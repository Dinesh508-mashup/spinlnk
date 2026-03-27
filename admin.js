// ===== SpinLnk — Admin Panel =====

const Admin = (() => {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ----- Hostel-scoped storage helpers -----
  let hostelId = null; // set on login

  function key(name) {
    return `spinlnk_${hostelId}_${name}`;
  }

  function getStore(name, fallback) {
    const raw = localStorage.getItem(key(name));
    return raw ? JSON.parse(raw) : fallback;
  }

  function setStore(name, value) {
    localStorage.setItem(key(name), JSON.stringify(value));
  }

  // ----- Screen navigation -----
  function showScreen(screenId) {
    $$('.admin-screen').forEach(s => s.classList.remove('active'));
    const screen = $(`#${screenId}`);
    if (screen) screen.classList.add('active');
  }

  // ----- Toast -----
  function showToast(message) {
    let toast = $('.toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
  }

  // =============================================
  // Single source of truth: adminMachineList
  // Stores all machine definitions [{id, name, type}]
  // Scoped per hostel ID
  // =============================================
  function getMachineList() {
    const saved = getStore('machineList', null);
    if (saved) return saved;
    // First time: default A and B
    const defaults = [
      { id: 'A', name: 'Machine A', type: 'washer' },
      { id: 'B', name: 'Machine B', type: 'washer' },
    ];
    setStore('machineList', defaults);
    // Also write to shared key so index.html can read it
    syncToShared(defaults);
    return defaults;
  }

  function saveMachineList(list) {
    setStore('machineList', list);
    syncToShared(list);

    // Also clean up machineState for deleted machines
    const machineState = getStore('machineState', []);
    const listIds = list.map(m => m.id);
    const updatedState = machineState.filter(m => listIds.includes(m.id));
    setStore('machineState', updatedState);
  }

  // Write to shared keys that index.html/queue.html read
  function syncToShared(list) {
    // The main app reads adminMachineList + hostelId
    localStorage.setItem(`spinlnk_${hostelId}_adminMachineList`, JSON.stringify(list));
  }

  // Get full machine data (merge definitions with live state)
  function getFullMachines() {
    const list = getMachineList();
    const state = getStore('machineState', []);

    return list.map(def => {
      const live = state.find(s => s.id === def.id);
      if (!live) {
        return { ...def, status: 'free', user: null, room: null, cycle: null, endTime: null };
      }
      if (live.status === 'in-use' && live.endTime && Date.now() >= live.endTime) {
        return { ...def, status: 'free', user: null, room: null, cycle: null, endTime: null };
      }
      return { ...def, ...live };
    });
  }

  // ----- Login (validates against Supabase) -----
  async function handleLogin() {
    const hostelInput = $('#admin-hostel-id').value.trim();
    const password = $('#admin-password').value;

    if (!hostelInput || !password) {
      showToast('Please fill in all fields.');
      return;
    }

    const normalizedId = hostelInput.toLowerCase().replace(/\s+/g, '_');

    try {
      const hostel = await Supabase.getHostel(normalizedId);

      if (hostel) {
        // Existing hostel — check password
        if (hostel.password !== password) {
          showToast('Invalid password. Try again.');
          return;
        }
      } else {
        // New hostel — register in Supabase
        await Supabase.createHostel(normalizedId, hostelInput, password);

        // Add default machines A and B
        await Supabase.addMachine(normalizedId, 'A', 'Machine A', 'washer');
        await Supabase.addMachine(normalizedId, 'B', 'Machine B', 'washer');
      }

      // Set active hostel
      hostelId = normalizedId;
      localStorage.setItem('spinlnk_activeHostel', normalizedId);
      localStorage.setItem('spinlnk_adminLoggedIn', 'true');

      // Sync machines to localStorage for offline use
      await syncMachinesToLocal();

      updateHostelLabel();
      showScreen('admin-panel');
      renderPanel();
      showToast(`Welcome! Hostel: ${hostelInput}`);
    } catch (err) {
      console.error('Login error:', err);
      showToast('Connection error. Please try again.');
    }
  }

  // Sync Supabase machines to localStorage so index.html works
  async function syncMachinesToLocal() {
    try {
      const machines = await Supabase.getMachines(hostelId);
      const list = machines.map(m => ({ id: m.machine_key, name: m.name, type: m.type }));
      setStore('adminMachineList', list);
      localStorage.setItem(`spinlnk_${hostelId}_adminMachineList`, JSON.stringify(list));
    } catch (err) {
      console.error('Sync error:', err);
    }
  }

  function handleLogout() {
    localStorage.removeItem('spinlnk_adminLoggedIn');
    localStorage.removeItem('spinlnk_activeHostel');
    hostelId = null;
    showScreen('admin-login');
    showToast('Logged out.');
  }

  function updateHostelLabel() {
    const label = $('#admin-hostel-label');
    if (label && hostelId) {
      label.textContent = `Hostel: ${hostelId}`;
    }
  }

  // ----- Toggle password visibility -----
  function togglePassword() {
    const input = $('#admin-password');
    input.type = input.type === 'password' ? 'text' : 'password';
  }

  // ----- Render Admin Panel -----
  function renderPanel() {
    updateHostelLabel();
    renderStats();
    renderMachineList();
  }

  async function renderStats() {
    // Fetch wash history from Supabase
    let history = [];
    if (hostelId) {
      try {
        history = await Supabase.getWashHistory(hostelId);
      } catch (err) {
        console.error('Stats fetch error:', err);
        history = getStore('washHistory', []);
      }
    } else {
      history = getStore('washHistory', []);
    }

    $('#stat-total-washes').textContent = history.length;

    if (history.length > 0) {
      const durations = history.filter(h => typeof h.duration === 'number').map(h => h.duration);
      const avg = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
      $('#stat-avg-wait').innerHTML = `${avg}<small>m</small>`;
    }

    const hour = new Date().getHours();
    if (hour >= 17 && hour <= 20) {
      $('#stat-peak-hour').textContent = '6PM';
    } else if (hour >= 12 && hour < 17) {
      $('#stat-peak-hour').textContent = '2PM';
    } else {
      $('#stat-peak-hour').textContent = '8PM';
    }
  }

  function renderMachineList() {
    const machines = getFullMachines();
    const list = $('#admin-machine-list');

    list.innerHTML = machines.map(m => {
      const isFree = m.status === 'free';
      const statusClass = isFree ? 'active' : 'in-use';
      const statusText = isFree ? 'ACTIVE' : 'IN USE';
      const typeLabel = (m.type || 'washer').toUpperCase();
      const icon = m.type === 'dryer' ? '🌀' : '🧺';

      return `
        <div class="admin-machine-card">
          <div class="admin-machine-icon">${icon}</div>
          <div class="admin-machine-info">
            <span class="admin-machine-name">${m.name}</span>
            <span class="admin-machine-meta">${typeLabel} • <span class="admin-machine-status ${statusClass}">${statusText}</span></span>
          </div>
          <button class="admin-delete-btn" onclick="Admin.deleteMachine('${m.id}')">🗑</button>
        </div>
      `;
    }).join('');
  }

  // ----- Add Machine -----
  async function addMachine() {
    const list = getMachineList();
    const existingIds = list.map(m => m.id);

    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let nextLetter = null;
    for (let i = 0; i < letters.length; i++) {
      if (!existingIds.includes(letters[i])) {
        nextLetter = letters[i];
        break;
      }
    }

    if (!nextLetter) {
      showToast('Maximum machines reached.');
      return;
    }

    list.push({ id: nextLetter, name: `Machine ${nextLetter}`, type: 'washer' });
    saveMachineList(list);

    // Save to Supabase
    try {
      await Supabase.addMachine(hostelId, nextLetter, `Machine ${nextLetter}`, 'washer');
    } catch (err) { console.error('DB add error:', err); }

    renderMachineList();
    showToast(`Machine ${nextLetter} added!`);
  }

  // ----- Delete Machine -----
  async function deleteMachine(machineId) {
    const list = getMachineList();
    const updated = list.filter(m => m.id !== machineId);

    if (updated.length === list.length) {
      showToast('Machine not found.');
      return;
    }

    saveMachineList(updated);

    // Delete from Supabase
    try {
      await Supabase.deleteMachine(hostelId, machineId);
      await Supabase.clearMachineQueue(hostelId, machineId);
    } catch (err) { console.error('DB delete error:', err); }

    // Clear local queue
    const queues = getStore('machineQueues', {});
    delete queues[machineId];
    setStore('machineQueues', queues);

    renderMachineList();
    showToast(`Machine ${machineId} removed.`);
  }

  // ===== QR Code Generation (using qrcode-generator library) =====
  function drawQR(containerId, text) {
    const container = document.getElementById(containerId);
    if (!container) return;
    try {
      const qr = qrcode(0, 'M');
      qr.addData(text);
      qr.make();
      container.innerHTML = qr.createImgTag(5, 10);
      const img = container.querySelector('img');
      if (img) {
        img.style.width = '200px';
        img.style.height = '200px';
        img.style.borderRadius = '4px';
        img.alt = 'QR Code';
      }
    } catch (err) {
      console.error('QR generation error:', err);
    }
  }

  async function renderQRScreen() {
    const baseUrl = SPINLNK_BASE_URL;

    // Machine QR — links to index.html with hostel param
    const machineUrl = `${baseUrl}index.html?hostel=${hostelId}`;
    drawQR('qr-machine-container', machineUrl);

    // Room QR — links to queue.html with hostel param
    const roomUrl = `${baseUrl}queue.html?hostel=${hostelId}`;
    drawQR('qr-room-container', roomUrl);

    // Save QR URLs to Supabase
    try {
      await Supabase.updateHostelQR(hostelId, machineUrl, roomUrl);
    } catch (err) { console.error('QR save error:', err); }
  }

  function downloadQRAsSVG(containerId, filename) {
    const container = document.getElementById(containerId);
    const img = container ? container.querySelector('img') : null;
    if (!img) return;
    const dataUrl = img.src;

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
      <image href="${dataUrl}" width="200" height="200"/>
    </svg>`;

    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    showToast('QR downloaded!');
  }

  function printQR(containerId) {
    const container = document.getElementById(containerId);
    const img = container ? container.querySelector('img') : null;
    if (!img) return;
    const dataUrl = img.src;
    const win = window.open('', '_blank');
    win.document.write(`
      <html><head><title>Print QR</title><style>
        body { display:flex; justify-content:center; align-items:center; min-height:100vh; margin:0; }
        img { width:300px; height:300px; }
      </style></head><body>
        <img src="${dataUrl}" onload="window.print();window.close();">
      </body></html>
    `);
    win.document.close();
  }

  // ----- Init -----
  function init() {
    // Check if already logged in
    const savedHostel = localStorage.getItem('spinlnk_activeHostel');
    if (localStorage.getItem('spinlnk_adminLoggedIn') === 'true' && savedHostel) {
      hostelId = savedHostel;
      showScreen('admin-panel');
      renderPanel();
    }

    // Event listeners
    $('#btn-login').addEventListener('click', handleLogin);
    $('#btn-logout').addEventListener('click', handleLogout);
    $('#toggle-password').addEventListener('click', togglePassword);
    $('#btn-add-machine').addEventListener('click', addMachine);

    // QR screen
    $('#btn-qr').addEventListener('click', () => {
      showScreen('admin-qr');
      renderQRScreen();
    });
    $('#btn-qr-back').addEventListener('click', () => {
      showScreen('admin-panel');
      renderPanel();
    });
    $('#btn-logout-qr').addEventListener('click', handleLogout);

    // QR download/print
    $('#btn-download-machine-qr').addEventListener('click', () => {
      downloadQRAsSVG('qr-machine-container', `spinlnk-${hostelId}-machine-qr.svg`);
    });
    $('#btn-print-machine-qr').addEventListener('click', () => printQR('qr-machine-container'));
    $('#btn-download-room-qr').addEventListener('click', () => downloadQRAsSVG('qr-room-container', `spinlnk-${hostelId}-room-qr.svg`));
    $('#btn-print-room-qr').addEventListener('click', () => printQR('qr-room-container'));

    // Enter key on login
    $('#admin-password').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleLogin();
    });
    $('#admin-hostel-id').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleLogin();
    });

    // Auto-refresh panel every 10s
    setInterval(() => {
      if (localStorage.getItem('spinlnk_adminLoggedIn') === 'true' && hostelId) {
        renderPanel();
      }
    }, 10000);
  }

  document.addEventListener('DOMContentLoaded', init);

  return { deleteMachine };
})();
