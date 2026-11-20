const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DEFAULT_GOAL_HOURS = Number(process.env.GOAL_HOURS) || 360;
const LOCAL_FILE = path.join(__dirname, 'data.local.json');

const usePostgres = Boolean(process.env.DATABASE_URL);
let pool = null;

function createPool() {
  const connectionString = process.env.DATABASE_URL;
  const isLocalDb =
    connectionString.includes('localhost') ||
    connectionString.includes('127.0.0.1');

  return new Pool({
    connectionString,
    ssl: isLocalDb ? false : { rejectUnauthorized: false },
  });
}

// --- Fallback JSON solo para pruebas locales sin DATABASE_URL ---
function readLocalData() {
  if (!fs.existsSync(LOCAL_FILE)) {
    const initial = {
      goalHours: DEFAULT_GOAL_HOURS,
      activeSession: null,
      entries: [],
      nextId: 1,
    };
    fs.writeFileSync(LOCAL_FILE, JSON.stringify(initial, null, 2), 'utf8');
    return initial;
  }
  return JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf8'));
}

function writeLocalData(data) {
  fs.writeFileSync(LOCAL_FILE, JSON.stringify(data, null, 2), 'utf8');
}

async function initDb() {
  if (!usePostgres) {
    readLocalData();
    console.log(
      '[DB] DATABASE_URL no configurada. Usando almacenamiento local temporal (data.local.json) para pruebas.'
    );
    return;
  }

  pool = createPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS active_sessions (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      started_at TIMESTAMPTZ NOT NULL,
      note TEXT DEFAULT ''
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS time_entries (
      id SERIAL PRIMARY KEY,
      entry_date TEXT NOT NULL,
      start_time TEXT,
      end_time TEXT,
      break_minutes INTEGER NOT NULL DEFAULT 0,
      duration_minutes INTEGER NOT NULL,
      note TEXT DEFAULT '',
      source TEXT NOT NULL DEFAULT 'manual',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(
    `
    INSERT INTO settings (key, value)
    VALUES ('goal_hours', $1)
    ON CONFLICT (key) DO NOTHING;
  `,
    [String(DEFAULT_GOAL_HOURS)]
  );

  console.log('[DB] Conectado a PostgreSQL y tablas verificadas.');
}

function getStorageMode() {
  return usePostgres ? 'postgresql' : 'local-dev';
}

async function getGoalHours() {
  if (!usePostgres) {
    return readLocalData().goalHours;
  }
  const { rows } = await pool.query(
    `SELECT value FROM settings WHERE key = 'goal_hours'`
  );
  return rows.length ? Number(rows[0].value) : DEFAULT_GOAL_HOURS;
}

async function setGoalHours(goalHours) {
  if (!usePostgres) {
    const data = readLocalData();
    data.goalHours = goalHours;
    writeLocalData(data);
    return goalHours;
  }
  await pool.query(
    `
    INSERT INTO settings (key, value)
    VALUES ('goal_hours', $1)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `,
    [String(goalHours)]
  );
  return goalHours;
}

async function getActiveSession() {
  if (!usePostgres) {
    return readLocalData().activeSession;
  }
  const { rows } = await pool.query(
    `SELECT id, started_at, note FROM active_sessions WHERE id = 1`
  );
  if (!rows.length) return null;
  return {
    id: rows[0].id,
    startedAt: new Date(rows[0].started_at).toISOString(),
    note: rows[0].note || '',
  };
}

async function startActiveSession(note = '') {
  const startedAt = new Date().toISOString();
  if (!usePostgres) {
    const data = readLocalData();
    if (data.activeSession) {
      return null;
    }
    data.activeSession = { id: 1, startedAt, note };
    writeLocalData(data);
    return data.activeSession;
  }

  const { rows } = await pool.query(
    `
    INSERT INTO active_sessions (id, started_at, note)
    VALUES (1, $1, $2)
    ON CONFLICT (id) DO NOTHING
    RETURNING id, started_at, note
  `,
    [startedAt, note]
  );

  if (!rows.length) return null;
  return {
    id: rows[0].id,
    startedAt: new Date(rows[0].started_at).toISOString(),
    note: rows[0].note || '',
  };
}

async function clearActiveSession() {
  if (!usePostgres) {
    const data = readLocalData();
    const prev = data.activeSession;
    data.activeSession = null;
    writeLocalData(data);
    return prev;
  }
  const { rows } = await pool.query(
    `DELETE FROM active_sessions WHERE id = 1 RETURNING id, started_at, note`
  );
  if (!rows.length) return null;
  return {
    id: rows[0].id,
    startedAt: new Date(rows[0].started_at).toISOString(),
    note: rows[0].note || '',
  };
}

async function listEntries() {
  if (!usePostgres) {
    const data = readLocalData();
    return [...data.entries].sort((a, b) => {
      if (a.entryDate !== b.entryDate) {
        return b.entryDate.localeCompare(a.entryDate);
      }
      return b.id - a.id;
    });
  }

  const { rows } = await pool.query(`
    SELECT
      id,
      entry_date,
      start_time,
      end_time,
      break_minutes,
      duration_minutes,
      note,
      source,
      created_at
    FROM time_entries
    ORDER BY entry_date DESC, id DESC
  `);

  return rows.map((r) => ({
    id: r.id,
    entryDate: r.entry_date,
    startTime: r.start_time,
    endTime: r.end_time,
    breakMinutes: r.break_minutes,
    durationMinutes: r.duration_minutes,
    note: r.note || '',
    source: r.source,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

async function createEntry({
  entryDate,
  startTime = null,
  endTime = null,
  breakMinutes = 0,
  durationMinutes,
  note = '',
  source = 'manual',
}) {
  if (!usePostgres) {
    const data = readLocalData();
    const entry = {
      id: data.nextId++,
      entryDate,
      startTime,
      endTime,
      breakMinutes,
      durationMinutes,
      note,
      source,
      createdAt: new Date().toISOString(),
    };
    data.entries.push(entry);
    writeLocalData(data);
    return entry;
  }

  const { rows } = await pool.query(
    `
    INSERT INTO time_entries (
      entry_date, start_time, end_time, break_minutes, duration_minutes, note, source
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id, entry_date, start_time, end_time, break_minutes, duration_minutes, note, source, created_at
  `,
    [entryDate, startTime, endTime, breakMinutes, durationMinutes, note, source]
  );

  const r = rows[0];
  return {
    id: r.id,
    entryDate: r.entry_date,
    startTime: r.start_time,
    endTime: r.end_time,
    breakMinutes: r.break_minutes,
    durationMinutes: r.duration_minutes,
    note: r.note || '',
    source: r.source,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

async function updateEntry(
  id,
  { entryDate, startTime = null, endTime = null, breakMinutes = 0, durationMinutes, note = '' }
) {
  if (!usePostgres) {
    const data = readLocalData();
    const idx = data.entries.findIndex((e) => e.id === Number(id));
    if (idx === -1) return null;
    data.entries[idx] = {
      ...data.entries[idx],
      entryDate,
      startTime,
      endTime,
      breakMinutes,
      durationMinutes,
      note,
    };
    writeLocalData(data);
    return data.entries[idx];
  }

  const { rows } = await pool.query(
    `
    UPDATE time_entries
    SET
      entry_date = $1,
      start_time = $2,
      end_time = $3,
      break_minutes = $4,
      duration_minutes = $5,
      note = $6
    WHERE id = $7
    RETURNING id, entry_date, start_time, end_time, break_minutes, duration_minutes, note, source, created_at
  `,
    [entryDate, startTime, endTime, breakMinutes, durationMinutes, note, Number(id)]
  );

  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: r.id,
    entryDate: r.entry_date,
    startTime: r.start_time,
    endTime: r.end_time,
    breakMinutes: r.break_minutes,
    durationMinutes: r.duration_minutes,
    note: r.note || '',
    source: r.source,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

async function deleteEntry(id) {
  if (!usePostgres) {
    const data = readLocalData();
    const prevLen = data.entries.length;
    data.entries = data.entries.filter((e) => e.id !== Number(id));
    writeLocalData(data);
    return data.entries.length < prevLen;
  }

  const { rowCount } = await pool.query(`DELETE FROM time_entries WHERE id = $1`, [
    Number(id),
  ]);
  return rowCount > 0;
}

module.exports = {
  initDb,
  getStorageMode,
  getGoalHours,
  setGoalHours,
  getActiveSession,
  startActiveSession,
  clearActiveSession,
  listEntries,
  createEntry,
  updateEntry,
  deleteEntry,
};
