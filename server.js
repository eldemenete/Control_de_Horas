require('dotenv').config();

const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const APP_PIN = (process.env.APP_PIN || '').trim();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Healthcheck para Render / Railway
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    storageMode: db.getStorageMode(),
    timestamp: new Date().toISOString(),
  });
});

// Middleware de PIN opcional
function requirePin(req, res, next) {
  if (!APP_PIN) return next();
  const provided = String(req.headers['x-app-pin'] || '').trim();
  if (provided !== APP_PIN) {
    return res.status(401).json({ error: 'PIN requerido o incorrecto', pinRequired: true });
  }
  next();
}

app.use('/api', (req, res, next) => {
  if (req.path === '/health' || req.path === '/auth/status') return next();
  return requirePin(req, res, next);
});

app.get('/api/auth/status', (req, res) => {
  const provided = String(req.headers['x-app-pin'] || '').trim();
  res.json({
    pinRequired: Boolean(APP_PIN),
    authenticated: !APP_PIN || provided === APP_PIN,
  });
});

// Utilidades de tiempo
function parseTimeToMinutes(hhmm) {
  if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(':').map(Number);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

function formatDateWithOffset(isoDate, tzOffsetMinutes = 0) {
  // tzOffsetMinutes sigue la convención de JS getTimezoneOffset() (UTC - local)
  const localMs = new Date(isoDate).getTime() - tzOffsetMinutes * 60000;
  const d = new Date(localMs);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hours = String(d.getUTCHours()).padStart(2, '0');
  const mins = String(d.getUTCMinutes()).padStart(2, '0');
  return {
    date: `${year}-${month}-${day}`,
    time: `${hours}:${mins}`,
  };
}

function computeManualDuration({ startTime, endTime, breakMinutes, durationMinutes }) {
  const parsedBreak = Math.max(0, Math.round(Number(breakMinutes) || 0));

  if (durationMinutes !== undefined && durationMinutes !== null && durationMinutes !== '') {
    const mins = Math.round(Number(durationMinutes));
    if (!Number.isFinite(mins) || mins <= 0) {
      return { error: 'La duración debe ser mayor a 0 minutos.' };
    }
    return {
      startTime: startTime || null,
      endTime: endTime || null,
      breakMinutes: parsedBreak,
      durationMinutes: mins,
    };
  }

  const startMin = parseTimeToMinutes(startTime);
  const endMin = parseTimeToMinutes(endTime);
  if (startMin === null || endMin === null) {
    return { error: 'Debes indicar hora de entrada y salida válidas (HH:MM) o una duración.' };
  }

  let diff = endMin - startMin;
  if (diff <= 0) {
    // Permite turnos que cruzan medianoche
    diff += 24 * 60;
  }

  const netMinutes = diff - parsedBreak;
  if (netMinutes <= 0) {
    return { error: 'El tiempo de colación/pausa no puede superar la jornada.' };
  }

  return {
    startTime,
    endTime,
    breakMinutes: parsedBreak,
    durationMinutes: netMinutes,
  };
}

// Estado completo de la app
app.get('/api/state', async (_req, res) => {
  try {
    const [goalHours, activeSession, entries] = await Promise.all([
      db.getGoalHours(),
      db.getActiveSession(),
      db.listEntries(),
    ]);

    const totalMinutes = entries.reduce((acc, e) => acc + e.durationMinutes, 0);

    res.json({
      goalHours,
      totalMinutes,
      activeSession,
      entries,
      storageMode: db.getStorageMode(),
      pinRequired: Boolean(APP_PIN),
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Error en GET /api/state:', err);
    res.status(500).json({ error: 'Error al cargar los datos.' });
  }
});

// Fichar entrada
app.post('/api/clock-in', async (req, res) => {
  try {
    const note = String(req.body?.note || '').trim().slice(0, 300);
    const session = await db.startActiveSession(note);
    if (!session) {
      return res.status(409).json({ error: 'Ya tienes una jornada en curso.' });
    }
    res.status(201).json({ activeSession: session });
  } catch (err) {
    console.error('Error en POST /api/clock-in:', err);
    res.status(500).json({ error: 'No se pudo iniciar la jornada.' });
  }
});

// Cancelar jornada activa sin guardar
app.delete('/api/clock-in', async (_req, res) => {
  try {
    const cleared = await db.clearActiveSession();
    if (!cleared) {
      return res.status(404).json({ error: 'No hay ninguna jornada activa.' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Error en DELETE /api/clock-in:', err);
    res.status(500).json({ error: 'No se pudo cancelar la jornada.' });
  }
});

// Fichar salida y guardar registro
app.post('/api/clock-out', async (req, res) => {
  try {
    const active = await db.getActiveSession();
    if (!active) {
      return res.status(404).json({ error: 'No hay ninguna jornada en curso.' });
    }

    const nowIso = new Date().toISOString();
    const breakMinutes = Math.max(0, Math.round(Number(req.body?.breakMinutes) || 0));
    const note = String(
      req.body?.note !== undefined ? req.body.note : active.note || ''
    )
      .trim()
      .slice(0, 300);
    const tzOffsetMinutes = Number.isFinite(Number(req.body?.tzOffsetMinutes))
      ? Number(req.body.tzOffsetMinutes)
      : 0;

    const elapsedMs = new Date(nowIso).getTime() - new Date(active.startedAt).getTime();
    const rawMinutes = Math.max(1, Math.round(elapsedMs / 60000));
    const netMinutes = Math.max(1, rawMinutes - breakMinutes);

    const startLocal = formatDateWithOffset(active.startedAt, tzOffsetMinutes);
    const endLocal = formatDateWithOffset(nowIso, tzOffsetMinutes);

    const entry = await db.createEntry({
      entryDate: startLocal.date,
      startTime: startLocal.time,
      endTime: endLocal.time,
      breakMinutes,
      durationMinutes: netMinutes,
      note,
      source: 'timer',
    });

    await db.clearActiveSession();
    res.status(201).json({ entry });
  } catch (err) {
    console.error('Error en POST /api/clock-out:', err);
    res.status(500).json({ error: 'No se pudo finalizar la jornada.' });
  }
});

// Crear registro manual
app.post('/api/entries', async (req, res) => {
  try {
    const entryDate = String(req.body?.entryDate || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) {
      return res.status(400).json({ error: 'Fecha inválida (usa formato YYYY-MM-DD).' });
    }

    const calc = computeManualDuration({
      startTime: req.body?.startTime,
      endTime: req.body?.endTime,
      breakMinutes: req.body?.breakMinutes,
      durationMinutes: req.body?.durationMinutes,
    });

    if (calc.error) {
      return res.status(400).json({ error: calc.error });
    }

    const note = String(req.body?.note || '').trim().slice(0, 300);

    const entry = await db.createEntry({
      entryDate,
      startTime: calc.startTime,
      endTime: calc.endTime,
      breakMinutes: calc.breakMinutes,
      durationMinutes: calc.durationMinutes,
      note,
      source: 'manual',
    });

    res.status(201).json({ entry });
  } catch (err) {
    console.error('Error en POST /api/entries:', err);
    res.status(500).json({ error: 'No se pudo guardar el registro.' });
  }
});

// Editar registro existente
app.put('/api/entries/:id', async (req, res) => {
  try {
    const entryDate = String(req.body?.entryDate || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) {
      return res.status(400).json({ error: 'Fecha inválida.' });
    }

    const calc = computeManualDuration({
      startTime: req.body?.startTime,
      endTime: req.body?.endTime,
      breakMinutes: req.body?.breakMinutes,
      durationMinutes: req.body?.durationMinutes,
    });

    if (calc.error) {
      return res.status(400).json({ error: calc.error });
    }

    const note = String(req.body?.note || '').trim().slice(0, 300);

    const updated = await db.updateEntry(req.params.id, {
      entryDate,
      startTime: calc.startTime,
      endTime: calc.endTime,
      breakMinutes: calc.breakMinutes,
      durationMinutes: calc.durationMinutes,
      note,
    });

    if (!updated) {
      return res.status(404).json({ error: 'Registro no encontrado.' });
    }

    res.json({ entry: updated });
  } catch (err) {
    console.error('Error en PUT /api/entries/:id:', err);
    res.status(500).json({ error: 'No se pudo actualizar el registro.' });
  }
});

// Eliminar registro
app.delete('/api/entries/:id', async (req, res) => {
  try {
    const deleted = await db.deleteEntry(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Registro no encontrado.' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Error en DELETE /api/entries/:id:', err);
    res.status(500).json({ error: 'No se pudo eliminar el registro.' });
  }
});

// Actualizar meta de horas
app.put('/api/settings', async (req, res) => {
  try {
    const goalHours = Number(req.body?.goalHours);
    if (!Number.isFinite(goalHours) || goalHours < 1 || goalHours > 5000) {
      return res.status(400).json({ error: 'La meta debe estar entre 1 y 5000 horas.' });
    }
    const saved = await db.setGoalHours(Math.round(goalHours));
    res.json({ goalHours: saved });
  } catch (err) {
    console.error('Error en PUT /api/settings:', err);
    res.status(500).json({ error: 'No se pudo actualizar la configuración.' });
  }
});

// Fallback SPA
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

db.initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Servidor corriendo en http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Error fatal inicializando la base de datos:', err);
    process.exit(1);
  });
