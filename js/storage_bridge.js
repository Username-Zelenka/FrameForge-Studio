/* =========================================================================
   storage_bridge.js — Native Storage Bridge
   Автосохранение проекта ВМЕСТЕ С МЕДИА в отдельный файл на диске
   (File System Access API), с резервным хранилищем в IndexedDB.

   Формат файла .ffbundle:
     "FFB1" (4 байта) | длина манифеста (uint32 LE) | манифест JSON | байты медиа
   Манифест содержит сам проект, настройки, позицию плейхеда и таблицу
   медиафайлов со смещениями — поэтому один файл = весь проект целиком.
   ========================================================================= */
(function (root) {
  'use strict';
  const PPE = root.PPE = root.PPE || {};
  const U = PPE.utils, S = PPE.state;
  const $ = U.$;
  const MAGIC = 'FFB1';
  const DB_NAME = 'frameforge.bridge.v1';
  const STORE = 'kv';
  const HANDLE_KEY = 'saveHandle';
  const MEDIA_KEY = 'mediaBundle';
  const PROJECT_KEY = 'projectBundle';
  const DEFAULT_NAME = 'FrameForge-автосохранение.ffbundle';

  const B = PPE.bridge = {
    mode: 'off',            // 'file' | 'idb' | 'off'
    handle: null,           // FileSystemFileHandle | FileSystemDirectoryHandle
    dirHandle: null,
    lastSave: 0,
    lastError: '',
    busy: false,
    supported: typeof root.showSaveFilePicker === 'function',
    autoSave: true,
    autoEnable: true,       // встроенное хранилище включено по умолчанию
    mediaCache: null
  };
  let queueTimer = 0, pending = false;

  /* --------------------------------- IndexedDB --------------------------------- */
  function openDB() {
    return new Promise((resolve, reject) => {
      let req;
      try { req = indexedDB.open(DB_NAME, 1); } catch (e) { reject(e); return; }
      req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbSet(key, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }
  async function idbGet(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const rq = tx.objectStore(STORE).get(key);
      rq.onsuccess = () => { db.close(); resolve(rq.result); };
      rq.onerror = () => { db.close(); reject(rq.error); };
    });
  }
  async function idbDel(key) {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => { db.close(); resolve(false); };
    });
  }

  /* ------------------------------ сборка бандла ------------------------------ */
  /** Байты файла медиа: File из памяти или blob по url. */
  async function mediaBytes(m) {
    if (m.file && m.file.size) return m.file;
    if (m.url && /^blob:/.test(m.url)) {
      try { const r = await fetch(m.url); return await r.blob(); } catch (e) { return null; }
    }
    return null;
  }
  async function buildBundle() {
    const mediaList = (S.project.media || []).filter(m => !m.generated);
    const table = [], blobs = [];
    let offset = 0;
    for (const m of mediaList) {
      const blob = await mediaBytes(m);
      if (!blob) continue;
      table.push({
        id: m.id, name: m.fileName || m.name, mime: blob.type || '',
        size: blob.size, lastModified: (m.file && m.file.lastModified) || Date.now(), offset: offset
      });
      blobs.push(blob);
      offset += blob.size;
    }
    const project = JSON.parse(S.serialize(false));
    const manifest = {
      v: 1, app: 'FrameForge Studio', kind: 'frameforge-bundle',
      savedAt: new Date().toISOString(),
      project: project.project, settings: project.settings,
      playhead: project.playhead, zoom: project.zoom,
      media: table
    };
    const json = new TextEncoder().encode(JSON.stringify(manifest));
    const head = new Uint8Array(8);
    head.set([70, 70, 66, 49], 0);                        // "FFB1"
    new DataView(head.buffer).setUint32(4, json.length, true);
    return { manifest, parts: [head, json].concat(blobs), size: 8 + json.length + offset, savedBytes: offset };
  }
  function parseBundle(buffer) {
    const bytes = new Uint8Array(buffer);
    if (bytes.length < 8) throw new Error('Файл слишком мал');
    const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    if (magic !== MAGIC) throw new Error('Это не файл автосохранения FrameForge');
    const len = new DataView(bytes.buffer).getUint32(4, true);
    const json = new TextDecoder().decode(bytes.subarray(8, 8 + len));
    const manifest = JSON.parse(json);
    const base = 8 + len;
    return { manifest, bytes, base };
  }

  /* --------------------------------- запись/чтение --------------------------------- */
  async function pickFile(force) {
    if (!B.supported) throw new Error('Браузер не поддерживает запись в файл (нужен Chrome/Edge)');
    const handle = await root.showSaveFilePicker({
      suggestedName: DEFAULT_NAME,
      types: [{ description: 'Проект FrameForge с медиа', accept: { 'application/octet-stream': ['.ffbundle'] } }]
    });
    B.handle = handle; B.dirHandle = null; B.mode = 'file';
    await idbSet(HANDLE_KEY, handle);
    return handle;
  }
  async function ensurePermission(handle, write) {
    if (!handle || !handle.queryPermission) return true;
    const opts = { mode: write ? 'readwrite' : 'read' };
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    try { return (await handle.requestPermission(opts)) === 'granted'; } catch (e) { return false; }
  }
  async function writeToHandle(handle, blob) {
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
  }
  async function saveNow(opts) {
    opts = opts || {};
    if (B.busy) return false;
    B.busy = true;
    try {
      const bundle = await buildBundle();
      const blob = new Blob(bundle.parts, { type: 'application/octet-stream' });
      if (B.mode === 'file' && B.handle) {
        if (!(await ensurePermission(B.handle, true))) throw new Error('Нет доступа к файлу автосохранения');
        await writeToHandle(B.handle, blob);
      } else if (B.mode === 'idb') {
        await idbSet(PROJECT_KEY, JSON.stringify({
          savedAt: new Date().toISOString(), project: bundle.manifest.project,
          settings: bundle.manifest.settings, playhead: bundle.manifest.playhead, zoom: bundle.manifest.zoom
        }));
        // медиа храним отдельными blob-ами: IDB умеет это нативно
        const list = bundle.parts.slice(2);
        await idbSet(MEDIA_KEY, { savedAt: Date.now(), items: bundle.manifest.media, blobs: list });
      } else {
        return false;
      }
      B.lastSave = Date.now();
      B.lastError = '';
      U.bus.emit('bridgeSaved', { at: B.lastSave, size: blob.size, mode: B.mode });
      if (!opts.silent) U.toast('Автосохранение: проект и медиа записаны' + (bundle.manifest.media.length ? ' (' + bundle.manifest.media.length + ' файлов)' : ''), 'success', 2200);
      return true;
    } catch (err) {
      B.lastError = err.message || String(err);
      U.bus.emit('bridgeError', { message: B.lastError });
      if (!opts.silent) U.toast('Автосохранение не удалось: ' + B.lastError, 'error', 5000);
      return false;
    } finally {
      B.busy = false; pending = false;
      updateChip();
    }
  }
  function queueSave(delay) {
    if (!B.autoSave || B.mode === 'off') return;
    pending = true;
    clearTimeout(queueTimer);
    queueTimer = setTimeout(() => { if (pending) saveNow({ silent: true }); }, delay == null ? 4000 : delay);
    updateChip();
  }

  function applyManifest(manifest, mediaFiles) {
    const obj = {
      v: 3, project: manifest.project, settings: manifest.settings || {},
      playhead: manifest.playhead || 0, zoom: manifest.zoom || 40
    };
    S.rehydrate(obj);
    (manifest.media || []).forEach(entry => {
      const m = S.findMedia(entry.id); if (!m) return;
      const file = mediaFiles[entry.id];
      if (!file) { m.offline = true; return; }
      try {
        if (m.url) URL.revokeObjectURL(m.url);
        m.file = file; m.fileName = entry.name || m.fileName;
        m.url = URL.createObjectURL(file);
        m.offline = false;
        if (!m.peaks) { try { PPE.media.computePeaks(file, m); } catch (e) {} }
      } catch (e) {}
    });
    S.relinkNeeded = S.project.media.some(m => !m.generated && !m.url);
    if (PPE.renderAll) PPE.renderAll();
  }
  async function restoreFromFile(fileOrHandle) {
    let file = fileOrHandle;
    if (fileOrHandle && fileOrHandle.getFile) {
      if (!(await ensurePermission(fileOrHandle, false))) throw new Error('Нет доступа к файлу');
      file = await fileOrHandle.getFile();
    }
    const buf = await file.arrayBuffer();
    const { manifest, bytes, base } = parseBundle(buf);
    const files = {};
    (manifest.media || []).forEach(entry => {
      const slice = bytes.subarray(base + entry.offset, base + entry.offset + entry.size);
      files[entry.id] = new File([slice], entry.name || 'media', { type: entry.mime || '', lastModified: entry.lastModified || Date.now() });
    });
    applyManifest(manifest, files);
    U.toast('Проект восстановлен из файла автосохранения' + (manifest.media && manifest.media.length ? ' с медиа (' + manifest.media.length + ')' : ''), 'success', 4000);
    return true;
  }
  /** Перепривязка «офлайн» медиа к байтам из встроенного хранилища: без диалогов
      и без пугающих баннеров. Возвращает число восстановленных файлов. */
  async function adoptMedia(items, blobs) {
    let restored = 0;
    try {
      let list = items, data = blobs;
      if (!list) {
        const stored = (await idbGet(MEDIA_KEY)) || { items: [], blobs: [] };
        list = stored.items || []; data = stored.blobs || [];
        B.mediaCache = { items: list, blobs: data };
      }
      const missing = (S.project.media || []).filter(m => !m.generated && !m.url);
      if (!missing.length) return 0;
      for (const entry of list) {
        const m = S.findMedia(entry.id);
        if (!m || m.url) continue;
        const blob = data && data[list.indexOf(entry)];
        if (!blob) continue;
        try {
          const file = new File([blob], entry.name || m.fileName || 'media', { type: entry.mime || blob.type || '' });
          m.file = file; m.url = URL.createObjectURL(file); m.offline = false;
          m.fileName = m.fileName || entry.name;
          if (!m.peaks) { try { PPE.media.computePeaks(file, m); } catch (e) {} }
          restored++;
        } catch (e) {}
      }
      if (restored) {
        S.relinkNeeded = S.project.media.some(m => !m.generated && !m.url);
        if (PPE.renderAll) { try { PPE.renderAll(); } catch (e) {} }
        if (PPE.animationUI && PPE.animationUI.isOpen()) PPE.animationUI.requestDraw();
      }
    } catch (e) {}
    return restored;
  }
  async function restoreFromIDB() {
    const raw = await idbGet(PROJECT_KEY);
    if (!raw) return false;
    const obj = JSON.parse(raw);
    const media = (await idbGet(MEDIA_KEY)) || { items: [], blobs: [] };
    const files = {};
    (media.items || []).forEach((entry, i) => {
      const blob = media.blobs && media.blobs[i];
      if (blob) files[entry.id] = new File([blob], entry.name || 'media', { type: entry.mime || '', lastModified: entry.lastModified || Date.now() });
    });
    applyManifest({ project: obj.project, settings: obj.settings, playhead: obj.playhead, zoom: obj.zoom, media: media.items }, files);
    U.toast('Проект восстановлен из встроенного хранилища', 'success', 3000);
    return true;
  }

  /* --------------------------------- подключение --------------------------------- */
  async function connectFile() {
    try {
      await pickFile(true);
      B.mode = 'file';
      await saveNow({ silent: true });
      U.toast('Автосохранение включено: отдельный файл с медиа', 'success', 3200);
      updateChip(); renderDialog();
      return true;
    } catch (err) {
      if (err && err.name === 'AbortError') return false;
      U.toast('Не удалось выбрать файл: ' + (err.message || err), 'error', 5000);
      return false;
    }
  }
  async function connectFolder() {
    if (typeof root.showDirectoryPicker !== 'function') { U.toast('Браузер не поддерживает выбор папки', 'warn'); return false; }
    try {
      const dir = await root.showDirectoryPicker({ mode: 'readwrite' });
      const handle = await dir.getFileHandle(DEFAULT_NAME, { create: true });
      B.dirHandle = dir; B.handle = handle; B.mode = 'file';
      await idbSet(HANDLE_KEY, handle);
      await saveNow({ silent: true });
      U.toast('Автосохранение включено: файл в выбранной папке', 'success', 3200);
      updateChip(); renderDialog();
      return true;
    } catch (err) {
      if (err && err.name === 'AbortError') return false;
      U.toast('Не удалось выбрать папку: ' + (err.message || err), 'error', 5000);
      return false;
    }
  }
  async function connectIDB() {
    B.mode = 'idb'; B.handle = null; B.dirHandle = null;
    await idbDel(HANDLE_KEY);
    await saveNow({ silent: true });
    U.toast('Автосохранение во встроенное хранилище включено (медиа сохраняются в браузере)', 'success', 3600);
    updateChip(); renderDialog();
    return true;
  }
  /** Выгрузить проект одним файлом с медиа: диалог «сохранить как»,
      при отсутствии поддержки — обычное скачивание. */
  async function saveAsFile() {
    const bundle = await buildBundle();
    const blob = new Blob(bundle.parts, { type: 'application/octet-stream' });
    const name = U.safeFileName((S.project.name || 'FrameForge') + '-проект', 'ffbundle', true);
    if (B.supported && root.showSaveFilePicker) {
      try {
        const handle = await root.showSaveFilePicker({
          suggestedName: name,
          types: [{ description: 'Проект FrameForge с медиа', accept: { 'application/octet-stream': ['.ffbundle'] } }]
        });
        await writeToHandle(handle, blob);
        B.handle = handle; B.mode = 'file';
        try { await idbSet(HANDLE_KEY, handle); } catch (e) {}
        updateChip();
        return { mode: 'file', media: bundle.manifest.media.length, size: bundle.size };
      } catch (err) {
        if (err && err.name === 'AbortError') return null;
      }
    }
    downloadBlob(blob, name);
    return { mode: 'download', media: bundle.manifest.media.length, size: bundle.size };
  }
  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  async function disconnect() {
    B.mode = 'off'; B.handle = null; B.dirHandle = null;
    clearTimeout(queueTimer); pending = false;
    await idbDel(HANDLE_KEY);
    U.toast('Автосохранение в отдельный файл выключено', 'warn');
    updateChip(); renderDialog();
  }
  async function openExternal() {
    if (root.showOpenFilePicker) {
      try {
        const [handle] = await root.showOpenFilePicker({
          types: [{ description: 'Проект FrameForge', accept: { 'application/octet-stream': ['.ffbundle'] } }],
          multiple: false
        });
        await restoreFromFile(handle);
        B.handle = handle; B.mode = 'file';
        await idbSet(HANDLE_KEY, handle);
        updateChip(); renderDialog();
        return true;
      } catch (err) { if (err && err.name === 'AbortError') return false; }
    }
    // Резерв: обычный выбор файла через input
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.ffbundle,application/octet-stream';
    input.onchange = async () => {
      if (!input.files || !input.files[0]) return;
      try { await restoreFromFile(input.files[0]); updateChip(); renderDialog(); }
      catch (e) { U.toast('Не удалось открыть файл: ' + e.message, 'error', 5000); }
    };
    input.click();
    return true;
  }

  /* --------------------------------- интерфейс --------------------------------- */
  function fmtTime(ts) {
    if (!ts) return 'ещё не сохранялось';
    const d = new Date(ts);
    const p = n => String(n).padStart(2, '0');
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  function statusText() {
    if (B.mode === 'file') return 'Файл с медиа' + (B.lastSave ? ' · ' + fmtTime(B.lastSave) : '');
    if (B.mode === 'idb') return 'Встроенное хранилище' + (B.lastSave ? ' · ' + fmtTime(B.lastSave) : '');
    return 'Отключено';
  }
  function updateChip() {
    const chip = $('#bridgeChip'); if (!chip) return;
    chip.classList.toggle('hidden', B.mode === 'off' && !B.lastSave);
    chip.classList.remove('off', 'busy', 'ok');
    chip.classList.add(B.busy ? 'busy' : 'ok');
    const label = chip.querySelector('.chip-text');
    if (label) label.textContent = (B.busy ? 'Сохраняю…' : 'Автосохранение: ' + statusText());
    chip.title = 'Автосохранение проекта вместе с медиафайлами. Нажмите, чтобы настроить.';
  }
  let dialogClose = null;
  function renderDialog() {
    if (!dialogClose) return;
    U.closeModal();
    openDialog();
  }
  function openDialog() {
    const media = (S.project.media || []).filter(m => !m.generated);
    const total = media.reduce((a, m) => a + (m.file ? m.file.size : 0), 0);
    const body =
      '<div class="bridge-state ' + (B.mode === 'off' ? 'off' : 'on') + '">' +
        '<b>Статус:</b> ' + U.escapeHtml(statusText()) +
        (B.lastError ? '<div class="bridge-error">' + U.escapeHtml(B.lastError) + '</div>' : '') +
      '</div>' +
      '<div class="form-note">Отдельный файл <b>.ffbundle</b> хранит проект <b>и все медиафайлы</b> — ' +
        'его можно перенести на другой компьютер и открыть без перепривязки. ' +
        'Файлов в проекте: ' + media.length + (total ? ' · ' + (total / 1048576).toFixed(1) + ' МБ' : '') + '.</div>' +
      '<div class="bridge-actions">' +
        '<button class="btn primary" data-b="file">' + U.icon('save') + '<span>Выбрать файл автосохранения…</span></button>' +
        '<button class="btn" data-b="folder">' + U.icon('folder') + '<span>Выбрать папку…</span></button>' +
        '<button class="btn" data-b="idb">' + U.icon('layers') + '<span>Встроенное хранилище</span></button>' +
      '</div>' +
      '<div class="bridge-actions">' +
        '<button class="btn" data-b="save">' + U.icon('check') + '<span>Сохранить сейчас</span></button>' +
        '<button class="btn" data-b="open">' + U.icon('import') + '<span>Открыть из файла…</span></button>' +
        '<button class="btn danger" data-b="off">' + U.icon('close') + '<span>Отключить</span></button>' +
      '</div>' +
      '<label class="bridge-check"><input type="checkbox" id="bridgeAuto"' + (B.autoSave ? ' checked' : '') + '> Автосохранение при изменениях (каждые 4 секунды тишины)</label>' +
      '<div class="form-note">' + (B.supported
        ? 'Браузер поддерживает прямое сохранение в файл (File System Access API).'
        : 'Этот браузер не умеет писать в файл напрямую — используйте встроенное хранилище: медиа останутся в браузере и не потеряются после перезагрузки.') + '</div>';
    dialogClose = U.modal({
      title: 'Хранилище и автосохранение', icon: 'save', wide: true, body,
      onClose: () => { dialogClose = null; },
      buttons: [{ label: 'Закрыть' }],
      onOpen: (b) => {
        b.querySelectorAll('[data-b]').forEach(btn => {
          btn.onclick = async () => {
            const act = btn.dataset.b;
            if (act === 'file') await connectFile();
            else if (act === 'folder') await connectFolder();
            else if (act === 'idb') await connectIDB();
            else if (act === 'save') await saveNow({});
            else if (act === 'open') await openExternal();
            else if (act === 'off') await disconnect();
          };
        });
        const chk = $('#bridgeAuto', b);
        if (chk) chk.onchange = () => { B.autoSave = chk.checked; if (B.autoSave) queueSave(600); };
      }
    });
  }

  /* --------------------------------- запуск --------------------------------- */
  async function init() {
    U.bus.on('projectSaved', () => queueSave());
    U.bus.on('stateDirty', () => queueSave());
    U.bus.on('bridgeSaved', () => updateChip());
    U.bus.on('bridgeError', () => updateChip());
    const chip = $('#bridgeChip');
    if (chip) chip.onclick = () => openDialog();
    document.addEventListener('visibilitychange', () => { if (document.hidden && B.mode !== 'off' && pending) saveNow({ silent: true }); });
    try {
      const saved = await idbGet(HANDLE_KEY);
      if (saved) {
        B.handle = saved; B.mode = 'file';
        const ok = await ensurePermission(saved, true);
        if (!ok) U.toast('Автосохранение: нужно снова разрешить доступ к файлу', 'warn', 5000);
      }
    } catch (e) {}
    // По умолчанию всегда включено встроенное хранилище: тогда медиа не теряются
    // при перезагрузке и открытии проекта из списка — «офлайн» больше не мешает.
    if (B.mode === 'off' && B.autoEnable !== false) {
      try { B.mode = 'idb'; } catch (e) {}
    }
    updateChip();
    if (B.mode !== 'off') queueSave(1500);
  }

  B.init = init;
  B.saveNow = saveNow;
  B.queueSave = queueSave;
  B.openDialog = openDialog;
  B.connectFile = connectFile;
  B.connectFolder = connectFolder;
  B.connectIDB = connectIDB;
  B.disconnect = disconnect;
  B.openExternal = openExternal;
  B.restoreFromFile = restoreFromFile;
  B.restoreFromIDB = restoreFromIDB;
  B.adoptMedia = adoptMedia;
  B.saveAsFile = saveAsFile;
  B.parseBundle = parseBundle;
  B.statusText = statusText;
  B.updateChip = updateChip;
  B.snapshot = buildBundle;
})(window);
