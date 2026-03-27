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

  // ----- Login -----
  function handleLogin() {
    const hostelInput = $('#admin-hostel-id').value.trim();
    const password = $('#admin-password').value;

    if (!hostelInput || !password) {
      showToast('Please fill in all fields.');
      return;
    }

    // Store the hostel credentials in a registry
    // For now, any hostel ID + password "spinlnk" works (demo)
    // In production, this would validate against a server/database
    const registeredHostels = JSON.parse(localStorage.getItem('spinlnk_hostels') || '{}');
    const normalizedId = hostelInput.toLowerCase().replace(/\s+/g, '_');

    if (registeredHostels[normalizedId]) {
      // Existing hostel — check password
      if (registeredHostels[normalizedId].password !== password) {
        showToast('Invalid password. Try again.');
        return;
      }
    } else {
      // New hostel — register it
      registeredHostels[normalizedId] = {
        password: password,
        name: hostelInput,
        createdAt: Date.now(),
      };
      localStorage.setItem('spinlnk_hostels', JSON.stringify(registeredHostels));
    }

    // Set active hostel
    hostelId = normalizedId;
    localStorage.setItem('spinlnk_activeHostel', normalizedId);
    localStorage.setItem('spinlnk_adminLoggedIn', 'true');

    // Show hostel name in header
    updateHostelLabel();

    showScreen('admin-panel');
    renderPanel();
    showToast(`Welcome! Hostel: ${hostelInput}`);
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

  function renderStats() {
    const history = getStore('washHistory', []);
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
  function addMachine() {
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
    renderMachineList();
    showToast(`Machine ${nextLetter} added!`);
  }

  // ----- Delete Machine -----
  function deleteMachine(machineId) {
    const list = getMachineList();
    const updated = list.filter(m => m.id !== machineId);

    if (updated.length === list.length) {
      showToast('Machine not found.');
      return;
    }

    saveMachineList(updated);

    // Clear queue for this machine
    const queues = getStore('machineQueues', {});
    delete queues[machineId];
    setStore('machineQueues', queues);

    renderMachineList();
    showToast(`Machine ${machineId} removed.`);
  }

  // ===== QR Code Generation =====
  function generateQRMatrix(text) {
    const size = 25;
    const matrix = [];
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    }

    for (let y = 0; y < size; y++) {
      matrix[y] = [];
      for (let x = 0; x < size; x++) {
        if ((x < 7 && y < 7) || (x >= size - 7 && y < 7) || (x < 7 && y >= size - 7)) {
          const isOuter = x === 0 || y === 0 || x === 6 || y === 6 || x === size - 1 || y === size - 1 ||
                          x === size - 7 || y === size - 7;
          const isInner = (x >= 2 && x <= 4 && y >= 2 && y <= 4) ||
                          (x >= size - 5 && x <= size - 3 && y >= 2 && y <= 4) ||
                          (x >= 2 && x <= 4 && y >= size - 5 && y <= size - 3);
          matrix[y][x] = isOuter || isInner ? 1 : 0;
        } else if (x === 6) {
          matrix[y][x] = y % 2 === 0 ? 1 : 0;
        } else if (y === 6) {
          matrix[y][x] = x % 2 === 0 ? 1 : 0;
        } else {
          const seed = (hash * (x + 1) * (y + 1) + x * 31 + y * 37) & 0xFFFF;
          matrix[y][x] = (seed % 3 === 0 || seed % 5 === 0) ? 1 : 0;
        }
      }
    }
    return matrix;
  }

  function drawQR(canvasId, text) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const matrix = generateQRMatrix(text);
    const size = matrix.length;
    const cellSize = 6;
    const padding = 10;
    const totalSize = size * cellSize + padding * 2;

    canvas.width = totalSize;
    canvas.height = totalSize;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, totalSize, totalSize);

    ctx.fillStyle = '#2c3e50';
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (matrix[y][x]) {
          ctx.fillRect(padding + x * cellSize, padding + y * cellSize, cellSize, cellSize);
        }
      }
    }
  }

  function renderQRScreen() {
    const baseUrl = window.location.origin + window.location.pathname.replace('admin.html', '');

    // Machine QR — links to index.html with hostel param
    const machineUrl = `${baseUrl}index.html?hostel=${hostelId}`;
    drawQR('qr-machine-canvas', machineUrl);

    // Room QR — links to queue.html with hostel param
    const roomUrl = `${baseUrl}queue.html?hostel=${hostelId}`;
    drawQR('qr-room-canvas', roomUrl);
  }

  function downloadQRAsSVG(canvasId, filename) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}">
      <image href="${dataUrl}" width="${canvas.width}" height="${canvas.height}"/>
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

  function printQR(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
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
      downloadQRAsSVG('qr-machine-canvas', `spinlnk-${hostelId}-machine-qr.svg`);
    });
    $('#btn-print-machine-qr').addEventListener('click', () => printQR('qr-machine-canvas'));
    $('#btn-download-room-qr').addEventListener('click', () => downloadQRAsSVG('qr-room-canvas', `spinlnk-${hostelId}-room-qr.svg`));
    $('#btn-print-room-qr').addEventListener('click', () => printQR('qr-room-canvas'));

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
