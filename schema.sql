-- ===== SpinLnk Database Schema =====

-- 1. Hostels table (admin accounts)
CREATE TABLE IF NOT EXISTS hostels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  password TEXT NOT NULL,
  machine_qr_url TEXT,
  room_qr_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Machines table (per hostel)
-- queue_members stores the queue as JSONB array: [{name, room, joinedAt}, ...]
-- sorted by joinedAt — one shared queue per machine
CREATE TABLE IF NOT EXISTS machines (
  id SERIAL PRIMARY KEY,
  hostel_id TEXT NOT NULL REFERENCES hostels(id) ON DELETE CASCADE,
  machine_key TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'washer',
  status TEXT NOT NULL DEFAULT 'free',
  user_name TEXT,
  room TEXT,
  cycle TEXT,
  end_time BIGINT,
  queue_members JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(hostel_id, machine_key)
);

-- 3. Wash history table
CREATE TABLE IF NOT EXISTS wash_history (
  id SERIAL PRIMARY KEY,
  hostel_id TEXT NOT NULL REFERENCES hostels(id) ON DELETE CASCADE,
  machine_key TEXT NOT NULL,
  machine_name TEXT NOT NULL,
  user_name TEXT NOT NULL,
  room TEXT,
  cycle TEXT NOT NULL,
  duration INTEGER,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_machines_hostel ON machines(hostel_id);
CREATE INDEX IF NOT EXISTS idx_wash_history_hostel ON wash_history(hostel_id);
