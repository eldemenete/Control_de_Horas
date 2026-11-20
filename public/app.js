(() => {
  const state = {
    goalHours: 360,
    totalMinutes: 0,
    entries: [],
    storageMode: 'local-dev',
    pin: localStorage.getItem('practica_app_pin') || '',
  };

  let toastTimeout = null;

  // --- Referencias DOM ---
  const el = {
    pinScreen: document.getElementById('pin-screen'),
    pinForm: document.getElementById('pin-form'),
    pinInput: document.getElementById('pin-input'),
    pinError: document.getElementById('pin-error'),
    storageBadge: document.getElementById('storage-badge'),
    storageText: document.getElementById('storage-text'),
    btnRefresh: document.getElementById('btn-refresh'),

    totalHoursDisplay: document.getElementById('total-hours-display'),
    percentDisplay: document.getElementById('percent-display'),
    progressRingCircle: document.getElementById('progress-ring-circle'),
    goalDisplay: document.getElementById('goal-display'),
    remainingDisplay: document.getElementById('remaining-display'),
    daysDisplay: document.getElementById('days-display'),

    entryForm: document.getElementById('entry-form'),
    entryDate: document.getElementById('entry-date'),
    entryStart: document.getElementById('entry-start'),
    entryEnd: document.getElementById('entry-end'),
    entryBreak: document.getElementById('entry-break'),
    entryPreview: document.getElementById('entry-preview'),
    entryNote: document.getElementById('entry-note'),
    btnNowStart: document.getElementById('btn-now-start'),
    btnNowEnd: document.getElementById('btn-now-end'),
    btnSaveEntry: document.getElementById('btn-save-entry'),

    directForm: document.getElementById('direct-form'),
    directDate: document.getElementById('direct-date'),
    directHours: document.getElementById('direct-hours'),
    directMinutes: document.getElementById('direct-minutes'),
    directNote: document.getElementById('direct-note'),

    recentList: document.getElementById('recent-list'),
    historyList: document.getElementById('history-list'),
    historySummary: document.getElementById('history-summary'),
    btnExportCsv: document.getElementById('btn-export-csv'),

    editModal: document.getElementById('edit-modal'),
    editForm: document.getElementById('edit-form'),
    editId: document.getElementById('edit-id'),
    editDate: document.getElementById('edit-date'),
    editHours: document.getElementById('edit-hours'),
    editMinutes: document.getElementById('edit-minutes'),
    editNote: document.getElementById('edit-note'),
    btnCloseModal: document.getElementById('btn-close-modal'),
    btnCancelEdit: document.getElementById('btn-cancel-edit'),

    toast: document.getElementById('toast'),
  };

  // --- Helpers ---
  function formatMinutes(totalMins) {
    const safe = Math.max(0, Math.round(totalMins));
    const h = Math.floor(safe / 60);
    const m = safe % 60;
    return `${h}h ${String(m).padStart(2, '0')}m`;
  }

  function formatDateEs(yyyyMmDd) {
    if (!yyyyMmDd) return '';
    const [y, m, d] = yyyyMmDd.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString('es-CL', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }

  function getTodayLocalIso() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function getNowHHMM() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }

  function showToast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.remove('hidden');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      el.toast.classList.add('hidden');
    }, 2800);
  }

  async function apiFetch(url, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };
    if (state.pin) {
      headers['x-app-pin'] = state.pin;
    }

    const res = await fetch(url, { ...options, headers });
    const data = await res.json().catch(() => ({}));

    if (res.status === 401 && data.pinRequired) {
      el.pinScreen.classList.remove('hidden');
      throw new Error('PIN_REQUIRED');
    }

    if (!res.ok) {
      throw new Error(data.error || 'Error de conexión con el servidor');
    }

    return data;
  }

  // --- Navegación por pestañas ---
  function switchTab(tabName) {
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));

    const panel = document.getElementById(`tab-${tabName}`);
    const navBtn = document.querySelector(`.nav-item[data-tab="${tabName}"]`);
    if (panel) panel.classList.add('active');
    if (navBtn) navBtn.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.querySelectorAll('[data-go-tab]').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.goTab));
  });

  // --- Renderizado ---
  const RING_CIRCUMFERENCE = 2 * Math.PI * 92;

  function renderProgress() {
    const goalMinutes = state.goalHours * 60;
    const pct = Math.min(100, (state.totalMinutes / goalMinutes) * 100);
    const remaining = Math.max(0, goalMinutes - state.totalMinutes);

    el.totalHoursDisplay.textContent = formatMinutes(state.totalMinutes);
    el.percentDisplay.textContent = `${pct.toFixed(1)}%`;
    const offset = RING_CIRCUMFERENCE * (1 - pct / 100);
    el.progressRingCircle.style.strokeDashoffset = String(offset);
    el.goalDisplay.textContent = `${state.goalHours}h`;
    el.remainingDisplay.textContent = formatMinutes(remaining);
    el.daysDisplay.textContent = String(state.entries.length);

    if (state.storageMode === 'postgresql') {
      el.storageText.textContent = 'En la nube · PostgreSQL';
      el.storageBadge.className = 'status-dot cloud';
    } else {
      el.storageText.textContent = 'Modo prueba local';
      el.storageBadge.className = 'status-dot local';
    }
  }

  function createEntryCard(entry, showActions) {
    const div = document.createElement('div');
    div.className = 'entry-item';

    const rangeText =
      entry.startTime && entry.endTime ? `${entry.startTime} - ${entry.endTime}` : 'Horas directas';
    const breakText = entry.breakMinutes > 0 ? ` · Colación ${entry.breakMinutes}m` : '';

    div.innerHTML = `
      <div class="entry-top">
        <span class="entry-date">${formatDateEs(entry.entryDate)}</span>
        <span class="entry-duration">${formatMinutes(entry.durationMinutes)}</span>
      </div>
      <div class="entry-meta">
        <span>${rangeText}${breakText}</span>
      </div>
      ${entry.note ? `<div class="entry-note"></div>` : ''}
    `;

    if (entry.note) {
      div.querySelector('.entry-note').textContent = entry.note;
    }

    if (showActions) {
      const actions = document.createElement('div');
      actions.className = 'entry-actions';

      const editBtn = document.createElement('button');
      editBtn.className = 'chip-btn';
      editBtn.textContent = 'Editar';
      editBtn.addEventListener('click', () => openEditModal(entry));

      const delBtn = document.createElement('button');
      delBtn.className = 'chip-btn delete';
      delBtn.textContent = 'Eliminar';
      delBtn.addEventListener('click', () => handleDeleteEntry(entry.id));

      actions.append(editBtn, delBtn);
      div.appendChild(actions);
    }

    return div;
  }

  function renderLists() {
    el.recentList.innerHTML = '';
    const recent = state.entries.slice(0, 3);
    if (!recent.length) {
      el.recentList.innerHTML =
        '<div class="empty-state">Aún no tienes jornadas registradas.</div>';
    } else {
      recent.forEach((e) => el.recentList.appendChild(createEntryCard(e, false)));
    }

    el.historyList.innerHTML = '';
    el.historySummary.textContent = `${state.entries.length} jornada(s) · Total acumulado: ${formatMinutes(
      state.totalMinutes
    )}`;

    if (!state.entries.length) {
      el.historyList.innerHTML =
        '<div class="empty-state">Cuando registres tus horas aparecerán aquí.</div>';
    } else {
      state.entries.forEach((e) => el.historyList.appendChild(createEntryCard(e, true)));
    }
  }

  async function loadState(silent = false) {
    try {
      const data = await apiFetch('/api/state');
      state.goalHours = data.goalHours;
      state.totalMinutes = data.totalMinutes;
      state.entries = data.entries;
      state.storageMode = data.storageMode;

      el.pinScreen.classList.add('hidden');
      renderProgress();
      renderLists();
    } catch (err) {
      if (err.message !== 'PIN_REQUIRED' && !silent) {
        showToast(err.message);
      }
    }
  }

  // --- Registro principal por horario escrito ---
  function updateEntryPreview() {
    const start = el.entryStart.value;
    const end = el.entryEnd.value;
    const brk = Math.max(0, Number(el.entryBreak.value) || 0);
    if (!start || !end) {
      el.entryPreview.textContent = 'Sin horario';
      el.entryPreview.classList.add('error');
      return;
    }
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    let diff = eh * 60 + em - (sh * 60 + sm);
    if (diff <= 0) diff += 24 * 60;
    const net = diff - brk;
    if (net <= 0) {
      el.entryPreview.textContent = 'Colación muy alta';
      el.entryPreview.classList.add('error');
    } else {
      el.entryPreview.textContent = `+ ${formatMinutes(net)}`;
      el.entryPreview.classList.remove('error');
    }
  }

  [el.entryStart, el.entryEnd, el.entryBreak].forEach((input) => {
    input.addEventListener('input', updateEntryPreview);
  });

  el.btnNowStart.addEventListener('click', () => {
    el.entryStart.value = getNowHHMM();
    updateEntryPreview();
  });

  el.btnNowEnd.addEventListener('click', () => {
    el.entryEnd.value = getNowHHMM();
    updateEntryPreview();
  });

  el.entryForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    el.btnSaveEntry.disabled = true;
    try {
      await apiFetch('/api/entries', {
        method: 'POST',
        body: JSON.stringify({
          entryDate: el.entryDate.value,
          startTime: el.entryStart.value,
          endTime: el.entryEnd.value,
          breakMinutes: Number(el.entryBreak.value) || 0,
          note: el.entryNote.value,
        }),
      });
      el.entryNote.value = '';
      showToast('Jornada guardada en la nube');
      await loadState(true);
    } catch (err) {
      showToast(err.message);
    } finally {
      el.btnSaveEntry.disabled = false;
    }
  });

  // --- Registro de horas directas ---
  el.directForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const h = Number(el.directHours.value) || 0;
    const m = Number(el.directMinutes.value) || 0;
    try {
      await apiFetch('/api/entries', {
        method: 'POST',
        body: JSON.stringify({
          entryDate: el.directDate.value,
          durationMinutes: h * 60 + m,
          note: el.directNote.value,
        }),
      });
      el.directNote.value = '';
      showToast('Horas guardadas en la nube');
      await loadState(true);
      switchTab('home');
    } catch (err) {
      showToast(err.message);
    }
  });

  // --- Editar / Eliminar ---
  function openEditModal(entry) {
    el.editId.value = entry.id;
    el.editDate.value = entry.entryDate;
    el.editHours.value = Math.floor(entry.durationMinutes / 60);
    el.editMinutes.value = entry.durationMinutes % 60;
    el.editNote.value = entry.note || '';
    el.editModal.classList.remove('hidden');
  }

  function closeEditModal() {
    el.editModal.classList.add('hidden');
  }

  el.btnCloseModal.addEventListener('click', closeEditModal);
  el.btnCancelEdit.addEventListener('click', closeEditModal);

  el.editForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const id = el.editId.value;
    const durationMinutes =
      (Number(el.editHours.value) || 0) * 60 + (Number(el.editMinutes.value) || 0);

    try {
      await apiFetch(`/api/entries/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          entryDate: el.editDate.value,
          durationMinutes,
          note: el.editNote.value,
        }),
      });
      closeEditModal();
      showToast('Registro actualizado');
      await loadState(true);
    } catch (err) {
      showToast(err.message);
    }
  });

  async function handleDeleteEntry(id) {
    if (!confirm('¿Eliminar esta jornada permanentemente?')) return;
    try {
      await apiFetch(`/api/entries/${id}`, { method: 'DELETE' });
      showToast('Registro eliminado');
      await loadState(true);
    } catch (err) {
      showToast(err.message);
    }
  }

  // --- Exportar CSV ---
  el.btnExportCsv.addEventListener('click', () => {
    if (!state.entries.length) {
      showToast('No hay registros para exportar');
      return;
    }
    const rows = [
      ['Fecha', 'Entrada', 'Salida', 'Colacion (min)', 'Duracion (min)', 'Horas', 'Nota'],
      ...state.entries.map((e) => [
        e.entryDate,
        e.startTime || '',
        e.endTime || '',
        e.breakMinutes,
        e.durationMinutes,
        (e.durationMinutes / 60).toFixed(2),
        `"${(e.note || '').replace(/"/g, '""')}"`,
      ]),
    ];

    const csv = '\uFEFF' + rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `horas-practica-${getTodayLocalIso()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // --- PIN ---
  el.pinForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    state.pin = el.pinInput.value.trim();
    el.pinError.classList.add('hidden');
    try {
      const status = await apiFetch('/api/auth/status');
      if (!status.authenticated) {
        el.pinError.textContent = 'PIN incorrecto. Intenta nuevamente.';
        el.pinError.classList.remove('hidden');
        return;
      }
      localStorage.setItem('practica_app_pin', state.pin);
      el.pinInput.value = '';
      await loadState(true);
    } catch {
      el.pinError.textContent = 'No se pudo validar el PIN.';
      el.pinError.classList.remove('hidden');
    }
  });

  // --- Sincronización y Service Worker ---
  el.btnRefresh.addEventListener('click', async () => {
    await loadState();
    showToast('Datos sincronizados');
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      loadState(true);
    }
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }

  // Inicialización
  const today = getTodayLocalIso();
  el.entryDate.value = today;
  el.directDate.value = today;
  updateEntryPreview();
  loadState();
})();
