// ===== SpinLnk — Hostel Laundry PWA =====

const App = (() => {
  // ----- Hostel ID from URL -----
  const urlParams = new URLSearchParams(window.location.search);
  const hostelId = urlParams.get('hostel') || localStorage.getItem('spinlnk_userHostel') || null;

  // Persist hostel ID so refreshes without ?hostel still work
  if (hostelId) {
    localStorage.setItem('spinlnk_userHostel', hostelId);
  }

  // Hostel-scoped storage helpers
  function hKey(name) {
    return hostelId ? `spinlnk_${hostelId}_${name}` : name;
  }

  function getStore(name, fallback) {
    const raw = localStorage.getItem(hKey(name));
    return raw ? JSON.parse(raw) : fallback;
  }

  function setStore(name, value) {
    localStorage.setItem(hKey(name), JSON.stringify(value));
  }

  // ----- State -----
  // Load machine definitions from admin panel (single source of truth, hostel-scoped)
  function getInitialMachines() {
    const list = getStore('adminMachineList', [
      { id: 'A', name: 'Machine A', type: 'washer' },
      { id: 'B', name: 'Machine B', type: 'washer' },
    ]);
    return list.map(m => ({
      id: m.id, name: m.name, status: 'free', user: null, room: null, cycle: null, endTime: null,
    }));
  }

  const state = {
    machines: getInitialMachines(),
    currentMachine: null,
    selectedCycle: { name: 'Normal', minutes: 45 },
    homeTimerInterval: null,
    bookingsTimerInterval: null,
    alarmedMachines: {},  // track which machines already triggered alarm
    history: getStore('washHistory', []),
  };

  // ----- DOM References -----
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ----- Screen Navigation -----
  function showScreen(screenId) {
    $$('.screen').forEach(s => s.classList.remove('active'));
    const screen = $(`#${screenId}`);
    if (screen) screen.classList.add('active');

    $$('.nav-item').forEach(n => {
      n.classList.toggle('active', n.dataset.screen === screenId);
    });

    // Refresh dynamic content when switching screens
    if (screenId === 'screen-home') renderMachines();
    if (screenId === 'screen-bookings') renderBookings();
    if (screenId === 'screen-queue') renderQueueStatus();
  }

  // ----- Toast Notification -----
  function showToast(message, duration = 3000) {
    let toast = $('.toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), duration);
  }

  // ----- Time helpers -----
  function formatTimeLeft(endTime) {
    const remaining = Math.max(0, endTime - Date.now());
    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    return `${mins}m ${secs}s left`;
  }

  function formatMinsLeft(endTime) {
    const remaining = Math.max(0, endTime - Date.now());
    return Math.ceil(remaining / 60000);
  }

  // ----- Alarm -----
  function triggerAlarm(machine) {
    const audio = document.getElementById('alarm-audio');
    const popup = document.getElementById('alarm-popup');
    const title = document.getElementById('alarm-popup-title');
    const sub = document.getElementById('alarm-popup-sub');

    title.textContent = `${machine.name} is almost done!`;
    sub.textContent = `Less than 1 minute remaining. Get ready to collect your clothes.`;
    popup.style.display = 'block';

    audio.currentTime = 0;
    audio.play().catch(() => {});

    sendNotification(`🔔 ${machine.name} almost done!`, `Less than 1 minute left. Get ready to collect your clothes.`);
  }

  function stopAlarm() {
    const audio = document.getElementById('alarm-audio');
    const popup = document.getElementById('alarm-popup');
    audio.pause();
    audio.currentTime = 0;
    popup.style.display = 'none';
  }

  // ----- Fetch live queue from Supabase -----
  async function fetchLiveQueues() {
    if (!hostelId) return null;
    try {
      const dbQueue = await Supabase.getQueueEntries(hostelId);
      const queueMap = {};
      dbQueue.forEach(q => {
        if (!queueMap[q.machine_key]) queueMap[q.machine_key] = [];
        queueMap[q.machine_key].push({
          name: q.user_name,
          room: q.room,
          joinedAt: new Date(q.joined_at).getTime(),
        });
      });
      setStore('machineQueues', queueMap);
      return queueMap;
    } catch (err) {
      console.error('Queue fetch error:', err);
      return null;
    }
  }

  // ----- Render Machine List (Home Dashboard) -----
  async function renderMachines() {
    const list = $('#machine-list');
    if (!list) return;

    // Fetch latest queue data from Supabase
    const liveQueues = await fetchLiveQueues();

    list.innerHTML = state.machines.map(m => {
      const isFree = m.status === 'free';

      if (isFree) {
        return `
          <div class="machine-card machine-card-free" data-machine="${m.id}">
            <div class="machine-card-row">
              <div>
                <div class="machine-status free">
                  <span class="status-dot green"></span> FREE
                </div>
                <h3 class="machine-name">${m.name}</h3>
                <p class="machine-sub">Available immediately</p>
              </div>
              <span class="machine-icon-small">🫧</span>
            </div>
            <button class="btn btn-primary btn-sm" onclick="App.onStartWash('${m.id}')">
              Book Now →
            </button>
          </div>
        `;
      } else {
        const minsLeft = formatMinsLeft(m.endTime);
        const queues = liveQueues || getStore('machineQueues', {});
        const queue = queues[m.id] || [];

        let queueHTML = '';
        if (queue.length > 0) {
          const queuePeople = queue.map((q, i) => `
            <div class="home-queue-person">
              <div class="home-queue-avatar">${q.name.charAt(0).toUpperCase()}</div>
              <div class="home-queue-info">
                <span class="home-queue-name">${q.name}</span>
                <span class="home-queue-detail">${q.room ? 'Room ' + q.room : ''}</span>
              </div>
              <span class="home-queue-pos">#${i + 1}</span>
            </div>
          `).join('');
          queueHTML = `
            <div class="home-queue-section">
              <span class="home-queue-label">👥 ${queue.length} in queue</span>
              ${queuePeople}
            </div>
          `;
        }

        return `
          <div class="machine-card machine-card-busy" data-machine="${m.id}">
            <div class="machine-card-row">
              <div>
                <div class="machine-status in-use">
                  <span class="status-dot red"></span> IN USE
                </div>
                <h3 class="machine-name">${m.name}</h3>
                <p class="machine-sub">Reserved by ${m.user}</p>
              </div>
              <span class="machine-icon-small">🌊</span>
            </div>
            <div class="machine-timer-row">
              <div class="mini-timer">
                <span class="mini-timer-value" data-end="${m.endTime}">${minsLeft}</span>
                <span class="mini-timer-unit">min</span>
              </div>
              <div class="mini-timer-info">
                <span class="mini-timer-phase">CYCLE PHASE</span>
                <span class="mini-timer-cycle">${m.cycle} Wash</span>
              </div>
            </div>
            ${queueHTML}
          </div>
        `;
      }
    }).join('');

    // Start a home-level interval to update mini timers
    if (state.homeTimerInterval) clearInterval(state.homeTimerInterval);
    state.homeTimerInterval = setInterval(() => {
      $$('.mini-timer-value').forEach(el => {
        const end = parseInt(el.dataset.end);
        if (end) {
          const mins = formatMinsLeft(end);
          el.textContent = mins;
          if (mins <= 0) renderMachines();
        }
      });

      // Check alarm trigger from home screen too
      state.machines.forEach(m => {
        if (m.status === 'in-use' && m.endTime) {
          const remaining = m.endTime - Date.now();
          if (remaining > 0 && remaining <= 60000 && !state.alarmedMachines[m.id]) {
            state.alarmedMachines[m.id] = true;
            triggerAlarm(m);
          }
        }
      });
    }, 1000);
  }

  // ----- Render Bookings Screen -----
  function renderBookings() {
    const activeSection = $('#bookings-active');
    const activeList = $('#bookings-active-list');
    const allFreeBanner = $('#bookings-all-free');
    const activeMachines = state.machines.filter(m => m.status === 'in-use' && m.endTime && m.endTime > Date.now());

    if (activeMachines.length > 0) {
      activeSection.style.display = 'block';
      if (allFreeBanner) allFreeBanner.style.display = 'none';

      const circumference = 2 * Math.PI * 45;
      activeList.innerHTML = activeMachines.map(m => {
        const minsLeft = formatMinsLeft(m.endTime);
        const cycleDurations = { Express: 15, Quick: 30, Normal: 45, Heavy: 60, Deep: 90, Custom: 45 };
        const totalMin = cycleDurations[m.cycle] || 45;
        const remaining = Math.max(0, m.endTime - Date.now());
        const progress = remaining / (totalMin * 60 * 1000);
        const offset = circumference * (1 - progress);

        return `
          <div class="booking-timer-card" data-machine="${m.id}">
            <div class="booking-timer-top">
              <div class="booking-timer-ring-wrap">
                <svg class="booking-timer-ring" viewBox="0 0 100 100">
                  <circle class="booking-ring-bg" cx="50" cy="50" r="45" />
                  <circle class="booking-ring-progress" cx="50" cy="50" r="45"
                    data-end="${m.endTime}" data-total="${totalMin}"
                    style="stroke-dasharray: ${circumference}; stroke-dashoffset: ${offset};" />
                </svg>
                <div class="booking-ring-text">
                  <span class="booking-ring-mins" data-end="${m.endTime}">${minsLeft}</span>
                  <span class="booking-ring-unit">min</span>
                </div>
              </div>
              <div class="booking-timer-info">
                <div class="machine-status-badge">
                  <span class="status-dot red"></span>
                  ${m.name.toUpperCase()} — IN USE
                </div>
                <p class="booking-timer-cycle">${m.cycle} cycle</p>
                <p class="booking-timer-user">${m.user} • Room ${m.room || '—'}</p>
              </div>
            </div>
            <div class="booking-timer-actions">
              <button class="btn btn-secondary btn-sm" onclick="App.doneEarlyFor('${m.id}')">I'm Done Early</button>
              <button class="btn btn-primary btn-sm" onclick="App.movedClothes('${m.id}')">I Moved the Clothes</button>
            </div>
          </div>
        `;
      }).join('');

      // Start interval to update booking timers
      if (state.bookingsTimerInterval) clearInterval(state.bookingsTimerInterval);
      state.bookingsTimerInterval = setInterval(() => {
        const ringCircumference = 2 * Math.PI * 45;
        $$('.booking-ring-mins').forEach(el => {
          const end = parseInt(el.dataset.end);
          if (end) {
            const mins = formatMinsLeft(end);
            el.textContent = mins;
            if (mins <= 0) renderBookings();
          }
        });
        $$('.booking-ring-progress').forEach(el => {
          const end = parseInt(el.dataset.end);
          const total = parseInt(el.dataset.total);
          if (end && total) {
            const remaining = Math.max(0, end - Date.now());
            const progress = remaining / (total * 60 * 1000);
            el.style.strokeDashoffset = ringCircumference * (1 - progress);
          }
        });

        // Check alarm trigger for each active machine (< 1 min remaining)
        state.machines.forEach(m => {
          if (m.status === 'in-use' && m.endTime) {
            const remaining = m.endTime - Date.now();
            if (remaining > 0 && remaining <= 60000 && !state.alarmedMachines[m.id]) {
              state.alarmedMachines[m.id] = true;
              triggerAlarm(m);
            }
            if (remaining <= 0) {
              stopAlarm();
              delete state.alarmedMachines[m.id];
            }
          }
        });
      }, 1000);
    } else {
      activeSection.style.display = 'none';
      if (allFreeBanner) allFreeBanner.style.display = 'block';
      if (state.bookingsTimerInterval) {
        clearInterval(state.bookingsTimerInterval);
        state.bookingsTimerInterval = null;
      }
    }

    // History
    const list = $('#bookings-history-list');
    if (state.history.length === 0) {
      list.innerHTML = '<p class="empty-state">No wash history yet.</p>';
      return;
    }
    list.innerHTML = state.history.map(h => `
      <div class="history-item">
        <div class="history-info">
          <span class="history-machine">${h.machine}</span>
          <span class="history-cycle">${h.cycle} cycle • ${h.duration} min</span>
        </div>
        <span class="history-time">${h.date}</span>
      </div>
    `).join('');
  }

  // ----- Save wash history to Supabase -----
  function saveHistoryToDB(machine, duration) {
    if (!hostelId) return;
    Supabase.addWashHistory(hostelId, {
      machine_key: machine.id,
      machine_name: machine.name,
      user_name: machine.user || 'Unknown',
      room: machine.room || null,
      cycle: machine.cycle || 'Unknown',
      duration: typeof duration === 'number' ? duration : null,
      ended_at: new Date().toISOString(),
    }).catch(err => console.error('DB history error:', err));
  }

  // ----- Done Early / Moved Clothes for specific machine (from bookings) -----
  function doneEarlyFor(machineId) {
    const machine = state.machines.find(m => m.id === machineId);
    if (!machine) return;
    const historyEntry = {
      machine: machine.name,
      cycle: machine.cycle,
      duration: 'Early',
      date: new Date().toLocaleDateString('en-IN', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
      }),
    };
    state.history.unshift(historyEntry);
    setStore('washHistory', state.history.slice(0, 20));
    saveHistoryToDB(machine, 'Early');
    notifyQueueOnFree(machine.id);
    freeMachine(machine);
    showToast(`${machine.name} freed up!`);
    renderBookings();
  }

  // ----- Moved Clothes (requires name confirmation) -----
  let pendingMovedMachineId = null;

  function movedClothes(machineId) {
    pendingMovedMachineId = machineId;
    const modal = document.getElementById('moved-clothes-modal');
    const input = document.getElementById('moved-clothes-name');
    input.value = '';
    modal.style.display = 'flex';
    input.focus();
  }

  function confirmMovedClothes() {
    const input = document.getElementById('moved-clothes-name');
    const name = input.value.trim();
    if (!name) {
      showToast('Please enter your name to confirm.');
      return;
    }

    const machine = state.machines.find(m => m.id === pendingMovedMachineId);
    if (!machine) return;

    const historyEntry = {
      machine: machine.name,
      cycle: machine.cycle,
      duration: 'Moved',
      date: new Date().toLocaleDateString('en-IN', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
      }),
    };
    state.history.unshift(historyEntry);
    setStore('washHistory', state.history.slice(0, 20));
    saveHistoryToDB(machine, 'Moved');
    notifyQueueOnFree(machine.id);
    freeMachine(machine);

    hideMovedModal();
    showToast(`${machine.name} is now free!`);
    renderBookings();
  }

  function hideMovedModal() {
    document.getElementById('moved-clothes-modal').style.display = 'none';
    pendingMovedMachineId = null;
  }

  // ----- Render Queue Status Screen -----
  async function renderQueueStatus() {
    const container = $('#queue-status-list');
    if (!container) return;

    const liveQueues = await fetchLiveQueues();
    const queues = liveQueues || getStore('machineQueues', {});

    container.innerHTML = state.machines.map(m => {
      const isFree = m.status === 'free';
      const queue = queues[m.id] || [];
      const icon = isFree ? '🧺' : '📋';

      // Queue people list
      let peopleHTML = '';
      if (queue.length > 0) {
        peopleHTML = queue.map((q, i) => `
          <div class="qs-person">
            <div class="qs-avatar">${q.name.charAt(0).toUpperCase()}</div>
            <div class="qs-person-info">
              <span class="qs-person-name">${q.name}</span>
              <span class="qs-person-detail">${q.room ? 'Room ' + q.room : ''}</span>
            </div>
            <span class="qs-pos">#${i + 1}</span>
          </div>
        `).join('');
      }

      let statusText;
      let btnHTML;
      const hostelParam = hostelId ? `?hostel=${hostelId}` : '';
      if (isFree) {
        statusText = 'Ready for your laundry load';
        btnHTML = `<a href="queue.html${hostelParam}" class="qs-btn">Join Queue ✌️</a>`;
      } else {
        const minsLeft = formatMinsLeft(m.endTime);
        statusText = queue.length === 0
          ? 'No one in queue yet. Be the first! 🎉'
          : `${queue.length} waiting in queue`;
        btnHTML = `<a href="queue.html${hostelParam}" class="qs-btn">Join Queue ✌️</a>`;
      }

      return `
        <div class="qs-card">
          <div class="qs-icon">${icon}</div>
          <h3 class="qs-machine-name">${m.name}</h3>
          <p class="qs-status-text">${statusText}</p>
          ${peopleHTML ? '<div class="qs-people">' + peopleHTML + '</div>' : ''}
          ${btnHTML}
        </div>
      `;
    }).join('');
  }

  // ----- Queue Notification -----
  function notifyQueueOnFree(machineId) {
    const queues = getStore('machineQueues', {});
    const queue = queues[machineId] || [];
    if (queue.length > 0) {
      sendNotification(
        `🎉 Machine ${machineId} is FREE!`,
        `Machine ${machineId} is now available. Go grab it!`
      );
      queues[machineId] = [];
      setStore('machineQueues', queues);
    }
    // Also clear queue in Supabase
    if (hostelId) {
      Supabase.clearMachineQueue(hostelId, machineId)
        .catch(err => console.error('DB queue clear error:', err));
    }
  }

  // ----- Start Wash Flow -----
  function onStartWash(machineId) {
    const machine = state.machines.find(m => m.id === machineId);
    if (!machine || machine.status !== 'free') {
      showToast('This machine is not available right now.');
      return;
    }

    state.currentMachine = machine;
    $('#claim-title').textContent = `${machine.name} is yours 🤙`;
    $('#input-name').value = getStore('userName', '') || localStorage.getItem('userName') || '';
    $('#input-room').value = getStore('userRoom', '') || localStorage.getItem('userRoom') || '';
    showScreen('screen-start');
  }

  // ----- Cycle Selection -----
  let customMinutes = 20;

  function initCycleOptions() {
    $$('.cycle-option').forEach(opt => {
      opt.addEventListener('click', () => {
        $$('.cycle-option').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');

        const customGroup = $('#custom-timer-group');
        if (opt.dataset.cycle === 'custom') {
          customGroup.style.display = 'block';
          state.selectedCycle = {
            name: 'Custom',
            minutes: customMinutes,
          };
        } else {
          customGroup.style.display = 'none';
          state.selectedCycle = {
            name: opt.dataset.cycle.charAt(0).toUpperCase() + opt.dataset.cycle.slice(1),
            minutes: parseInt(opt.dataset.minutes),
          };
        }
      });
    });

    // Custom timer controls
    const btnPlus = $('#btn-time-plus');
    const btnMinus = $('#btn-time-minus');
    const display = $('#custom-timer-value');

    if (btnPlus) {
      btnPlus.addEventListener('click', () => {
        customMinutes = Math.min(180, customMinutes + 5);
        display.textContent = customMinutes;
        state.selectedCycle.minutes = customMinutes;
        updatePresetActive();
      });
    }

    if (btnMinus) {
      btnMinus.addEventListener('click', () => {
        customMinutes = Math.max(5, customMinutes - 5);
        display.textContent = customMinutes;
        state.selectedCycle.minutes = customMinutes;
        updatePresetActive();
      });
    }

    // Quick presets
    $$('.time-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        customMinutes = parseInt(btn.dataset.preset);
        display.textContent = customMinutes;
        state.selectedCycle.minutes = customMinutes;
        updatePresetActive();
      });
    });

    function updatePresetActive() {
      $$('.time-preset').forEach(p => {
        p.classList.toggle('active', parseInt(p.dataset.preset) === customMinutes);
      });
    }
  }

  // ----- Confirm Start Wash -----
  function confirmStartWash() {
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

    setStore('userName', name);
    setStore('userRoom', room);
    localStorage.setItem('userName', name);
    localStorage.setItem('userRoom', room);

    const machine = state.currentMachine;
    const cycle = state.selectedCycle;
    const endTime = Date.now() + cycle.minutes * 60 * 1000;

    machine.status = 'in-use';
    machine.user = name;
    machine.room = room;
    machine.cycle = cycle.name;
    machine.endTime = endTime;

    saveMachineState();

    // Log wash start to Supabase
    if (hostelId) {
      Supabase.addWashHistory(hostelId, {
        machine_key: machine.id,
        machine_name: machine.name,
        user_name: name,
        room: room,
        cycle: cycle.name,
        duration: cycle.minutes,
        started_at: new Date().toISOString(),
      }).catch(err => console.error('DB wash log error:', err));
    }

    requestNotificationPermission();
    showToast(`${machine.name} wash started!`);
    showScreen('screen-bookings');
  }

  // ----- Free Machine -----
  async function freeMachine(machine) {
    delete state.alarmedMachines[machine.id];
    stopAlarm();
    machine.status = 'free';
    machine.user = null;
    machine.room = null;
    machine.cycle = null;
    machine.endTime = null;
    saveMachineState();
    await renderMachines();
  }

  // ----- Notifications -----
  function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  function sendNotification(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body, icon: 'icons/icon-192.svg' });
    }
  }

  // ----- Alert Banner -----
  function checkAlerts() {
    const hour = new Date().getHours();
    const banner = $('#alert-banner');
    const text = $('#alert-text');

    // Example contextual alerts
    if (hour >= 17 && hour <= 20) {
      banner.style.display = 'flex';
      banner.className = 'alert-banner alert-busy';
      text.textContent = 'Peak hours right now! Expect longer waits.';
    } else if (hour >= 22 || hour < 6) {
      banner.style.display = 'flex';
      banner.className = 'alert-banner alert-quiet';
      text.textContent = 'Quiet hours — great time to do laundry!';
    } else {
      banner.style.display = 'none';
    }
  }

  // ----- Persistence -----
  function saveMachineState() {
    const data = state.machines.map(m => ({
      id: m.id, status: m.status, user: m.user, room: m.room, cycle: m.cycle, endTime: m.endTime,
    }));
    setStore('machineState', data);

    // Sync each machine status to Supabase
    if (hostelId) {
      data.forEach(m => {
        Supabase.updateMachine(hostelId, m.id, {
          status: m.status,
          user_name: m.user || null,
          room: m.room || null,
          cycle: m.cycle || null,
          end_time: m.endTime || null,
        }).catch(err => console.error('DB sync error:', err));
      });
    }
  }

  async function loadMachineState() {
    // Re-read machine list from admin panel (picks up adds/deletes)
    state.machines = getInitialMachines();

    // Try fetching live state from Supabase first
    let saved = getStore('machineState', []);
    if (hostelId) {
      try {
        const dbMachines = await Supabase.getMachines(hostelId);
        if (dbMachines.length > 0) {
          saved = dbMachines.map(m => ({
            id: m.machine_key,
            status: m.status || 'free',
            user: m.user_name,
            room: m.room,
            cycle: m.cycle,
            endTime: m.end_time,
          }));
          // Also update local machine definitions
          const list = dbMachines.map(m => ({ id: m.machine_key, name: m.name, type: m.type }));
          setStore('adminMachineList', list);
          state.machines = getInitialMachines();
        }
      } catch (err) {
        console.error('DB load error, using localStorage:', err);
      }
    }
    saved.forEach(s => {
      const machine = state.machines.find(m => m.id === s.id);
      if (!machine) return;

      if (s.status === 'in-use' && s.endTime && Date.now() >= s.endTime) {
        machine.status = 'free';
        machine.user = null;
        machine.room = null;
        machine.cycle = null;
        machine.endTime = null;
        notifyQueueOnFree(machine.id);
      } else {
        machine.status = s.status;
        machine.user = s.user;
        machine.room = s.room;
        machine.cycle = s.cycle;
        machine.endTime = s.endTime;
      }
    });
    saveMachineState();
  }

  // ----- QR Code URL Handling -----
  function handleQRParam() {
    const params = new URLSearchParams(window.location.search);
    const machineId = params.get('machine');
    if (machineId) {
      setTimeout(() => onStartWash(machineId.toUpperCase()), 300);
    }
  }

  // ----- Bottom Nav -----
  function initNav() {
    $$('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        showScreen(item.dataset.screen);
      });
    });
  }

  // ----- Init -----
  async function init() {
    await loadMachineState();
    await renderMachines();
    checkAlerts();
    initNav();
    initCycleOptions();

    // Button listeners
    $('#btn-start-wash').addEventListener('click', confirmStartWash);
    $('#btn-back-start').addEventListener('click', () => showScreen('screen-home'));
    $('#moved-confirm-btn').addEventListener('click', confirmMovedClothes);
    $('#moved-cancel-btn').addEventListener('click', hideMovedModal);
    $('#moved-clothes-backdrop').addEventListener('click', hideMovedModal);
    $('#btn-stop-alarm').addEventListener('click', stopAlarm);
    requestNotificationPermission();

    handleQRParam();

    // Auto-refresh from Supabase every 15s to sync across devices
    setInterval(async () => {
      await loadMachineState();
      const activeScreen = document.querySelector('.screen.active');
      if (activeScreen) {
        if (activeScreen.id === 'screen-home') await renderMachines();
        if (activeScreen.id === 'screen-bookings') renderBookings();
        if (activeScreen.id === 'screen-queue') await renderQueueStatus();
      }
    }, 15000);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  document.addEventListener('DOMContentLoaded', init);

  // Public API
  return { onStartWash, doneEarlyFor, movedClothes };
})();
