/* =========================================================================
   projects.js — стартовое окно со всеми проектами + хранилище проектов
   ========================================================================= */
(function (root) {
  'use strict';
  const PPE = root.PPE = root.PPE || {};
  const U = PPE.utils, S = PPE.state;
  const $ = U.$, $$ = U.$$, el = U.el, esc = U.escapeHtml, uid = U.uid;

  const INDEX_KEY = 'frameforge.projects.v1';
  const PREF_KEY = 'frameforge.prefs.v1';
  const mem = {};
  let index = [];
  let currentId = null;
  let opts = {};
  let openFlag = false;
  let search = '';

  let storageWarned = false;
  function sget(k) { if (Object.prototype.hasOwnProperty.call(mem, k)) return mem[k]; try { return localStorage.getItem(k); } catch (e) { return null; } }
  function sset(k, v) { try { localStorage.setItem(k, v); delete mem[k]; } catch (e) { mem[k] = v; if (!storageWarned) { storageWarned = true; U.toast('Список проектов временный: хранилище недоступно или заполнено. Скачайте проект JSON.', 'warn', 8000); } } }
  function readIndex() {
    try { const raw = sget(INDEX_KEY); const a = raw ? JSON.parse(raw) : []; return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }
  // «Живой» снимок с blob-URL хранится только в памяти: после перезагрузки
  // эти URL недействительны, поэтому на диск пишем только офлайн-версию.
  function writeIndex() {
    sset(INDEX_KEY, JSON.stringify(index.map(e => ({ id: e.id, name: e.name, updated: e.updated, data: e.data }))));
  }
  function prefs() { try { return JSON.parse(sget(PREF_KEY) || '{}'); } catch (e) { return {}; } }
  function setPref(k, v) { const p = prefs(); p[k] = v; sset(PREF_KEY, JSON.stringify(p)); }

  function init(options) {
    opts = options || {};
    index = readIndex();
    const last = prefs().lastId;
    if (last && index.some(e => e.id === last)) currentId = last;
    // Keep the multi-project index in sync with editor changes.
    const save = U.debounce(() => saveCurrent(), 900);
    U.bus.on('history', save);
    U.bus.on('projectSaved', save);
    U.bus.on('stateDirty', save);
    window.addEventListener('beforeunload', () => { try { saveCurrent(); } catch (e) {} });
  }

  function seedIfEmpty(name, data) {
    if (index.length) return;
    const e = { id: uid('proj'), name: name || 'Демо-проект', updated: Date.now(), data: data };
    try { e.live = S.serialize(true); } catch (err) {}
    index.push(e); writeIndex();
    currentId = e.id; setPref('lastId', e.id);
  }
  function add(name, data) {
    const e = { id: uid('proj'), name: name || 'Без имени', updated: Date.now(), data: data };
    index.unshift(e); writeIndex(); return e.id;
  }
  function list() { return index.slice().sort((a, b) => (b.updated || 0) - (a.updated || 0)); }
  function find(id) { return index.find(e => e.id === id); }
  // Загружаем именно проект из индекса. Пустой проект и проект без медиа —
  // полноценные проекты; устаревший автоснимок нельзя записывать поверх них.
  function restoreLast() {
    if (!currentId && index.length) { currentId = list()[0].id; setPref('lastId', currentId); }
    const e = find(currentId); if (!e) return false;
    try { S.rehydrate(JSON.parse(e.live || e.data)); if (PPE.media && PPE.media.resetRuntime) PPE.media.resetRuntime(); return true; }
    catch (err) { console.warn('Не удалось восстановить проект из индекса', err); return false; }
  }

  function saveCurrent() {
    if (!currentId) return;
    const e = find(currentId); if (!e) return;
    try {
      e.name = S.project.name || e.name;
      e.updated = Date.now();
      e.data = S.exportProjectFile();
      e.live = S.serialize(true);   // blob-URL живы в рамках текущей сессии
      writeIndex();
    } catch (err) { console.warn('saveCurrent', err); }
  }

  function stats(data) {
    try {
      const p = (JSON.parse(data) || {}).project || {};
      let clips = 0, dur = 0;
      (p.tracks || []).forEach(t => (t.clips || []).forEach(c => {
        clips++;
        const len = ((c.outPoint || 0) - (c.inPoint || 0)) / (c.speed || 1) || 0;
        dur = Math.max(dur, (c.start || 0) + len);
      }));
      const gen = (p.media || []).filter(m => m.generated);
      const colorMedia = gen.find(m => m.type === 'color' && m.data && m.data.color);
      const textMedia = gen.find(m => m.type === 'text');
      return {
        clips: clips, dur: dur, media: (p.media || []).length,
        w: p.width || 1920, h: p.height || 1080, fps: p.fps || 30,
        color: colorMedia ? colorMedia.data.color : '#2c3f5a',
        title: textMedia && textMedia.data ? textMedia.data.text : ''
      };
    } catch (e) { return { clips: 0, dur: 0, media: 0, w: 1920, h: 1080, fps: 30, color: '#2c3f5a', title: '' }; }
  }
  function dateText(ts) {
    try {
      const d = new Date(ts || Date.now());
      return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' }) + ' · ' +
        d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return ''; }
  }

  /* =============================== start screen UI =============================== */
  function isOpen() { return openFlag; }
  function show(options) {
    const rootEl = $('#startScreen'); if (!rootEl) return;
    // Фиксируем состояние текущего проекта до того, как пользователь может
    // выбрать/создать другой — иначе «текущий» id мог бы указывать не туда.
    if (!options || !options.initial) saveCurrent();
    openFlag = true;
    rootEl.classList.remove('hidden');
    rootEl.innerHTML = '';
    rootEl.appendChild(buildWindow());
    setTimeout(() => { const s = $('#projSearch', rootEl); if (s) s.focus(); }, 40);
  }
  function hide() {
    const rootEl = $('#startScreen'); if (!rootEl) return;
    openFlag = false; rootEl.classList.add('hidden'); rootEl.innerHTML = '';
    U.closeMenus();
  }
  function buildWindow() {
    const wrap = el('div', { class: 'start-window' });
    const head = el('div', { class: 'start-head' }, [
      el('div', { class: 'start-brand' }, [
        el('span', { class: 'brand-mark', html: 'F<span>F</span>' }),
        el('div', {}, [
          el('div', { class: 'start-title', text: 'FrameForge Studio' }),
          el('div', { class: 'start-subtitle', text: 'Ваши проекты' })
        ])
      ]),
      el('div', { class: 'start-head-actions' }, [
        el('button', { class: 'icon-btn', title: 'Закрыть и открыть текущий проект', html: U.icon('close'), onclick: () => { if (opts.applyLayout) opts.applyLayout(); hide(); } })
      ])
    ]);
    const tools = el('div', { class: 'start-tools' }, [
      el('button', { class: 'btn primary', html: U.icon('plus') + '<span>Новый проект</span>', onclick: newProjectDialog }),
      el('button', { class: 'btn', html: U.icon('folder') + '<span>Открыть файл…</span>', onclick: () => $('#projectInput').click() }),
      el('button', { class: 'btn', title: 'Короткое обучение: как устроен редактор', html: U.icon('info') + '<span>Туториал</span>', onclick: () => { if (PPE.tutorial && PPE.tutorial.startFromStartScreen) PPE.tutorial.startFromStartScreen(); } }),
      el('div', { class: 'start-search' }, [
        el('span', { class: 'search-icon', html: U.icon('search') }),
        el('input', { id: 'projSearch', type: 'text', placeholder: 'Поиск проекта…', value: search, oninput: e => { search = e.target.value; renderCards(); } })
      ])
    ]);
    const cards = el('div', { class: 'start-cards', id: 'startCards' });
    const foot = el('div', { class: 'start-foot' }, [
      el('span', { text: 'Проекты сохраняются при доступном хранилище браузера. Медиа после перезапуска нужно перепривязать.' }),
      el('span', { class: 'spacer' }),
      el('span', { class: 'start-count', id: 'startCount' })
    ]);
    wrap.appendChild(head); wrap.appendChild(tools); wrap.appendChild(cards); wrap.appendChild(foot);
    setTimeout(renderCards, 0);
    return wrap;
  }
  function renderCards() {
    const box = $('#startCards'); if (!box) return;
    const items = list().filter(e => !search || (e.name || '').toLowerCase().includes(search.toLowerCase()));
    const count = $('#startCount'); if (count) count.textContent = 'Проектов: ' + index.length;
    box.innerHTML = '';
    if (!items.length) {
      box.appendChild(el('div', { class: 'start-empty' }, [
        el('div', { class: 'start-empty-icon', html: U.icon('film') }),
        el('div', { class: 'start-empty-title', text: search ? 'Ничего не найдено' : 'Проектов пока нет' }),
        el('div', { class: 'start-empty-text', text: 'Создайте первый проект или откройте файл .json' }),
        el('button', { class: 'btn primary', html: U.icon('plus') + '<span>Новый проект</span>', onclick: newProjectDialog })
      ]));
      return;
    }
    items.forEach(entry => box.appendChild(card(entry)));
  }
  function card(entry) {
    const st = stats(entry.data);
    const gradient = 'linear-gradient(145deg,' + st.color + ' 0%, #171923 100%)';
    const preview = el('div', { class: 'start-preview', style: { background: gradient } }, [
      el('div', { class: 'start-preview-grid' }),
      el('div', { class: 'start-preview-text', text: st.title || entry.name }),
      el('div', { class: 'start-preview-badge', text: st.w + '×' + st.h + ' · ' + st.fps + ' fps' }),
      el('div', { class: 'start-preview-play', html: U.icon('play') })
    ]);
    const info = el('div', { class: 'start-card-info' }, [
      el('div', { class: 'start-card-name', text: entry.name || 'Без имени', title: entry.name }),
      el('div', { class: 'start-card-meta', html: esc(String(st.clips)) + ' клипов · ' + esc(String(st.media)) + ' медиа · ' + esc(U.formatTC(st.dur, st.fps)) }),
      el('div', { class: 'start-card-date', text: 'Изменён ' + dateText(entry.updated) })
    ]);
    const actions = el('div', { class: 'start-card-actions' }, [
      el('button', { class: 'btn tiny primary', text: 'Открыть', onclick: () => open(entry.id) }),
      el('button', { class: 'icon-btn tiny', title: 'Действия', html: U.icon('more'), onclick: e => cardMenu(e.currentTarget, entry.id) })
    ]);
    const node = el('div', {
      class: 'start-card' + (entry.id === currentId ? ' current' : ''),
      ondblclick: () => open(entry.id), onclick: e => { if (e.target.closest('.start-card-actions')) return; open(entry.id); }
    }, [preview, info, actions]);
    return node;
  }
  function cardMenu(anchor, id) {
    const e = find(id); if (!e) return;
    U.dropdown(anchor, [
      { label: 'Открыть', icon: 'play', action: () => open(id) },
      { label: 'Переименовать…', icon: 'text', action: () => renameDialog(id) },
      { label: 'Дублировать', icon: 'copy', action: () => { const n = add((e.name || 'Проект') + ' (копия)', e.data); const ne = find(n); if (ne && e.live) ne.live = e.live; renderCards(); U.toast('Проект скопирован', 'success'); } },
      { label: 'Скачать .json', icon: 'export', action: () => U.download(e.data, U.safeFileName(e.name, 'json'), 'application/json') },
      '-',
      { label: 'Удалить', icon: 'trash', danger: true, action: () => remove(id) }
    ], 'right');
  }

  /* =============================== project operations =============================== */
  function open(id) {
    const entry = find(id); if (!entry) { U.toast('Проект не найден', 'error'); return; }
    try {
      const P = PPE.panels, M = PPE.media, E = PPE.engine, T = PPE.timeline;
      E.pause();
      const obj = JSON.parse(entry.live || entry.data);
      obj.playhead = 0; obj.zoom = 40;
      S.rehydrate(obj);
      S.history.undo.length = 0; S.history.redo.length = 0; S.history.pending = null;
      if (M.resetRuntime) M.resetRuntime();
      currentId = id; setPref('lastId', id);
      S.persist(true);
      hide();
      if (opts.applyLayout) opts.applyLayout();
      if (PPE.renderAll) PPE.renderAll();
      const first = S.project.media.find(m => m.type === 'text') || S.project.media[0];
      if (first && P.openSource) { try { P.openSource(first.id); } catch (e) {} }
      else if (E.openSource) { try { E.openSource(null); } catch (e) {} }
      U.bus.emit('history');
      // Медиа из встроенного хранилища подтягиваем молча.
      if (PPE.bridge && PPE.bridge.adoptMedia) {
        PPE.bridge.adoptMedia().then(n => { if (n) { if (PPE.renderAll) PPE.renderAll(); } }).catch(() => {});
      }
      U.toast('Проект «' + (S.project.name || entry.name) + '» открыт', 'success');
      setTimeout(() => { try { T.fitZoom(); } catch (e) {} }, 180);
    } catch (err) {
      U.toast('Не удалось открыть проект: ' + err.message, 'error');
      console.error(err);
    }
  }
  function remove(id) {
    const e = find(id); if (!e) return;
    if (!confirm('Удалить проект «' + (e.name || 'Без имени') + '»?')) return;
    index = index.filter(x => x.id !== id); writeIndex();
    if (currentId === id) currentId = index.length ? index[0].id : null;
    renderCards(); U.toast('Проект удалён', 'success');
  }
  function renameDialog(id) {
    const e = find(id); if (!e) return;
    U.modal({
      title: 'Переименовать проект', icon: 'text',
      body: '<div class="form-row"><label>Название</label><div class="form-control"><input type="text" id="prjRename" value="' + esc(e.name || '') + '"></div></div>',
      onOpen: (b) => { const i = $('#prjRename', b); if (i) { i.focus(); i.select(); } },
      buttons: [
        { label: 'Отмена' },
        { label: 'Сохранить', class: 'primary', close: false, action: (b, close) => {
          const v = ($('#prjRename', b).value || '').trim();
          if (v) { e.name = v; e.updated = Date.now(); writeIndex(); if (id === currentId) S.project.name = v; renderCards(); }
          close(); return false;
        } }
      ]
    });
  }
  function newProjectDialog() {
    U.modal({
      title: 'Новый проект', icon: 'film',
      body: '<div class="form-row"><label>Название проекта</label><div class="form-control"><input type="text" id="npName" value="Новый проект"></div></div>' +
        '<div class="form-row"><label>Шаблон</label><div class="form-control"><select id="npTemplate"><option value="demo">Демо-последовательность (титры + переход)</option><option value="blank">Пустая последовательность</option></select></div></div>' +
        '<div class="form-row"><label>Формат кадра</label><div class="form-control"><select id="npRatio">' +
          '<option value="16:9">16:9 — широкая, 1920×1080</option>' +
          '<option value="9:16">9:16 — вертикальная, 1080×1920</option>' +
          '<option value="1:1">1:1 — квадрат, 1080×1080</option>' +
          '<option value="4:5">4:5 — портрет, 1080×1350</option>' +
        '</select></div></div>' +
        '<div class="form-note">Проект появится в списке. Вернуться к списку можно через меню «Файл → Все проекты».</div>',
      onOpen: (b) => { const i = $('#npName', b); if (i) { i.focus(); i.select(); } },
      buttons: [
        { label: 'Отмена' },
        { label: 'Создать и открыть', class: 'primary', close: false, action: (b, close) => {
          const name = ($('#npName', b).value || '').trim() || 'Без имени';
          const tpl = $('#npTemplate', b).value;
          const ratioSel = $('#npRatio', b);
          const ratioId = ratioSel ? ratioSel.value : '16:9';
          try {
            S.newProject();
            const table = { '16:9': [16, 9], '9:16': [9, 16], '1:1': [1, 1], '4:5': [4, 5] };
            const rr = table[ratioId] || [16, 9];
            const ratio = rr[0] / rr[1], short = 1080, even = n => Math.max(2, Math.round(n / 2) * 2);
            S.project.width = ratio >= 1 ? even(short * ratio) : short;
            S.project.height = ratio >= 1 ? short : even(short / ratio);
            if (tpl === 'demo' && opts.createDemo) opts.createDemo();
            S.project.name = name;
            const data = S.exportProjectFile();
            const id = add(name, data);
            close();
            open(id);
          } catch (err) { U.toast('Ошибка: ' + err.message, 'error'); }
          return false;
        } }
      ]
    });
  }
  async function importFile(file) {
    if (!file) return;
    try {
      // Один файл .ffbundle несёт и проект, и все медиа.
      const head = await file.slice(0, 4).arrayBuffer();
      const magic = String.fromCharCode.apply(null, new Uint8Array(head));
      if (magic === 'FFB1' && PPE.bridge && PPE.bridge.restoreFromFile) {
        await PPE.bridge.restoreFromFile(file);
        const data = S.exportProjectFile();
        const id = add(S.project.name || file.name.replace(/\.[^.]+$/, ''), data);
        currentId = id; setPref('lastId', id);
        S.persist(true);
        hide();
        if (PPE.renderAll) PPE.renderAll();
        return;
      }
      const text = await file.text();
      const obj = JSON.parse(text);
      const p = obj.project || obj;
      if (!p || !p.name && !p.tracks) throw new Error('Это не файл проекта FrameForge');
      const data = JSON.stringify({ v: 3, app: 'FrameForge Studio', savedAt: new Date().toISOString(), project: p }, null, 2);
      const name = p.name || file.name.replace(/\.[^.]+$/, '');
      const id = add(name, data);
      U.toast('Проект добавлен в список', 'success');
      open(id);
    } catch (err) { U.toast('Не удалось открыть проект: ' + err.message, 'error'); }
  }

  PPE.projects = {
    init, show, hide, isOpen, open, list, saveCurrent, seedIfEmpty, restoreLast, add, remove,
    newProjectDialog, importFile, currentId: () => currentId
  };
})(window);
