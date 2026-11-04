/* =========================================================================
   utils.js — helpers, DOM, timecode, menus, modals, toasts
   ========================================================================= */
(function (root) {
  'use strict';
  const PPE = root.PPE = root.PPE || {};

  const $ = (sel, ctx) => (ctx || document).querySelector(sel);
  const $$ = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (v === true) node.setAttribute(k, '');
      else node.setAttribute(k, v);
    }
    if (children != null) {
      const arr = Array.isArray(children) ? children : [children];
      arr.forEach(c => { if (c == null || c === false) return; node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c); });
    }
    return node;
  }

  const uid = (prefix) => (prefix || 'id') + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const round = (v, n) => { const p = Math.pow(10, n == null ? 3 : n); return Math.round(v * p) / p; };
  const escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function icon(name, cls) { return `<svg class="icon ${cls || ''}"><use href="#i-${name}"></use></svg>`; }
  function iconEl(name, cls) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('class', 'icon ' + (cls || ''));
    const u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    u.setAttribute('href', '#i-' + name);
    s.appendChild(u); return s;
  }
  /* --------------------------- кадровый планировщик --------------------------- */
  /* Схлопывает пачку вызовов в один кадр: при перетаскивании клипов и во время
     воспроизведения обработчики срабатывают десятки раз в секунду, и каждый раз
     перерисовывать весь таймлайн/канвас не нужно — достаточно одного раза перед
     отрисовкой кадра. */
  function raf(fn) {
    let scheduled = false, lastArgs = null;
    const wrapped = function () {
      lastArgs = arguments;
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(function () {
        scheduled = false;
        const a = lastArgs; lastArgs = null;
        try { fn.apply(null, a || []); } catch (e) { console.error(e); }
      });
    };
    wrapped.flush = function () { if (!scheduled) return; scheduled = false; const a = lastArgs; lastArgs = null; try { fn.apply(null, a || []); } catch (e) { console.error(e); } };
    wrapped.cancel = function () { scheduled = false; lastArgs = null; };
    return wrapped;
  }
  /** Один общий кадр на несколько разных колбэков. */
  const frameQueue = new Set();
  let frameScheduled = false;
  function nextFrame(fn) {
    frameQueue.add(fn);
    if (frameScheduled) return;
    frameScheduled = true;
    requestAnimationFrame(function () {
      frameScheduled = false;
      const q = Array.from(frameQueue); frameQueue.clear();
      q.forEach(f => { try { f(); } catch (e) { console.error(e); } });
    });
  }

  function debounce(fn, ms) { let t; return function () { const a = arguments, c = this; clearTimeout(t); t = setTimeout(() => fn.apply(c, a), ms || 120); }; }
  function throttle(fn, ms) { let last = 0, pending = null; return function () { const now = Date.now(), a = arguments, c = this; if (now - last >= ms) { last = now; fn.apply(c, a); } else { clearTimeout(pending); pending = setTimeout(() => { last = Date.now(); fn.apply(c, a); }, ms - (now - last)); } }; }

  /* ------------------------------- time / timecode ------------------------------- */
  function formatTC(seconds, fps, drop) {
    fps = fps || 30;
    seconds = Math.max(0, Number(seconds) || 0);
    let totalFrames = Math.round(seconds * fps);
    const f = totalFrames % fps;
    const totalSeconds = Math.floor(totalFrames / fps);
    const s = totalSeconds % 60;
    const m = Math.floor(totalSeconds / 60) % 60;
    const h = Math.floor(totalSeconds / 3600);
    return pad(h) + ':' + pad(m) + ':' + pad(s) + ':' + pad(f);
  }
  function formatShort(seconds, fps) {
    const v = Math.max(0, Number(seconds) || 0);
    const m = Math.floor(v / 60), s = Math.floor(v % 60);
    return (m > 0 ? m + ':' : '') + pad(s);
  }
  function formatDuration(seconds) {
    const v = Math.max(0, Number(seconds) || 0);
    const m = Math.floor(v / 60), s = Math.floor(v % 60), ms = Math.floor((v % 1) * 10);
    return pad(m) + ':' + pad(s) + '.' + ms;
  }
  function pad(n, len) { return String(Math.abs(Math.floor(n))).padStart(len || 2, '0'); }
  function parseTC(str, fps) {
    if (str == null) return null;
    str = String(str).trim();
    if (!str) return null;
    if (/^-?\d+(\.\d+)?$/.test(str)) return Math.max(0, parseFloat(str));
    const parts = str.split(/[:;,.]/).map(p => parseInt(p, 10) || 0);
    let h = 0, m = 0, s = 0, f = 0;
    if (parts.length === 4) [h, m, s, f] = parts;
    else if (parts.length === 3) [m, s, f] = parts;
    else if (parts.length === 2) [s, f] = parts;
    else if (parts.length === 1) return parts[0] / (fps || 30);
    return Math.max(0, h * 3600 + m * 60 + s + f / (fps || 30));
  }
  function snapTime(t, fps) { return Math.round(t * fps) / fps; }

  /** Chromium ignores non-ASCII `download` attributes in some contexts; keep names safe. */
  function safeFileName(name, ext, withTime) {
    const map = { а:'a', б:'b', в:'v', г:'g', д:'d', е:'e', ё:'e', ж:'zh', з:'z', и:'i', й:'y', к:'k', л:'l', м:'m', н:'n', о:'o', п:'p', р:'r', с:'s', т:'t', у:'u', ф:'f', х:'h', ц:'ts', ч:'ch', ш:'sh', щ:'sch', ъ:'', ы:'y', ь:'', э:'e', ю:'yu', я:'ya' };
    let s = String(name || 'export').trim().toLowerCase();
    s = s.replace(/[а-яё]/g, ch => (map[ch] === undefined ? '-' : map[ch]));
    s = s.replace(/[^a-z0-9._-]+/g, '_').replace(/_{2,}/g, '_').replace(/^[_.-]+|[_.-]+$/g, '');
    if (!s) s = 'export';
    if (withTime) {
      const d = new Date(), p = n => String(n).padStart(2, '0');
      s += '_' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
    }
    return s + (ext ? '.' + String(ext).replace(/^\./, '') : '');
  }
  /* Сохранение файла. В обычном браузере — <a download>, а внутри Android
     WebView используется нативный мост HJC: он пишет файл в публичную папку
     «Загрузки», потому что download-атрибут в WebView не работает. */
  function download(blobOrString, filename, mime) {
    const blob = blobOrString instanceof Blob
      ? blobOrString
      : new Blob([blobOrString], { type: mime || 'text/plain;charset=utf-8' });

    // Android WebView: нативный мост HJC → публичные Загрузки
    if (window.HJC && typeof window.HJC.startSave === 'function') {
      saveViaNative(blob, filename).catch(function (err) {
        console.warn('[download] HJC failed, fallback to <a download>', err);
        downloadViaAnchor(blob, filename);
      });
      return;
    }
    downloadViaAnchor(blob, filename);
  }

  function downloadViaAnchor(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      if (a.parentNode) a.parentNode.removeChild(a);
      URL.revokeObjectURL(url);
    }, 2000);
  }

  function uint8ToBase64(u8) {
    // безопасный кусками, чтобы не упасть на больших буферах
    var s = '';
    var chunk = 0x8000;
    for (var i = 0; i < u8.length; i += chunk) {
      s += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + chunk, u8.length)));
    }
    return btoa(s);
  }

  async function saveViaNative(blob, filename) {
    var CHUNK = 256 * 1024; // 256 КБ бинарных данных за раз
    window.HJC.startSave(String(filename || 'export.bin'));

    var buf = await blob.arrayBuffer();
    var bytes = new Uint8Array(buf);

    for (var i = 0; i < bytes.length; i += CHUNK) {
      var slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
      window.HJC.appendSave(uint8ToBase64(slice));
    }
    window.HJC.endSave();
  }

  /* ----------------------------------- event bus ----------------------------------- */
  const listeners = {};
  const bus = {
    on(name, fn) { (listeners[name] = listeners[name] || []).push(fn); return () => bus.off(name, fn); },
    off(name, fn) { if (listeners[name]) listeners[name] = listeners[name].filter(f => f !== fn); },
    emit(name, data) { (listeners[name] || []).slice().forEach(fn => { try { fn(data); } catch (e) { console.error('[bus] ' + name, e); } }); }
  };

  /* ----------------------------------- status ----------------------------------- */
  let statusTimer = null;
  function status(text, kind, transient) {
    const t = $('#statusText'), dot = $('#statusIcon');
    if (t) t.textContent = text;
    if (dot) dot.className = 'status-dot' + (kind === 'busy' ? ' busy' : kind === 'error' ? ' error' : '');
    clearTimeout(statusTimer);
    if (transient) statusTimer = setTimeout(() => status('Готов к работе'), 3200);
  }
  function hint(text) { const h = $('#statusHint'); if (h) h.textContent = text; }

  function toast(message, kind, ms) {
    const rootEl = $('#toastRoot'); if (!rootEl) return;
    const node = el('div', { class: 'toast ' + (kind || ''), html: escapeHtml(message).replace(/\n/g, '<br>') });
    rootEl.appendChild(node);
    setTimeout(() => { node.style.opacity = '0'; node.style.transition = 'opacity .25s'; setTimeout(() => node.remove(), 280); }, ms || 3400);
  }

  /* ------------------------------- floating layers ------------------------------- */
  /* Все всплывающие панели (меню, контекстные меню, палитра инструментов, палитра
     команд) регистрируются здесь и закрываются ОДНИМ обработчиком pointerdown.
     Раньше у каждой панели был свой обработчик: палитра с большим z-index могла
     остаться открытой и перехватывала клики по пунктам меню — пункт «не срабатывал»,
     а панель при этом закрывалась. Теперь слой закрывается только если нажатие
     пришлось ВНЕ него, а нажатие внутри слоя всегда доходит до своего обработчика. */
  const layers = [];
  let menuAnchor = null;

  function layerOpen(node) {
    if (!node || !node.isConnected) return false;
    if (node.classList.contains('hidden')) return false;
    return node.getClientRects().length > 0;
  }
  function addLayer(node, close, keep) {
    if (!node) return null;
    const entry = { node, close, keep: keep || null };
    const i = layers.findIndex(l => l.node === node);
    if (i >= 0) layers[i] = entry; else layers.push(entry);
    return entry;
  }
  function removeLayer(node) {
    if (!node) return;
    const i = layers.findIndex(l => l.node === node);
    if (i >= 0) layers.splice(i, 1);
  }
  function isLayerOpen(node) { return layerOpen(node); }
  /** Закрывает все открытые всплывающие слои (кроме указанного узла). */
  function closeLayers(exceptNode, event) {
    layers.slice().forEach(L => {
      const node = L.node;
      if (!node || !node.isConnected) { removeLayer(node); return; }
      if (!layerOpen(node)) return;
      if (exceptNode && node === exceptNode) return;
      if (event) {
        const t = event.target;
        if (t && t.nodeType === 1) {
          // нажатие по самому слою — не закрываем (иначе click не успевает дойти)
          if (node.contains(t)) return;
          // нажатие по кнопке, которая этот слой открывает — тоже не закрываем
          // (тогда её собственный обработчик сможет «переключить» панель)
          if (L.keep && L.keep.some(k => {
            try {
              if (typeof k === 'string') return !!t.closest(k);
              return !!k && (k === t || (k.contains && k.contains(t)));
            } catch (e) { return false; }
          })) return;
        }
      }
      try { L.close(); } catch (e) { console.error(e); }
    });
  }

  /* ----------------------------------- menus ----------------------------------- */
  function closeMenus() {
    $$('.menu-drop').forEach(n => { removeLayer(n); n.remove(); });
    $$('.menu-top.open').forEach(n => n.classList.remove('open'));
    menuAnchor = null;
    hideContext();
  }
  function renderMenuItems(items) {
    const frag = document.createDocumentFragment();
    items.forEach(item => {
      if (item === '-' || item.sep) { frag.appendChild(el('div', { class: 'menu-sep' })); return; }
      const node = el('div', {
        class: 'menu-item' + (item.disabled ? ' disabled' : '') + (item.danger ? ' danger' : ''),
        html: (item.icon ? icon(item.icon, 'mi-icon') : '<span class="mi-icon"></span>') +
          '<span>' + escapeHtml(item.label) + '</span>' +
          (item.checked != null ? '<span class="menu-check">' + (item.checked ? '✓' : '') + '</span>' : '') +
          (item.shortcut ? '<span class="mi-short">' + escapeHtml(item.shortcut) + '</span>' : '')
      });
      if (!item.disabled) node.addEventListener('click', (ev) => { ev.stopPropagation(); closeMenus(); try { item.action && item.action(); } catch (e) { console.error(e); toast('Ошибка: ' + e.message, 'error'); } });
      frag.appendChild(node);
    });
    return frag;
  }
  function dropdown(anchor, items, align) {
    // Повторное нажатие на тот же «якорь» закрывает меню (toggle) — иначе клик
    // выглядел как «ничего не произошло»: меню просто открывалось заново.
    if (anchor && menuAnchor === anchor && $('.menu-drop')) { closeMenus(); return null; }
    closeMenus();
    const menu = el('div', { class: 'menu-drop' });
    menu.appendChild(renderMenuItems(items));
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    const w = menu.offsetWidth, h = menu.offsetHeight;
    let x = align === 'right' ? r.right - w : r.left;
    x = clamp(x, 4, Math.max(4, window.innerWidth - w - 4));
    let y = r.bottom + 2;
    if (y + h > window.innerHeight - 6) y = Math.max(4, r.top - h - 2);
    menu.style.left = x + 'px'; menu.style.top = y + 'px';
    if (anchor.classList && anchor.classList.contains('menu-top')) anchor.classList.add('open');
    menuAnchor = anchor || null;
    addLayer(menu, closeMenus, anchor ? [anchor] : null);
    return menu;
  }
  function closeContext() {
    const c = $('#contextMenu');
    if (c) { removeLayer(c); c.classList.add('hidden'); c.innerHTML = ''; }
  }
  function hideContext() { closeContext(); }
  function contextMenu(x, y, items) {
    closeMenus();
    const c = $('#contextMenu'); if (!c) return;
    c.innerHTML = ''; c.appendChild(renderMenuItems(items)); c.classList.remove('hidden');
    const w = c.offsetWidth, h = c.offsetHeight;
    c.style.left = clamp(x, 4, Math.max(4, window.innerWidth - w - 6)) + 'px';
    c.style.top = clamp(y, 4, Math.max(4, window.innerHeight - h - 6)) + 'px';
    addLayer(c, closeContext);
  }

  /* ----------------------------------- modals ----------------------------------- */
  let modalCleanup = null, modalOnClose = null;
  function closeModal() {
    const r = $('#modalRoot'); if (!r) return;
    r.classList.add('hidden'); r.innerHTML = '';
    if (modalCleanup) { try { modalCleanup(); } catch (e) {} modalCleanup = null; }
    if (modalOnClose) { try { modalOnClose(); } catch (e) {} modalOnClose = null; }
    bus.emit('modalClose');
  }
  /**
   * modal({title, icon, body: html|node, wide, buttons:[{label,class,action}], onOpen})
   * button.action(bodyEl, close) — return false to keep modal open
   */
  function modal(opts) {
    closeModal();
    const rootEl = $('#modalRoot'); if (!rootEl) return () => {};
    const bodyEl = el('div', { class: 'modal-body' });
    if (typeof opts.body === 'string') bodyEl.innerHTML = opts.body;
    else if (opts.body) bodyEl.appendChild(opts.body);
    const modalEl = el('div', { class: 'modal' + (opts.wide ? ' wide' : '') }, [
      el('div', { class: 'modal-head' }, [
        iconEl(opts.icon || 'info'),
        el('span', { text: opts.title || '' }),
        el('span', { class: 'spacer' }),
        el('button', { class: 'icon-btn', title: 'Закрыть', html: icon('close'), onclick: closeModal })
      ]),
      bodyEl,
      el('div', { class: 'modal-foot' })
    ]);
    const foot = $('.modal-foot', modalEl);
    const close = () => closeModal();
    (opts.buttons || [{ label: 'Закрыть' }]).forEach(b => {
      const btn = el('button', { class: 'btn ' + (b.class || ''), text: b.label });
      btn.addEventListener('click', () => { const res = b.action ? b.action(bodyEl, close) : undefined; if (res !== false && (b.close !== false)) close(); });
      foot.appendChild(btn);
    });
    rootEl.innerHTML = ''; rootEl.appendChild(modalEl); rootEl.classList.remove('hidden');
    modalOnClose = opts.onClose || null;
    rootEl.onclick = (e) => { if (e.target === rootEl && opts.backdropClose !== false) close(); };
    if (opts.onOpen) opts.onOpen(bodyEl, close, modalEl);
    const first = $('input,select,textarea,button', bodyEl); if (first) setTimeout(() => first.focus(), 30);
    return close;
  }

  /* Один обработчик на все всплывающие панели. Capture-фаза нужна, чтобы слой
     закрывался до того, как нажатие дойдёт до «фона» (таймлайн, монитор).
     Нажатие ВНУТРИ слоя не закрывает его — именно из-за этого раньше пункты меню
     «не нажимались»: панель исчезала раньше, чем приходил click. */
  document.addEventListener('pointerdown', (e) => {
    closeLayers(null, e);
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeLayers();
      if (!$('#modalRoot').classList.contains('hidden')) closeModal();
      if (PPE.tutorial && PPE.tutorial.isOpen && PPE.tutorial.isOpen()) PPE.tutorial.stop();
    }
  });

  const utils = {
    $, $$, el, uid, clamp, round, escapeHtml, icon, iconEl, debounce, throttle, raf, nextFrame,
    formatTC, formatShort, formatDuration, parseTC, snapTime, safeFileName, download, downloadViaAnchor, saveViaNative, bus,
    status, hint, toast, modal, closeModal, dropdown, contextMenu, hideContext, closeMenus, renderMenuItems,
    addLayer, removeLayer, isLayerOpen, closeLayers
  };
  PPE.utils = utils;
  PPE.$ = $; PPE.$$ = $$;
})(window);
