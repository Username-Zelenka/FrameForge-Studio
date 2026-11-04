/* =========================================================================
   timeline.js — ruler, tracks, clips, dragging, trimming, edit operations
   ========================================================================= */
(function (root) {
  'use strict';
  const PPE = root.PPE = root.PPE || {};
  const U = PPE.utils, S = PPE.state, M = PPE.media;
  const $ = U.$, $$ = U.$$, el = U.el, clamp = U.clamp, uid = U.uid;
  // Track-header width is a CSS variable (narrower on phones) — keep JS in sync.
  let HEAD = 186;
  /* Ширина шапки дорожек. Раньше читали переменную с documentElement — но тему
     CapCut она задаёт на body, и в JS попадало чужое значение (112 вместо 104).
     Из-за этого плейхед стоял на 8 px правее дорожек, а поставленный ключ
     «съезжал назад». Меряем реальную геометрию — она всегда верная. */
  function measureHead() {
    let v = 0;
    try {
      const tracks = tlTracks || $('#tlTracks');
      const lane = tracks && tracks.querySelector('.tl-lane');
      if (lane && tracks) v = lane.getBoundingClientRect().left - tracks.getBoundingClientRect().left;
    } catch (e) {}
    if (!(isFinite(v) && v > 40)) {
      // Запасной путь: переменную берём с панели таймлайна (её задаёт тема на body).
      const panel = document.querySelector('.timeline-panel') || document.documentElement;
      try { v = parseFloat(getComputedStyle(panel).getPropertyValue('--track-head-w')); } catch (e) {}
    }
    HEAD = (isFinite(v) && v > 40) ? Math.round(v) : 186;
  }
  let tlScroll, tlInner, tlRuler, tlTracks, playheadEl;
  let clipEls = new Map(), laneEls = new Map();
  let drag = null, scrubbing = false;
  let initialized = false;

  /* =============================== setup =============================== */
  function init() {
    if (initialized) return; initialized = true;
    measureHead();
    tlScroll = $('#tlScroll'); tlInner = $('#tlInner'); tlRuler = $('#tlRuler');
    tlTracks = $('#tlTracks'); playheadEl = $('#tlPlayhead');
    tlRuler.addEventListener('pointerdown', onRulerDown);
    tlTracks.addEventListener('pointerdown', onTracksDown);
    tlTracks.addEventListener('dblclick', onTracksDblClick);
    tlTracks.addEventListener('contextmenu', onTracksContext);
    tlTracks.addEventListener('dragover', onTrackDragOver);
    tlTracks.addEventListener('dragleave', onTrackDragLeave);
    tlTracks.addEventListener('drop', onTrackDrop);
    tlTracks.addEventListener('input', onTracksInput);
    tlScroll.addEventListener('wheel', onWheel, { passive: false });
    playheadEl.addEventListener('pointerdown', onPlayheadDown);
    $('#zoomSlider').addEventListener('input', e => setZoom(parseFloat(e.target.value)));
    window.addEventListener('resize', U.debounce(() => render(), 180));
  }

  /* =============================== helpers =============================== */
  function contentWidth() { return Math.max(600, Math.ceil(S.sequenceDuration() * S.zoom) + 240); }
  function timeFromClientX(clientX, laneRect) {
    return Math.max(0, (clientX - laneRect.left + (laneRect.scrollLeft || 0)) / S.zoom);
  }
  function targetTrack(type) {
    return S.project.tracks.find(t => t.type === type && t.target) || S.project.tracks.find(t => t.type === type) || null;
  }
  function snapCandidates(ignoreIds) {
    const out = [0, S.playhead];
    (S.project.markers || []).forEach(m => out.push(m.time));
    S.allClips().forEach(c => {
      if (ignoreIds && ignoreIds.has(c.id)) return;
      out.push(c.start, S.clipEnd(c));
    });
    return out;
  }
  function snapValue(v, cands, px) {
    if (!S.settings.snap) return v;
    let best = v, d = (px || 8) / S.zoom;
    cands.forEach(c => { const diff = Math.abs(c - v); if (diff < d) { d = diff; best = c; } });
    return best;
  }
  function cloneClip(c, newId) {
    const n = JSON.parse(JSON.stringify(c));
    n.id = newId || uid('clip');
    return n;
  }
  function shiftKeys(c, delta, trim) {
    if (!c.keys) return;
    Object.keys(c.keys).forEach(path => {
      c.keys[path] = c.keys[path].map(k => Object.assign({}, k, { t: k.t - delta })).filter(k => k.t >= -0.0001 || trim);
      c.keys[path].forEach(k => { k.t = Math.max(0, k.t); });
      if (!c.keys[path].length) delete c.keys[path];
    });
  }
  function mediaMax(clip) {
    const m = S.findMedia(clip.mediaId);
    return S.sourceDuration(m);
  }
  /** Expand a set of clip ids with linked A/V partners (Premiere-style linked clips). */
  function withLinks(ids) {
    const out = new Set(ids);
    if (!S.settings.linkAV) return out;
    ids.forEach(id => { const c = S.findClip(id); if (c && c.linkedTo && S.findClip(c.linkedTo)) out.add(c.linkedTo); });
    return out;
  }
  function detachAudio(clip) {
    if (!clip) { U.toast('Сначала выберите клип', 'warn'); return; }
    const m = S.findMedia(clip.mediaId);
    if (!m || !m.hasAudio) { U.toast('У этого клипа нет звуковой дорожки', 'warn'); return; }
    const at = targetTrack('audio');
    if (!at) { U.toast('Нет аудиодорожки', 'error'); return; }
    S.change('Отделение звука', () => {
      const a = cloneClip(clip);
      a.name = clip.name + ' (звук)';
      a.trackId = at.id; a.linkedTo = clip.id;
      a.transform = S.defaultTransform(); a.color = S.defaultColor();
      a.audio = S.defaultAudio(); a.audio.volume = 100;
      a.effects = []; a.keys = {}; a.transitionIn = 0; a.transitionOut = 0;
      at.clips.push(a);
      clip.audio.volume = 0; clip.linkedTo = a.id;
      S.selection.clear(); S.selection.add(clip.id); S.selection.add(a.id);
    });
    renderAll();
    U.toast('Звук вынесен на дорожку ' + at.name, 'success');
  }

  /* =============================== ruler =============================== */
  const STEPS = [1 / 60, 1 / 30, 1 / 15, .2, .5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200, 3600];
  function renderRuler(w) {
    tlRuler.innerHTML = '';
    tlRuler.style.width = w + 'px';
    let major = STEPS[STEPS.length - 1];
    for (const s of STEPS) { if (s * S.zoom >= 78) { major = s; break; } }
    const minor = major / 5;
    const frag = document.createDocumentFragment();
    const total = w / S.zoom;
    for (let t = 0, i = 0; t <= total + minor; t += minor, i++) {
      if (i > 4000) break;
      const x = t * S.zoom;
      const isMajor = Math.abs(t / major - Math.round(t / major)) < 0.001;
      const isMid = Math.abs(t / (major / 2) - Math.round(t / (major / 2))) < 0.001;
      const tick = el('div', { class: 'ruler-tick ' + (isMajor ? 'major' : isMid ? 'mid' : 'minor'), style: { left: x + 'px' } });
      frag.appendChild(tick);
      if (isMajor) frag.appendChild(el('div', { class: 'ruler-label', text: U.formatTC(t, S.project.fps, true), style: { left: x + 'px' } }));
    }
    if (S.project.seqOut > S.project.seqIn) {
      frag.appendChild(el('div', { class: 'ruler-section', style: { left: S.project.seqIn * S.zoom + 'px', width: (S.project.seqOut - S.project.seqIn) * S.zoom + 'px', background: 'rgba(90,169,255,.09)' } }));
    }
    tlRuler.appendChild(frag);
  }

  /* =============================== track headers & lanes =============================== */
  /* Подпись состояния таймлайна: если структура и содержимое клипов не изменились,
     полная перерисовка DOM (а это пересоздание всех клипов, миниатюр и канвасов
     дорожек) не нужна — достаточно обновить позиции и подписи. Это главный выигрыш
     по скорости: render() вызывается на каждое изменение, выделение и т.п. */
  function timelineSignature() {
    const tr = S.project.tracks.map(t => [
      t.id, t.name, t.type, t.height,
      t.locked ? 1 : 0, t.muted ? 1 : 0, t.solo ? 1 : 0, t.hidden ? 1 : 0, t.target ? 1 : 0, t.gain,
      t.clips.map(c => [
        c.id, c.mediaId, c.name, c.speed, c.rate, c.inPoint, c.outPoint,
        c.transitionIn, c.labelColor || '', c.disabled ? 1 : 0,
        (c.audio && c.audio.fadeIn) || 0, (c.audio && c.audio.fadeOut) || 0,
        c.effects ? c.effects.length : 0,
        // количество ключей ПО КАЖДОМУ параметру: иначе второй ключ того же
        // параметра не менял подпись и ромбики на клипе оставались старыми
        c.keys ? S.allKeyParams(c).map(p => p + ':' + ((c.keys[p] || []).length) + ':' +
          (c.keys[p] || []).map(k => Math.round(k.t * 100)).join('.')).join('+') : 0
      ].join('~')).join(',')
    ].join('|')).join(';');
    const thumbs = S.project.media.reduce((a, m) => a + (m.thumb ? 1 : 0), 0);
    const marks = (S.project.markers || []).map(m => m.time + (m.color || '') + m.label).join(',');
    return [tr, S.zoom, S.project.fps, S.activeParam, Array.from(S.selection).sort().join(','),
      S.settings.showThumbnails ? 1 : 0,
      S.settings.waveforms ? 1 : 0, S.project.media.length, thumbs,
      marks, S.project.seqIn, S.project.seqOut].join('#');
  }
  let lastSignature = '';

  function render(force) {
    if (force && typeof force === 'object') force = false; // render() часто передают как колбэк
    if (!initialized) init();
    const sig = timelineSignature();
    if (!force && sig === lastSignature && clipEls.size) {
      updateClipElements(); updateFoot(); return;
    }
    lastSignature = sig;
    measureHead();
    const keepScroll = tlScroll ? { l: tlScroll.scrollLeft, t: tlScroll.scrollTop } : { l: 0, t: 0 };
    const w = contentWidth();
    tlInner.style.width = (HEAD + w) + 'px';
    renderRuler(w);
    tlTracks.innerHTML = '';
    clipEls = new Map(); laneEls = new Map();
    const frag = document.createDocumentFragment();
    let totalH = 0;
    S.project.tracks.forEach((t, idx) => {
      const row = el('div', { class: 'tl-track-row', style: { height: t.height + 'px' }, dataset: { trackIndex: idx } });
      row.appendChild(renderTrackHead(t));
      const lane = el('div', {
        class: 'tl-lane ' + (t.type === 'audio' ? 'audio-lane' : '') + (t.locked ? ' locked' : ''),
        style: { width: w + 'px', height: t.height + 'px' }, dataset: { trackId: t.id, trackIndex: idx }
      });
      t.clips.forEach(c => {
        const node = renderClip(c, t);
        lane.appendChild(node);
        clipEls.set(c.id, node);
      });
      laneEls.set(t.id, lane);
      row.appendChild(lane);
      frag.appendChild(row);
      totalH += t.height;
    });
    // markers
    (S.project.markers || []).forEach(m => {
      frag.appendChild(el('div', { class: 'tl-marker', style: { left: (HEAD + m.time * S.zoom) + 'px' }, dataset: { markerTime: m.time } }));
    });
    tlTracks.appendChild(frag);
    tlTracks.style.width = (HEAD + w) + 'px';
    playheadEl.style.height = Math.max(totalH + 28, tlInner.clientHeight || 1) + 'px';
    updatePlayhead();
    if (tlScroll) { tlScroll.scrollLeft = keepScroll.l; tlScroll.scrollTop = keepScroll.t; }
    updateFoot();
  }

  function renderTrackHead(t) {
    const focused = targetTrack(t.type) === t;
    const head = el('div', { class: 'track-head' + (focused ? ' focused' : ''), dataset: { trackId: t.id } });
    const top = el('div', { class: 'th-top' }, [
      el('div', { class: 'th-target' + (t.target ? ' on' : ''), text: t.type === 'video' ? 'V' : 'A', title: 'Сделать целевой дорожкой', dataset: { act: 'target', trackId: t.id } }),
      el('div', { class: 'th-name', text: t.name, title: 'Дважды щёлкните для переименования', dataset: { act: 'rename', trackId: t.id } }),
      el('div', { class: 'th-badge', text: String(t.clips.length) }),
      el('button', { class: 'th-btn' + (t.locked ? ' on' : ''), title: 'Блокировка дорожки', html: U.icon(t.locked ? 'lock' : 'unlock'), dataset: { act: 'lock', trackId: t.id } })
    ]);
    head.appendChild(top);
    const controls = el('div', { class: 'th-controls' });
    controls.appendChild(el('button', { class: 'th-btn' + (t.muted ? ' mute-on' : ''), text: 'M', title: 'Выключить звук', dataset: { act: 'mute', trackId: t.id } }));
    controls.appendChild(el('button', { class: 'th-btn' + (t.solo ? ' on' : ''), text: 'S', title: 'Соло', dataset: { act: 'solo', trackId: t.id } }));
    if (t.type === 'video') controls.appendChild(el('button', { class: 'th-btn' + (t.hidden ? ' on' : ''), title: 'Скрыть видео', html: U.icon(t.hidden ? 'eye-off' : 'eye'), dataset: { act: 'hide', trackId: t.id } }));
    controls.appendChild(el('button', { class: 'th-btn', title: 'Добавить дорожку того же типа', html: U.icon('plus'), dataset: { act: 'add', trackId: t.id } }));
    const vol = el('input', { type: 'range', min: 0, max: 2, step: .01, value: t.gain == null ? 1 : t.gain, title: 'Громкость дорожки', dataset: { act: 'volume', trackId: t.id } });
    vol.className = 'th-vol';
    controls.appendChild(el('span', { class: 'th-volume' }, [U.iconEl('volume'), vol]));
    head.appendChild(controls);
    return head;
  }

  function renderClip(c, t) {
    const m = S.findMedia(c.mediaId);
    const dur = S.clipDuration(c);
    const kind = m ? m.type : 'video';
    const node = el('div', {
      class: 'tl-clip ' + kind + (S.selection.has(c.id) ? ' selected' : '') + (c.disabled ? ' disabled' : ''),
      style: { left: (c.start * S.zoom) + 'px', width: Math.max(2, dur * S.zoom) + 'px' },
      dataset: { clipId: c.id, trackId: t.id },
      title: c.name + '\nНачало: ' + U.formatTC(c.start, S.project.fps) + '\nДлительность: ' + U.formatTC(dur, S.project.fps)
    });
    if (c.labelColor) node.style.borderColor = c.labelColor;
    // Generated mattes show their real colour on the timeline instead of a generic swatch.
    if (m && m.generated && m.type === 'color' && m.data && m.data.color) {
      node.style.background = 'linear-gradient(rgba(255,255,255,.10),rgba(0,0,0,.20)), ' + m.data.color;
    }
    if (m && m.thumb && !m.generated && S.settings.showThumbnails && kind !== 'audio' && dur * S.zoom > 26) {
      node.appendChild(el('div', { class: 'clip-thumbs', style: { backgroundImage: 'url("' + m.thumb + '")' } }));
    }
    if (kind === 'audio' && S.settings.waveforms && dur * S.zoom > 12) {
      const cv = el('canvas', { class: 'clip-wave' });
      node.appendChild(cv);
      requestAnimationFrame(() => drawWave(cv, c, m, t));
    }
    const label = el('div', { class: 'clip-label', html: U.icon(M.mediaIcon(m)) + '<span>' + U.escapeHtml(c.name) + '</span>' });
    node.appendChild(label);
    const extra = [];
    if (c.speed !== 1) extra.push(c.speed + '×');
    if (c.effects && c.effects.length) extra.push(c.effects.length + ' эфф.');
    if (S.allKeyParams(c).length) extra.push('◇ ключи');
    if (m && m.offline) extra.push('OFFLINE');
    node.appendChild(el('div', { class: 'clip-sublabel', text: U.formatTC(dur, S.project.fps) + (extra.length ? ' · ' + extra.join(' · ') : '') }));
    node.appendChild(el('div', { class: 'clip-handle left', dataset: { handle: 'left' } }));
    node.appendChild(el('div', { class: 'clip-handle right', dataset: { handle: 'right' } }));
    if (S.selection.has(c.id)) {
      const fi = c.audio.fadeIn || 0, fo = c.audio.fadeOut || 0;
      node.appendChild(el('div', { class: 'clip-fade in', title: 'Нарастание звука (перетащите)', dataset: { handle: 'fadein' }, style: { left: Math.min(dur * S.zoom - 10, fi * S.zoom) + 'px' } }));
      node.appendChild(el('div', { class: 'clip-fade out', title: 'Затухание звука (перетащите)', dataset: { handle: 'fadeout' }, style: { right: Math.min(dur * S.zoom - 10, fo * S.zoom) + 'px' } }));
      // Как в CapCut: один ромбик на момент времени, независимо от числа
      // анимированных параметров. Перетаскивание двигает все ключи этого момента.
      const strip = el('div', { class: 'clip-keys', title: 'Ключевые кадры клипа' });
      S.allKeyTimes(c).forEach(t => {
        const at = Math.abs(c.start + t - S.playhead) < 1 / S.project.fps * .6;
        const paths = S.keysAtTime(c, t).map(x => x.path);
        strip.appendChild(el('div', {
          class: 'clip-key' + (at ? ' active' : '') + (paths.length > 1 ? ' multi' : ''),
          style: { left: (t * S.zoom) + 'px' },
          dataset: { handle: 'key', keyTime: String(t) },
          title: 'Ключевой кадр ' + U.formatTC(c.start + t, S.project.fps) + ' · ' + paths.length + ' парам.'
        }));
      });
      node.appendChild(strip);
      strip.addEventListener('pointerdown', onKeyStripDown);
    }
    if (c.transitionIn > 0) node.appendChild(el('div', { class: 'transition-badge', text: '◧', title: 'Переход: ' + U.formatDuration(c.transitionIn) }));
    return node;
  }
  function drawWave(cv, c, m, t) {
    if (!cv.isConnected) return;
    const wpx = Math.max(8, Math.min(2600, Math.floor(S.clipDuration(c) * S.zoom)));
    const hpx = Math.max(16, t.height - 10);
    cv.width = wpx; cv.height = hpx;
    const x = cv.getContext('2d');
    const peaks = m && m.peaks && m.peaks.length ? m.peaks : M.fakePeaks(c.name, 700);
    const total = S.sourceDuration(m);
    const from = clamp(c.inPoint / Math.max(.001, total), 0, 1), to = clamp(c.outPoint / Math.max(.001, total), 0, 1);
    const mid = hpx / 2;
    x.fillStyle = 'rgba(190,232,204,.72)';
    for (let px = 0; px < wpx; px += 2) {
      const f = px / wpx;
      const idx = Math.min(peaks.length - 1, Math.floor((from + (to - from) * f) * peaks.length));
      const v = Math.max(.02, peaks[idx] || .15) * (mid - 2);
      x.fillRect(px, mid - v, 1.4, v * 2);
    }
    x.strokeStyle = 'rgba(255,255,255,.18)'; x.beginPath(); x.moveTo(0, mid); x.lineTo(wpx, mid); x.stroke();
  }

  /* =============================== live DOM updates =============================== */
  function updateClipElements() {
    S.allClips().forEach(c => {
      const n = clipEls.get(c.id); if (!n) return;
      const dur = S.clipDuration(c);
      n.style.left = (c.start * S.zoom) + 'px';
      n.style.width = Math.max(2, dur * S.zoom) + 'px';
      const sub = $('.clip-sublabel', n); if (sub) sub.textContent = U.formatTC(dur, S.project.fps);
      n.classList.toggle('selected', S.selection.has(c.id));
      const track = S.findTrack(c.trackId);
      if (track && n.parentElement && n.parentElement.dataset.trackId !== track.id) {
        const lane = laneEls.get(track.id); if (lane) lane.appendChild(n);
      }
    });
    updatePlayhead();
  }
  let lastKeyTick = -1;
  function updatePlayhead() {
    if (!playheadEl) return;
    playheadEl.style.left = (HEAD + S.playhead * S.zoom) + 'px';
    // Подсветка ближайшего ключевого кадра (ромбик у выбранного клипа) — без
    // полной перерисовки таймлайна.
    const tick = Math.round(S.playhead * 6);
    if (tick !== lastKeyTick) {
      lastKeyTick = tick;
      $$('.clip-key').forEach(k => {
        const n = k.closest('.tl-clip'); if (!n) return;
        const c = S.findClip(n.dataset.clipId); if (!c) return;
        const keys = (c.keys && c.keys[S.activeParam]) || [];
        const i = parseInt(k.dataset.keyIndex, 10);
        const key = keys[i]; if (!key) return;
        k.classList.toggle('active', Math.abs(c.start + key.t - S.playhead) < 1 / S.project.fps * .6);
      });
    }
    updateKeyButton();
    if (S.playing && tlScroll && !drag) {
      const x = HEAD + S.playhead * S.zoom;
      if (x > tlScroll.scrollLeft + tlScroll.clientWidth - 80) tlScroll.scrollLeft = x - tlScroll.clientWidth * .65;
      else if (x < tlScroll.scrollLeft + HEAD + 10) tlScroll.scrollLeft = Math.max(0, x - HEAD - 40);
    }
  }
  function updateFoot() {
    const st = $('#tlStatus'); if (st) st.textContent = 'Дорожек: ' + S.project.tracks.length + ' · Клипов: ' + S.allClips().length;
    const d = $('#tlDuration'); if (d) d.textContent = 'Длительность ' + U.formatTC(S.sequenceDuration(), S.project.fps);
    const z = $('#zoomSlider'); if (z) z.value = S.zoom;
    const snap = $('#snapBtn'); if (snap) snap.classList.toggle('active', S.settings.snap);
    const wave = $('#waveBtn'); if (wave) wave.classList.toggle('active', S.settings.waveforms);
    const link = $('#linkBtn'); if (link) link.classList.toggle('active', S.settings.linkAV);
    const ak = $('#autoKeyBtn'); if (ak) ak.classList.toggle('active', S.settings.autoKey !== false);
    $('#timelinePanel').className = 'panel timeline-panel tool-' + S.tool;
    $$('#toolBar .tool[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === S.tool));
  }

  /* =============================== pointer interactions =============================== */
  function seekFromEvent(e) {
    const r = tlRuler.getBoundingClientRect();
    const t = Math.max(0, (e.clientX - r.left) / S.zoom);
    PPE.engine.seek(U.snapTime(t, S.project.fps));
  }
  function onRulerDown(e) {
    if (e.button !== 0) return;
    if (PPE.proTools && PPE.proTools.onRulerDown(e)) return;
    e.preventDefault(); scrubbing = true;
    PPE.engine.pause(); seekFromEvent(e);
    const move = ev => { if (scrubbing) seekFromEvent(ev); };
    const up = () => { scrubbing = false; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }
  function onPlayheadDown(e) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation(); scrubbing = true;
    PPE.engine.pause();
    const move = ev => { if (scrubbing) seekFromEvent(ev); };
    const up = () => { scrubbing = false; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }
  function onTracksInput(e) {
    const node = e.target.closest('[data-act="volume"]'); if (!node) return;
    const t = S.findTrack(node.dataset.trackId); if (!t) return;
    t.gain = parseFloat(node.value);
    M.setTrackGain(t.id, t.gain);
    S.markDirty();
  }
  function onTracksDown(e) {
    const act = e.target.closest('[data-act]');
    if (act && act.tagName === 'INPUT') return; // let range sliders work
    if (act) { handleTrackAction(act.dataset.act, act, e); return; }
    if (e.target.closest('.track-head')) return;
    const lane = e.target.closest('.tl-lane');
    const clipNode = e.target.closest('.tl-clip');
    const keyStrip = e.target.closest('.clip-keys');
    if (keyStrip && !e.target.closest('.clip-key')) { e.stopPropagation(); return; }
    if (clipNode && e.button === 0) { onClipDown(e, clipNode, lane); return; }
    if (lane) {
      if (PPE.proTools && PPE.proTools.onLaneDown(e, lane)) return;
      if (S.tool === 'hand') { startPan(e); return; }
      if (S.tool === 'zoom') { setZoom(S.zoom * 1.6); PPE.engine.pause(); return; }
      PPE.engine.pause();
      const r = lane.getBoundingClientRect();
      const t = Math.max(0, (e.clientX - r.left) / S.zoom);
      PPE.engine.seek(U.snapTime(t, S.project.fps));
      if (e.button === 0 && S.tool === 'select') { S.selection.clear(); if (PPE.panels) PPE.panels.renderEffectControls(); render(); }
    }
  }
  function handleTrackAction(act, node, e) {
    const t = S.findTrack(node.dataset.trackId); if (!t) return;
    e.stopPropagation();
    if (act === 'target') {
      S.project.tracks.forEach(x => { if (x.type === t.type) x.target = (x.id === t.id); });
      S.markDirty(); render();
    } else if (act === 'mute' || act === 'solo' || act === 'lock' || act === 'hide') {
      S.change('Настройки дорожки', () => {
        if (act === 'mute') t.muted = !t.muted;
        if (act === 'solo') t.solo = !t.solo;
        if (act === 'lock') t.locked = !t.locked;
        if (act === 'hide') t.hidden = !t.hidden;
      });
      render();
    } else if (act === 'volume') {
      // handled in input event below
    } else if (act === 'add') {
      addTrackUI(t.type);
    } else if (act === 'rename') {
      renameTrack(t);
    }
  }
  function renameTrack(t) {
    U.modal({
      title: 'Переименовать дорожку', icon: 'layers',
      body: '<div class="form-row"><label>Название</label><div class="form-control"><input type="text" id="trName" value="' + U.escapeHtml(t.name) + '"></div></div>',
      buttons: [{ label: 'Отмена' }, { label: 'ОК', class: 'primary', action: (b) => { const v = $('#trName', b).value.trim(); if (v) S.change('Переименование дорожки', () => { t.name = v; }); render(); } }]
    });
  }
  function onTracksDblClick(e) {
    const nameEl = e.target.closest('.th-name');
    if (nameEl) { const t = S.findTrack(nameEl.dataset.trackId); if (t) renameTrack(t); return; }
    const clipNode = e.target.closest('.tl-clip');
    if (clipNode) {
      const c = S.findClip(clipNode.dataset.clipId);
      if (c) {
        const m = S.findMedia(c.mediaId); if (!m) return;
        S.source.mediaId = c.mediaId; S.source.inPoint = c.inPoint; S.source.outPoint = c.outPoint;
        S.source.position = c.inPoint;
        PPE.engine.openSource(c.mediaId);
        S.source.inPoint = c.inPoint; S.source.outPoint = c.outPoint; S.source.position = c.inPoint;
        PPE.engine.sourceSeek(c.inPoint); PPE.engine.updateSourceUI();
      }
      return;
    }
    if (e.target.closest('.tl-lane')) {
      const lane = e.target.closest('.tl-lane');
      const t = Math.max(0, (e.clientX - lane.getBoundingClientRect().left) / S.zoom);
      addMarkerAt(t);
    }
  }
  function onTracksContext(e) {
    const clipNode = e.target.closest('.tl-clip');
    if (clipNode) {
      e.preventDefault();
      const id = clipNode.dataset.clipId;
      if (!S.selection.has(id)) { S.selection.clear(); S.selection.add(id); render(); }
      if (PPE.panels) PPE.panels.renderEffectControls();
      U.contextMenu(e.clientX, e.clientY, clipMenuItems(e.clientX, e.clientY));
      return;
    }
    if (e.target.closest('.tl-lane')) {
      e.preventDefault();
      const lane = e.target.closest('.tl-lane');
      const t = Math.max(0, (e.clientX - lane.getBoundingClientRect().left) / S.zoom);
      U.contextMenu(e.clientX, e.clientY, [
        { label: 'Разрезать здесь', icon: 'scissors', action: () => { S.change('Разрезание', () => splitAt(t)); renderAll(); } },
        { label: 'Добавить маркер', icon: 'marker', action: () => addMarkerAt(t) },
        { label: 'Вставить клипы', icon: 'copy', action: () => paste() },
        '-',
        { label: 'Добавить видеодорожку', icon: 'plus', action: () => addTrackUI('video') },
        { label: 'Добавить аудиодорожку', icon: 'plus', action: () => addTrackUI('audio') },
        '-',
        { label: 'Масштабировать по длительности', icon: 'fit', action: fitZoom }
      ]);
      return;
    }
    const head = e.target.closest('.track-head');
    if (head) {
      e.preventDefault();
      const t = S.findTrack(head.dataset.trackId); if (!t) return;
      U.contextMenu(e.clientX, e.clientY, [
        { label: t.locked ? 'Снять блокировку' : 'Заблокировать', icon: 'lock', action: () => { S.change('Блокировка', () => t.locked = !t.locked); render(); } },
        { label: t.muted ? 'Включить звук' : 'Выключить звук', icon: 'mute', action: () => { S.change('Mute', () => t.muted = !t.muted); render(); } },
        { label: 'Переименовать', icon: 'text', action: () => renameTrack(t) },
        { label: 'Удалить дорожку', icon: 'trash', danger: true, action: () => deleteTrack(t.id) }
      ]);
    }
  }
  /* ================= настройки спрайта прямо из меню клипа =================
     Клип студии анимации — это сцена: «спрайт» внутри неё. Пункты меню
     нацеливаются на верхний объект сцены в кадре под курсором воспроизведения. */
  function animSceneOf(c) {
    if (!c) return null;
    const m = S.findMedia(c.mediaId);
    if (!m || m.type !== 'animation' || !m.data || !m.data.sceneId) return null;
    const A = PPE.animation; if (!A) return null;
    const d = A.doc(); const sc = d && A.scene(d, m.data.sceneId);
    return sc ? { doc: d, scene: sc } : null;
  }
  function spriteTarget(c) {
    const res = animSceneOf(c); if (!res) return null;
    const A = PPE.animation, ui = PPE.animationUI && PPE.animationUI.state; if (!ui) return null;
    const sc = res.scene, d = res.doc;
    const local = Math.max(0, Math.min(S.clipDuration(c), S.playhead - c.start));
    const frame = A.frameBound(sc, Math.round(local * (d.fps || 30)));
    const prev = new Set(Array.from(ui.selected || []));
    const layers = (sc.layers || []).filter(l => l.type !== 'folder' && l.visible !== false);
    let layer = null, objs = null;
    const pick = (wantPrev) => {
      for (let i = layers.length - 1; i >= 0; i--) {
        const list = A.objectsAt(layers[i], frame);
        if (!list.length) continue;
        if (wantPrev && !list.some(o => prev.has(o.id))) continue;
        return { layer: layers[i], list };
      }
      return null;
    };
    const found = pick(true) || pick(false);
    if (!found) return null;
    layer = found.layer; objs = found.list;
    const obj = objs.filter(o => prev.has(o.id))[0] || objs[objs.length - 1];
    return { sceneId: sc.id, layerId: layer.id, frame: frame, objId: obj.id, count: objs.length };
  }
  /** Направить состояние студии на спрайт клипа и выполнить действие. */
  function withSprite(c, fn) {
    const t = spriteTarget(c);
    if (!t) return false;
    const ui = PPE.animationUI.state;
    ui.sceneId = t.sceneId; ui.layerId = t.layerId; ui.frame = t.frame;
    ui.selected = new Set([t.objId]);
    if (PPE.sprite && typeof fn === 'function') fn(PPE.sprite, t);
    if (PPE.animationUI && PPE.animationUI.isOpen()) { PPE.animationUI.render(); }
    else { if (PPE.renderAll) PPE.renderAll(); if (PPE.engine) PPE.engine.renderFrame(S.playhead); }
    return true;
  }
  /** Нет сцены у клипа — объясняем, что делать. */
  function needAnimClip(c) {
    const m = c ? S.findMedia(c.mediaId) : null;
    U.toast('«' + (c ? c.name : 'Клип') + '» — ' + (m ? ({ video: 'видео', image: 'картинка', audio: 'звук', color: 'заливка', text: 'титр' }[m.type] || 'медиа') : 'медиа') +
      '. Пункт работает со спрайтами клипа студии анимации: откройте «Анимация» и добавьте сцену в монтаж.', 'warn', 4600);
  }

  /* --------------------------- фильтры для клипа --------------------------- */
  const CLIP_FILTERS = [
    ['Ч/Б', { grayscale: 100, sepia: 0, saturate: 100, contrast: 100, brightness: 100, hue: 0, blur: 0 }],
    ['Нуар', { grayscale: 100, contrast: 145, brightness: 92, hue: 0, sepia: 0, saturate: 100, blur: 0 }],
    ['Сепия', { sepia: 100, grayscale: 0, contrast: 105, brightness: 102, saturate: 100, hue: 0, blur: 0 }],
    ['Винтаж', { sepia: 45, saturate: 78, contrast: 92, brightness: 104, grayscale: 0, hue: 8, blur: 0 }],
    ['Тёплый', { hue: 12, sepia: 22, saturate: 118, brightness: 104, contrast: 102, grayscale: 0, blur: 0 }],
    ['Холодный', { hue: -14, saturate: 96, brightness: 101, contrast: 106, sepia: 0, grayscale: 0, blur: 0 }],
    ['Контраст', { contrast: 145, saturate: 108, brightness: 100, grayscale: 0, sepia: 0, hue: 0, blur: 0 }],
    ['Яркий', { brightness: 118, saturate: 132, contrast: 106, grayscale: 0, sepia: 0, hue: 0, blur: 0 }],
    ['Неон', { saturate: 210, contrast: 120, hue: 22, brightness: 104, grayscale: 0, sepia: 0, blur: 0 }],
    ['Размытие', { blur: 6, brightness: 100, contrast: 100, saturate: 100, grayscale: 0, sepia: 0, hue: 0 }],
    ['Виньетка', { vignette: 60, brightness: 100, contrast: 104, saturate: 100, grayscale: 0, sepia: 0, hue: 0, blur: 0 }]
  ];
  function applyClipFilter(c, preset) {
    S.change('Фильтр клипа: ' + preset[0], () => {
      Object.keys(preset[1]).forEach(k => { c.color[k] = preset[1][k]; });
    });
    if (PPE.proColor) PPE.proColor.dropCache(c.id);
    renderAll(); if (PPE.engine) PPE.engine.renderFrame(S.playhead);
    U.toast('Фильтр «' + preset[0] + '» применён к клипу', 'success', 2200);
  }
  function clipFilterMenu(c, anchor) {
    U.dropdown(anchor, CLIP_FILTERS.map(p => ({
      label: p[0], checked: Object.keys(p[1]).every(k => Math.abs((c.color[k] || 0) - p[1][k]) < .01),
      action: () => applyClipFilter(c, p)
    })).concat([{ label: 'Сбросить фильтры', action: () => {
      S.change('Сброс фильтров клипа', () => { Object.assign(c.color, S.defaultColor()); });
      renderAll(); if (PPE.engine) PPE.engine.renderFrame(S.playhead);
    } }]));
  }
  /** Диалог со слайдерами цвета клипа (фильтры / освещение). */
  function clipColorDialog(c, mode) {
    const isLight = mode === 'light';
    const rows = isLight
      ? [['brightness', 'Экспозиция', 0, 300, 1, '%'], ['contrast', 'Контраст', 0, 300, 1, '%'],
         ['saturate', 'Насыщенность', 0, 400, 1, '%'], ['hue', 'Температура', -180, 180, 1, '°'],
         ['vignette', 'Виньетка', 0, 100, 1, '%']]
      : [['brightness', 'Яркость', 0, 300, 1, '%'], ['contrast', 'Контраст', 0, 300, 1, '%'],
         ['saturate', 'Насыщенность', 0, 400, 1, '%'], ['grayscale', 'Ч/Б', 0, 100, 1, '%'],
         ['sepia', 'Сепия', 0, 100, 1, '%'], ['hue', 'Оттенок', -180, 180, 1, '°'],
         ['blur', 'Размытие', 0, 60, .5, 'px']];
    const start = Object.assign({}, c.color);
    const body = el('div', { class: 'form-stack' });
    rows.forEach(r => {
      const [key, label, min, max, step, unit] = r;
      const row = el('div', { class: 'form-row' }, [
        el('label', { text: label }),
        el('div', { class: 'form-control' }, [
          el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(start[key] == null ? min : start[key]), dataset: { ck: key } }),
          el('span', { class: 'unit', text: String(start[key] == null ? min : start[key]) + unit, dataset: { cv: key } })
        ])
      ]);
      body.appendChild(row);
    });
    body.appendChild(el('div', { class: 'form-note', text: isLight
      ? 'Экспозиция и температура влияют на весь клип. Пресеты — как в CapCut: День, Ночь, Плёнка.'
      : 'Значения применяются к клипу целиком и видны в программном мониторе сразу.' }));
    const presets = isLight
      ? [['День', { brightness: 108, contrast: 104, saturate: 112, hue: 6, vignette: 0 }],
         ['Ночь', { brightness: 88, contrast: 118, saturate: 92, hue: -18, vignette: 34 }],
         ['Плёнка', { brightness: 102, contrast: 96, saturate: 88, hue: 10, vignette: 22 }]]
      : [['Нейтрально', { brightness: 100, contrast: 100, saturate: 100, grayscale: 0, sepia: 0, hue: 0, blur: 0 }]];
    const presetBox = el('div', { class: 'form-presets' });
    presets.forEach(p => presetBox.appendChild(el('button', { class: 'btn small', text: p[0], onclick: () => {
      Object.keys(p[1]).forEach(k => { c.color[k] = p[1][k]; });
      body.querySelectorAll('[data-ck]').forEach(inp => { if (p[1][inp.dataset.ck] != null) inp.value = String(p[1][inp.dataset.ck]); });
      body.querySelectorAll('[data-cv]').forEach(sp => { const k = sp.dataset.cv; const def = rows.find(r => r[0] === k); if (def) sp.textContent = String(c.color[k]) + def[5]; });
      if (PPE.engine) PPE.engine.renderFrame(S.playhead);
    } })));
    body.appendChild(presetBox);
    U.modal({
      title: isLight ? 'Коррекция освещения · клип' : 'Настройка фильтра · клип', icon: isLight ? 'fx' : 'sliders', body,
      onOpen: (root) => {
        root.querySelectorAll('[data-ck]').forEach(inp => {
          inp.addEventListener('input', () => {
            const k = inp.dataset.ck;
            c.color[k] = Number(inp.value);
            const sp = root.querySelector('[data-cv="' + k + '"]');
            const def = rows.find(r => r[0] === k);
            if (sp && def) sp.textContent = String(c.color[k]) + def[5];
            if (PPE.engine) PPE.engine.renderFrame(S.playhead);
          });
        });
      },
      buttons: [
        { label: 'Отмена', action: () => { Object.assign(c.color, start); renderAll(); if (PPE.engine) PPE.engine.renderFrame(S.playhead); } },
        { label: 'Применить', class: 'primary', action: () => {
          S.change(isLight ? 'Освещение клипа' : 'Фильтр клипа', () => { Object.assign(c.color, start); });
          renderAll(); if (PPE.engine) PPE.engine.renderFrame(S.playhead);
        } }
      ]
    });
  }

  /* -------------------------------- громкость -------------------------------- */
  const VOL_PRESETS = [['Без звука', 0], ['−6 дБ', 50], ['Норма', 100], ['+6 дБ', 200], ['+12 дБ', 400]];
  function volumeDialog(c) {
    if (!c) { U.toast('Выберите клип', 'warn'); return; }
    const m = S.findMedia(c.mediaId);
    const local = Math.max(0, S.playhead - c.start);
    const cur = Math.round(S.valueAt(c, 'audio.volume', local));
    const keyed = (c.keys && c.keys['audio.volume'] && c.keys['audio.volume'].length) || 0;
    const body = el('div', { class: 'form-stack' }, [
      el('div', { class: 'form-row' }, [
        el('label', { text: 'Громкость' }),
        el('div', { class: 'form-control' }, [
          el('input', { type: 'range', id: 'volRange', min: '0', max: '400', step: '1', value: String(cur) }),
          el('span', { class: 'unit', id: 'volVal', text: cur + '%' })
        ])
      ]),
      el('div', { class: 'form-presets' }, VOL_PRESETS.map(p => el('button', {
        class: 'btn small' + (cur === p[1] ? ' on' : ''), text: p[0], onclick: () => {
          const r = $('#volRange'), v = $('#volVal');
          if (r) r.value = String(p[1]); if (v) v.textContent = p[1] + '%';
          c.audio.volume = p[1];
          if (PPE.engine) PPE.engine.renderFrame(S.playhead);
        }
      })))
    ]);
    const note = el('div', { class: 'form-note', text:
      (m && m.type === 'audio' ? 'Аудиоклип. ' : '') +
      'Громкость применяется ко всему клипу' + (keyed ? ' (ключи громкости выравниваются по значению).' : '.') +
      (m && m.hasAudio === false && m.type === 'video' ? ' У этого видео нет звуковой дорожки.' : '') });
    body.appendChild(note);
    const start = c.audio.volume;
    U.modal({
      title: 'Громкость клипа · ' + c.name, icon: 'volume', body,
      onOpen: (root) => {
        const r = root.querySelector('#volRange'), v = root.querySelector('#volVal');
        if (!r) return;
        r.addEventListener('input', () => {
          c.audio.volume = Number(r.value); if (v) v.textContent = r.value + '%';
          if (PPE.engine) PPE.engine.renderFrame(S.playhead);
        });
      },
      buttons: [
        { label: 'Отмена', action: () => { c.audio.volume = start; renderAll(); } },
        { label: 'Применить', class: 'primary', action: () => {
          const v = Number(($('#volRange') || {}).value);
          S.change('Громкость клипа', () => {
            c.audio.volume = isFinite(v) ? v : start;
            if (c.keys && c.keys['audio.volume']) c.keys['audio.volume'].forEach(k => { k.v = c.audio.volume; });
          });
          renderAll(); if (PPE.engine) PPE.engine.renderFrame(S.playhead);
          U.toast('Громкость: ' + Math.round(c.audio.volume) + '%', 'success', 2000);
        } }
      ]
    });
  }

  /** «Слой» для обычного клипа — на какую видеодорожку его переложить. */
  function trackMenuForClip(c, anchor) {
    if (!c) return;
    const tracks = S.project.tracks.filter(t => t.type === 'video');
    const items = tracks.map(t => ({
      label: t.name + (t.id === c.trackId ? ' · текущая' : ''), checked: t.id === c.trackId,
      disabled: t.id === c.trackId || t.locked,
      action: () => {
        S.change('Перенос клипа на дорожку', () => {
          const from = S.findTrack(c.trackId);
          if (from) from.clips = from.clips.filter(x => x.id !== c.id);
          c.trackId = t.id; t.clips.push(c);
        });
        renderAll();
      }
    }));
    items.push('-', {
      label: 'Новая видеодорожка сверху', icon: 'plus', action: () => {
        S.change('Новая дорожка', () => {
          const nt = S.addTrack('video');
          if (!nt) return;
          const from = S.findTrack(c.trackId);
          if (from) from.clips = from.clips.filter(x => x.id !== c.id);
          c.trackId = nt.id; nt.clips.push(c);
        });
        renderAll();
      }
    });
    U.dropdown(anchor, items);
  }

  function clipMenuItems(menuX, menuY) {
    const c = S.findClip(Array.from(S.selection)[0]);
    const anchor = kfAnchor(menuX == null ? window.innerWidth / 2 : menuX, menuY == null ? window.innerHeight / 2 : menuY);
    const anim = !!animSceneOf(c);
    const sprite = (fn, fallback) => () => {
      if (!c) { U.toast('Выберите клип', 'warn'); return; }
      if (anim) { if (!withSprite(c, fn)) needAnimClip(c); return; }
      if (fallback) fallback(); else needAnimClip(c);
    };
    return [
      { label: 'Разрезать в точке воспроизведения', icon: 'scissors', shortcut: 'Ctrl+K', action: () => splitSelected() },
      { label: 'Дублировать', icon: 'copy', shortcut: 'Ctrl+D', action: duplicate },
      { label: 'Копировать', icon: 'copy', shortcut: 'Ctrl+C', action: copySelected },
      { label: 'Удалить', icon: 'trash', shortcut: 'Del', action: () => deleteSelected(false) },
      { label: 'Удалить со сдвигом', icon: 'trash', shortcut: 'Shift+Del', action: () => deleteSelected(true) },
      '-',
      { label: 'Перекрёстное растворение', icon: 'layers', action: () => applyEffectToSelected('cross-dissolve') },
      { label: 'Растворение через чёрное', icon: 'color', action: () => applyEffectToSelected('dip-black') },
      { label: 'Появление из чёрного', icon: 'eye', action: () => applyEffectToSelected('fade-in-video') },
      { label: 'Затухание в чёрное', icon: 'eye-off', action: () => applyEffectToSelected('fade-out-video') },
      '-',
      { label: 'Отделить звук на аудиодорожку', icon: 'music', action: () => detachAudio(c) },
      { label: 'Громкость…', icon: 'volume', action: () => volumeDialog(c) },
      { label: 'Скорость и длительность…', icon: 'speed', action: () => speedDialog(c) },
      { label: 'Добавить ключевой кадр', icon: 'diamond', action: addKeyAtPlayhead },
      { label: 'Открыть в исходном мониторе', icon: 'film', action: () => { if (c) { PPE.engine.openSource(c.mediaId); S.source.inPoint = c.inPoint; S.source.outPoint = c.outPoint; PPE.engine.sourceSeek(c.inPoint); } } },
      '-',
      { label: 'Склейка', icon: 'layers', action: sprite(sp => sp.merge()) },
      { label: 'Замена спрайта…', icon: 'image', action: sprite(sp => sp.replaceDialog()) },
      { label: 'Кадрирование…', icon: 'fit', action: sprite(sp => sp.cropDialog()) },
      { label: 'Фильтры', icon: 'color', action: sprite(sp => sp.filterMenu(anchor), () => clipFilterMenu(c, anchor)) },
      { label: 'Настроить фильтр…', icon: 'sliders', action: sprite(sp => sp.filterDialog(), () => clipColorDialog(c, 'filter')) },
      { label: 'Удалить фон…', icon: 'eye-off', action: sprite(sp => sp.removeBgDialog()) },
      { label: 'Коррекция освещения…', icon: 'fx', action: sprite(sp => sp.lightDialog(), () => clipColorDialog(c, 'light')) },
      { label: 'Деформация спрайта', icon: 'grid', action: sprite(sp => sp.deformMenu(anchor)) },
      { label: 'Слой', icon: 'layers', action: sprite(sp => sp.layerMenu(anchor), () => { if (c) trackMenuForClip(c, anchor); }) },
      { label: 'Маска', icon: 'eye', action: sprite(sp => sp.maskMenu(anchor)) },
      '-',
      { label: 'Переименовать клип', icon: 'text', action: () => renameClip(c) },
      { label: c && c.disabled ? 'Включить клип' : 'Отключить клип', icon: 'eye-off', action: () => { if (c) S.change('Включение клипа', () => c.disabled = !c.disabled); renderAll(); } }
    ];
  }

  /* ---------------------------- ключевые кадры клипа ---------------------------- */
  const kfAnchor = (x, y) => ({ getBoundingClientRect: () => ({ left: x, right: x, top: y, bottom: y }) });
  function openKeyMenu(clipId, keyTime, x, y) {
    const c = S.findClip(clipId); if (!c) return;
    const items = S.keysAtTime(c, keyTime);
    const label = U.formatTC(c.start + keyTime, S.project.fps);
    U.contextMenu(x, y, [
      { label: 'Ключевой кадр ' + label + (items.length > 1 ? ' · ' + items.length + ' парам.' : ''), disabled: true },
      '-',
      { label: 'Кривые — скорость перехода', action: () => keyCurveMenu(c, keyTime, kfAnchor(x, y)) },
      { label: 'Настройки кривых…', action: () => keyCurveDialog(c, keyTime) },
      '-',
      { label: 'Применить ключевой кадр к другому клипу…', action: () => applyKeyToClipDialog(c, keyTime) }
    ]);
  }
  const KEY_CURVES = [
    ['Линейно', 'linear'], ['Плавно', 'ease'], ['Резко', 'bezier:.9,0,.1,1'],
    ['Пружина', 'bezier:.34,1.56,.64,1'], ['Ускорение', 'bezier:.42,0,1,1'], ['Замедление', 'bezier:0,0,.58,1']
  ];
  function keyCurveMenu(c, keyTime, anchor) {
    const items = S.keysAtTime(c, keyTime);
    const cur = items.length ? items[0].key.easing : null;
    U.dropdown(anchor, KEY_CURVES.map(([label, val]) => ({
      label, checked: cur === val,
      action: () => {
        S.change('Кривая ключевого кадра', () => {
          S.keysAtTime(c, keyTime).forEach(it => { it.key.easing = val; });
        });
        renderAll();
        U.toast('Кривая «' + label + '» для ключа ' + U.formatTC(c.start + keyTime, S.project.fps), 'success', 2400);
      }
    })).concat(['-', { label: 'Настроить кривую вручную…', action: () => keyCurveDialog(c, keyTime) }]));
  }
  function keyCurveDialog(c, keyTime) {
    const items = S.keysAtTime(c, keyTime);
    if (!items.length) { U.toast('В этой точке нет ключа', 'warn'); return; }
    const cur = (items[0].key.easing || '').replace('bezier:', '').split(',').map(Number);
    const st0 = { curve: cur.length === 4 && cur.every(n => isFinite(n)) ? cur : [.25, .1, .25, 1] };
    const body = el('div', { class: 'sp-form sp-curve' });
    const cv = el('canvas', { class: 'sp-curve-canvas', width: 260, height: 260 });
    body.appendChild(cv);
    const fields = el('div', { class: 'sp-curve-fields' });
    ['X1', 'Y1', 'X2', 'Y2'].forEach((nm, i) => {
      const inp = el('input', { type: 'number', step: '0.05', value: String(st0.curve[i]) });
      inp.addEventListener('input', () => { st0.curve[i] = Number(inp.value) || 0; PPE.sprite.drawCurve(cv, st0.curve); });
      fields.appendChild(el('label', {}, [el('span', { text: nm }), inp]));
    });
    body.appendChild(fields);
    const presets = el('div', { class: 'sp-row sp-presets' });
    (PPE.sprite.CURVES || []).forEach(([label, cc]) => {
      const bt = el('button', { class: 'an-btn', text: label });
      bt.addEventListener('click', () => {
        st0.curve = cc.slice(); PPE.sprite.drawCurve(cv, st0.curve);
        $$('input', fields).forEach((n, i) => n.value = String(st0.curve[i]));
      });
      presets.appendChild(bt);
    });
    body.appendChild(presets);
    body.appendChild(el('div', { class: 'sp-note', text: 'Ключ «' + c.name + '» · ' + U.formatTC(c.start + keyTime, S.project.fps) + '. Кривая задаёт скорость перехода к следующему ключу этого параметра.' }));
    PPE.sprite.drawCurve(cv, st0.curve);
    U.modal({
      title: 'Настройки кривых · ключевой кадр', icon: 'wave', body,
      buttons: [
        { label: 'Отмена' },
        { label: 'Применить', class: 'primary', action: () => {
          const val = 'bezier:' + st0.curve.map(n => Math.round(n * 100) / 100).join(',');
          S.change('Кривая ключевого кадра', () => { S.keysAtTime(c, keyTime).forEach(it => { it.key.easing = val; }); });
          renderAll();
          U.toast('Кривая применена', 'success');
        } }
      ]
    });
  }
  function applyKeyToClipDialog(src, keyTime) {
    const items = S.keysAtTime(src, keyTime);
    if (!items.length) { U.toast('В этой точке нет ключа', 'warn'); return; }
    const targets = S.allClips().filter(c => c.id !== src.id);
    if (!targets.length) { U.toast('В проекте только один клип', 'warn'); return; }
    const body = el('div', { class: 'sp-form' });
    body.appendChild(el('div', { class: 'sp-note', text: 'Значения ключевого кадра (' + items.length + ' парам.) встанут на тот же момент от начала клипа. Длительность обрежется по клипу.' }));
    const list = el('div', { class: 'sp-transfer' });
    let picked = targets[0];
    targets.forEach((c, i) => {
      const b = el('button', { class: 'sp-transfer-item' + (i === 0 ? ' on' : '') }, [
        el('span', { text: c.name }), el('strong', { text: (S.findTrack(c.trackId) || {}).name + ' · ' + U.formatTC(c.start, S.project.fps) })
      ]);
      b.addEventListener('click', () => { picked = c; $$('.sp-transfer-item', list).forEach(n => n.classList.remove('on')); b.classList.add('on'); });
      list.appendChild(b);
    });
    body.appendChild(list);
    U.modal({
      title: 'Применить ключевой кадр к другому клипу', icon: 'diamond', wide: true, body,
      buttons: [
        { label: 'Отмена' },
        { label: 'Применить', class: 'primary', action: () => {
          let n = 0;
          S.change('Перенос ключевого кадра', () => {
            items.forEach(it => {
              const t = clamp(keyTime, 0, S.clipDuration(picked));
              S.addKey(picked, it.path, t, it.key.v, it.key.easing);
              n++;
            });
          });
          renderAll();
          U.toast('Ключевой кадр применён к «' + picked.name + '» (' + n + ' парам.)', 'success', 3200);
        } }
      ]
    });
  }
  function onClipDown(e, node, lane) {
    const id = node.dataset.clipId, clip = S.findClip(id); if (!clip) return;
    const track = S.findTrack(clip.trackId);
    if (PPE.proTools && PPE.proTools.onClipDown(e, node, lane, clip)) return;
    e.preventDefault(); PPE.engine.pause();
    if (S.tool === 'razor') {
      const r = node.getBoundingClientRect();
      const t = clip.start + (e.clientX - r.left) / S.zoom;
      S.change('Разрезание', () => splitAt(t, new Set([id]))); renderAll(); return;
    }
    if (S.tool === 'zoom') { setZoom(S.zoom * 1.6); return; }
    if (S.tool === 'hand') { startPan(e); return; }
    if (e.shiftKey) { if (S.selection.has(id)) S.selection.delete(id); else S.selection.add(id); }
    else if (!S.selection.has(id)) { S.selection.clear(); S.selection.add(id); }
    if (PPE.panels) PPE.panels.renderEffectControls();
    if (track && track.locked) { render(); return; }
    const handle = e.target.closest('[data-handle]');
    let mode = 'move';
    if (S.tool === 'slip') mode = 'slip';
    else if (handle) mode = handle.dataset.handle;
    const ids = withLinks(S.selection.has(id) ? new Set(S.selection) : new Set([id]));
    const originals = new Map();
    S.allClips().forEach(c => { if (ids.has(c.id)) originals.set(c.id, JSON.parse(JSON.stringify(c))); });
    const rects = Array.from(laneEls.entries()).map(([tid, l]) => ({ tid, rect: l.getBoundingClientRect(), type: (S.findTrack(tid) || {}).type, locked: (S.findTrack(tid) || {}).locked }));
    drag = {
      id, ids, mode, originals, startX: e.clientX, startY: e.clientY,
      startScroll: tlScroll.scrollLeft, rects, started: false, zoom: S.zoom,
      keyIndex: -1,
      keyTime: (handle && handle.dataset.handle === 'key') ? parseFloat(handle.dataset.keyTime) : null,
      keyRef: null,
      laneLeft: lane.getBoundingClientRect().left
    };
    node.classList.add('drag-src');
    // Touch devices have no right click: a long press opens the clip context menu.
    // Порог поднят до 650 мс и отменяется при малейшем движении — иначе палец,
    // который «прижался» перед перетаскиванием, открывал контекстное меню вместо
    // перемещения клипа.
    if (e.pointerType === 'touch') {
      drag.lpTimer = setTimeout(() => {
        if (!drag || drag.started || drag.longPressed || drag.moved) return;
        drag.longPressed = true;
        const cn = clipEls.get(drag.id); if (cn) cn.classList.remove('drag-src');
        try { if (navigator.vibrate) navigator.vibrate(18); } catch (err) {}
        U.contextMenu(drag.startX, drag.startY, clipMenuItems(drag.startX, drag.startY));
      }, 650);
    }
    // Подсказка, если активный инструмент перехватывает нажатие по клипу:
    // пользователю кажется, что клип «не двигается».
    if (PPE.proTools && PPE.proTools.ADV && PPE.proTools.ADV.has(S.tool) && S.tool !== 'razor') {
      const t = PPE.proTools.TOOLS.find(x => x.id === S.tool);
      U.hint('Инструмент «' + (t ? t.name : S.tool) + '»: чтобы перетаскивать клипы, нажмите V (Selection Tool)');
    }
    // Задержка на ромбе ключевого кадра открывает меню самого ключа
    // (кривые, настройки кривых, перенос на другой клип).
    if (mode === 'key' && drag.keyTime != null) {
      drag.kfTimer = setTimeout(() => {
        if (!drag || drag.started) return;
        drag.kfFired = true;
        openKeyMenu(drag.id, drag.keyTime, e.clientX, e.clientY);
        // гасим «хвостовой» клик, иначе меню закроется сразу после отпускания
        const kill = ev2 => { ev2.stopPropagation(); ev2.preventDefault(); };
        document.addEventListener('click', kill, true);
        setTimeout(() => document.removeEventListener('click', kill, true), 700);
      }, 460);
    }
    const move = ev => onDragMove(ev);
    const up = ev => { onDragUp(ev); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }
  function onDragMove(e) {
    if (!drag) return;
    const dx = (e.clientX - drag.startX) / drag.zoom;
    const dy = e.clientY - drag.startY;
    if (Math.abs(e.clientX - drag.startX) + Math.abs(dy) > 4) {
      drag.moved = true;
      if (drag.lpTimer) { clearTimeout(drag.lpTimer); drag.lpTimer = null; }
      if (drag.kfTimer) { clearTimeout(drag.kfTimer); drag.kfTimer = null; }
    }
    if (!drag.started && Math.abs(e.clientX - drag.startX) + Math.abs(dy) < 3) return;
    if (!drag.started) { drag.started = true; S.begin(drag.mode === 'move' ? 'Перемещение клипа' : drag.mode === 'slip' ? 'Сдвиг содержимого' : 'Изменение клипа'); }
    const cands = snapCandidates(drag.ids);
    const primary = S.findClip(drag.id); if (!primary) return;
    const o = drag.originals.get(drag.id);
    if (drag.mode === 'move') {
      let ns = o.start + dx;
      const d = S.clipDuration(primary);
      const s1 = snapValue(ns, cands, 8) - ns;
      const s2 = snapValue(ns + d, cands, 8) - (ns + d);
      ns = Math.max(0, ns + (Math.abs(s1) <= Math.abs(s2) ? s1 : s2));
      let targetTrackId = o.trackId;
      const hit = drag.rects.find(r => e.clientY >= r.rect.top && e.clientY <= r.rect.bottom);
      const hitTrack = hit ? S.findTrack(hit.tid) : null;
      if (hitTrack && !hit.locked && hit.type === S.findTrack(o.trackId).type) targetTrackId = hit.tid;
      drag.ids.forEach(cid => {
        const c = S.findClip(cid), oc = drag.originals.get(cid); if (!c || !oc) return;
        c.start = Math.max(0, oc.start + (ns - o.start));
        if (cid === drag.id || S.findTrack(oc.trackId).type === (hitTrack || {}).type) c.trackId = cid === drag.id ? targetTrackId : oc.trackId;
      });
    } else if (drag.mode === 'left') {
      let ns = snapValue(o.start + dx, cands);
      const minStart = Math.max(0, o.start - o.inPoint / (o.speed || 1));
      ns = clamp(ns, minStart, o.start + S.clipDuration(primary) - 1 / S.project.fps);
      const delta = ns - o.start;
      primary.start = ns;
      primary.inPoint = Math.max(0, o.inPoint + delta * (o.speed || 1));
      primary.outPoint = o.outPoint;
      primary.keys = JSON.parse(JSON.stringify(o.keys || {}));
      if (primary.transitionIn) primary.transitionIn = Math.min(primary.transitionIn, S.clipDuration(primary) / 2);
      shiftKeys(primary, delta, false);
    } else if (drag.mode === 'right') {
      let no = o.outPoint + dx * (o.speed || 1);
      no = clamp(no, o.inPoint + 1 / S.project.fps / (o.speed || 1), mediaMax(primary));
      let ne = o.start + (no - o.inPoint) / (o.speed || 1);
      ne = snapValue(ne, cands, 6);
      no = o.inPoint + (ne - o.start) * (o.speed || 1);
      primary.outPoint = clamp(no, o.inPoint + 1 / S.project.fps / (o.speed || 1), mediaMax(primary));
    } else if (drag.mode === 'slip') {
      let shift = dx * (o.speed || 1);
      const len = o.outPoint - o.inPoint;
      shift = clamp(shift, -o.inPoint, mediaMax(primary) - o.outPoint);
      primary.inPoint = o.inPoint + shift; primary.outPoint = o.inPoint + shift + len;
    } else if (drag.mode === 'fadein' || drag.mode === 'fadeout') {
      const v = (drag.mode === 'fadein' ? (o.audio.fadeIn || 0) : (o.audio.fadeOut || 0)) + dx;
      const d = S.clipDuration(primary);
      if (drag.mode === 'fadein') primary.audio.fadeIn = clamp(v, 0, d / 2);
      else primary.audio.fadeOut = clamp(v, 0, d / 2);
    } else if (drag.mode === 'key') {
      // Двигаем всю «пачку» ключей, стоящих в один момент времени (все параметры).
      const orig = drag.originals.get(drag.id);
      if (drag.keyTime != null) {
        const rawT = (orig.start + (e.clientX - drag.laneLeft) / drag.zoom) - primary.start;
        const nt = clamp(Math.round(rawT * 1000) / 1000, 0, S.clipDuration(primary));
        S.allKeyParams(primary).forEach(p => {
          (primary.keys[p] || []).forEach(k => { if (Math.abs(k.t - drag.keyTime) <= 0.02) k.t = nt; });
          primary.keys[p].sort((a, b) => a.t - b.t);
        });
      }
    }
    scheduledDomUpdate();
    showDragBadge(primary);
  }
  /* Перерисовка DOM и кадра не чаще одного раза за кадр — иначе при быстром
     движении мыши браузер получает десятки перерисовок в секунду. */
  const scheduledDomUpdate = U.raf(() => { updateClipElements(); try { PPE.engine.renderFrame(S.playhead); } catch (err) {} });
  let dragBadge = null;
  function showDragBadge(clip) {
    if (!clip) return;
    if (!dragBadge) { dragBadge = el('div', { class: 'tl-drag-badge' }); document.body.appendChild(dragBadge); }
    const lane = laneEls.get(clip.trackId);
    const node = clipEls.get(clip.id);
    if (!node || !lane) return;
    const r = node.getBoundingClientRect();
    dragBadge.textContent = U.formatTC(clip.start, S.project.fps);
    dragBadge.style.left = Math.round(r.left + 8) + 'px';
    dragBadge.style.top = Math.max(4, Math.round(r.top - 22)) + 'px';
    dragBadge.classList.add('on');
  }
  function hideDragBadge() {
    if (dragBadge) { dragBadge.remove(); dragBadge = null; }
  }
  function onDragUp(e) {
    if (!drag) return;
    hideDragBadge();
    if (drag.lpTimer) { clearTimeout(drag.lpTimer); drag.lpTimer = null; }
    if (drag.kfTimer) { clearTimeout(drag.kfTimer); drag.kfTimer = null; }
    if (drag.kfFired) { drag = null; render(); return; }
    const node = clipEls.get(drag.id); if (node) node.classList.remove('drag-src');
    if (drag.longPressed) { drag = null; render(); return; }
    if (drag.started) S.end();
    drag = null;
    S.playhead = U.snapTime(S.playhead, S.project.fps);
    renderAll();
  }
  function onKeyStripDown(e) {
    if (e.target.closest('.clip-key')) return; // diamond handles its own drag
    const strip = e.currentTarget, node = strip.closest('.tl-clip'); if (!node) return;
    e.stopPropagation(); e.preventDefault();
    const c = S.findClip(node.dataset.clipId); if (!c) return;
    const r = strip.getBoundingClientRect();
    const local = (e.clientX - r.left) / S.zoom;
    S.change('Ключевой кадр', () => S.addKey(c, S.activeParam, local, S.valueAt(c, S.activeParam, local)));
    renderAll();
  }
  function startPan(e) {
    const sx = e.clientX, sy = e.clientY, sl = tlScroll.scrollLeft, st = tlScroll.scrollTop;
    const move = ev => { tlScroll.scrollLeft = sl - (ev.clientX - sx); tlScroll.scrollTop = st - (ev.clientY - sy); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }
  function onWheel(e) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const factor = e.deltaY > 0 ? .85 : 1.18;
      const before = (e.clientX - tlRuler.getBoundingClientRect().left) / S.zoom;
      setZoom(S.zoom * factor);
      const after = (e.clientX - tlRuler.getBoundingClientRect().left) / S.zoom;
      tlScroll.scrollLeft += (before - after) * S.zoom;
    } else if (e.shiftKey) { e.preventDefault(); tlScroll.scrollLeft += e.deltaY; }
  }

  /* =============================== drag & drop from bin =============================== */
  function onTrackDragOver(e) {
    const lane = e.target.closest('.tl-lane'); if (!lane) return;
    const types = Array.from(e.dataTransfer.types || []);
    if (types.includes('text/ppe-media') || types.includes('text/ppe-effect') || types.includes('Files') || types.includes('text/plain')) {
      e.preventDefault(); e.dataTransfer.dropEffect = types.includes('Files') ? 'copy' : 'copy';
      $$('.tl-lane.drop-target').forEach(n => n.classList.remove('drop-target'));
      lane.classList.add('drop-target');
    }
  }
  function onTrackDragLeave(e) {
    if (!e.relatedTarget || !e.relatedTarget.closest || !e.relatedTarget.closest('.tl-lane')) $$('.tl-lane.drop-target').forEach(n => n.classList.remove('drop-target'));
  }
  function onTrackDrop(e) {
    const lane = e.target.closest('.tl-lane'); if (!lane) return;
    e.preventDefault();
    $$('.tl-lane.drop-target').forEach(n => n.classList.remove('drop-target'));
    const t = Math.max(0, (e.clientX - lane.getBoundingClientRect().left) / S.zoom);
    const trackId = lane.dataset.trackId;
    const fx = e.dataTransfer.getData('text/ppe-effect');
    if (fx) {
      const clipNode = e.target.closest('.tl-clip');
      const ids = clipNode ? [clipNode.dataset.clipId] : Array.from(S.selection);
      if (!ids.length) { U.toast('Выберите клип или бросьте эффект прямо на него', 'warn'); return; }
      S.change('Применение эффекта', () => ids.forEach(cid => { const c = S.findClip(cid); if (c) S.applyEffect(c, fx); }));
      renderAll(); return;
    }
    const id = e.dataTransfer.getData('text/ppe-media') || e.dataTransfer.getData('text/plain');
    if (id && S.findMedia(id)) { placeMedia(id, trackId, t); return; }
    if (e.dataTransfer.files && e.dataTransfer.files.length) {
      M.importFiles(e.dataTransfer.files, { silentSource: true }).then(list => { if (list.length) placeMedia(list[0].id, pickCompatibleTrack(trackId, list[0].type), t); });
    }
  }
  function pickCompatibleTrack(trackId, type) {
    const t = S.findTrack(trackId);
    if (!t) return targetTrack(type === 'audio' ? 'audio' : 'video').id;
    if ((type === 'audio') === (t.type === 'audio')) return trackId;
    return (targetTrack(type === 'audio' ? 'audio' : 'video') || t).id;
  }

  /* =============================== edit operations =============================== */
  function placeMedia(mediaId, trackId, start, opts) {
    const m = S.findMedia(mediaId); if (!m) return null;
    const track = S.findTrack(trackId) || targetTrack(m.type === 'audio' ? 'audio' : 'video');
    if (!track) { U.toast('Нет подходящей дорожки', 'error'); return null; }
    if (track.locked) { U.toast('Дорожка заблокирована', 'warn'); return null; }
    const c = S.newClip(mediaId, track.id, Math.max(0, start), opts);
    S.change('Добавление клипа', () => {
      track.clips.push(c);
      // overwrite collisions on the same track
      resolveCollisions(track, c);
      S.selection.clear(); S.selection.add(c.id);
    });
    renderAll();
    U.status('Клип добавлен: ' + c.name, null, true);
    return c;
  }
  function resolveCollisions(track, newClip) {
    const end = S.clipEnd(newClip);
    const keep = [];
    track.clips.forEach(c => {
      if (c.id === newClip.id) { keep.push(c); return; }
      const ce = S.clipEnd(c);
      if (ce <= newClip.start + .001 || c.start >= end - .001) { keep.push(c); return; }
      // allow small overlap for transitions
      if (newClip.transitionIn > 0 && ce - newClip.start <= newClip.transitionIn + .001) { keep.push(c); return; }
      if (c.start < newClip.start) { const left = cloneClip(c); left.outPoint = c.inPoint + (newClip.start - c.start) * c.speed; if (left.outPoint > left.inPoint + .001) keep.push(left); }
      if (ce > end) { const right = cloneClip(c); const off = (end - c.start) * c.speed; right.inPoint = c.inPoint + off; right.start = end; shiftKeys(right, end - c.start, false); if (right.outPoint > right.inPoint + .001) keep.push(right); }
    });
    track.clips = keep;
  }
  function insertSource(mode) {
    const m = S.findMedia(S.source.mediaId);
    if (!m) { U.toast('Сначала откройте клип в исходном мониторе', 'warn'); return; }
    if (m.offline) { U.toast('Файл недоступен — «Файл → Найти медиа»', 'warn'); return; }
    const srcIn = S.source.inPoint, srcOut = S.source.outPoint;
    let dur = Math.max(1 / S.project.fps, (srcOut - srcIn));
    if (m.generated) dur = Math.min(dur, 3600);
    const audioOnly = $('#sourceAudioOnly') && $('#sourceAudioOnly').checked;
    let track;
    if (m.type === 'audio' || audioOnly) track = targetTrack('audio');
    else track = targetTrack('video');
    if (!track) { U.toast('Нет подходящей дорожки', 'error'); return; }
    let start = mode === 'append' ? S.sequenceDuration() : S.playhead;
    start = Math.max(0, U.snapTime(start, S.project.fps));
    S.change('Вставка из исходного монитора', () => {
      if (mode === 'insert') {
        S.project.tracks.forEach(t => t.clips.forEach(c => { if (c.start >= start - .001) c.start += dur; }));
      } else if (mode === 'overwrite') {
        cutRegion(track, start, start + dur);
      }
      const c = S.newClip(m.id, track.id, start, { inPoint: srcIn, outPoint: srcIn + dur, generatedDuration: 5 });
      if (audioOnly) c.audio.volume = 100;
      track.clips.push(c);
      if (mode !== 'insert') resolveCollisions(track, c);
      S.selection.clear(); S.selection.add(c.id);
      if (mode !== 'insert') S.playhead = start;
    });
    renderAll();
    U.status('Вставлено: ' + U.formatTC(dur, S.project.fps), null, true);
  }
  function cutRegion(track, start, end) {
    const result = [];
    track.clips.forEach(c => {
      const ce = S.clipEnd(c);
      if (ce <= start + .0001 || c.start >= end - .0001) { result.push(c); return; }
      if (c.start < start - .0001) { const left = cloneClip(c); left.outPoint = c.inPoint + (start - c.start) * c.speed; if (left.outPoint > left.inPoint + .0001) result.push(left); }
      if (ce > end + .0001) {
        const right = cloneClip(c);
        const off = (end - c.start) * c.speed;
        right.inPoint = c.inPoint + off; right.start = end;
        shiftKeys(right, end - c.start, false);
        if (right.outPoint > right.inPoint + .0001) result.push(right);
      }
    });
    track.clips = result;
  }
  function splitAt(time, ids) {
    let count = 0;
    const f = 1 / S.project.fps;
    S.project.tracks.forEach(track => {
      const out = [];
      track.clips.forEach(c => {
        const end = S.clipEnd(c);
        if ((ids && !ids.has(c.id)) || time <= c.start + f * .5 || time >= end - f * .5) { out.push(c); return; }
        const local = time - c.start;
        const srcSplit = c.inPoint + local * c.speed;
        const right = cloneClip(c);
        right.start = time; right.inPoint = srcSplit; right.outPoint = c.outPoint;
        right.transitionIn = 0; right.keys = {};
        Object.keys(c.keys || {}).forEach(path => {
          const vSplit = S.valueAt(c, path, local);
          const before = c.keys[path].filter(k => k.t < local).map(k => JSON.parse(JSON.stringify(k)));
          const after = c.keys[path].filter(k => k.t >= local).map(k => Object.assign({}, k, { t: k.t - local }));
          c.keys[path] = before.concat([{ t: local, v: vSplit, easing: 'linear' }]);
          right.keys[path] = [{ t: 0, v: vSplit, easing: 'linear' }].concat(after);
        });
        c.outPoint = srcSplit;
        c.transitionOut = 0;
        out.push(c, right);
        count++;
      });
      track.clips = out;
    });
    return count;
  }
  function splitSelected() {
    const t = S.playhead;
    const ids = S.selection.size ? new Set(S.selection) : null;
    let n = 0;
    S.change('Разрезание клипов', () => { n = splitAt(t, ids); });
    renderAll();
    U.status(n ? 'Разрезано клипов: ' + n : 'В точке курсора нет клипов', null, true);
  }
  function deleteSelected(ripple) {
    if (!S.selection.size) { U.toast('Не выбрано ни одного клипа', 'warn'); return; }
    const ids = withLinks(new Set(S.selection));
    S.change(ripple ? 'Удаление со сдвигом' : 'Удаление клипов', () => {
      const removed = [];
      S.project.tracks.forEach(t => {
        t.clips.forEach(c => { if (ids.has(c.id)) removed.push({ track: t, start: c.start, dur: S.clipDuration(c) }); });
        t.clips = t.clips.filter(c => !ids.has(c.id));
      });
      if (ripple) {
        removed.sort((a, b) => b.start - a.start);
        removed.forEach(r => r.track.clips.forEach(c => { if (c.start >= r.start + r.dur - .001) c.start = Math.max(0, c.start - r.dur); }));
      }
      S.selection.clear();
    });
    renderAll();
  }
  function duplicate() {
    if (!S.selection.size) { U.toast('Сначала выберите клип', 'warn'); return; }
    const ids = withLinks(new Set(S.selection));
    const minStart = Math.min(...Array.from(ids).map(id => { const c = S.findClip(id); return c ? c.start : 0; }));
    const maxEnd = Math.max(...Array.from(ids).map(id => { const c = S.findClip(id); return c ? S.clipEnd(c) : 0; }));
    const delta = maxEnd - minStart;
    S.change('Дублирование клипов', () => {
      S.selection.clear();
      S.allClips().forEach(c => {
        if (!ids.has(c.id)) return;
        const n = cloneClip(c); n.start += delta; n.effects = JSON.parse(JSON.stringify(c.effects || []));
        n.linkedTo = null;
        const t = S.findTrack(c.trackId); t.clips.push(n); S.selection.add(n.id);
      });
    });
    renderAll();
  }
  function copySelected() {
    const ids = withLinks(new Set(S.selection));
    S.clipboard = S.allClips().filter(c => ids.has(c.id)).map(c => JSON.parse(JSON.stringify(c)));
    U.status('Скопировано клипов: ' + S.clipboard.length, null, true);
  }
  function cutSelected() { copySelected(); deleteSelected(false); }
  function paste() {
    if (!S.clipboard.length) { U.toast('Буфер обмена пуст', 'warn'); return; }
    const base = Math.min(...S.clipboard.map(c => c.start));
    S.change('Вставка клипов', () => {
      S.selection.clear();
      S.clipboard.forEach(c => {
        const n = cloneClip(c);
        n.start = Math.max(0, S.playhead + (c.start - base));
        n.linkedTo = null;
        const t = S.findTrack(n.trackId) || targetTrack('video');
        n.trackId = t.id; t.clips.push(n); S.selection.add(n.id);
      });
    });
    renderAll();
  }
  function extract() {
    const a = S.project.seqIn, b = S.project.seqOut;
    if (b <= a) { U.toast('Сначала задайте точки входа и выхода последовательности', 'warn'); return; }
    S.change('Изъятие фрагмента', () => {
      S.project.tracks.forEach(t => {
        cutRegion(t, a, b);
        t.clips.forEach(c => { if (c.start >= b - .001) c.start = Math.max(a, c.start - (b - a)); });
      });
      S.playhead = a; S.project.seqIn = 0; S.project.seqOut = 0;
    });
    renderAll();
  }
  function lift() {
    const a = S.project.seqIn, b = S.project.seqOut;
    if (b <= a) { U.toast('Сначала задайте точки входа и выхода', 'warn'); return; }
    S.change('Подъём фрагмента', () => { S.project.tracks.forEach(t => cutRegion(t, a, b)); });
    renderAll();
  }
  function selectAll() { S.selection = new Set(S.allClips().map(c => c.id)); render(); if (PPE.panels) PPE.panels.renderEffectControls(); }
  function nudgeSelected(frames) {
    if (!S.selection.size) { PPE.engine.step(frames); return; }
    const d = frames / S.project.fps;
    S.change('Сдвиг клипов', () => S.allClips().forEach(c => { if (S.selection.has(c.id)) c.start = Math.max(0, c.start + d); }));
    renderAll();
  }
  function addTrackUI(type) {
    S.change('Добавление дорожки', () => { const t = S.addTrack(type); S.renameTracks(); t.target = true; S.project.tracks.forEach(x => { if (x.type === type && x.id !== t.id) x.target = false; }); });
    renderAll();
  }
  function deleteTrack(id) {
    const t = S.findTrack(id); if (!t) return;
    if (t.clips.length && !confirm('На дорожке «' + t.name + '» есть клипы. Удалить вместе с ними?')) return;
    S.change('Удаление дорожки', () => { S.removeTrack(id); S.renameTracks(); });
    renderAll();
  }
  function addMarkerAt(time) {
    time = U.snapTime(time, S.project.fps);
    U.modal({
      title: 'Новый маркер', icon: 'marker',
      body: '<div class="form-row"><label>Имя</label><div class="form-control"><input type="text" id="mkName" value="Маркер ' + ((S.project.markers || []).length + 1) + '"></div></div>' +
        '<div class="form-row"><label>Время</label><div class="form-control"><input type="text" id="mkTime" value="' + U.formatTC(time, S.project.fps) + '"></div></div>' +
        '<div class="form-row"><label>Комментарий</label><div class="form-control"><textarea id="mkComment" placeholder="Необязательно"></textarea></div></div>',
      buttons: [{ label: 'Отмена' }, { label: 'Добавить', class: 'primary', action: (b) => {
        const t = U.parseTC($('#mkTime', b).value, S.project.fps);
        S.change('Добавление маркера', () => {
          S.project.markers.push({ id: uid('mk'), time: t == null ? time : t, name: $('#mkName', b).value || 'Маркер', comment: $('#mkComment', b).value || '' });
          S.project.markers.sort((x, y) => x.time - y.time);
        });
        renderAll();
      } }]
    });
  }
  function removeMarker(id) { S.change('Удаление маркера', () => { S.project.markers = S.project.markers.filter(m => m.id !== id); }); renderAll(); }
  function renameClip(c) {
    if (!c) return;
    U.modal({
      title: 'Переименовать клип', icon: 'text',
      body: '<div class="form-row"><label>Имя</label><div class="form-control"><input type="text" id="clName" value="' + U.escapeHtml(c.name) + '"></div></div>',
      buttons: [{ label: 'Отмена' }, { label: 'ОК', class: 'primary', action: (b) => { const v = $('#clName', b).value.trim(); if (v) { S.change('Переименование клипа', () => c.name = v); renderAll(); } } }]
    });
  }
  function speedDialog(c) {
    if (!c) { U.toast('Выберите клип', 'warn'); return; }
    U.modal({
      title: 'Скорость и длительность', icon: 'speed',
      body: '<div class="form-row"><label>Скорость</label><div class="form-control"><input type="number" id="spVal" min="5" max="2000" step="5" value="' + Math.round(c.speed * 100) + '"><span class="unit">%</span></div></div>' +
        '<div class="form-row"><label>Новая длительность</label><div class="form-control"><input type="text" id="spDur" value="' + U.formatTC(S.clipDuration(c), S.project.fps) + '"><span class="unit">ТК</span></div></div>' +
        '<div class="form-note">Изменение скорости меняет длительность клипа и высоту звука (звук воспроизводится браузером с той же скоростью).</div>',
      buttons: [{ label: 'Отмена' }, { label: 'Применить', class: 'primary', action: (b) => {
        const pct = parseFloat($('#spVal', b).value);
        const dur = U.parseTC($('#spDur', b).value, S.project.fps);
        S.change('Изменение скорости', () => {
          if (isFinite(pct) && pct > 0) c.speed = pct / 100;
          if (dur != null && dur > 0) {
            const len = (c.outPoint - c.inPoint);
            c.speed = len / dur;
            c.outPoint = c.inPoint + dur * c.speed;
          }
          c.speed = clamp(c.speed, .05, 20);
        });
        renderAll();
      } }]
    });
  }
  function applyEffectToSelected(id) {
    if (!S.selection.size) { U.toast('Сначала выберите клип', 'warn'); return; }
    S.change('Применение эффекта', () => {
      S.selection.forEach(cid => { const c = S.findClip(cid); if (c) S.applyEffect(c, id); });
    });
    renderAll();
  }
  function addKeyAtPlayhead() {
    if (!S.selection.size) { U.toast('Сначала выберите клип', 'warn'); return; }
    S.change('Ключевой кадр', () => S.selection.forEach(cid => {
      const c = S.findClip(cid); if (!c) return;
      const local = clamp(S.playhead - c.start, 0, S.clipDuration(c));
      S.addKey(c, S.activeParam, local, S.valueAt(c, S.activeParam, local));
    }));
    renderAll();
  }
  function removeKeyAtPlayhead() {
    if (!S.selection.size) return;
    S.change('Удаление ключевого кадра', () => S.selection.forEach(cid => {
      const c = S.findClip(cid); if (c) S.removeKeyAt(c, S.activeParam, S.playhead - c.start);
    }));
    renderAll();
  }
  /** Диапазон клипа содержит точку воспроизведения? */
  function playheadInside(clip) {
    return !!clip && S.playhead >= clip.start - 1e-6 && S.playhead <= S.clipEnd(clip) + 1e-6;
  }
  function paramLabel(path) {
    return (PPE.panels && PPE.panels.paramLabel) ? PPE.panels.paramLabel(path) : path;
  }
  /**
   * Кнопка «ключевой кадр» в стиле CapCut: ставит или снимает ключ активного
   * параметра ровно в точке воспроизведения. Раньше ключ ставился по устаревшей
   * позиции панели, из-за чего второй ключ затирал первый.
   */
  const KEY_PATHS = ['transform.x', 'transform.y', 'transform.scale', 'transform.rotation', 'transform.opacity'];
  function toggleKeyAtPlayhead() {
    const clip = S.findClip(Array.from(S.selection)[0]);
    if (!clip) { U.toast('Сначала выберите клип на таймлайне', 'warn', 2200); return; }
    if (!playheadInside(clip)) { U.toast('Поставьте курсор внутри выбранного клипа', 'warn', 2400); return; }
    const local0 = clamp(S.playhead - clip.start, 0, S.clipDuration(clip));
    const has = S.keysAtTime(clip, local0).length > 0;
    let added = 0, removed = 0;
    S.change(has ? 'Удаление ключевого кадра' : 'Ключевой кадр', () => {
      S.selection.forEach(cid => {
        const c = S.findClip(cid); if (!c || !playheadInside(c)) return;
        const local = clamp(S.playhead - c.start, 0, S.clipDuration(c));
        if (has) { removed += S.keysAtTime(c, local).length; S.removeKeysAtTime(c, local); }
        else {
          // Первый ключ делает анимированными все параметры трансформации —
          // дальше картинку можно просто двигать в кадре (см. превью).
          const paths = S.hasKeys(c) ? S.allKeyParams(c) : KEY_PATHS;
          S.addKeysAtTime(c, local, paths);
          added += paths.length;
        }
      });
    });
    renderAll();
    U.toast(has ? 'Ключевой кадр удалён' : 'Ключевой кадр поставлен — двигайте картинку в превью',
      has ? 'warn' : 'success', 1800);
    updateKeyButton();
  }
  /** Индикация кнопки ключевого кадра (заполненный ромб = ключ уже есть в этой точке). */
  let lastKeyBtnSig = '';
  function updateKeyButton() {
    const btn = $('#kfAddBtn'), mbtn = $('#mKey');
    if (!btn && !mbtn) return;
    const clip = S.findClip(Array.from(S.selection)[0]);
    const inside = playheadInside(clip);
    const has = !!(inside && S.keysAtTime(clip, S.playhead - clip.start).length > 0);
    const sig = (clip ? clip.id : '-') + '|' + S.activeParam + '|' + (inside ? Math.round((S.playhead - clip.start) * 100) : 'x') + '|' + has;
    if (sig === lastKeyBtnSig) return;
    lastKeyBtnSig = sig;
    const title = (has ? 'Удалить ключевой кадр' : 'Поставить ключевой кадр') + ' (Shift+K)';
    if (btn) {
      btn.classList.toggle('at-kf', has);
      btn.classList.toggle('off', !clip || !inside);
      const use = btn.querySelector('use'); if (use) use.setAttribute('href', has ? '#i-diamond' : '#i-diamond-o');
      btn.title = title;
    }
    if (mbtn) mbtn.classList.toggle('on', has);
  }
  function jumpKey(dir) {
    const c = S.findClip(Array.from(S.selection)[0]); if (!c) return;
    const keys = (c.keys && c.keys[S.activeParam] || []).slice().sort((a, b) => a.t - b.t);
    const local = S.playhead - c.start;
    const k = dir > 0 ? keys.find(x => x.t > local + .002) : keys.slice().reverse().find(x => x.t < local - .002);
    if (k) PPE.engine.seek(c.start + k.t);
  }
  function setZoom(z) {
    S.zoom = clamp(Math.round(z * 10) / 10, 4, 320);
    const sl = $('#zoomSlider'); if (sl) sl.value = S.zoom;
    S.markDirty(); render();
  }
  function fitZoom() {
    const avail = Math.max(300, tlScroll.clientWidth - HEAD - 20);
    setZoom(avail / Math.max(1, S.sequenceDuration()));
  }
  function gotoPlayhead() { tlScroll.scrollLeft = Math.max(0, HEAD + S.playhead * S.zoom - tlScroll.clientWidth / 2); }
  function setTool(tool) { S.tool = tool; updateFoot(); if (PPE.panels) PPE.panels.renderEffectControls(); }
  function renderAll() { if (PPE.renderAll) PPE.renderAll(); else { render(); if (PPE.panels) PPE.panels.renderEffectControls(); } }

  PPE.timeline = {
    init, render, updatePlayhead, updateClipElements, setZoom, fitZoom, gotoPlayhead, setTool,
    placeMedia, insertSource, splitAt, splitSelected, deleteSelected, duplicate, copySelected, cutSelected,
    paste, extract, lift, selectAll, nudgeSelected, addTrackUI, deleteTrack, addMarkerAt, removeMarker,
    speedDialog, applyEffectToSelected, addKeyAtPlayhead, removeKeyAtPlayhead, toggleKeyAtPlayhead, updateKeyButton, jumpKey, clipMenuItems,
    detachAudio, withLinks, targetTrack, renderClip, snapValue, snapCandidates,
    openKeyMenu, keyCurveMenu, keyCurveDialog, applyKeyToClipDialog
  };
})(window);
