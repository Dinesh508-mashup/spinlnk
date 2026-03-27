// ===== SpinLnk — Admin Panel =====

const Admin = (() => {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  let hostelId = null;

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
        if (hostel.password !== password) {
          showToast('Invalid password. Try again.');
          return;
        }
      } else {
        // New hostel — register + add default machines
        await Supabase.createHostel(normalizedId, hostelInput, password);
        await Supabase.addMachine(normalizedId, 'A', 'Machine A', 'washer');
        await Supabase.addMachine(normalizedId, 'B', 'Machine B', 'washer');
      }

      hostelId = normalizedId;
      localStorage.setItem('spinlnk_activeHostel', normalizedId);
      localStorage.setItem('spinlnk_adminLoggedIn', 'true');

      updateHostelLabel();
      showScreen('admin-panel');
      await renderPanel();
      showToast(`Welcome! Hostel: ${hostelInput}`);
    } catch (err) {
      console.error('Login error:', err);
      showToast('Connection error. Please try again.');
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

  function togglePassword() {
    const input = $('#admin-password');
    input.type = input.type === 'password' ? 'text' : 'password';
  }

  // ----- Render Admin Panel (ALL data from Supabase) -----
  async function renderPanel() {
    updateHostelLabel();
    await Promise.all([renderStats(), renderMachineList()]);
  }

  async function renderStats() {
    let history = [];
    try {
      history = await Supabase.getWashHistory(hostelId);
    } catch (err) {
      console.error('Stats fetch error:', err);
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

  // Fetch machines directly from Supabase — no localStorage
  async function renderMachineList() {
    const list = $('#admin-machine-list');
    let machines = [];

    try {
      machines = await Supabase.getMachines(hostelId);
    } catch (err) {
      console.error('Machine fetch error:', err);
      list.innerHTML = '<p class="empty-state">Failed to load machines.</p>';
      return;
    }

    list.innerHTML = machines.map(m => {
      const isFree = m.status === 'free' || (m.status === 'in-use' && m.end_time && Date.now() >= m.end_time);
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
          <button class="admin-delete-btn" onclick="Admin.deleteMachine('${m.machine_key}')">🗑</button>
        </div>
      `;
    }).join('');
  }

  // ----- Add Machine (directly to Supabase) -----
  async function addMachine() {
    try {
      const machines = await Supabase.getMachines(hostelId);
      const existingKeys = machines.map(m => m.machine_key);

      const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      let nextLetter = null;
      for (let i = 0; i < letters.length; i++) {
        if (!existingKeys.includes(letters[i])) {
          nextLetter = letters[i];
          break;
        }
      }

      if (!nextLetter) {
        showToast('Maximum machines reached.');
        return;
      }

      await Supabase.addMachine(hostelId, nextLetter, `Machine ${nextLetter}`, 'washer');
      await renderMachineList();
      showToast(`Machine ${nextLetter} added!`);
    } catch (err) {
      console.error('Add machine error:', err);
      showToast('Failed to add machine.');
    }
  }

  // ----- Delete Machine (actually delete from Supabase) -----
  async function deleteMachine(machineKey) {
    try {
      await Supabase.deleteMachine(hostelId, machineKey);
      await renderMachineList();
      showToast(`Machine ${machineKey} deleted.`);
    } catch (err) {
      console.error('Delete machine error:', err);
      showToast('Failed to delete machine.');
    }
  }

  // ===== QR Code Generation =====
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
    const machineUrl = `${baseUrl}index.html?hostel=${hostelId}`;
    const roomUrl = `${baseUrl}queue.html?hostel=${hostelId}`;

    drawQR('qr-machine-container', machineUrl);
    drawQR('qr-room-container', roomUrl);

    try {
      await Supabase.updateHostelQR(hostelId, machineUrl, roomUrl);
    } catch (err) { console.error('QR save error:', err); }
  }

  function downloadQRAsSVG(containerId, filename) {
    const container = document.getElementById(containerId);
    const img = container ? container.querySelector('img') : null;
    if (!img) return;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
      <image href="${img.src}" width="200" height="200"/>
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
    const win = window.open('', '_blank');
    win.document.write(`
      <html><head><title>Print QR</title><style>
        body { display:flex; justify-content:center; align-items:center; min-height:100vh; margin:0; }
        img { width:300px; height:300px; }
      </style></head><body>
        <img src="${img.src}" onload="window.print();window.close();">
      </body></html>
    `);
    win.document.close();
  }

  // ----- Init -----
  function init() {
    const savedHostel = localStorage.getItem('spinlnk_activeHostel');
    if (localStorage.getItem('spinlnk_adminLoggedIn') === 'true' && savedHostel) {
      hostelId = savedHostel;
      showScreen('admin-panel');
      renderPanel();
    }

    $('#btn-login').addEventListener('click', handleLogin);
    $('#btn-logout').addEventListener('click', handleLogout);
    $('#toggle-password').addEventListener('click', togglePassword);
    $('#btn-add-machine').addEventListener('click', addMachine);

    $('#btn-qr').addEventListener('click', () => {
      showScreen('admin-qr');
      renderQRScreen();
    });
    $('#btn-qr-back').addEventListener('click', () => {
      showScreen('admin-panel');
      renderPanel();
    });
    $('#btn-logout-qr').addEventListener('click', handleLogout);

    $('#btn-download-machine-qr').addEventListener('click', () => {
      downloadQRAsSVG('qr-machine-container', `spinlnk-${hostelId}-machine-qr.svg`);
    });
    $('#btn-print-machine-qr').addEventListener('click', () => printQR('qr-machine-container'));
    $('#btn-download-room-qr').addEventListener('click', () => downloadQRAsSVG('qr-room-container', `spinlnk-${hostelId}-room-qr.svg`));
    $('#btn-print-room-qr').addEventListener('click', () => printQR('qr-room-container'));

    $('#admin-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleLogin(); });
    $('#admin-hostel-id').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleLogin(); });

    // Auto-refresh every 10s
    setInterval(() => {
      if (localStorage.getItem('spinlnk_adminLoggedIn') === 'true' && hostelId) {
        renderPanel();
      }
    }, 10000);
  }

  document.addEventListener('DOMContentLoaded', init);

  return { deleteMachine };
})();
