/* =========================================================================
   pro_tools.js — полный набор монтажных инструментов Premiere Pro
   ========================================================================= */
(function (root) {
  'use strict';
  const PPE = root.PPE = root.PPE || {};
  const U = PPE.utils, S = PPE.state;
  const $ = U.$, $$ = U.$$, el = U.el, clamp = U.clamp, uid = U.uid, esc = U.escapeHtml;
  const PRO = PPE.pro;
  const T = () => PPE.timeline, E = () => PPE.engine, P = () => PPE.panels, M = () => PPE.media;

  const ICON = {
    select: 'select', trackForward: 'step-fwd', trackBackward: 'step-back', ripple: 'layers',
    rolling: 'sliders', rateStretch: 'speed', razor: 'razor', slip: 'sliders', slide: 'sliders',
    pen: 'add-track', hand: 'hand', zoom: 'zoom-in', type: 'text', vtype: 'text',
    rect: 'cards', ellipse: 'cards'
  };
  const TOOLS = [
    { id: 'select', name: 'Selection Tool', key: 'V', hint: 'Выделение и перемещение клипов' },
    { id: 'trackForward', name: 'Track Select Forward Tool', key: 'A', hint: 'Выделяет все клипы правее точки клика' },
    { id: 'trackBackward', name: 'Track Select Backward Tool', key: 'Shift+A', hint: 'Выделяет все клипы левее точки клика' },
    { id: 'ripple', name: 'Ripple Edit Tool', key: 'B', hint: 'Подрезка со сдвигом последующих клипов' },
    { id: 'rolling', name: 'Rolling Edit Tool', key: 'N', hint: 'Сдвигает границу между двумя клипами' },
    { id: 'rateStretch', name: 'Rate Stretch Tool', key: 'R', hint: 'Меняет скорость, сохраняя содержимое' },
    { id: 'razor', name: 'Razor Tool', key: 'C', hint: 'Разрезает клип по клику' },
    { id: 'slip', name: 'Slip Tool', key: 'Y', hint: 'Сдвигает содержимое внутри клипа' },
    { id: 'slide', name: 'Slide Tool', key: 'U', hint: 'Двигает клип, подрезая соседей' },
    { id: 'pen', name: 'Pen Tool', key: 'P', hint: 'Ключевые кадры и маски кликом' },
    { id: 'hand', name: 'Hand Tool', key: 'H', hint: 'Прокрутка таймлайна' },
    { id: 'zoom', name: 'Zoom Tool', key: 'Z', hint: 'Масштаб таймлайна' },
    { id: 'type', name: 'Type Tool', key: 'T', hint: 'Создать титр в точке курсора' },
    { id: 'vtype', name: 'Vertical Type Tool', hint: 'Вертикальный титр' },
    { id: 'rect', name: 'Rectangle Tool', hint: 'Прямоугольная фигура' },
    { id: 'ellipse', name: 'Ellipse Tool', hint: 'Эллиптическая фигура' }
  ];
  const ADV = new Set(['trackForward', 'trackBackward', 'ripple', 'rolling', 'rateStretch', 'slide', 'pen', 'type', 'vtype', 'rect', 'ellipse']);
  const SHAPES = new Set(['type', 'vtype', 'rect', 'ellipse']);
  PPE.proTools = { TOOLS, ICON, ADV, SHAPES };

  /* --------------------------- палитра инструментов --------------------------- */
  function buildPalette() {
    const box = $('#toolPalette'); if (!box) return;
    box.innerHTML = '';
    TOOLS.forEach(t => {
      const b = el('button', { class: 'tool-cell', dataset: { tool: t.id }, title: t.name + (t.key ? ' (' + t.key + ')' : '') }, [
        el('span', { class: 'tool-cell-icon', html: U.icon(ICON[t.id]) }),
        el('span', { class: 'tool-cell-name', text: t.name }),
        el('span', { class: 'tool-cell-key', text: t.key || '' })
      ]);
      b.addEventListener('click', () => { T().setTool(t.id); closePalette(); updateActive(); });
      box.appendChild(b);
    });
    updateActive();
  }
  function updateActive() {
    $$('#toolPalette .tool-cell').forEach(b => b.classList.toggle('active', b.dataset.tool === S.tool));
    const label = $('#currentToolName');
    if (label) { const t = TOOLS.find(q => q.id === S.tool); label.textContent = t ? t.name : S.tool; }
  }
  function openPalette(anchor) {
    const box = $('#toolPalette'); if (!box) return;
    buildPalette();
    box.classList.remove('hidden');
    anchor = anchor || $('#allToolsBtn');
    if (anchor) {
      const r = anchor.getBoundingClientRect();
      box.style.left = clamp(r.left, 6, Math.max(6, window.innerWidth - 330)) + 'px';
      box.style.top = (r.bottom + 4 > window.innerHeight - 340 ? Math.max(6, r.top - 344) : r.bottom + 4) + 'px';
    }
    U.addLayer(box, closePalette, ['#allToolsBtn']);
  }
  function closePalette() { const b = $('#toolPalette'); if (b) { b.classList.add('hidden'); U.removeLayer(b); } }
  function togglePalette(anchor) {
    const b = $('#toolPalette'); if (!b) return;
    if (U.isLayerOpen(b)) closePalette(); else openPalette(anchor || $('#allToolsBtn'));
  }
  PPE.proTools.openPalette = openPalette;
  PPE.proTools.closePalette = closePalette;
  PPE.proTools.togglePalette = togglePalette;

  /* --------------------------- создание графики --------------------------- */
  function createGenerated(kind) {
    let type, name, data;
    if (kind === 'type' || kind === 'vtype') {
      type = 'text'; name = kind === 'vtype' ? 'Вертикальный титр' : 'Титр';
      data = Object.assign(S.defaultTextData(), {
        text: kind === 'vtype' ? 'ВЕРТИКАЛЬНЫЙ\nТИТР' : 'Новый титр',
        vertical: kind === 'vtype', size: kind === 'vtype' ? 82 : 96,
        color: '#ffffff', x: 50, y: 50, align: 'center'
      });
    } else {
      type = 'shape'; name = kind === 'ellipse' ? 'Эллипс' : 'Прямоугольник';
      data = { shape: kind === 'ellipse' ? 'ellipse' : 'rect', color: '#5aa9ff', w: 38, h: 26, x: 50, y: 50, opacity: 100, stroke: '#ffffff', strokeWidth: 0 };
    }
    const m = { id: uid('media'), name: name, fileName: null, type: type, generated: true, data: data, duration: 3600,
      width: S.project.width, height: S.project.height, fps: S.project.fps, hasAudio: false, thumb: null, peaks: null,
      offline: false, url: null, x: {} };
    S.change('Создание: ' + name, () => {
      S.project.media.push(m);
      const track = T().targetTrack('video');
      const c = S.newClip(m.id, track.id, S.playhead, { generatedDuration: 5 });
      c.name = name; track.clips.push(c);
      S.selection.clear(); S.selection.add(c.id);
    });
    PRO.refresh();
    U.toast(name + ' создан в точке курсора', 'success');
    return m;
  }
  PPE.proTools.createGenerated = createGenerated;

  /* --------------------------- выделение дорожек --------------------------- */
  function selectTrackDirection(clip, node, forward) {
    const r = node.getBoundingClientRect();
    const t = clip.start + (window._lastClickX != null ? 0 : 0);
    // точка клика в секундах
    const clickT = window._ffToolClickT != null ? window._ffToolClickT : clip.start;
    S.selection.clear();
    S.allClips().forEach(c => {
      const inside = forward ? (c.start >= clickT - 1e-6 || S.clipEnd(c) > clickT) : (c.start <= clickT + 1e-6);
      if (inside) S.selection.add(c.id);
    });
    if (P()) P().renderEffectControls();
    T().render();
    U.status('Выделено клипов: ' + S.selection.size, null, true);
  }

  /* --------------------------- drag-операции --------------------------- */
  function dragSession(e, onMove, onEnd, label) {
    const startX = e.clientX, zoom = S.zoom;
    let began = false;
    const move = ev => {
      if (!began) { S.begin(label); began = true; }
      onMove((ev.clientX - startX) / zoom);
      T().updateClipElements && T().updateClipElements();
      E().renderFrame(S.playhead);
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      if (began) { S.end(); if (onEnd) onEnd(); }
      PRO.refresh();
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }
  function snapDelta(d, ids) {
    const v = T().snapValue ? T().snapValue(d, ids) : d;
    return v;
  }
  function laterClips(clip) {
    const t = S.findTrack(clip.trackId);
    return t.clips.filter(c => c.start >= S.clipEnd(clip) - 1e-6 && c.id !== clip.id).map(c => ({ id: c.id, start: c.start }));
  }
  function neighbor(clip, dir) {
    const t = S.findTrack(clip.trackId);
    if (dir > 0) return t.clips.filter(c => c.start >= S.clipEnd(clip) - 1e-6 && c.id !== clip.id).sort((a, b) => a.start - b.start)[0];
    return t.clips.filter(c => S.clipEnd(c) <= clip.start + 1e-6 && c.id !== clip.id).sort((a, b) => b.start - a.start)[0];
  }

  function rippleEdit(e, clip) {
    const orig = { out: clip.outPoint, speed: clip.speed || 1 };
    const later = laterClips(clip).filter(o => { const t = S.findTrack(S.findClip(o.id).trackId); return t.syncLock !== false; });
    const maxT = T().snapCandidates ? Infinity : Infinity;
    dragSession(e, d => {
      const delta = snapDelta(d, [clip.id]);
      clip.outPoint = Math.max(clip.inPoint + 1 / S.project.fps, orig.out + delta * orig.speed);
      const actual = (clip.outPoint - orig.out) / orig.speed;
      later.forEach(o => { const c = S.findClip(o.id); if (c) c.start = Math.max(0, o.start + actual); });
    }, null, 'Ripple Edit');
  }
  function rollingEdit(e, clip) {
    const next = neighbor(clip, 1);
    if (!next) { U.toast('Справа нет соседнего клипа для Rolling Edit', 'warn'); return false; }
    const o = { out: clip.outPoint, in: next.inPoint, start: next.start, sp: clip.speed || 1, sp2: next.speed || 1 };
    const minLen = 1 / S.project.fps;
    dragSession(e, d => {
      const delta = snapDelta(d, [clip.id, next.id]);
      const srcAvail = Math.max(minLen, (o.out - clip.inPoint) / o.sp);
      const clamped = clamp(delta, -Math.min(srcAvail, (o.out - clip.inPoint) / o.sp - minLen), Math.min((o.out - clip.inPoint) / o.sp, S.clipDuration(next) - minLen));
      clip.outPoint = o.out + clamped * o.sp;
      next.inPoint = o.in + clamped * o.sp2;
      next.start = o.start + clamped;
    }, null, 'Rolling Edit');
  }
  function rateStretch(e, clip) {
    const o = { dur: S.clipDuration(clip), src: clip.outPoint - clip.inPoint, out: clip.outPoint };
    dragSession(e, d => {
      const nd = clamp(o.dur + snapDelta(d, [clip.id]), 1 / S.project.fps, o.src / .05);
      clip.speed = clamp(o.src / nd, .05, 20);
      if (clip.x && clip.x.remap) delete clip.x.remap;
    }, null, 'Rate Stretch');
  }
  function slideEdit(e, clip) {
    const prev = neighbor(clip, -1), next = neighbor(clip, 1);
    const o = { start: clip.start, prevOut: prev && prev.outPoint, nextIn: next && next.inPoint, prevSp: prev && prev.speed || 1, nextSp: next && next.speed || 1 };
    dragSession(e, d => {
      const delta = snapDelta(d, [clip.id]);
      clip.start = Math.max(0, o.start + delta);
      if (prev) prev.outPoint = Math.max(prev.inPoint + 1 / S.project.fps, o.prevOut + delta * o.prevSp);
      if (next) next.inPoint = Math.max(0, o.nextIn + delta * o.nextSp);
    }, null, 'Slide');
  }
  function penKey(clip, local) {
    const path = S.activeParam || 'transform.opacity';
    const v = S.valueAt(clip, path, local);
    S.change('Ключевой кадр (Pen)', () => S.addKey(clip, path, local, v));
    PRO.refresh();
  }

  /* --------------------------- обработчики --------------------------- */
  function onClipDown(e, node, lane, clip) {
    const tool = S.tool;
    if (!ADV.has(tool)) return false;
    if (e.button !== 0) return false;
    const r = node.getBoundingClientRect();
    const clickT = clip.start + (e.clientX - r.left) / S.zoom;
    window._ffToolClickT = clickT;
    e.preventDefault(); e.stopPropagation(); E().pause();
    if (!S.selection.has(clip.id)) { S.selection.clear(); S.selection.add(clip.id); }
    if (tool === 'trackForward' || tool === 'trackBackward') { selectTrackDirection(clip, node, tool === 'trackForward'); return true; }
    if (SHAPES.has(tool)) { createGenerated(tool); T().setTool('select'); return true; }
    if (tool === 'pen') { penKey(clip, clamp(clickT - clip.start, 0, S.clipDuration(clip))); return true; }
    if (tool === 'ripple') { rippleEdit(e, clip); return true; }
    if (tool === 'rolling') { return rollingEdit(e, clip) === false ? false : true; }
    if (tool === 'rateStretch') { rateStretch(e, clip); return true; }
    if (tool === 'slide') { slideEdit(e, clip); return true; }
    return false;
  }
  function onLaneDown(e, lane) {
    const tool = S.tool;
    if (SHAPES.has(tool)) { e.preventDefault(); e.stopPropagation(); E().pause(); createGenerated(tool); T().setTool('select'); return true; }
    if (tool === 'pen') {
      const c = PRO.selClip(); if (!c) return false;
      const r = lane.getBoundingClientRect();
      const t = Math.max(0, (e.clientX - r.left) / S.zoom);
      e.preventDefault(); e.stopPropagation(); penKey(c, clamp(t - c.start, 0, S.clipDuration(c))); return true;
    }
    return false;
  }
  function onRulerDown(e) {
    if (S.tool !== 'pen') return false;
    const c = PRO.selClip(); if (!c) return false;
    const r = $('#tlRuler').getBoundingClientRect();
    const t = Math.max(0, (e.clientX - r.left) / S.zoom);
    e.preventDefault(); e.stopPropagation();
    const v = S.valueAt(c, S.activeParam, clamp(t - c.start, 0, S.clipDuration(c)));
    S.change('Ключевой кадр (Pen)', () => S.addKey(c, S.activeParam, clamp(t - c.start, 0, S.clipDuration(c)), v));
    PRO.refresh();
    return true;
  }
  PPE.proTools.onClipDown = onClipDown;
  PPE.proTools.onLaneDown = onLaneDown;
  PPE.proTools.onRulerDown = onRulerDown;

  /* --------------------------- горячие клавиши --------------------------- */
  const KEYMAP = {
    a: 'trackForward', A: 'trackBackward', b: 'ripple', B: 'ripple', n: 'rolling', N: 'rolling',
    r: 'rateStretch', R: 'rateStretch', u: 'slide', U: 'slide', p: 'pen', P: 'pen',
    t: 'type', T: 'vtype'
  };
  function bind() {
    buildPalette();
    const btn = $('#allToolsBtn');
    if (btn) btn.addEventListener('click', ev => { ev.stopPropagation(); togglePalette(btn); });
    // Внешние нажатия обрабатывает общий реестр слоёв (U.addLayer выше) —
    // отдельный document-обработчик здесь больше не нужен.
    window.addEventListener('keydown', e => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT' || e.target.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key;
      if (KEYMAP[k]) { e.preventDefault(); T().setTool(KEYMAP[k]); updateActive(); return; }
      if (k === 'F' || k === 'f') { e.preventDefault(); PRO.cmd.matchFrame(k === 'F'); return; }
      if (k === ';') { e.preventDefault(); T().lift(); return; }
      if (k === "'") { e.preventDefault(); T().extract(); return; }
      if (k === '1' || k === '2' || k === '3' || k === '4' || k === '5' || k === '6' || k === '7' || k === '8' || k === '9') {
        if (PRO.multicam(PRO.selClip()) || PRO.x(S.project).multicam) { e.preventDefault(); PRO.cmd.switchAngle(Number(k) - 1); }
      }
    });
    // Клик по программному монитору инструментами графики
    const stage = $('#programStage');
    if (stage) stage.addEventListener('pointerdown', e => {
      if (!SHAPES.has(S.tool)) return;
      e.preventDefault(); e.stopPropagation(); createGenerated(S.tool); T().setTool('select');
    }, true);
    U.bus.on('history', updateActive);
    const origSetTool = T().setTool;
    T().setTool = function (tool) { origSetTool(tool); updateActive(); };
    updateActive();
  }
  PPE.proTools.init = bind;
})(window);
