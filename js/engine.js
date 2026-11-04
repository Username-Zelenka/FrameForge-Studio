/* =========================================================================
   engine.js — playback, compositing canvas, source monitor, export
   ========================================================================= */
(function (root) {
  'use strict';
  const PPE = root.PPE = root.PPE || {};
  const U = PPE.utils, S = PPE.state, M = PPE.media;
  const $ = U.$, $$ = U.$$, clamp = U.clamp;

  let canvas, ctx, sourceVideo, sourceImage, sourceCanvas, sourceCtx, sourceStage;
  let playStartTime = 0, playStartClock = 0, reverseMode = false;
  let frameCounter = 0, uiCounter = 0, lastFpsTime = 0, fpsCount = 0, fpsValue = 0;
  let srcAnimStart = 0, srcAnimTime = 0;
  let exportJob = null;
  let initialized = false;
  /* Отрисовка «по требованию»: в паузе монитор не перерисовывается, пока
     что-то не изменилось. Раньше кадр 1920×1080 растрировался 60 раз в секунду
     даже без изменений — это и было главной причиной «тормозов». */
  let frameDirty = true, lastDrawnT = -1, lastPreviewSig = '';
  /* Адаптивный предпросмотр: если во время игры кадры не успевают, буфер
     монитора временно уменьшается, а на паузе снова становится полным.
     Так «тормозит» только воспроизведение на слабой машине, а картинка в
     паузе и при правках остаётся резкой. */
  let playDownscale = 1, fpsSmoothed = 60, lastLoopTime = 0, lastAdaptTime = 0;

  /* =============================== initialization =============================== */
  function init() {
    if (initialized) return;
    initialized = true;
    canvas = $('#programCanvas'); ctx = canvas.getContext('2d', { alpha: false });
    sourceVideo = $('#sourceVideo'); sourceImage = $('#sourceImage');
    sourceCanvas = $('#sourceCanvas'); sourceCtx = sourceCanvas.getContext('2d');
    sourceStage = $('#sourceStage');
    resize();
    setupProgramDrag();
    applyProgramZoom();
    window.addEventListener('resize', () => { applyProgramZoom(); if (PPE.panels) PPE.panels.renderMixer(); frameDirty = true; });
    requestAnimationFrame(loop);
    /* Любое изменение проекта или истории делает кадр «грязным». */
    try {
      U.bus.on('history', () => invalidate());
      U.bus.on('stateDirty', () => invalidate());
      U.bus.on('playState', () => invalidate());
    } catch (e) {}
  }
  /* Размер буфера монитора. Экспорт всегда идёт в полном разрешении проекта
     (отдельный canvas), а предпросмотр — не крупнее того, что реально видно на
     экране: вчетверо меньше пикселей = вчетверо дешевле растр и компоновка. */
  function previewTarget() {
    const p = S.project;
    const q = S.settings.previewQuality || 'auto';
    const holder = $('#canvasHolder');
    const cssW = holder ? holder.clientWidth : 0;
    const dpr = Math.min(2, root.devicePixelRatio || 1);
    let budget = cssW > 0 ? cssW * dpr : p.width;
    if (q === 'full') budget = p.width;
    else if (q === 'fast') budget = Math.min(budget, p.width * .5);
    else budget = Math.min(budget, 1280);              // авто: не больше 1280 px по ширине
    budget *= playDownscale;
    const scale = Math.max(.15, Math.min(1, budget / Math.max(1, p.width)));
    return { w: Math.max(2, Math.round(p.width * scale)), h: Math.max(2, Math.round(p.height * scale)) };
  }
  function resize() {
    const p = S.project;
    const t = previewTarget();
    if (canvas.width !== t.w || canvas.height !== t.h) { canvas.width = t.w; canvas.height = t.h; }
    if (sourceCanvas.width !== t.w || sourceCanvas.height !== t.h) { sourceCanvas.width = t.w; sourceCanvas.height = t.h; }
    const r = $('#programRes'); if (r) r.textContent = p.width + '×' + p.height + ' · ' + p.fps + ' fps';
    frameDirty = true;
  }
  function applyProgramZoom() {
    setTimeout(() => { try { updateOverlay(); } catch (e) {} }, 0);
    setTimeout(() => { try { resize(); frameDirty = true; } catch (e) {} }, 0);
    const z = $('#programZoom'); if (!z || !canvas) return;
    const p = S.project, stage = $('#programStage'); if (!stage) return;
    const holder = $('#canvasHolder');
    if (z.value === 'fit') {
      // Точный расчёт «вписать»: проценты max-height не работают, когда высота
      // родителя auto (проявлялось на вертикальных форматах 9:16 / 4:5).
      const availW = Math.max(40, stage.clientWidth - 16);
      const availH = Math.max(40, stage.clientHeight - 16);
      const scale = Math.min(availW / Math.max(1, p.width), availH / Math.max(1, p.height));
      const cw = Math.max(24, Math.round(p.width * scale)), ch = Math.max(24, Math.round(p.height * scale));
      holder.style.width = cw + 'px'; holder.style.height = ch + 'px';
      canvas.style.maxWidth = 'none'; canvas.style.maxHeight = 'none';
      canvas.style.width = '100%'; canvas.style.height = '100%';
    } else {
      const pct = parseFloat(z.value) / 100;
      const availW = stage.clientWidth - 24, availH = stage.clientHeight - 24;
      let cw = p.width * pct, ch = p.height * pct;
      holder.style.width = cw + 'px'; holder.style.height = ch + 'px';
      canvas.style.maxWidth = 'none'; canvas.style.maxHeight = 'none';
      canvas.style.width = '100%'; canvas.style.height = '100%';
    }
  }

  // Перемещение выбранного видеоклипа непосредственно по программному монитору.
  // При ключевых кадрах изменяется только позиция в текущем времени.
  /* =============================== прямое управление в кадре =============================== */
  /** Нужно ли писать ключевой кадр при правке параметра (режим «авто-ключ», как в CapCut). */
  function shouldKeyframe(clip, path) {
    if (!clip) return false;
    if (clip.keys && clip.keys[path] && clip.keys[path].length) return true;
    return S.settings.autoKey !== false && S.hasKeys(clip);
  }
  /** Видимый прямоугольник клипа в кадре (с учётом вписывания медиа). */
  function clipBox(clip, pw, ph) {
    const m = S.findMedia(clip.mediaId);
    const fit = clip.transform.fit || 'fit';
    if (!m || m.generated || !m.width || !m.height) return { w: pw, h: ph };
    if (fit === 'stretch') return { w: pw, h: ph };
    const sc = fit === 'fill' ? Math.max(pw / m.width, ph / m.height) : Math.min(pw / m.width, ph / m.height);
    return { w: m.width * sc, h: m.height * sc };
  }
  let overlayEl = null, overlayFrame = null, poDrag = null;
  function clipAtPlayhead() {
    if (!S.selection.size) return null;
    for (const id of S.selection) {
      const c = S.findClip(id); if (!c) continue;
      const t = S.findTrack(c.trackId);
      if (!t || t.type !== 'video' || t.hidden || c.disabled) continue;
      if (S.playhead < c.start - 1e-6 || S.playhead >= S.clipEnd(c) - 1e-6) continue;
      if (param(c, 'transform.opacity', S.playhead - c.start) <= 0.5) continue;
      return c;
    }
    return null;
  }
  /** Рамка выделения с ручками над кадром (как в CapCut). */
  function updateOverlay() {
    if (!overlayEl) {
      overlayEl = $('#progOverlay'); overlayFrame = $('#poFrame');
      if (!overlayEl) return;
    }
    const clip = (S.tool === 'select' && !S.exporting) ? clipAtPlayhead() : null;
    if (!clip || (PPE.animationUI && PPE.animationUI.isOpen())) { overlayEl.classList.add('hidden'); return; }
    const p = S.project, local = S.playhead - clip.start;
    // Рамка повторяет положение и размер видимого кадра внутри монитора.
    const stage = $('#programStage'), holder = $('#canvasHolder');
    if (!stage || !holder) { overlayEl.classList.add('hidden'); return; }
    const hr = holder.getBoundingClientRect(), sr = stage.getBoundingClientRect();
    if (!hr.width || !hr.height) { overlayEl.classList.add('hidden'); return; }
    overlayEl.style.left = (hr.left - sr.left) + 'px';
    overlayEl.style.top = (hr.top - sr.top) + 'px';
    overlayEl.style.width = hr.width + 'px';
    overlayEl.style.height = hr.height + 'px';
    overlayEl.classList.remove('hidden');

    const box = clipBox(clip, p.width, p.height);
    const scale = (param(clip, 'transform.scale', local) || 100) / 100;
    const rot = param(clip, 'transform.rotation', local) || 0;
    const ox = (param(clip, 'transform.x', local) || 0) / 100;
    const oy = (param(clip, 'transform.y', local) || 0) / 100;
    const ow = hr.width, oh = hr.height;
    const fw = Math.max(16, box.w / p.width * ow * scale);
    const fh = Math.max(16, box.h / p.height * oh * scale);
    const cx = ow * (0.5 + ox), cy = oh * (0.5 + oy);

    overlayFrame.style.left = cx + 'px';
    overlayFrame.style.top = cy + 'px';
    overlayFrame.style.width = fw + 'px';
    overlayFrame.style.height = fh + 'px';
    overlayFrame.style.transform = 'translate(-50%,-50%) rotate(' + rot + 'deg)';
    overlayEl.classList.toggle('keyed', S.hasKeys(clip));

    // Ручки ставим по фактическим (повёрнутым) углам и «прижимаем» к видимой
    // области: иначе при увеличении или сдвиге картинки они уезжают за монитор
    // и за них нельзя взяться.
    const rad = rot * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
    const corner = (sx, sy) => {
      const dx = sx * fw / 2, dy = sy * fh / 2;
      return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
    };
    const pad = 7;
    const put = (node, pt) => {
      if (!node) return;
      node.style.left = clamp(pt.x, pad, ow - pad) + 'px';
      node.style.top = clamp(pt.y, pad, oh - pad) + 'px';
    };
    put($('.po-h.tl', overlayEl), corner(-1, -1));
    put($('.po-h.tr', overlayEl), corner(1, -1));
    put($('.po-h.bl', overlayEl), corner(-1, 1));
    put($('.po-h.br', overlayEl), corner(1, 1));
    put($('.po-rot', overlayEl), { x: cx - sin * (fh / 2 + 20), y: cy - cos * (fh / 2 + 20) });
  }
  function setupProgramDrag() {
    let drag = null, raf = 0, pending = null;
    if (canvas) canvas.title = 'Выберите клип и двигайте картинку прямо в кадре';
    function eligible(c) {
      const t = c && S.findTrack(c.trackId);
      return !!(c && t && t.type === 'video' && !t.locked && !t.hidden && !c.disabled && S.playhead >= c.start && S.playhead < S.clipEnd(c));
    }
    function pick() {
      let c = Array.from(S.selection).map(id => S.findClip(id)).find(eligible);
      if (c) return c;
      for (const t of S.project.tracks) {
        if (t.type !== 'video' || t.hidden || t.locked) continue;
        for (let i = t.clips.length - 1; i >= 0; i--) if (eligible(t.clips[i])) return t.clips[i];
      }
      return null;
    }
    function applyMove() {
      if (!drag || !pending) return;
      const e = pending; pending = null;
      const dx = e.x - drag.startX, dy = e.y - drag.startY;
      if (!drag.began && Math.hypot(dx, dy) < 3) return;
      if (!drag.began) { pause(); S.begin('Перемещение в кадре'); drag.began = true; }
      const r = canvas.getBoundingClientRect(), clip = S.findClip(drag.id);
      if (!clip || !r.width || !r.height) return;
      S.setClipParam(clip, 'transform.x', drag.x + dx / r.width * 100, drag.local, shouldKeyframe(clip, 'transform.x'));
      S.setClipParam(clip, 'transform.y', drag.y + dy / r.height * 100, drag.local, shouldKeyframe(clip, 'transform.y'));
      renderFrame(S.playhead); updateOverlay();
    }
    function tick() { raf = 0; applyMove(); }
    canvas.addEventListener('pointerdown', e => {
      if (e.button !== 0 || S.tool !== 'select' || S.exporting || drag || (PPE.animationUI && PPE.animationUI.isOpen())) return;
      const clip = pick(); if (!clip) return;
      e.preventDefault();
      const local = S.playhead - clip.start;
      if (!S.selection.has(clip.id)) { S.selection.clear(); S.selection.add(clip.id); if (PPE.renderAll) PPE.renderAll(); }
      drag = {
        id: clip.id, pointer: e.pointerId, startX: e.clientX, startY: e.clientY, local,
        x: Number(S.valueAt(clip, 'transform.x', local)) || 0,
        y: Number(S.valueAt(clip, 'transform.y', local)) || 0,
        began: false
      };
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    });
    canvas.addEventListener('pointermove', e => { if (!drag || e.pointerId !== drag.pointer) return; e.preventDefault(); pending = { x: e.clientX, y: e.clientY }; if (!raf) raf = requestAnimationFrame(tick); });
    function finish(e) {
      if (!drag || e.pointerId !== drag.pointer) return;
      if (raf) cancelAnimationFrame(raf); raf = 0;
      if (e.type !== 'pointercancel') pending = { x: e.clientX, y: e.clientY };
      applyMove();
      const began = drag.began; drag = null;
      if (began) { S.end(); if (PPE.renderAll) PPE.renderAll(); }
      updateOverlay();
    }
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);

    /* --- ручки рамки: масштаб и поворот --- */
    function setupHandle(el, mode) {
      if (!el) return;
      el.addEventListener('pointerdown', e => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        const clip = clipAtPlayhead(); if (!clip) return;
        e.preventDefault(); e.stopPropagation();
        pause();
        const holder = $('#canvasHolder').getBoundingClientRect();
        const local = S.playhead - clip.start;
        poDrag = {
          mode, pointer: e.pointerId, clipId: clip.id, local, holder,
          cx: holder.left + holder.width / 2 + (Number(S.valueAt(clip, 'transform.x', local)) || 0) / 100 * holder.width,
          cy: holder.top + holder.height / 2 + (Number(S.valueAt(clip, 'transform.y', local)) || 0) / 100 * holder.height,
          startDist: 1, startAngle: 0,
          scale0: Number(S.valueAt(clip, 'transform.scale', local)) || 100,
          rot0: Number(S.valueAt(clip, 'transform.rotation', local)) || 0,
          began: false
        };
        poDrag.startDist = Math.max(6, Math.hypot(e.clientX - poDrag.cx, e.clientY - poDrag.cy));
        poDrag.startAngle = Math.atan2(e.clientY - poDrag.cy, e.clientX - poDrag.cx) * 180 / Math.PI;
        try { el.setPointerCapture(e.pointerId); } catch (_) {}
      });
      el.addEventListener('pointermove', e => {
        if (!poDrag || poDrag.pointer !== e.pointerId) return;
        e.preventDefault();
        if (!poDrag.began) { S.begin(poDrag.mode === 'rotate' ? 'Поворот в кадре' : 'Масштаб в кадре'); poDrag.began = true; }
        const clip = S.findClip(poDrag.clipId); if (!clip) return;
        if (poDrag.mode === 'scale') {
          const d = Math.hypot(e.clientX - poDrag.cx, e.clientY - poDrag.cy);
          const v = clamp(poDrag.scale0 * (d / poDrag.startDist), 0, 500);
          S.setClipParam(clip, 'transform.scale', Math.round(v * 10) / 10, poDrag.local, shouldKeyframe(clip, 'transform.scale'));
        } else {
          const a = Math.atan2(e.clientY - poDrag.cy, e.clientX - poDrag.cx) * 180 / Math.PI;
          let v = poDrag.rot0 + (a - poDrag.startAngle);
          if (e.shiftKey) v = Math.round(v / 15) * 15;
          v = ((v + 540) % 360) - 180;
          S.setClipParam(clip, 'transform.rotation', Math.round(v * 10) / 10, poDrag.local, shouldKeyframe(clip, 'transform.rotation'));
        }
        renderFrame(S.playhead); updateOverlay();
      });
      function up(e) {
        if (!poDrag || poDrag.pointer !== e.pointerId) return;
        const began = poDrag.began; poDrag = null;
        if (began) { S.end(); if (PPE.renderAll) PPE.renderAll(); }
        updateOverlay();
      }
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    }
    $$('#progOverlay .po-h').forEach(h => setupHandle(h, 'scale'));
    setupHandle($('#progOverlay .po-rot'), 'rotate');
  }

  /* =============================== compositing =============================== */
  function param(clip, path, local) { return S.valueAt(clip, path, local); }
  function clipAlpha(clip, local, dur) {
    let a = 1;
    if (clip.transitionIn > 0 && local < clip.transitionIn) a *= clamp(local / clip.transitionIn, 0, 1);
    if (clip.transitionOut > 0 && (dur - local) < clip.transitionOut) a *= clamp((dur - local) / clip.transitionOut, 0, 1);
    return a;
  }
  function buildFilter(clip, local, scale) {
    const c = clip.color, p = (k, d) => { const v = param(clip, 'color.' + k, local); return v == null ? d : v; };
    const blur = p('blur', 0) * scale;
    let f = 'brightness(' + p('brightness', 100) + '%) contrast(' + p('contrast', 100) + '%) saturate(' + p('saturate', 100) + '%) ' +
      'blur(' + blur.toFixed(2) + 'px) grayscale(' + p('grayscale', 0) + '%) sepia(' + p('sepia', 0) + '%) hue-rotate(' + p('hue', 0) + 'deg)';
    if (PPE.proColor && PPE.proColor.filterString) {
      const extra = PPE.proColor.filterString(clip, local);
      if (extra) f += ' ' + extra;
    }
    return f;
  }
  function drawSlate(c, pw, ph, title, subtitle) {
    c.fillStyle = '#121216'; c.fillRect(-pw / 2, -ph / 2, pw, ph);
    c.strokeStyle = '#3e3e4a'; c.lineWidth = 3; c.strokeRect(-pw / 2 + 16, -ph / 2 + 16, pw - 32, ph - 32);
    c.fillStyle = title === 'НЕТ ФАЙЛА' ? '#d9736a' : '#8f9fb5';
    c.font = 'bold ' + Math.round(ph * 0.045) + 'px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(title, 0, -ph * 0.02);
    if (subtitle) { c.fillStyle = '#6a6a78'; c.font = Math.round(ph * 0.024) + 'px Arial'; c.fillText(subtitle, 0, ph * 0.05); }
  }
  function drawTextClip(c, d, pw, ph) {
    if (!d) return;
    const size = Number(d.size) || 72;
    let lines = String(d.text || '').split('\n');
    // Vertical Type Tool: каждая строка рисуется столбцом, символы идут сверху вниз.
    if (d.vertical) {
      const cols = lines.map(l => Array.from(l));
      const lh = size * (Number(d.lineHeight) || 1.2);
      c.font = (d.italic ? 'italic ' : '') + (d.bold ? 'bold ' : '') + size + 'px ' + (d.font || 'Arial');
      try { c.letterSpacing = (Number(d.letterSpacing) || 0) + 'px'; } catch (e) {}
      c.textBaseline = 'middle'; c.textAlign = d.align || 'center';
      const x = pw * (Number(d.x) || 0) / 100 - pw / 2;
      const y = ph * (Number(d.y) || 0) / 100 - ph / 2;
      const totalW = cols.length * lh;
      let maxH = 0; cols.forEach(col => { maxH = Math.max(maxH, col.length * lh); });
      if (Number(d.bgOpacity) > 0) {
        c.save(); c.globalAlpha *= Number(d.bgOpacity); c.fillStyle = d.bg || '#000000';
        c.fillRect(x - totalW / 2 - size * .2, y - maxH / 2 - size * .2, totalW + size * .4, maxH + size * .4); c.restore();
      }
      if (d.shadow) { c.shadowColor = 'rgba(0,0,0,.75)'; c.shadowBlur = size * .16; c.shadowOffsetY = size * .06; }
      c.fillStyle = d.color || '#ffffff';
      cols.forEach((col, ci) => {
        const cx = x - totalW / 2 + (ci + .5) * lh;
        col.forEach((ch, ri) => c.fillText(ch, cx, y - maxH / 2 + (ri + .5) * lh));
      });
      c.shadowColor = 'transparent'; c.shadowBlur = 0; c.shadowOffsetY = 0;
      try { c.letterSpacing = '0px'; } catch (e) {}
      return;
    }
    const lh = size * (Number(d.lineHeight) || 1.2);
    c.font = (d.italic ? 'italic ' : '') + (d.bold ? 'bold ' : '') + size + 'px ' + (d.font || 'Arial');
    try { c.letterSpacing = (Number(d.letterSpacing) || 0) + 'px'; } catch (e) {}
    c.textBaseline = 'middle';
    c.textAlign = d.align || 'center';
    let maxW = 0;
    lines.forEach(l => { maxW = Math.max(maxW, c.measureText(l).width); });
    const x = pw * (Number(d.x) || 0) / 100 - pw / 2;
    const y = ph * (Number(d.y) || 0) / 100 - ph / 2;
    if (Number(d.bgOpacity) > 0) {
      c.save();
      c.globalAlpha *= Number(d.bgOpacity);
      c.fillStyle = d.bg || '#000000';
      const pad = size * .35;
      const bx = d.align === 'left' ? x - pad : d.align === 'right' ? x - maxW - pad : x - maxW / 2 - pad;
      c.fillRect(bx, y - lh * lines.length / 2 - pad / 2, maxW + pad * 2, lh * lines.length + pad);
      c.restore();
    }
    if (d.shadow) { c.shadowColor = 'rgba(0,0,0,.75)'; c.shadowBlur = size * .16; c.shadowOffsetY = size * .06; }
    c.fillStyle = d.color || '#ffffff';
    const ax = d.align === 'left' ? x : d.align === 'right' ? x : x;
    lines.forEach((l, i) => c.fillText(l, ax, y + (i - (lines.length - 1) / 2) * lh));
    c.shadowColor = 'transparent'; c.shadowBlur = 0; c.shadowOffsetY = 0;
    try { c.letterSpacing = '0px'; } catch (e) {}
  }
  function drawClip(c, clip, local, pw, ph, T, depth) {
    depth = depth || 0;
    // Multicam: подменяем источник на активный ракурс, сохраняя стабильный объект клипа.
    const eff = (PPE.pro && PPE.pro.effectiveClip) ? PPE.pro.effectiveClip(clip, T) : clip;
    const src = M.sourceFor(eff);
    if (src.kind === 'audio') return; // audio clips produce no picture
    const dur = S.clipDuration(clip);
    let alpha = clamp(param(clip, 'transform.opacity', local) / 100, 0, 1) * clipAlpha(clip, local, dur);
    if (alpha <= 0.001) return;
    const t = clip.transform;
    const scale = (param(clip, 'transform.scale', local) || 100) / 100;
    const rot = (param(clip, 'transform.rotation', local) || 0) * Math.PI / 180;
    const ox = (param(clip, 'transform.x', local) || 0) / 100 * pw;
    const oy = (param(clip, 'transform.y', local) || 0) / 100 * ph;
    const flipH = t.flipH ? -1 : 1, flipV = t.flipV ? -1 : 1;
    const blurScale = Math.min(2, Math.max(.4, scale));
    c.save();
    c.globalAlpha = alpha;
    c.filter = buildFilter(clip, local, blurScale);
    c.translate(pw / 2 + ox, ph / 2 + oy);
    c.rotate(rot);
    c.scale(scale * flipH, scale * flipV);
    if (PPE.pro && PPE.pro.applyMask) PPE.pro.applyMask(c, clip, local, pw, ph);

    if (src.kind === 'offline') {
      drawSlate(c, pw, ph, 'НЕТ ФАЙЛА', src.media ? src.media.name : 'файл не найден');
    } else if (src.kind === 'nest' && depth < 3) {
      if (PPE.pro && PPE.pro.drawNest) PPE.pro.drawNest(c, src.data, local, pw, ph, depth);
      else drawSlate(c, pw, ph, 'ВЛОЖЕННАЯ ПОСЛЕДОВАТЕЛЬНОСТЬ', clip.name);
    } else if (src.kind === 'animation') {
      if (PPE.animation) PPE.animation.renderClip(c, src.data, clip.inPoint + ((PPE.pro && PPE.pro.sourceTime) ? PPE.pro.sourceTime(clip, local) : local * (clip.speed || 1)), pw, ph);
    } else if (src.kind === 'shape') {
      if (PPE.pro && PPE.pro.drawShape) PPE.pro.drawShape(c, src.data, pw, ph);
      else drawSlate(c, pw, ph, 'ФИГУРА', clip.name);
    } else if (src.kind === 'text') {
      drawTextClip(c, src.data, pw, ph);
    } else if (src.kind === 'color') {
      c.fillStyle = (src.data && src.data.color) || '#ffffff';
      c.fillRect(-pw, -ph, pw * 2, ph * 2);
    } else if (src.kind === 'image') {
      const img = src.image;
      if (img && img.complete && img.naturalWidth) drawMedia(c, img, img.naturalWidth, img.naturalHeight, clip, pw, ph);
      else drawSlate(c, pw, ph, 'ЗАГРУЗКА', clip.name);
    } else {
      const el = src.el;
      if (el && el.readyState >= 2 && (src.kind !== 'video' || el.videoWidth)) {
        drawMedia(c, el, el.videoWidth || pw, el.videoHeight || ph, clip, pw, ph);
      } else drawSlate(c, pw, ph, 'ЗАГРУЗКА', clip.name);
    }
    c.filter = 'none';
    c.restore();

    /* Дополнительные «пленочные» эффекты: зерно, световой блик, шторки кадра
       и глитч. Рисуем поверх клипа в экранных координатах. */
    applyFilmEffects(c, clip, local, alpha);
    const vig = param(clip, 'color.vignette', local) || 0;
    if (vig > 0) {
      c.save();
      c.setTransform(1, 0, 0, 1, 0, 0);
      const g = c.createRadialGradient(c.canvas.width / 2, c.canvas.height / 2, Math.min(c.canvas.width, c.canvas.height) * .25,
        c.canvas.width / 2, c.canvas.height / 2, Math.max(c.canvas.width, c.canvas.height) * .72);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,' + (vig / 100 * alpha).toFixed(3) + ')');
      c.fillStyle = g; c.fillRect(0, 0, c.canvas.width, c.canvas.height);
      c.restore();
    }
  }
  let grainPat = null, grainCtx = null;
  function grainPattern(c) {
    if (grainPat) return grainPat;
    const g = document.createElement('canvas'); g.width = g.height = 128;
    const x = g.getContext('2d'), img = x.createImageData(128, 128), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = 110 + Math.random() * 145;
      d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    grainPat = c.createPattern(g, 'repeat');
    return grainPat;
  }
  function applyFilmEffects(c, clip, local, alpha) {
    const p = (k) => { const v = param(clip, 'color.' + k, local); return v == null ? 0 : v; };
    const grain = p('grain'), leak = p('leak'), bars = p('letterbox'), glitch = p('glitch');
    const W = c.canvas.width, H = c.canvas.height;
    if (!grain && !leak && !bars && !glitch) return;
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    if (glitch > 0) {
      const steps = 3 + Math.round(glitch / 22);
      for (let i = 0; i < steps; i++) {
        const sy = Math.random() * H, sh = Math.max(2, H * (0.01 + Math.random() * 0.05));
        const dx = (Math.random() - 0.5) * W * 0.06 * (glitch / 100);
        try { c.drawImage(c.canvas, 0, sy, W, sh, dx, sy, W, sh); } catch (e) {}
      }
      c.globalAlpha = alpha * 0.18 * (glitch / 100);
      c.fillStyle = '#7fd0ff'; c.fillRect(0, 0, W, H);
      c.globalAlpha = 1;
    }
    if (leak > 0) {
      c.globalCompositeOperation = 'screen';
      const g = c.createRadialGradient(W * 0.82, H * -0.1, 0, W * 0.7, H * 0.1, Math.max(W, H) * 0.95);
      g.addColorStop(0, 'rgba(255,170,96,' + (0.55 * leak / 100 * alpha).toFixed(3) + ')');
      g.addColorStop(0.45, 'rgba(255,110,60,' + (0.22 * leak / 100 * alpha).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(255,80,40,0)');
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      c.globalCompositeOperation = 'source-over';
    }
    if (grain > 0) {
      c.globalAlpha = alpha * (grain / 100) * 0.5;
      c.globalCompositeOperation = 'overlay';
      const pat = grainPattern(c);
      if (pat && pat.setTransform && c.setTransform) {
        try { const m = new DOMMatrix(); m.translateSelf(Math.random() * 128, Math.random() * 128); pat.setTransform(m); } catch (e) {}
      }
      c.fillStyle = pat || '#808080';
      c.fillRect(0, 0, W, H);
      c.globalCompositeOperation = 'source-over';
    }
    if (bars > 0) {
      c.globalAlpha = alpha;
      c.fillStyle = '#000';
      const h = H * (bars / 100) * 0.18;
      c.fillRect(0, 0, W, h); c.fillRect(0, H - h, W, h);
    }
    c.restore();
  }
  function drawMedia(c, media, sw, sh, clip, pw, ph) {
    const fit = clip.transform.fit || 'fit';
    let dw = pw, dh = ph;
    const par = (PPE.pro && PPE.pro.pixelAspect) ? PPE.pro.pixelAspect(clip) : 1;
    const iw = sw * par;
    if (fit === 'stretch') { dw = pw; dh = ph; }
    else {
      const s = fit === 'fill' ? Math.max(pw / iw, ph / sh) : Math.min(pw / iw, ph / sh);
      dw = iw * s; dh = sh * s;
    }
    try { c.drawImage(media, -dw / 2, -dh / 2, dw, dh); }
    catch (e) { drawSlate(c, pw, ph, 'ОШИБКА КАДРА', clip.name); }
  }

  /** Draw complete sequence frame at time T into arbitrary 2D context. */
  function drawTo(c, w, h, T, opts) {
    opts = opts || {};
    const p = S.project;
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1; c.filter = 'none';
    c.fillStyle = '#000'; c.fillRect(0, 0, w, h);
    c.scale(w / p.width, h / p.height);
    drawSequence(c, p.tracks, T, p.width, p.height, 0);
    if (opts.drawSlate !== false && anyOfflineAt(T)) {
      c.save();
      c.globalAlpha = .85;
      c.fillStyle = '#4a1f1c'; c.font = 'bold 26px Arial'; c.textAlign = 'left'; c.textBaseline = 'top';
      c.fillText('НЕТ ФАЙЛА', 24, 24);
      c.restore();
    }
    c.restore();
  }
  /** Отрисовка произвольного набора дорожек — используется для вложенных последовательностей. */
  function drawSequence(c, tracks, T, pw, ph, depth) {
    depth = depth || 0; if (depth > 3) return;
    const vtracks = (tracks || []).filter(t => t.type === 'video');
    for (let i = vtracks.length - 1; i >= 0; i--) {
      const track = vtracks[i];
      if (track.hidden) continue;
      for (const clip of track.clips) {
        if (clip.disabled) continue;
        if (T < clip.start - 1e-6 || T >= S.clipEnd(clip) - 1e-6) continue;
        try { drawClip(c, clip, T - clip.start, pw, ph, T, depth); } catch (e) { console.warn('drawClip', e); }
      }
    }
  }
  function anyOfflineAt(T) {
    return S.allClips().some(c => T >= c.start && T < S.clipEnd(c) && (() => { const m = S.findMedia(c.mediaId); return m && !m.generated && !m.url; })());
  }
  function renderFrame(T) {
    if (ctx) drawTo(ctx, canvas.width, canvas.height, T);
    lastDrawnT = T; frameDirty = false;
    updateOverlay();
  }
  /** Пометить монитор «грязным»: перерисуется в ближайшем кадре rAF. */
  function invalidate() { frameDirty = true; }
  function programVisible() {
    if (PPE.animationUI && PPE.animationUI.isOpen()) return false;
    try { return !!(canvas && canvas.getClientRects && canvas.getClientRects().length && $('#programPanel').getClientRects().length); }
    catch (e) { return true; }
  }
  function sourceVisible() {
    try { return !!(sourceStage && sourceStage.getClientRects && sourceStage.getClientRects().length); }
    catch (e) { return true; }
  }

  /* =============================== media sync =============================== */
  function activeAudioClips() { return S.allClips(); }
  function syncMedia(T) {
    const playing = S.playing && !reverseMode;
    const solo = S.project.tracks.some(t => t.solo);
    S.project.tracks.forEach(t => {
      const n = M.trackNodes(t.id);
      if (n) {
        const g = (solo && !t.solo ? 0 : (t.muted ? 0 : (t.gain == null ? 1 : t.gain)));
        try { n.gain.gain.setTargetAtTime(g, n.ctx.currentTime, .015); } catch (e) { n.gain.gain.value = g; }
      }
    });
    const clips = S.allClips();
    const look = playing ? 1.2 : 0.4;
    for (const clip of clips) {
      const dur = S.clipDuration(clip);
      const track = S.findTrack(clip.trackId);
      const active = T >= clip.start - 1e-6 && T < clip.start + dur - 1e-6 && !clip.disabled;
      const near = T >= clip.start - look && T <= clip.start + dur + look;
      if (!near && !active) { M.setClipGain(clip.id, 0); continue; }
      const eff = (PPE.pro && PPE.pro.effectiveClip) ? PPE.pro.effectiveClip(clip, T) : clip;
      const src = M.sourceFor(eff);
      M.ensureClipTrack(clip);
      const local0 = T - clip.start;
      const pro = PPE.pro;
      const st = pro ? pro.sourceTime(clip, local0) : local0 * (clip.speed || 1);
      const expected = clip.inPoint + st;
      const rate = pro ? pro.speedAt(clip, local0) : (clip.speed || 1);
      const el = src.el;
      let audio = 0;
      if (el && (src.kind === 'video' || src.kind === 'audio')) {
        // Звук подключается и «догоняет» элемент: если MediaElementSource не
        // удался до первого жеста, звук раньше терялся навсегда.
        if (M.ensureClipAudio && !M.hasClipAudio(clip.id)) M.ensureClipAudio(clip, el);
        if (playing && active) {
          if (el.preload !== 'auto') el.preload = 'auto';
          if (el.muted) el.muted = false;
          if (el.volume !== 1) el.volume = 1;
          if (Math.abs(el.playbackRate - rate) > .001) el.playbackRate = clamp(rate, .0625, 16);
          if (el.paused) {
            try { el.currentTime = clamp(expected, 0, Math.max(0, (el.duration || 1 / 30) - .02)); } catch (e) {}
            el.play().catch(noteAudioBlocked);
          } else if (Math.abs(el.currentTime - expected) > .28) {
            try { el.currentTime = clamp(expected, 0, Math.max(0, (el.duration || 1 / 30) - .02)); } catch (e) {}
          }
        } else {
          if (!el.paused) el.pause();
          if (!el.seeking && isFinite(el.duration) && Math.abs(el.currentTime - expected) > 1 / (S.fps * 2)) {
            try { el.currentTime = clamp(expected, 0, Math.max(0, (el.duration || 1 / 30) - .02)); } catch (e) {}
          }
        }
        const local = T - clip.start;
        let v = active ? clamp(param(clip, 'audio.volume', local) / 100, 0, 4) : 0;
        const fi = param(clip, 'audio.fadeIn', local) || 0, fo = param(clip, 'audio.fadeOut', local) || 0;
        if (fi > 0) v *= clamp(local / fi, 0, 1);
        if (fo > 0) v *= clamp((dur - local) / fo, 0, 1);
        v *= clipAlpha(clip, local, dur);
        if (!S.settings.audioPreview && !S.exporting) v = 0;
        if (PPE.pro && PPE.pro.audioPost) v = PPE.pro.audioPost(clip, local, v, T);
        audio = v;
        M.setClipGain(clip.id, audio);
        M.setClipPan(clip.id, param(clip, 'audio.pan', local) || 0);
      }
    }
  }
  let audioBlockNotified = false;
  /**
   * Запуск медиаэлементов прямо внутри жеста пользователя.
   * В Safari/Firefox вызов play() из rAF-цикла отклоняется политикой автозапуска:
   * картинка при этом рисуется (кадры берутся через seek), а звука нет.
   * Поэтому в момент нажатия «Пуск» все активные клипы запускаются синхронно.
   */
  function primePlayback() {
    const T = S.playhead;
    S.allClips().forEach(c => {
      if (c.disabled) return;
      const active = T >= c.start - 1e-6 && T < S.clipEnd(c) - 1e-6;
      const soon = c.start > T && c.start - T < 3;   // клип начнётся в ближайшие 3 с
      if (!active && !soon) return;
      try {
        const src = M.sourceFor(c); const el = src && src.el;
        if (!el) return;
        if (el.preload !== 'auto') el.preload = 'auto';
        el.volume = 1;
        if (active) {
          el.muted = false;
          const p = el.play(); if (p && p.catch) p.catch(() => {});
        } else {
          // «Разблокировка» элемента внутри жеста: Safari/iOS разрешает
          // последующий play() из rAF-цикла только после такого вызова.
          el.muted = true;
          const p = el.play();
          if (p && p.then) p.then(() => { try { el.pause(); el.muted = false; } catch (e) {} }).catch(() => { el.muted = false; });
          else { try { el.pause(); el.muted = false; } catch (e) {} }
        }
      } catch (e) {}
    });
    if (S.source.playing && sourceVideo && sourceVideo.src) {
      try { sourceVideo.muted = !S.settings.audioPreview; sourceVideo.play().catch(() => {}); } catch (e) {}
    }
  }
  function noteAudioBlocked(err) {
    if (!err || err.name !== 'NotAllowedError' || audioBlockNotified) return;
    audioBlockNotified = true;
    U.toast('Браузер заблокировал автозапуск звука — нажмите «Пуск» ещё раз', 'warn', 5000);
  }
  function currentTime() {
    if (!S.playing) return S.playhead;
    const t = playStartTime + (performance.now() / 1000 - playStartClock) * S.rate;
    return Math.max(0, t);
  }

  /* =============================== main loop =============================== */
  function loop(now) {
    requestAnimationFrame(loop);
    if (!ctx) return;
    frameCounter++;
    /* Автоподстройка качества предпросмотра (только во время игры). */
    if (lastLoopTime) {
      const dt = now - lastLoopTime;
      if (dt > 0 && dt < 400) fpsSmoothed = fpsSmoothed * .9 + (1000 / dt) * .1;
    }
    lastLoopTime = now;
    if (now - lastAdaptTime > 900) {
      lastAdaptTime = now;
      if (S.playing && !exportJob) {
        if (fpsSmoothed < 22 && playDownscale > .5) { playDownscale = Math.max(.5, playDownscale * .8); resize(); }
        else if (fpsSmoothed > 52 && playDownscale < 1) { playDownscale = Math.min(1, playDownscale / .85); resize(); }
      } else if (playDownscale !== 1) { playDownscale = 1; resize(); }
    }
    let T = S.playhead;
    if (S.playing) {
      T = currentTime();
      const end = exportJob ? exportJob.end : S.sequenceDuration();
      if (reverseMode) {
        if (T <= 0) { pause(); T = 0; }
      } else if (T >= end) {
        if (exportJob) { T = end; finishExport(); }
        else { pause(); T = end; }
      }
      S.playhead = T;
    }
    resizeIfNeeded();
    syncMedia(T);
    // On phones the program monitor can be hidden behind another tab: don't burn
    // CPU/GPU repainting a 1920x1080 canvas that nobody sees. Explicit seek(),
    // renderAll() and effect edits still call renderFrame() on demand.
    const previewSig = canvas ? canvas.width + 'x' + canvas.height : '';
    if (S.playing || exportJob) renderFrame(T);
    else if (previewSig !== lastPreviewSig) { lastPreviewSig = previewSig; renderFrame(T); }
    else if ((frameDirty || T !== lastDrawnT) && programVisible()) renderFrame(T);
    if (exportJob && exportJob.ctx) drawTo(exportJob.ctx, exportJob.canvas.width, exportJob.canvas.height, T);
    if (S.source.playing) updateSourcePlayback();
    else if (S.source.mediaId && isGeneratedSource() && sourceVisible()) renderSourceGenerated(S.source.position);
    if (S.playing || T !== lastTimeUI) { updateTimeUI(T); lastTimeUI = T; }
    // Сторож AudioContext: браузер может усыпить контекст (политика автозапуска,
    // переключение вкладки). Без этого видео шло бы без звука.
    if (S.playing && !S.exporting && frameCounter % 30 === 0) {
      const ctx = M.audio && M.audio.ctx;
      if (ctx && ctx.state !== 'running') M.resumeAudio();
    }
    if (S.playing && frameCounter % 6 === 0 && PPE.panels) PPE.panels.updateMeters();
    fpsCount++;
    if (now - lastFpsTime > 900) { fpsValue = Math.round(fpsCount * 1000 / (now - lastFpsTime)); fpsCount = 0; lastFpsTime = now; const f = $('#statusFPS'); if (f && !S.exporting) f.textContent = (S.playing ? fpsValue + ' fps · ' : '— ') + (S.rate !== 1 && S.playing ? S.rate + '×' : 'fps'); }
    if (exportJob && S.playing) {
      const pct = clamp((T - exportJob.start) / Math.max(.001, exportJob.end - exportJob.start), 0, 1);
      U.bus.emit('exportProgress', { pct, time: T, end: exportJob.end });
    }
  }
  let lastW = 0, lastH = 0;
  function resizeIfNeeded() {
    const p = S.project;
    if (p.width !== lastW || p.height !== lastH) { lastW = p.width; lastH = p.height; resize(); }
  }
  let lastKeySync = 0, lastTimeUI = -1;
  function updateTimeUI(T) {
    const fps = S.project.fps;
    const tc = U.formatTC(T, fps);
    const tcEl = $('#programTC');
    if (tcEl && document.activeElement !== tcEl) tcEl.value = tc;
    const durEl = $('#programDur'); if (durEl) durEl.textContent = U.formatTC(Math.max(0, S.sequenceDuration() - T), fps);
    const tl = $('#tlTC'); if (tl) tl.textContent = tc;
    const clk = $('#tlClock'); if (clk) clk.textContent = tc;
    const head = $('#programHead');
    if (head) head.style.left = (clamp(T / Math.max(.001, S.sequenceDuration()), 0, 1) * 100) + '%';
    const seq = $('#programSeqRange');
    if (seq) { seq.style.left = '0'; seq.style.right = '0'; }
    if (PPE.timeline) PPE.timeline.updatePlayhead();
    if (PPE.panels && PPE.panels.syncKeyIndicators) {
      const now = performance.now();
      if (now - lastKeySync > 80) { lastKeySync = now; PPE.panels.syncKeyIndicators(); }
    }
    const badge = $('#monitorBadge');
    if (badge) {
      const active = S.allClips().filter(c => T >= c.start && T < S.clipEnd(c) && !c.disabled);
      badge.textContent = active.length ? active.map(c => c.name).slice(0, 2).join(' + ') + (active.length > 2 ? ' …' : '') : 'Чёрный кадр';
    }
  }

  /* =============================== transport =============================== */
  function play(rate) {
    if (S.exporting && !exportJob) return;
    rate = rate == null ? 1 : rate;
    M.resumeAudio();
    // Во время экспорта громкоговоритель намеренно выключен; во всех остальных
    // случаях он должен быть включён, иначе после сбоя экспорта остаётся тишина.
    if (!S.exporting) { try { M.setSpeakerGain(S.settings.audioPreview === false ? 0 : 1); } catch (e) {} }
    if (S.playhead >= S.sequenceDuration() - .01 && rate > 0) seek(0);
    reverseMode = rate < 0;
    if (reverseMode) {
      S.allClips().forEach(c => { const s = M.sourceFor(c); if (s.el && !s.el.paused) s.el.pause(); });
    }
    S.rate = rate; S.playing = true;
    playStartTime = S.playhead; playStartClock = performance.now() / 1000;
    primePlayback();
    updatePlayButtons(); U.bus.emit('playState');
    U.status('Воспроизведение ' + (rate < 0 ? 'назад' : rate > 1 ? '×' + rate : ''), null, true);
  }
  function pause() {
    audioBlockNotified = false;
    if (S.playing) S.playhead = currentTime();
    S.playing = false; reverseMode = false;
    S.allClips().forEach(c => { const s = M.sourceFor(c); if (s.el && !s.el.paused) s.el.pause(); });
    updatePlayButtons(); U.bus.emit('playState');
  }
  function toggle() { S.playing ? pause() : play(1); }
  function isPlaying() { return S.playing; }
  function seek(t, keepPlaying) {
    t = Math.max(0, Number(t) || 0);
    S.playhead = t;
    if (S.playing && !keepPlaying) { playStartTime = t; playStartClock = performance.now() / 1000; }
    updateTimeUI(t);
    renderFrame(t);
  }
  function step(frames) {
    pause();
    seek(U.snapTime(S.playhead + frames / S.project.fps, S.project.fps));
  }
  function shuttle(dir) {
    if (dir === 0) { pause(); return; }
    if (dir < 0) play(-1);
    else if (S.playing && S.rate > 1) play(Math.min(8, S.rate * 2));
    else play(2);
  }
  function updatePlayButtons() {
    const b = $('#progPlay'); if (b) b.innerHTML = U.icon(S.playing ? 'pause' : 'play');
    if (PPE.panels) PPE.panels.updateTransport();
  }

  /* =============================== source monitor =============================== */
  function isGeneratedSource() {
    const m = S.findMedia(S.source.mediaId);
    return m && m.generated;
  }
  function openSource(mediaId) {
    const m = S.findMedia(mediaId);
    if (!m) {
      S.source.mediaId = null; S.source.inPoint = 0; S.source.outPoint = 0;
      S.source.position = 0; S.source.playing = false;
      sourceVideo.pause(); sourceVideo.removeAttribute('src');
      sourceVideo.classList.remove('show'); sourceImage.classList.remove('show'); sourceCanvas.classList.remove('show');
      $('#sourcePlaceholder').classList.remove('hidden');
      updateSourceUI(); return;
    }
    S.source.mediaId = mediaId; S.source.inPoint = 0;
    S.source.outPoint = m.generated ? 5 : S.sourceDuration(m);
    S.source.position = 0; S.source.playing = false;
    sourceVideo.pause(); sourceVideo.removeAttribute('src');
    const generated = m.generated;
    sourceVideo.classList.remove('show'); sourceImage.classList.remove('show'); sourceCanvas.classList.remove('show');
    $('#sourcePlaceholder').classList.add('hidden');
    if (generated) {
      sourceCanvas.classList.add('show');
      renderSourceGenerated(0);
    } else if (m.type === 'image') {
      sourceImage.src = m.url || m.thumb || ''; sourceImage.classList.add('show');
    } else if (m.url) {
      sourceVideo.src = m.url;
      sourceVideo.poster = m.thumb || '';
      sourceVideo.classList.add('show');
      if (m.type === 'audio') sourceVideo.poster = m.thumb || M.svgDataURI('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><rect width="800" height="450" fill="#1b241e"/><text x="400" y="230" fill="#7cb891" font-family="Arial" font-size="34" text-anchor="middle">АУДИО</text></svg>');
      try { sourceVideo.currentTime = 0; } catch (e) {}
    } else {
      sourceImage.src = m.thumb || M.svgDataURI('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><rect width="800" height="450" fill="#2a1c1c"/><text x="400" y="230" fill="#d9736a" font-family="Arial" font-size="28" text-anchor="middle">НЕТ ФАЙЛА</text></svg>');
      sourceImage.classList.add('show');
    }
    updateSourceUI();
    if (PPE.panels) PPE.panels.updateTransport();
  }
  function renderSourceGenerated(t) {
    const m = S.findMedia(S.source.mediaId); if (!m) return;
    sourceCtx.setTransform(1, 0, 0, 1, 0, 0);
    sourceCtx.fillStyle = '#000'; sourceCtx.fillRect(0, 0, sourceCanvas.width, sourceCanvas.height);
    if (m.type === 'animation' && PPE.animation) { sourceCtx.save(); sourceCtx.translate(sourceCanvas.width / 2, sourceCanvas.height / 2); PPE.animation.renderClip(sourceCtx, m.data, t, sourceCanvas.width, sourceCanvas.height); sourceCtx.restore(); }
    else if (m.type === 'color') { sourceCtx.fillStyle = (m.data && m.data.color) || '#fff'; sourceCtx.fillRect(0, 0, sourceCanvas.width, sourceCanvas.height); }
    else { sourceCtx.save(); sourceCtx.translate(sourceCanvas.width / 2, sourceCanvas.height / 2); drawTextClip(sourceCtx, m.data, sourceCanvas.width, sourceCanvas.height); sourceCtx.restore(); }
    $('#sourceTC').textContent = U.formatTC(t, S.project.fps);
  }
  function sourceDuration(m) { return S.sourceDuration(m); }
  /** Generators are theoretically infinite; the source scrubber uses a practical 5 s (or longer if marked). */
  function sourceScrubDur() {
    const m = S.findMedia(S.source.mediaId);
    return m && m.generated ? Math.max(5, S.source.outPoint) : S.sourceDuration(m);
  }
  function updateSourcePlayback() {
    const m = S.findMedia(S.source.mediaId); if (!m) return;
    if (m.generated) {
      if (!srcAnimStart) { srcAnimStart = performance.now() / 1000; srcAnimTime = S.source.position; }
      S.source.position = srcAnimTime + (performance.now() / 1000 - srcAnimStart);
      if (S.source.position >= S.source.outPoint) {
        if (S.source.loop) S.source.position = S.source.inPoint;
        else { S.source.playing = false; S.source.position = S.source.outPoint; }
      }
      renderSourceGenerated(S.source.position);
    } else {
      let t = sourceVideo.currentTime || 0;
      if (t >= S.source.outPoint - .02) {
        if (S.source.loop) { sourceVideo.currentTime = S.source.inPoint; t = S.source.inPoint; }
        else { sourceVideo.pause(); S.source.playing = false; S.source.position = S.source.outPoint; updateSourceUI(); updatePlayButtons(); return; }
      }
      S.source.position = t;
    }
    updateSourceUI();
  }
  function sourcePlayPause() {
    const m = S.findMedia(S.source.mediaId); if (!m) { U.toast('Сначала откройте клип в исходном мониторе', 'warn'); return; }
    M.resumeAudio();
    if (S.source.playing) {
      S.source.playing = false; sourceVideo.pause(); srcAnimStart = 0;
    } else {
      if (S.source.position >= S.source.outPoint - .03) sourceSeek(S.source.inPoint);
      S.source.playing = true; srcAnimStart = 0;
      if (!m.generated) {
        if (sourceVideo.currentTime < S.source.inPoint || sourceVideo.currentTime > S.source.outPoint) sourceVideo.currentTime = S.source.inPoint;
        sourceVideo.muted = !S.settings.audioPreview;
        sourceVideo.play().catch(e => {
          if (e && e.name === 'NotAllowedError') noteAudioBlocked(e);
          else U.toast('Не удалось воспроизвести: ' + e.message, 'error');
          S.source.playing = false;
        });
      }
    }
    updatePlayButtons(); updateSourceUI(); U.bus.emit('playState');
  }
  function sourceSeek(t) {
    const m = S.findMedia(S.source.mediaId); if (!m) return;
    t = clamp(Number(t) || 0, 0, S.sourceDuration(m));
    S.source.position = t;
    if (!m.generated && sourceVideo.src) { try { sourceVideo.currentTime = t; } catch (e) {} }
    else renderSourceGenerated(t);
    updateSourceUI();
  }
  function sourceStep(frames) { sourcePlayPauseIfNeeded(false); sourceSeek(S.source.position + frames / S.project.fps); }
  function sourcePlayPauseIfNeeded(play) { if (play && !S.source.playing) sourcePlayPause(); else if (!play && S.source.playing) sourcePlayPause(); }
  function markIn() {
    const m = S.findMedia(S.source.mediaId); if (!m) return;
    S.source.inPoint = clamp(S.source.position, 0, S.source.outPoint - 1 / S.project.fps);
    updateSourceUI(); U.status('Точка входа: ' + U.formatTC(S.source.inPoint, S.project.fps), null, true);
  }
  function markOut() {
    const m = S.findMedia(S.source.mediaId); if (!m) return;
    const max = m.generated ? Math.max(60, S.source.outPoint) : S.sourceDuration(m);
    S.source.outPoint = clamp(S.source.position, S.source.inPoint + 1 / S.project.fps, max);
    updateSourceUI(); U.status('Точка выхода: ' + U.formatTC(S.source.outPoint, S.project.fps), null, true);
  }
  function clearInOut() {
    const m = S.findMedia(S.source.mediaId); if (!m) return;
    S.source.inPoint = 0; S.source.outPoint = m.generated ? 5 : S.sourceDuration(m); updateSourceUI();
  }
  function updateSourceUI() {
    const m = S.findMedia(S.source.mediaId);
    const realDur = S.sourceDuration(m);
    const dur = sourceScrubDur();
    const fps = S.project.fps;
    $('#sourceTC').textContent = U.formatTC(S.source.position, fps);
    $('#sourceDur').textContent = m && m.generated ? '∞ · ' + U.formatTC(dur, fps) : U.formatTC(realDur, fps);
    $('#sourceSel').textContent = U.formatTC(Math.max(0, S.source.outPoint - S.source.inPoint), fps);
    const pos = (v) => clamp(v / Math.max(.001, dur), 0, 1) * 100 + '%';
    const head = $('#sourceHead'); if (head) head.style.left = pos(S.source.position);
    const range = $('#sourceRange');
    if (range) { range.style.left = pos(S.source.inPoint); range.style.width = (clamp((S.source.outPoint - S.source.inPoint) / Math.max(.001, dur), 0, 1) * 100) + '%'; }
    const im = $('#sourceInMark'), om = $('#sourceOutMark');
    if (im) im.style.left = pos(S.source.inPoint);
    if (om) om.style.left = pos(S.source.outPoint);
    const b = $('#srcPlay'); if (b) b.innerHTML = U.icon(S.source.playing ? 'pause' : 'play');
    $('#sourcePlaceholder').classList.toggle('hidden', !!m);
    if (PPE.timeline) PPE.timeline.updatePlayhead();
  }

  /** Кадр для оффлайн-экспорта: точный сик медиа и ожидание готовности кадра. */
  async function prepareFrame(T, timeout) {
    syncMedia(T);
    const waits = [];
    S.allClips().forEach(clip => {
      if (clip.disabled) return;
      const dur = S.clipDuration(clip);
      if (T < clip.start - 1e-6 || T >= clip.start + dur - 1e-6) return;
      const src = M.sourceFor(clip);
      const el = src && src.el;
      if (!el || el.readyState < 1) return;
      if (el.seeking) waits.push(new Promise(res => {
        let done = false;
        const fin = () => { if (done) return; done = true; el.removeEventListener('seeked', fin); res(); };
        el.addEventListener('seeked', fin);
        setTimeout(fin, timeout || 160);
      }));
    });
    if (!waits.length) return;   // нет видеофайлов — ждать кадр не нужно
    await Promise.all(waits);
    await new Promise(r => (root.requestAnimationFrame ? root.requestAnimationFrame(r) : setTimeout(r, 16)));
  }

  /* =============================== export =============================== */
  function supportedMime(format) {
    const list = [
      'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=h264,opus',
      'video/webm', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4'
    ];
    if (!root.MediaRecorder) return null;
    for (const m of list) { if (format && format !== 'auto' && !m.startsWith('video/' + format)) continue; try { if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m; } catch (e) {} }
    return format && format !== 'auto' ? null : '';
  }
  function exportFramePNG() {
    pause();
    const c = document.createElement('canvas');
    c.width = S.project.width; c.height = S.project.height;
    drawTo(c.getContext('2d'), c.width, c.height, S.playhead);
    c.toBlob(blob => { if (blob) U.download(blob, U.safeFileName('frame_' + U.formatTC(S.playhead, S.project.fps).replace(/[:]/g, '-'), 'png', true)); U.toast('Кадр сохранён', 'success'); }, 'image/png');
  }
  function animationImagesReady(start,end){
    if(!PPE.animation||!PPE.animation.doc())return {offline:[],loading:[]};
    const A=PPE.animation,d=A.doc(),ids=new Set();
    S.project.tracks.forEach(t=>{if(t.type!=='video'||t.hidden)return;(t.clips||[]).forEach(c=>{if(c.disabled||S.clipEnd(c)<=start||c.start>=end)return;const m=S.findMedia(c.mediaId);if(!m||!m.generated||m.type!=='animation')return;const sc=d.scenes.find(s=>s.id===(m.data&&m.data.sceneId));if(!sc)return;
      A.sceneImageIds(sc).forEach(id=>ids.add(id));});});
    const offline=[],loading=[];ids.forEach(id=>{const m=S.findMedia(id),img=A.imageFor({mediaId:id});if(!m||!m.url||!img||(img.complete&&!img.naturalWidth))offline.push(m?m.name:id);else if(!img.complete)loading.push(m.name);});return {offline,loading};
  }
  function startExport(opts) {
    if (S.exporting) { U.toast('Экспорт уже идёт', 'warn'); return false; }
    opts = opts || {};
    /* По умолчанию — оффлайн-кодирование WebCodecs: кадры рисуются в фоне и не
       требуют реального времени. Запись MediaRecorder остаётся запасным путём. */
    const method = opts.method || (PPE.fastExport && PPE.fastExport.supported() ? 'fast' : 'realtime');
    if (method === 'fast' && PPE.fastExport) return PPE.fastExport.startExport(opts);
    exportMethod = 'realtime';
    const start = opts.range === 'inout' && S.project.seqOut > S.project.seqIn ? S.project.seqIn : 0;
    const end = opts.range === 'inout' && S.project.seqOut > S.project.seqIn ? Math.min(S.project.seqOut, S.sequenceDuration()) : S.sequenceDuration();
    const images=animationImagesReady(start,end);
    if(images.offline.length){U.toast('Анимация: не найдены изображения — '+images.offline.slice(0,3).join(', ')+'. Нажмите «Файл → Найти медиа».','warn',7000);return false;}
    if(images.loading.length){U.toast('Загружаю изображения. Повторите экспорт через несколько секунд.','warn',5000);return false;}
    const mime = supportedMime(opts.format);
    if (mime === null) { U.toast(opts.format && opts.format !== 'auto' ? 'Формат ' + opts.format.toUpperCase() + ' не поддерживается этим браузером' : 'Ваш браузер не поддерживает MediaRecorder', 'error'); return false; }
    if (!M.recordStream()) { U.toast('Не удалось создать аудиопоток', 'error'); return false; }
    pause();
    M.resumeAudio();
    opts = opts || {};
    const w = opts.width || S.project.width, h = opts.height || S.project.height, fps = opts.fps || S.project.fps;
    const ec = document.createElement('canvas'); ec.width = w; ec.height = h;
    const ectx = ec.getContext('2d', { alpha: false });
    drawTo(ectx, w, h, start);
    let stream;
    try { stream = ec.captureStream(fps); } catch (e) { U.toast('captureStream недоступен: ' + e.message, 'error'); return false; }
    if (opts.audio !== false) {
      const tracks = M.recordStream().getAudioTracks();
      if (tracks.length) stream.addTrack(tracks[0]);
    }
    let recorder;
    try {
      const recOpts = { videoBitsPerSecond: (opts.bitrate || 8) * 1000000, audioBitsPerSecond: 192000 };
      if (mime) recOpts.mimeType = mime;
      recorder = new MediaRecorder(stream, recOpts);
    } catch (e) { U.toast('Не удалось создать MediaRecorder: ' + e.message, 'error'); return false; }
    const chunks = [];
    recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onerror = e => { U.toast('Ошибка записи: ' + (e.error && e.error.message || e), 'error'); };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: (mime || 'video/webm').split(';')[0] });
      if (!blob.size) { U.toast('Браузер не записал кадры. Не сворачивайте вкладку и попробуйте снова.', 'error', 6000); U.status('Экспорт не удался', 'error', true); return; }
      const ext = (mime && mime.indexOf('mp4') >= 0) ? 'mp4' : 'webm';
      const name = U.safeFileName(S.project.name || 'sequence', ext, true);
      U.download(blob, name);
      U.toast('Экспорт завершён: ' + name + ' (' + (blob.size / 1048576).toFixed(1) + ' МБ)', 'success', 6000);
      U.status('Экспорт завершён', null, true);
    };
    exportJob = { canvas: ec, ctx: ectx, start, end, fps, recorder, stream, mime, t0: performance.now(), prevSpeaker: null, prevAudioPreview: S.settings.audioPreview };
    try { exportJob.prevSpeaker = M.setSpeakerGain(0); } catch (e) {}
    S.exporting = true;
    S.settings.audioPreview = true;
    seek(start);
    recorder.start(400);
    // Первая отрисовка после старта записи: кадр, нарисованный до captureStream,
    // некоторые браузеры не выдают энкодеру вовсе.
    drawTo(ectx, w, h, start);
    try { const vt = stream.getVideoTracks()[0]; if (vt && vt.requestFrame) vt.requestFrame(); } catch (e) {}
    play(1);
    U.status('Экспорт видео…', 'busy');
    U.bus.emit('exportProgress', { pct: 0, time: start, end, started: true });
    return true;
  }
  function finishExport() {
    if (!exportJob) return;
    const job = exportJob;
    // Гарантируем последний кадр, даже если композиция статична и браузер
    // оптимизирует одинаковые кадры при captureStream.
    try {
      drawTo(job.ctx, job.canvas.width, job.canvas.height, Math.max(job.start, job.end - 1 / (job.fps || 30)));
      const vt = job.stream.getVideoTracks()[0]; if (vt && vt.requestFrame) vt.requestFrame();
    } catch (e) {}
    exportJob = null;
    S.exporting = false; pause();
    setTimeout(() => { try { if (job.recorder.state !== 'inactive') job.recorder.stop(); } catch (e) {} }, 150);
    try { M.setSpeakerGain(job.prevSpeaker == null ? 1 : job.prevSpeaker); } catch (e) {}
    S.settings.audioPreview = job.prevAudioPreview !== false;
    setTimeout(() => { try { job.stream.getTracks().forEach(t => { if (t.readyState === 'live' && t.kind === 'video') t.stop(); }); } catch (e) {} }, 500);
    U.bus.emit('exportProgress', { pct: 1, done: true, seconds: (performance.now() - job.t0) / 1000 });
  }
  let exportMethod = 'realtime';
  function cancelExport() {
    if (PPE.fastExport && PPE.fastExport.isRunning()) { PPE.fastExport.cancel(); return; }
    if (!exportJob) return;
    const job = exportJob; exportJob = null;
    S.exporting = false; pause();
    try { if (job.recorder.state !== 'inactive') { job.recorder.onstop = null; job.recorder.stop(); } } catch (e) {}
    try { M.setSpeakerGain(job.prevSpeaker == null ? 1 : job.prevSpeaker); } catch (e) {}
    S.settings.audioPreview = job.prevAudioPreview !== false;
    U.toast('Экспорт отменён', 'warn'); U.status('Экспорт отменён', null, true);
    U.bus.emit('exportProgress', { done: true, cancelled: true });
  }

  PPE.engine = {
    invalidate,
    init, resize, applyProgramZoom, drawTo, renderFrame, syncMedia, primePlayback, updateOverlay, shouldKeyframe,
    play, pause, toggle, seek, step, shuttle, isPlaying, currentTime, updatePlayButtons, updateTimeUI,
    openSource, sourcePlayPause, sourceSeek, sourceStep, markIn, markOut, clearInOut, updateSourceUI,
    exportFramePNG, startExport, cancelExport, supportedMime, prepareFrame,
    drawMedia, drawSequence, drawSlate, drawClip, buildFilter,
    get canvas() { return canvas; }, get sourceVideo() { return sourceVideo; },
    get sourceCanvas() { return sourceCanvas; }
  };
})(window);
