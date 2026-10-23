'use strict';

/* ========== Fungsi murni (mudah diuji) ========== */
const DEFAULTS = { focus: 25, short: 5, long: 15, every: 4 };
const CIRC = 2 * Math.PI * 90;
const MODE_LABEL = { focus: 'Fokus', short: 'Istirahat pendek', long: 'Istirahat panjang' };

function formatTime(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = String(Math.floor(total / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return m + ':' + s;
}

function dayKey(date) {
  const d = date || new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + mm + '-' + dd;
}

function nextMode(mode, doneToday, every) {
  if (mode !== 'focus') return 'focus';
  return doneToday > 0 && doneToday % every === 0 ? 'long' : 'short';
}

function lastDays(log, n, today) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today || new Date());
    d.setDate(d.getDate() - i);
    const key = dayKey(d);
    out.push({ key, date: d, minutes: (log[key] && log[key].minutes) || 0 });
  }
  return out;
}

function streak(log, today) {
  let count = 0;
  const d = new Date(today || new Date());
  if (!(log[dayKey(d)] && log[dayKey(d)].sessions)) d.setDate(d.getDate() - 1);
  while (log[dayKey(d)] && log[dayKey(d)].sessions) {
    count++;
    d.setDate(d.getDate() - 1);
  }
  return count;
}

if (typeof module !== 'undefined') {
  module.exports = { formatTime, dayKey, nextMode, lastDays, streak };
}

/* ========== Aplikasi (hanya jalan di browser) ========== */
if (typeof document !== 'undefined') {
  const $ = (id) => document.getElementById(id);
  const store = {
    get(key, fallback) {
      try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* abaikan */ }
    }
  };

  const state = {
    settings: Object.assign({}, DEFAULTS, store.get('fokusku:settings', {})),
    tasks: store.get('fokusku:tasks', []),
    log: store.get('fokusku:log', {}),
    activeId: store.get('fokusku:active', null),
    mode: 'focus',
    remaining: 0,
    endAt: 0,
    running: false,
    timerId: null
  };

  const el = {
    time: $('time'), ring: $('ring'), start: $('start'),
    current: $('current-task'), list: $('task-list'), empty: $('task-empty'),
    chart: $('chart'), cycle: $('cycle')
  };

  const duration = (mode) => state.settings[mode] * 60 * 1000;
  const today = () => state.log[dayKey()] || { sessions: 0, minutes: 0 };

  /* ----- Timer ----- */
  function render() {
    el.time.textContent = formatTime(state.remaining);
    const done = 1 - state.remaining / duration(state.mode);
    el.ring.style.strokeDashoffset = String(CIRC * done);
    document.title = (state.running ? formatTime(state.remaining) + ' · ' : '') + 'FokusKu';
    document.body.dataset.mode = state.mode;
    el.start.textContent = state.running ? 'Jeda' : (state.remaining < duration(state.mode) ? 'Lanjut' : 'Mulai');
    document.querySelectorAll('.modes button').forEach((b) =>
      b.classList.toggle('active', b.dataset.mode === state.mode));
  }

  function setMode(mode) {
    stop();
    state.mode = mode;
    state.remaining = duration(mode);
    renderAll();
  }

  function tick() {
    state.remaining = state.endAt - Date.now();
    if (state.remaining <= 0) { complete(); return; }
    render();
  }

  function begin() {
    if (state.running) return;
    state.running = true;
    state.endAt = Date.now() + state.remaining;
    state.timerId = setInterval(tick, 250);
    render();
  }

  function stop() {
    state.running = false;
    clearInterval(state.timerId);
    render();
  }

  function complete() {
    stop();
    beep();
    if (state.mode === 'focus') {
      const t = today();
      t.sessions += 1;
      t.minutes += state.settings.focus;
      state.log[dayKey()] = t;
      store.set('fokusku:log', state.log);
      const task = state.tasks.find((x) => x.id === state.activeId);
      if (task) { task.pomos += 1; saveTasks(); }
    }
    const upcoming = nextMode(state.mode, today().sessions, state.settings.every);
    state.mode = upcoming;
    state.remaining = duration(upcoming);
    renderAll();
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('FokusKu', { body: 'Selanjutnya: ' + MODE_LABEL[upcoming] });
    }
  }

  function beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 660;
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + 0.8);
    } catch (e) { /* suara tidak tersedia */ }
  }

  /* ----- Tugas ----- */
  function saveTasks() {
    store.set('fokusku:tasks', state.tasks);
    store.set('fokusku:active', state.activeId);
  }

  function renderTasks() {
    el.list.textContent = '';
    state.tasks.forEach((task) => {
      const li = document.createElement('li');
      li.className = (task.done ? 'done ' : '') + (task.id === state.activeId ? 'active' : '');

      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = task.done;
      check.setAttribute('aria-label', 'Tandai selesai: ' + task.text);
      check.addEventListener('change', () => {
        task.done = check.checked;
        if (task.done && state.activeId === task.id) state.activeId = null;
        saveTasks(); renderAll();
      });

      const label = document.createElement('button');
      label.type = 'button';
      label.className = 'label';
      label.textContent = task.text;
      label.title = 'Pilih untuk dikerjakan';
      label.addEventListener('click', () => {
        if (task.done) return;
        state.activeId = task.id;
        saveTasks(); renderAll();
      });

      const pomos = document.createElement('span');
      pomos.className = 'pomos';
      pomos.textContent = task.pomos + ' sesi';

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'del';
      del.textContent = '×';
      del.setAttribute('aria-label', 'Hapus tugas: ' + task.text);
      del.addEventListener('click', () => {
        state.tasks = state.tasks.filter((x) => x.id !== task.id);
        if (state.activeId === task.id) state.activeId = null;
        saveTasks(); renderAll();
      });

      li.append(check, label, pomos, del);
      el.list.appendChild(li);
    });
    el.empty.hidden = state.tasks.length > 0;
    const active = state.tasks.find((x) => x.id === state.activeId);
    el.current.textContent = active ? active.text : 'Belum ada tugas dipilih';
  }

  /* ----- Statistik ----- */
  function renderStats() {
    const t = today();
    const every = state.settings.every;
    const filled = state.mode !== 'focus' && t.sessions > 0 && t.sessions % every === 0 ? every : t.sessions % every;
    el.cycle.textContent = '';
    for (let i = 0; i < every; i++) {
      const dot = document.createElement('span');
      if (i < filled) dot.className = 'on';
      el.cycle.appendChild(dot);
    }
    $('st-sessions').textContent = t.sessions;
    $('st-minutes').textContent = t.minutes;
    $('st-streak').textContent = streak(state.log);
    const days = lastDays(state.log, 7);
    const max = Math.max.apply(null, days.map((d) => d.minutes).concat(1));
    el.chart.textContent = '';
    days.forEach((d, i) => {
      const bar = document.createElement('div');
      bar.className = 'bar' + (i === days.length - 1 ? ' today' : '');
      bar.title = d.minutes + ' menit';
      const fill = document.createElement('i');
      fill.style.height = Math.round((d.minutes / max) * 100) + '%';
      const name = document.createElement('span');
      name.textContent = d.date.toLocaleDateString('id-ID', { weekday: 'short' });
      bar.append(fill, name);
      el.chart.appendChild(bar);
    });
  }

  function renderAll() { render(); renderTasks(); renderStats(); }

  /* ----- Event ----- */
  el.start.addEventListener('click', () => {
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
    state.running ? stop() : begin();
  });
  $('reset').addEventListener('click', () => setMode(state.mode));
  $('skip').addEventListener('click', () => {
    if (state.mode === 'focus') setMode(nextMode('focus', today().sessions + 1, state.settings.every));
    else setMode('focus');
  });
  document.querySelectorAll('.modes button').forEach((b) =>
    b.addEventListener('click', () => setMode(b.dataset.mode)));

  $('task-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('task-input');
    const text = input.value.trim();
    if (!text) return;
    const task = { id: Date.now().toString(36), text, done: false, pomos: 0 };
    state.tasks.push(task);
    if (!state.activeId) state.activeId = task.id;
    input.value = '';
    saveTasks(); renderAll();
  });

  $('clear-done').addEventListener('click', () => {
    state.tasks = state.tasks.filter((x) => !x.done);
    saveTasks(); renderAll();
  });

  const form = $('settings-form');
  Object.keys(DEFAULTS).forEach((k) => { form.elements[k].value = state.settings[k]; });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    Object.keys(DEFAULTS).forEach((k) => {
      const v = parseInt(form.elements[k].value, 10);
      state.settings[k] = v > 0 ? v : DEFAULTS[k];
      form.elements[k].value = state.settings[k];
    });
    store.set('fokusku:settings', state.settings);
    setMode(state.mode);
  });

  document.addEventListener('keydown', (e) => {
    const tag = e.target.tagName;
    if (e.code === 'Space' && tag !== 'INPUT' && tag !== 'BUTTON' && tag !== 'SUMMARY') {
      e.preventDefault();
      el.start.click();
    }
  });

  // Sinkron saat tab kembali aktif
  document.addEventListener('visibilitychange', () => { if (state.running) tick(); });

  $('today-date').textContent = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' });
  state.remaining = duration('focus');
  renderAll();
}
