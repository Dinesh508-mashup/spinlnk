// ===== SpinLnk — Supabase Configuration =====

const Supabase = (() => {
  const SUPABASE_URL = 'https://wskoxxsglnkgzrtdxefp.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_pZP1nXWug1Uu5lU7vEtUGQ_sfYAMBv4';

  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };

  // ----- Generic REST helpers -----
  async function query(table, params = '') {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, { headers });
    if (!res.ok) throw new Error(`Supabase GET ${table}: ${res.status}`);
    return res.json();
  }

  async function insert(table, data) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Supabase INSERT ${table}: ${res.status}`);
    return res.json();
  }

  async function update(table, match, data) {
    const params = Object.entries(match).map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`).join('&');
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Supabase UPDATE ${table}: ${res.status}`);
    return res.json();
  }

  async function remove(table, match) {
    const params = Object.entries(match).map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`).join('&');
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
      method: 'DELETE',
      headers,
    });
    if (!res.ok) throw new Error(`Supabase DELETE ${table}: ${res.status}`);
    return res.ok;
  }

  // ----- Hostel helpers -----
  async function getHostel(hostelId) {
    const rows = await query('hostels', `id=eq.${encodeURIComponent(hostelId)}`);
    return rows.length > 0 ? rows[0] : null;
  }

  async function createHostel(hostelId, name, password) {
    return insert('hostels', { id: hostelId, name, password });
  }

  async function updateHostelQR(hostelId, machineQrUrl, roomQrUrl) {
    return update('hostels', { id: hostelId }, { machine_qr_url: machineQrUrl, room_qr_url: roomQrUrl });
  }

  // ----- Machine helpers -----
  async function getMachines(hostelId) {
    return query('machines', `hostel_id=eq.${encodeURIComponent(hostelId)}&order=machine_key.asc`);
  }

  async function addMachine(hostelId, machineKey, name, type) {
    return insert('machines', { hostel_id: hostelId, machine_key: machineKey, name, type });
  }

  async function deleteMachine(hostelId, machineKey) {
    return remove('machines', { hostel_id: hostelId, machine_key: machineKey });
  }

  async function updateMachine(hostelId, machineKey, data) {
    return update('machines', { hostel_id: hostelId, machine_key: machineKey }, data);
  }

  // ----- Wash History helpers -----
  async function getWashHistory(hostelId) {
    return query('wash_history', `hostel_id=eq.${encodeURIComponent(hostelId)}&order=started_at.desc&limit=50`);
  }

  async function addWashHistory(hostelId, entry) {
    return insert('wash_history', { hostel_id: hostelId, ...entry });
  }

  // ----- Queue helpers -----
  async function getQueueEntries(hostelId) {
    return query('queue_entries', `hostel_id=eq.${encodeURIComponent(hostelId)}&order=joined_at.asc`);
  }

  async function addQueueEntry(hostelId, machineKey, userName, room) {
    return insert('queue_entries', { hostel_id: hostelId, machine_key: machineKey, user_name: userName, room });
  }

  async function removeQueueEntry(hostelId, machineKey, userName) {
    const params = `hostel_id=eq.${encodeURIComponent(hostelId)}&machine_key=eq.${encodeURIComponent(machineKey)}&user_name=eq.${encodeURIComponent(userName)}`;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/queue_entries?${params}`, {
      method: 'DELETE',
      headers,
    });
    return res.ok;
  }

  async function clearMachineQueue(hostelId, machineKey) {
    const params = `hostel_id=eq.${encodeURIComponent(hostelId)}&machine_key=eq.${encodeURIComponent(machineKey)}`;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/queue_entries?${params}`, {
      method: 'DELETE',
      headers,
    });
    return res.ok;
  }

  return {
    query, insert, update, remove,
    getHostel, createHostel, updateHostelQR,
    getMachines, addMachine, deleteMachine, updateMachine,
    getWashHistory, addWashHistory,
    getQueueEntries, addQueueEntry, removeQueueEntry, clearMachineQueue,
  };
})();
