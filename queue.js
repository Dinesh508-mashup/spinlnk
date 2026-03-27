// ===== SpinLnk — Queue Page =====

const Queue = (() => {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ----- Hostel ID from URL -----
  const urlParams = new URLSearchParams(window.location.search);
  const hostelId = urlParams.get('hostel') || localStorage.getItem('spinlnk_userHostel') || null;
  if (hostelId) localStorage.setItem('spinlnk_userHostel', hostelId);

  function hKey(name) { return hostelId ? `spinlnk_${hostelId}_${name}` : name; }
  function getStore(name, fallback) {
    const raw = localStorage.getItem(hKey(name));
    return raw ? JSON.parse(raw) : fallback;
  }
  function setStore(name, value) { localStorage.setItem(hKey(name), JSON.stringify(value)); }

  // Read shared machine state from localStorage (synced with admin panel)
  function getMachines() {
    const definitions = getStore('adminMachineList', [
      { id: 'A', name: 'Machine A', type: 'washer' },
      { id: 'B', name: 'Machine B', type: 'washer' },
    ]);
    const saved = getStore('machineState', []);
    return definitions.map(d => {
      const base = { id: d.id, name: d.name, type: d.type || 'washer', status: 'free', user: null, room: null, cycle: null, endTime: null };
      const s = saved.find(m => m.id === d.id);
      if (!s) return base;
      if (s.status === 'in-use' && s.endTime && Date.now() >= s.endTime) {
        return base;
      }
      return { ...base, ...s };
    });
  }

  function getQueues() {
    return getStore('machineQueues', {});
  }

  function saveQueues(queues) {
    setStore('machineQueues', queues);
  }

  function getUserName() {
    return localStorage.getItem('userName') || '';
  }

  function formatMinsLeft(endTime) {
    return Math.max(0, Math.ceil((endTime - Date.now()) / 60000));
  }

  function timeAgo(timestamp) {
    if (!timestamp) return 'just now';
    const diff = Math.floor((Date.now() - timestamp) / 60000);
    if (diff < 1) return 'just now';
    if (diff === 1) return '1 min ago';
    if (diff < 60) return `${diff}m ago`;
    return `${Math.floor(diff / 60)}h ago`;
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

  // ----- Fetch real-time data from Supabase -----
  async function fetchLiveData() {
    if (!hostelId) return null;
    try {
      const dbMachines = await Supabase.getMachines(hostelId);

      const machines = [];
      const queueMap = {};

      dbMachines.forEach(m => {
        const machine = {
          id: m.machine_key,
          name: m.name,
          type: m.type || 'washer',
          status: m.status || 'free',
          user: m.user_name || null,
          room: m.room || null,
          cycle: m.cycle || null,
          endTime: m.end_time || null,
        };
        // Auto-free if timer expired
        if (machine.status === 'in-use' && machine.endTime && Date.now() >= machine.endTime) {
          machine.status = 'free';
          machine.user = null;
          machine.room = null;
          machine.cycle = null;
          machine.endTime = null;
          // Update DB to free
          Supabase.updateMachine(hostelId, m.machine_key, {
            status: 'free', user_name: null, room: null, cycle: null, end_time: null,
          }).catch(() => {});
        }
        machines.push(machine);

        // Queue comes from queue_members column
        queueMap[m.machine_key] = m.queue_members || [];
      });

      // Sync to localStorage
      const list = dbMachines.map(m => ({ id: m.machine_key, name: m.name, type: m.type }));
      setStore('adminMachineList', list);
      setStore('machineState', machines.map(m => ({
        id: m.id, status: m.status, user: m.user, room: m.room, cycle: m.cycle, endTime: m.endTime,
      })));
      setStore('machineQueues', queueMap);

      return { machines, queues: queueMap };
    } catch (err) {
      console.error('Supabase fetch error:', err);
      return null;
    }
  }

  // ----- Render In-Use Machines with Queue -----
  async function render() {
    // Try fetching live data, fall back to localStorage
    const live = await fetchLiveData();
    const machines = live ? live.machines : getMachines();
    const queues = live ? live.queues : getQueues();
    const userName = getUserName();

    const queueContainer = $('#queue-machine-list');
    const availableContainer = $('#queue-available-machines');

    let queueHTML = '';
    let availableHTML = '';

    machines.forEach(m => {
      const queue = queues[m.id] || [];
      const isInQueue = queue.some(q => q.name === userName && userName);

      if (m.status === 'in-use' && m.endTime) {
        // --- In-use machine: show queue card ---
        const minsLeft = formatMinsLeft(m.endTime);

        let peopleHTML = '';
        if (queue.length > 0) {
          peopleHTML = '<div class="queue-list">' + queue.map((q, i) => `
            <div class="queue-person">
              <div class="queue-avatar">${q.name.charAt(0).toUpperCase()}</div>
              <div class="queue-person-info">
                <span class="queue-person-name">${q.name}</span>
                <span class="queue-person-detail">${q.room ? 'Room ' + q.room + ' • ' : ''}Joined ${timeAgo(q.joinedAt)}</span>
              </div>
              <span class="queue-position">#${i + 1}</span>
            </div>
          `).join('') + '</div>';
        } else {
          peopleHTML = '<p class="queue-empty">No one in queue yet. Be the first! 🎉</p>';
        }

        let actionBtn;
        const hostelParam = hostelId ? `&hostel=${hostelId}` : '';
        if (isInQueue) {
          actionBtn = `<a href="join-queue.html?machine=${m.id}${hostelParam}" class="btn-leave-queue" style="text-decoration:none;display:block;text-align:center;">View Queue</a>`;
        } else {
          actionBtn = `<a href="join-queue.html?machine=${m.id}${hostelParam}" class="btn-join-queue" style="text-decoration:none;display:block;text-align:center;">Join Queue ✌️</a>`;
        }

        queueHTML += `
          <div class="queue-machine-card">
            <div class="queue-machine-card-icon">📋</div>
            <h3>Queue — ${m.name}</h3>
            <p class="queue-subtitle">${queue.length === 0 ? 'No one in queue yet. Be the first!' : queue.length + ' in queue'}</p>
            <div class="queue-card-status in-use">
              <span class="status-dot red"></span> IN USE — ${minsLeft} MIN LEFT
            </div>
            <p style="font-size:13px;color:var(--text-light);margin-bottom:8px;">
              Reserved by ${m.user}${m.room ? ' • Room ' + m.room : ''}
            </p>
            ${peopleHTML}
            ${actionBtn}
          </div>
        `;
      } else {
        // --- Free machine: show status only, must scan QR to book ---
        availableHTML += `
          <div class="available-machine-card">
            <div class="available-machine-header">
              <div>
                <span class="available-tag">AVAILABLE</span>
                <h3 class="available-machine-name">${m.name}</h3>
                <p class="available-machine-sub">Ready for your laundry load</p>
              </div>
              <div class="available-machine-icon">🫧</div>
            </div>
            <div class="scan-to-book">
              <span class="scan-icon">📷</span>
              <span class="scan-text">Scan the QR code on the machine to book</span>
            </div>
          </div>
        `;
      }
    });

    // If no machines are in use, show a friendly message
    if (!queueHTML) {
      queueHTML = `
        <div class="queue-machine-card">
          <div class="queue-machine-card-icon">🎉</div>
          <h3>All machines are free!</h3>
          <p class="queue-subtitle">No need to queue — go start a wash.</p>
        </div>
      `;
    }

    queueContainer.innerHTML = queueHTML;
    availableContainer.innerHTML = availableHTML;
  }

  // ----- Join Queue -----
  async function joinQueue(machineId) {
    const name = getUserName();
    if (!name) {
      showNameModal(machineId);
      return;
    }

    const room = localStorage.getItem('userRoom') || '';

    if (hostelId) {
      try {
        const updatedQueue = await Supabase.joinMachineQueue(hostelId, machineId, name, room);
        const pos = updatedQueue.findIndex(q => q.name === name) + 1;
        if (pos === 0) {
          showToast('You\'re already in this queue.');
          return;
        }
        await render();
        showToast(`You're #${pos} in queue for Machine ${machineId}! 🔔`);
      } catch (err) {
        console.error('DB queue join error:', err);
        showToast('Failed to join queue. Try again.');
      }
    } else {
      const queues = getQueues();
      const queue = queues[machineId] || [];
      if (queue.some(q => q.name === name)) {
        showToast('You\'re already in this queue.');
        return;
      }
      queue.push({ name, room, joinedAt: Date.now() });
      queues[machineId] = queue;
      saveQueues(queues);
      await render();
      showToast(`You're #${queue.length} in queue for Machine ${machineId}! 🔔`);
    }
    requestNotifications();
  }

  // ----- Leave Queue -----
  async function leaveQueue(machineId) {
    const name = getUserName();

    if (hostelId) {
      try { await Supabase.leaveMachineQueue(hostelId, machineId, name); }
      catch (err) { console.error('DB queue leave error:', err); }
    } else {
      const queues = getQueues();
      queues[machineId] = (queues[machineId] || []).filter(q => q.name !== name);
      saveQueues(queues);
    }

    await render();
    showToast('You left the queue.');
  }

  // ----- Name Modal -----
  let pendingMachineId = null;

  function showNameModal(machineId) {
    pendingMachineId = machineId;
    const modal = $('#name-modal');
    modal.style.display = 'flex';
    $('#modal-name').value = '';
    $('#modal-room').value = '';
    $('#modal-name').focus();
  }

  function hideNameModal() {
    $('#name-modal').style.display = 'none';
    pendingMachineId = null;
  }

  function saveNameAndJoin() {
    const name = $('#modal-name').value.trim();
    const room = $('#modal-room').value.trim();
    if (!name) {
      showToast('Please enter your name.');
      return;
    }
    if (!room) {
      showToast('Please enter your room number.');
      return;
    }
    localStorage.setItem('userName', name);
    localStorage.setItem('userRoom', room);
    hideNameModal();
    if (pendingMachineId) joinQueue(pendingMachineId);
  }

  // ----- Notifications -----
  function requestNotifications() {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  // ----- Auto-refresh -----
  function startAutoRefresh() {
    render();
    setInterval(render, 15000);
  }

  // ----- Show hostel name -----
  async function showHostelInfo() {
    const label = $('#queue-hostel-name');
    if (!label) return;
    if (!hostelId) {
      label.textContent = 'No hostel linked. Scan a valid QR code.';
      return;
    }
    try {
      const hostel = await Supabase.getHostel(hostelId);
      if (hostel) {
        label.textContent = hostel.name;
      } else {
        label.textContent = `Hostel: ${hostelId}`;
      }
    } catch (e) {
      label.textContent = `Hostel: ${hostelId}`;
    }
  }

  // ----- Init -----
  async function init() {
    await showHostelInfo();

    if (!hostelId) {
      $('#queue-machine-list').innerHTML = '<p class="empty-state">No hostel linked. Scan a valid QR code to view machines.</p>';
      return;
    }

    startAutoRefresh();

    $('#modal-save').addEventListener('click', saveNameAndJoin);
    $('#modal-cancel').addEventListener('click', hideNameModal);
    $('.modal-backdrop').addEventListener('click', hideNameModal);
  }

  document.addEventListener('DOMContentLoaded', init);

  return { joinQueue, leaveQueue };
})();
