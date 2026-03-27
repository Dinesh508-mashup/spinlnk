// ===== SpinLnk — Join Queue Page =====

const JoinQueue = (() => {
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

  let machineId = null;
  let timerInterval = null;

  // ----- Helpers -----
  function getMachines() {
    const definitions = getStore('adminMachineList', [
      { id: 'A', name: 'Machine A', type: 'washer' },
      { id: 'B', name: 'Machine B', type: 'washer' },
    ]);
    const saved = getStore('machineState', []);
    return definitions.map(d => {
      const base = { id: d.id, name: d.name, status: 'free', user: null, room: null, cycle: null, endTime: null };
      const s = saved.find(m => m.id === d.id);
      if (!s) return base;
      if (s.status === 'in-use' && s.endTime && Date.now() >= s.endTime) {
        return base;
      }
      return { ...base, ...s };
    });
  }

  function getMachine(id) {
    return getMachines().find(m => m.id === id);
  }

  function getQueues() {
    return getStore('machineQueues', {});
  }

  function saveQueues(queues) {
    setStore('machineQueues', queues);
  }

  function formatMinsLeft(endTime) {
    const remaining = Math.max(0, endTime - Date.now());
    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  function timeAgo(timestamp) {
    if (!timestamp) return 'just now';
    const diff = Math.floor((Date.now() - timestamp) / 60000);
    if (diff < 1) return 'just now';
    if (diff === 1) return '1 min ago';
    if (diff < 60) return `${diff}m ago`;
    return `${Math.floor(diff / 60)}h ago`;
  }

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

  function showStep(stepId) {
    $$('.screen').forEach(s => s.classList.remove('active'));
    $(`#${stepId}`).classList.add('active');
  }

  function requestNotifications() {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  function sendNotification(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body, icon: 'icons/icon-192.svg' });
    }
  }

  // ===== STEP 1: Form =====
  function initForm() {
    const machine = getMachine(machineId);
    if (!machine) {
      showToast('Machine not found.');
      return;
    }

    // Machine is free — show scan prompt
    if (machine.status === 'free') {
      showStep('step-free');
      $('#free-machine-name').textContent = `${machine.name} is now available`;
      return;
    }

    // Set title
    $('#jq-title').textContent = `Join Queue for ${machine.name}`;

    // Estimated wait
    const minsLeft = Math.ceil(Math.max(0, machine.endTime - Date.now()) / 60000);
    $('#jq-wait-time').textContent = minsLeft;

    // Pre-fill
    $('#input-name').value = localStorage.getItem('userName') || '';
    $('#input-room').value = localStorage.getItem('userRoom') || '';

    // Already in queue? Skip to step 2
    const queues = getQueues();
    const queue = queues[machineId] || [];
    const userName = localStorage.getItem('userName') || '';
    if (userName && queue.some(q => q.name === userName)) {
      showQueuedScreen();
    }
  }

  // ===== Join =====
  function handleJoin() {
    const name = $('#input-name').value.trim();
    const room = $('#input-room').value.trim();

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

    const queues = getQueues();
    const queue = queues[machineId] || [];

    if (queue.some(q => q.name === name)) {
      showToast('You\'re already in this queue.');
      showQueuedScreen();
      return;
    }

    queue.push({ name, room, joinedAt: Date.now() });
    queues[machineId] = queue;
    saveQueues(queues);

    requestNotifications();
    showToast(`You're #${queue.length} in the queue! 🔔`);
    showQueuedScreen();
  }

  // ===== STEP 2: Queued =====
  function showQueuedScreen() {
    showStep('step-queued');

    const name = localStorage.getItem('userName');
    const room = localStorage.getItem('userRoom');
    const machine = getMachine(machineId);

    $('#queued-name').textContent = name;
    $('#queued-room').textContent = `Room ${room}`;
    $('#queued-machine-info').textContent = machine ? machine.name : `Machine ${machineId}`;

    updateQueuedStatus();
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(updateQueuedStatus, 1000);
  }

  function updateQueuedStatus() {
    const machine = getMachine(machineId);
    const queues = getQueues();
    const queue = queues[machineId] || [];
    const userName = localStorage.getItem('userName');

    // Machine became free
    if (!machine || machine.status === 'free' || (machine.endTime && Date.now() >= machine.endTime)) {
      if (timerInterval) clearInterval(timerInterval);
      sendNotification(`🎉 Machine ${machineId} is FREE!`, `${machine ? machine.name : 'Machine'} is now available. Go grab it!`);

      queues[machineId] = queue.filter(q => q.name !== userName);
      saveQueues(queues);

      showStep('step-free');
      $('#free-machine-name').textContent = `${machine ? machine.name : 'Machine ' + machineId} is now available`;
      return;
    }

    // Timer
    $('#queued-timer').textContent = formatMinsLeft(machine.endTime);

    // Progress
    const cycleDurations = { Quick: 30, Normal: 45, Heavy: 60 };
    const totalMs = (cycleDurations[machine.cycle] || 45) * 60 * 1000;
    const elapsed = totalMs - (machine.endTime - Date.now());
    const progress = Math.min(100, Math.max(0, (elapsed / totalMs) * 100));
    $('#queued-progress').style.width = `${progress}%`;

    // Position
    const myIndex = queue.findIndex(q => q.name === userName);
    if (myIndex === -1) {
      showToast('You were removed from the queue.');
      showStep('step-form');
      initForm();
      return;
    }
    $('#queued-position').textContent = `#${myIndex + 1}`;

    // Queue list
    $('#queued-list').innerHTML = queue.map((q, i) => {
      const isMe = q.name === userName;
      return `
        <div class="jq-person ${isMe ? 'jq-person-me' : ''}">
          <div class="jq-avatar">${q.name.charAt(0).toUpperCase()}</div>
          <div class="jq-person-info">
            <span class="jq-person-name">${q.name}${isMe ? ' (You)' : ''}${q.room ? ' • Room ' + q.room : ''}</span>
            <span class="jq-person-detail">Joined ${timeAgo(q.joinedAt)}</span>
          </div>
          <span class="jq-person-pos">#${i + 1}</span>
        </div>
      `;
    }).join('');
  }

  // ===== Leave =====
  function handleLeave() {
    const name = localStorage.getItem('userName');
    const queues = getQueues();
    queues[machineId] = (queues[machineId] || []).filter(q => q.name !== name);
    saveQueues(queues);
    if (timerInterval) clearInterval(timerInterval);
    showToast('You left the queue.');
    window.location.href = 'queue.html';
  }

  // ===== Init =====
  function init() {
    const params = new URLSearchParams(window.location.search);
    machineId = (params.get('machine') || 'A').toUpperCase();

    initForm();

    $('#btn-join').addEventListener('click', handleJoin);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
