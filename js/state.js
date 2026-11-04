/* =========================================================================
   state.js — project model, history, persistence, effects catalog
   ========================================================================= */
(function (root) {
  'use strict';
  const PPE = root.PPE = root.PPE || {};
  const U = PPE.utils;
  const clamp = U.clamp, uid = U.uid, deep = (o) => JSON.parse(JSON.stringify(o));
  const STORAGE_KEY = 'frameforge.project.v3';

  /* --------------------------------- defaults --------------------------------- */
  function defaultTransform() { return { x: 0, y: 0, scale: 100, rotation: 0, opacity: 100, fit: 'fit', flipH: false, flipV: false }; }
  function defaultColor() { return { brightness: 100, contrast: 100, saturate: 100, blur: 0, grayscale: 0, sepia: 0, hue: 0, vignette: 0 }; }
  function defaultAudio() { return { volume: 100, pan: 0, fadeIn: 0, fadeOut: 0 }; }

  function makeTrack(type, name, opts) {
    return Object.assign({
      id: uid('tr'), type: type, name: name, height: type === 'video' ? 58 : 48,
      clips: [], muted: false, solo: false, locked: false, hidden: false, gain: 1, target: false,
      syncLock: true, heightLocked: false, x: {}
    }, opts || {});
  }
  function defaultProject() {
    return {
      name: 'Без имени',
      width: 1920, height: 1080, fps: 30, audioRate: 48000,
      media: [], markers: [], seqIn: 0, seqOut: 0, x: {},
      tracks: [
        makeTrack('video', 'V3'),
        makeTrack('video', 'V2'),
        makeTrack('video', 'V1', { target: true }),
        makeTrack('audio', 'A1', { target: true }),
        makeTrack('audio', 'A2'),
        makeTrack('audio', 'A3')
      ]
    };
  }
  function defaultTextData() {
    return {
      text: 'Ваш заголовок', font: 'Arial', size: 96, color: '#ffffff', bg: '#000000', bgOpacity: 0,
      align: 'center', bold: true, italic: false, shadow: true, x: 50, y: 50, letterSpacing: 0, lineHeight: 1.2
    };
  }

  /* --------------------------------- state --------------------------------- */
  const S = {
    project: defaultProject(),
    playhead: 0, zoom: 40, fps: 30, rate: 1, playing: false, exporting: false,
    tool: 'select',
    selection: new Set(),
    selectedMedia: null,
    source: { mediaId: null, inPoint: 0, outPoint: 0, position: 0, playing: false, loop: false },
    settings: { snap: true, safeMargins: false, waveforms: true, linkAV: true, showThumbnails: true, autoSave: true, audioPreview: true, autoKey: true, previewQuality: 'auto' },
    activeParam: 'transform.opacity',
    clipboard: [],
    mediaView: 'grid',
    effectSearch: '',
    relinkNeeded: false,
    dirty: false
  };
  PPE.state = S;

  /* --------------------------------- model helpers --------------------------------- */
  function clipDuration(c) { return Math.max(0.001, (c.outPoint - c.inPoint) / (c.speed || 1)); }
  function clipEnd(c) { return c.start + clipDuration(c); }
  function allClips() { const out = []; S.project.tracks.forEach(t => t.clips.forEach(c => out.push(c))); return out; }
  function findClip(id) { for (const t of S.project.tracks) { const c = t.clips.find(x => x.id === id); if (c) return c; } return null; }
  function findTrack(id) { return S.project.tracks.find(t => t.id === id) || null; }
  function trackOf(clip) { return findTrack(clip.trackId); }
  function findMedia(id) { return S.project.media.find(m => m.id === id) || null; }
  function sequenceDuration() {
    let d = 0;
    S.project.tracks.forEach(t => t.clips.forEach(c => { d = Math.max(d, clipEnd(c)); }));
    return Math.max(d, S.project.seqOut || 0, 10);
  }
  function sourceDuration(media) {
    if (!media) return 0;
    if (media.generated) return 3600;
    return Math.max(0.04, media.duration || 0);
  }

  function newClip(mediaId, trackId, start, opts) {
    const media = findMedia(mediaId);
    const track = findTrack(trackId);
    opts = opts || {};
    const dur = media && media.generated ? (opts.generatedDuration || 5) : sourceDuration(media);
    const c = {
      id: uid('clip'), mediaId: mediaId, trackId: trackId, start: Math.max(0, start || 0),
      inPoint: 0, outPoint: dur, speed: 1, name: media ? media.name : 'Клип',
      transform: defaultTransform(), color: defaultColor(), audio: defaultAudio(),
      keys: {}, effects: [], transitionIn: 0, transitionOut: 0,
      disabled: false, labelColor: null, x: {}
    };
    if (opts.inPoint != null) c.inPoint = opts.inPoint;
    if (opts.outPoint != null) c.outPoint = opts.outPoint;
    if (opts.speed != null) c.speed = opts.speed;
    if (opts.name) c.name = opts.name;
    if (opts.start != null) c.start = opts.start;
    if (track && track.type === 'audio' && media && media.type === 'video') c.audio.volume = 100;
    if (media && media.type === 'audio') c.transform = defaultTransform();
    return c;
  }

  function addTrack(type, atIndex) {
    const list = S.project.tracks.filter(t => t.type === type);
    const name = type === 'video' ? 'V' + (list.length + 1) : 'A' + (list.length + 1);
    const t = makeTrack(type, name);
    const lastIdx = S.project.tracks.map((x, i) => x.type === type ? i : -1).filter(i => i >= 0).pop();
    // Video tracks are numbered bottom-up (V1 at the bottom), so a new one goes on top.
    // Audio tracks are numbered top-down (A1 at the top), so a new one goes at the bottom.
    const idx = atIndex != null ? atIndex : (type === 'video' ? 0 : (lastIdx == null ? S.project.tracks.length : lastIdx + 1));
    S.project.tracks.splice(idx, 0, t);
    return t;
  }
  function removeTrack(id) {
    const i = S.project.tracks.findIndex(t => t.id === id);
    if (i < 0) return false;
    S.project.tracks.splice(i, 1);
    return true;
  }
  function renameTracks() {
    let v = 0;
    S.project.tracks.slice().reverse().forEach(t => {
      if (t.type === 'video') { v++; if (/^V\d+$/.test(t.name)) t.name = 'V' + v; }
    });
    let a = 0;
    S.project.tracks.forEach(t => {
      if (t.type === 'audio') { a++; if (/^A\d+$/.test(t.name)) t.name = 'A' + a; }
    });
  }

  /* --------------------------------- keyframes --------------------------------- */
  function getBase(clip, path) {
    const [section, key] = path.split('.');
    if (section === 'speed') return clip.speed;
    return clip[section] ? clip[section][key] : undefined;
  }
  function setBase(clip, path, value) {
    const [section, key] = path.split('.');
    if (section === 'speed') { clip.speed = Math.max(0.05, Math.min(20, value)); return; }
    if (clip[section]) clip[section][key] = value;
  }
  /* Решатель cubic-bezier для кривых ключевых кадров: easing = 'bezier:x1,y1,x2,y2'. */
  function bezierSolve(c, t) {
    const [x1, y1, x2, y2] = c;
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const fx = u => ((ax * u + bx) * u + cx) * u, fy = u => ((ay * u + by) * u + cy) * u;
    let u = t;
    for (let i = 0; i < 12; i++) {
      const x = fx(u) - t; if (Math.abs(x) < 1e-5) return fy(u);
      const d = (3 * ax * u + 2 * bx) * u + cx; if (Math.abs(d) < 1e-6) break;
      u = clamp(u - x / d, 0, 1);
    }
    let lo = 0, hi = 1; u = t;
    for (let i = 0; i < 20; i++) { const x = fx(u); if (Math.abs(x - t) < 1e-5) break; if (x > t) hi = u; else lo = u; u = (lo + hi) / 2; }
    return fy(u);
  }
  function ease(a, b, t, type) {
    if (type === 'hold') return a;
    if (type === 'ease') t = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    else if (typeof type === 'string' && type.indexOf('bezier:') === 0) {
      const c = type.slice(7).split(',').map(Number);
      if (c.length === 4 && c.every(n => isFinite(n))) t = bezierSolve(c, clamp(t, 0, 1));
    }
    return a + (b - a) * t;
  }
  function valueAt(clip, path, localTime) {
    const base = getBase(clip, path);
    const arr = clip.keys && clip.keys[path];
    if (!arr || !arr.length) return base;
    const keys = arr.slice().sort((x, y) => x.t - y.t);
    const t = clamp(localTime, -1e9, 1e9);
    if (t <= keys[0].t) return keys[0].v;
    if (t >= keys[keys.length - 1].t) return keys[keys.length - 1].v;
    for (let i = 0; i < keys.length - 1; i++) {
      const k1 = keys[i], k2 = keys[i + 1];
      if (t >= k1.t && t <= k2.t) {
        const f = (t - k1.t) / Math.max(1e-6, k2.t - k1.t);
        const v = ease(k1.v, k2.v, f, k1.easing);
        return typeof base === 'number' ? v : v;
      }
    }
    return base;
  }
  function addKey(clip, path, localTime, value, easing) {
    clip.keys = clip.keys || {};
    const arr = clip.keys[path] = clip.keys[path] || [];
    const t = clamp(localTime, 0, clipDuration(clip));
    const existing = arr.find(k => Math.abs(k.t - t) < 0.0005);
    if (existing) { existing.v = value != null ? value : getBase(clip, path); if (easing) existing.easing = easing; }
    else arr.push({ t: t, v: value != null ? value : getBase(clip, path), easing: easing || 'linear' });
    arr.sort((a, b) => a.t - b.t);
    return arr;
  }
  function removeKeyAt(clip, path, localTime) {
    const arr = clip.keys && clip.keys[path]; if (!arr) return;
    const i = arr.findIndex(k => Math.abs(k.t - localTime) < 0.02);
    if (i >= 0) arr.splice(i, 1);
    if (!arr.length) delete clip.keys[path];
  }
  function findKeyAt(clip, path, localTime) {
    const arr = clip.keys && clip.keys[path]; if (!arr) return null;
    return arr.find(k => Math.abs(k.t - localTime) < 0.02) || null;
  }
  function setClipParam(clip, path, value, localTime, keyframed) {
    /* Один ключ на параметр = значение действует на весь клип: правка в любой
       точке меняет этот единственный ключ, а не создаёт второй. */
    const one = clip.keys && clip.keys[path];
    if (one && one.length === 1) { one[0].v = value; return one[0]; }
    if (keyframed || (clip.keys && clip.keys[path] && clip.keys[path].length)) {
      if (localTime == null) localTime = S.playhead - clip.start;
      addKey(clip, path, localTime, value);
    } else setBase(clip, path, value);
  }
  function allKeyParams(clip) { return Object.keys(clip.keys || {}); }
  /** Все моменты времени, где у клипа есть ключи (по любому параметру) — «ромбики» как в CapCut. */
  function allKeyTimes(clip) {
    const set = new Map();
    allKeyParams(clip).forEach(p => (clip.keys[p] || []).forEach(k => {
      const key = Math.round(k.t * 1000) / 1000;
      set.set(key, (set.get(key) || 0) + 1);
    }));
    return Array.from(set.keys()).sort((a, b) => a - b);
  }
  function keysAtTime(clip, t, tol) {
    const out = [];
    const lim = tol == null ? 0.02 : tol;
    allKeyParams(clip).forEach(p => (clip.keys[p] || []).forEach(k => {
      if (Math.abs(k.t - t) <= lim) out.push({ path: p, key: k });
    }));
    return out;
  }
  function removeKeysAtTime(clip, t) {
    keysAtTime(clip, t).forEach(item => {
      const arr = clip.keys[item.path]; if (!arr) return;
      const i = arr.indexOf(item.key); if (i >= 0) arr.splice(i, 1);
      if (!arr.length) delete clip.keys[item.path];
    });
  }
  function addKeysAtTime(clip, t, paths) {
    (paths || []).forEach(p => addKey(clip, p, t, valueAt(clip, p, t)));
  }
  /** Есть ли у клипа хоть какая-то анимация ключами. */
  function hasKeys(clip) { return allKeyParams(clip).length > 0; }

  /* --------------------------------- serialization --------------------------------- */
  function cleanProject(p, keepUrls) {
    return {
      name: p.name, width: p.width, height: p.height, fps: p.fps, audioRate: p.audioRate,
      markers: deep(p.markers || []), seqIn: p.seqIn || 0, seqOut: p.seqOut || 0,
      x: p.x ? deep(p.x) : {},
      media: (p.media || []).map(m => ({
        id: m.id, name: m.name, type: m.type, duration: m.duration, width: m.width, height: m.height,
        thumb: m.thumb || null, hasAudio: !!m.hasAudio, generated: !!m.generated, data: m.data ? deep(m.data) : null,
        fileName: m.fileName || null,
        offline: keepUrls ? !!m.offline && !m.generated : !m.generated,
        url: keepUrls && !m.generated ? (m.url || null) : null,
        fps: m.fps || 0, x: m.x ? deep(m.x) : {}
      })),
      tracks: p.tracks.map(t => ({
        id: t.id, type: t.type, name: t.name, height: t.height, muted: !!t.muted, solo: !!t.solo,
        locked: !!t.locked, hidden: !!t.hidden, gain: t.gain == null ? 1 : t.gain, target: !!t.target,
        syncLock: t.syncLock !== false, x: t.x ? deep(t.x) : {},
        clips: t.clips.map(c => deep({
          id: c.id, mediaId: c.mediaId, trackId: t.id, start: c.start, inPoint: c.inPoint, outPoint: c.outPoint,
          speed: c.speed, name: c.name, transform: c.transform, color: c.color, audio: c.audio,
          keys: c.keys, effects: c.effects, transitionIn: c.transitionIn, transitionOut: c.transitionOut,
          disabled: !!c.disabled, labelColor: c.labelColor, linkedTo: c.linkedTo || null,
          x: c.x ? deep(c.x) : {}
        }))
      }))
    };
  }
  /** keepUrls=true -> in-memory snapshots for undo/redo (blob URLs stay valid).
      keepUrls=false -> files for localStorage / exported .json (media marked offline). */
  function serialize(keepUrls) {
    return JSON.stringify({
      v: 3, project: cleanProject(S.project, keepUrls), playhead: S.playhead, zoom: S.zoom,
      settings: S.settings, source: { mediaId: S.source.mediaId, inPoint: S.source.inPoint, outPoint: S.source.outPoint }
    });
  }
  function rehydrate(obj) {
    if (!obj || !obj.project) throw new Error('Неверный файл проекта');
    const p = obj.project;
    S.project = Object.assign(defaultProject(), p);
    S.project.media = (p.media || []).map(m => Object.assign({
      width: 0, height: 0, hasAudio: false, generated: false, data: null, thumb: null, peaks: null,
      offline: !m.generated, url: null, file: null, fps: 0, x: {}
    }, m));
    S.project.tracks = (p.tracks && p.tracks.length ? p.tracks : defaultProject().tracks).map(t => {
      const base = makeTrack(t.type, t.name);
      const merged = Object.assign(base, t);
      merged.x = t.x || {}; merged.syncLock = t.syncLock !== false;
      merged.clips = (t.clips || []).map(c => {
        const nc = Object.assign(newClip(c.mediaId, merged.id, c.start), c);
        nc.trackId = merged.id;
        nc.transform = Object.assign(defaultTransform(), c.transform || {});
        nc.color = Object.assign(defaultColor(), c.color || {});
        nc.audio = Object.assign(defaultAudio(), c.audio || {});
        nc.keys = c.keys || {}; nc.effects = c.effects || []; nc.x = c.x || {};
        return nc;
      });
      return merged;
    });
    S.project.markers = p.markers || [];
    S.fps = S.project.fps || 30;
    S.playhead = obj.playhead || 0;
    S.zoom = clamp(obj.zoom || 40, 4, 320);
    if (obj.settings) Object.assign(S.settings, obj.settings);
    if (obj.source) { S.source.mediaId = obj.source.mediaId; S.source.inPoint = obj.source.inPoint || 0; S.source.outPoint = obj.source.outPoint || 0; }
    S.selection.clear();
    S.relinkNeeded = S.project.media.some(m => !m.generated && m.offline);
    S.dirty = false;
  }

  // localStorage may be unavailable (file:// in some browsers, private mode, jsdom).
  // Fall back to an in-memory store so autosave/undo still behave during the session.
  const memStore = {};
  let storageWarned = false;
  function safeGet(key) { if (Object.prototype.hasOwnProperty.call(memStore, key)) return memStore[key]; try { return localStorage.getItem(key); } catch (e) { return null; } }
  function safeSet(key, val) {
    try { localStorage.setItem(key, val); delete memStore[key]; }
    catch (e) { memStore[key] = val; if (!storageWarned) { storageWarned = true; U.toast('Постоянное хранилище недоступно или заполнено. Скачайте проект JSON до закрытия страницы.', 'warn', 8000); } }
  }
  function safeDel(key) { delete memStore[key]; try { localStorage.removeItem(key); } catch (e) {} }
  let saveTimer = null;
  function persist(now) {
    if (!S.settings.autoSave) return;
    clearTimeout(saveTimer);
    const doSave = () => { safeSet(STORAGE_KEY, serialize()); S.dirty = false; U.bus.emit('projectSaved'); };
    if (now) doSave(); else saveTimer = setTimeout(doSave, 700);
  }
  function loadPersisted() {
    try { const raw = safeGet(STORAGE_KEY); if (raw) { rehydrate(JSON.parse(raw)); return true; } }
    catch (e) { console.warn('Load failed', e); }
    return false;
  }
  function clearPersisted() { safeDel(STORAGE_KEY); }
  function newProject() {
    S.project = defaultProject();
    S.playhead = 0; S.zoom = 40; S.fps = 30; S.rate = 1; S.playing = false;
    S.selection.clear(); S.selectedMedia = null;
    S.source = { mediaId: null, inPoint: 0, outPoint: 0, position: 0, playing: false, loop: false };
    S.relinkNeeded = false; S.clipboard = []; S.dirty = false;
    clearPersisted();
  }
  function exportProjectFile() {
    return JSON.stringify({ v: 3, app: 'FrameForge Studio', savedAt: new Date().toISOString(), project: cleanProject(S.project) }, null, 2);
  }

  /* --------------------------------- history --------------------------------- */
  const history = { undo: [], redo: [], pending: null, limit: 120, listeners: [] };
  S.history = history;
  // Полные снимки удобны для отмены, но при сотнях длинных штрихов
  // не должны занимать сотни мегабайт на телефоне.
  function trimHistory(stack) {
    const cap=20*1024*1024;let bytes=stack.reduce((n,x)=>n+(x.before?x.before.length*2:0),0);
    while(stack.length>1&&(stack.length>history.limit||bytes>cap)){const old=stack.shift();bytes-=(old.before?old.before.length*2:0);}
  }
  function historyChanged() { history.listeners.forEach(f => { try { f(); } catch (e) {} }); U.bus.emit('history'); }
  function begin(label) {
    if (history.pending) return;
    history.pending = { label: label || 'Изменение', before: serialize(true) };
  }
  function end() {
    if (!history.pending) return;
    const p = history.pending; history.pending = null;
    if (serialize(true) !== p.before) {
      history.undo.push({ label: p.label, before: p.before });
      trimHistory(history.undo);
      history.redo.length = 0;
      S.dirty = true; persist(); historyChanged();
    }
  }
  function change(label, fn) { begin(label); let r; try { r = fn(); } finally { end(); } return r; }
  function restoreSnapshot(snap) {
    try {
      const obj = JSON.parse(snap);
      // Выделение переживает отмену: id клипов сохраняются при сериализации,
      // поэтому после восстановления возвращаем те, что ещё существуют.
      const keepSel = Array.from(S.selection);
      rehydrate(obj);
      S.playhead = obj.playhead || 0;
      S.zoom = clamp(obj.zoom || 40, 4, 320);
      keepSel.forEach(id => { if (S.findClip(id)) S.selection.add(id); });
    } catch (e) { console.error(e); }
  }
  function undo() {
    if (!history.undo.length) { U.toast('Отменять больше нечего'); return; }
    const item = history.undo.pop();
    history.redo.push({ label: item.label, before: serialize(true) });trimHistory(history.redo);
    restoreSnapshot(item.before);
    if (PPE.renderAll) PPE.renderAll();
    persist(true); historyChanged(); U.status('Отменено: ' + item.label, null, true);
  }
  function redo() {
    if (!history.redo.length) { U.toast('Повторять больше нечего'); return; }
    const item = history.redo.pop();
    history.undo.push({ label: item.label, before: serialize(true) });trimHistory(history.undo);
    restoreSnapshot(item.before);
    if (PPE.renderAll) PPE.renderAll();
    persist(true); historyChanged(); U.status('Повторено: ' + item.label, null, true);
  }
  function markDirty() { S.dirty = true; U.bus.emit('stateDirty'); if (PPE.engine && PPE.engine.invalidate) PPE.engine.invalidate(); persist(); }

  /* --------------------------------- effects catalog --------------------------------- */
  function snapshotEffect(clip) {
    return deep({ transform: clip.transform, color: clip.color, audio: clip.audio, speed: clip.speed,
      transitionIn: clip.transitionIn, transitionOut: clip.transitionOut, keys: clip.keys || {} });
  }
  function applyEffect(clip, effectId) {
    const def = PPE.effectCatalog.find(e => e.id === effectId);
    if (!def) return false;
    if (clip.effects.some(e => e.id === effectId && !def.multi)) return false;
    const before = snapshotEffect(clip);
    def.apply(clip);
    clip.effects.push({ id: effectId, label: def.name, uid: uid('fx'), before: before });
    return true;
  }
  function removeEffect(clip, fxUid) {
    const i = clip.effects.findIndex(e => e.uid === fxUid);
    if (i < 0) return;
    const fx = clip.effects[i];
    if (fx.before) Object.assign(clip, deep(fx.before));
    clip.effects.splice(i, 1);
  }
  function findPrevClip(clip) {
    const t = findTrack(clip.trackId); if (!t) return null;
    let prev = null;
    t.clips.forEach(c => { if (c !== clip && clipEnd(c) <= clip.start + 0.001 && (!prev || clipEnd(c) > clipEnd(prev))) prev = c; });
    return prev;
  }

  const clipDur = c => Math.max(0.1, clipDuration(c));
  PPE.effectCatalog = [
    { id: 'cross-dissolve', group: 'Видеопереходы', name: 'Перекрёстное растворение', icon: 'layers', tag: '0.8 c', apply(c) {
      const d = 0.8, prev = findPrevClip(c);
      if (prev && c.start >= d * 0.5) { c.start = Math.max(0, c.start - d); c.transitionIn = d; prev.transitionOut = d; }
      else c.transitionIn = d;
    } },
    { id: 'dip-black', group: 'Видеопереходы', name: 'Растворение через чёрное', icon: 'color', tag: '0.6 c', apply(c) {
      c.transitionIn = 0.6; const prev = findPrevClip(c); if (prev) prev.transitionOut = 0.6;
    } },
    { id: 'fade-in-video', group: 'Видеопереходы', name: 'Появление из чёрного', icon: 'eye', tag: '1 c', apply(c) { c.transitionIn = 1; } },
    { id: 'fade-out-video', group: 'Видеопереходы', name: 'Затухание в чёрное', icon: 'eye-off', tag: '1 c', apply(c) { c.transitionOut = 1; } },
    { id: 'gaussian-blur', group: 'Видеоэффекты', name: 'Размытие по Гауссу', icon: 'fx', tag: '8 px', apply(c) { c.color.blur = 8; } },
    { id: 'brightness', group: 'Видеоэффекты', name: 'Яркость и контраст', icon: 'sliders', tag: '+20%', apply(c) { c.color.brightness = 120; c.color.contrast = 115; } },
    { id: 'bw', group: 'Видеоэффекты', name: 'Чёрно-белое', icon: 'color', tag: '100%', apply(c) { c.color.grayscale = 100; } },
    { id: 'sepia', group: 'Видеоэффекты', name: 'Сепия', icon: 'color', tag: '100%', apply(c) { c.color.sepia = 100; } },
    { id: 'saturate', group: 'Видеоэффекты', name: 'Насыщенность +', icon: 'sliders', tag: '180%', apply(c) { c.color.saturate = 180; } },
    { id: 'hue-shift', group: 'Видеоэффекты', name: 'Сдвиг оттенка', icon: 'fx', tag: '90°', apply(c) { c.color.hue = 90; } },
    { id: 'vignette', group: 'Видеоэффекты', name: 'Виньетка', icon: 'grid', tag: '55%', apply(c) { c.color.vignette = 55; } },
    /* --- плёночные и «камерные» эффекты --- */
    { id: 'film-grain', group: 'Плёночные', name: 'Зерно плёнки', icon: 'fx', tag: '18%', multi: true, apply(c) { c.color.grain = c.color.grain ? Math.min(100, c.color.grain + 10) : 18; } },
    { id: 'light-leak', group: 'Плёночные', name: 'Световой блик', icon: 'color', tag: '35%', apply(c) { c.color.leak = 35; } },
    { id: 'letterbox', group: 'Плёночные', name: 'Кадр в кино (шторки)', icon: 'grid', tag: '2.39:1', apply(c) { c.color.letterbox = 100; } },
    { id: 'glitch', group: 'Плёночные', name: 'Глитч', icon: 'fx', tag: '45%', apply(c) { c.color.glitch = 45; } },
    { id: 'vhs', group: 'Плёночные', name: 'VHS-кассета', icon: 'film', tag: 'VHS', apply(c) { c.color.grain = 22; c.color.saturate = 128; c.color.contrast = 108; c.color.blur = 0.6; } },
    { id: 'dream', group: 'Плёночные', name: 'Мягкий сон', icon: 'eye', tag: 'Bloom', apply(c) { c.color.blur = 2.5; c.color.brightness = 108; c.color.leak = 18; } },

    /* --- движение на ключевых кадрах: эффект сам расставляет ключи --- */
    { id: 'fx-shake', group: 'Движение', name: 'Дрожание камеры', icon: 'fx', tag: 'ключи', apply(c) {
      const d = clipDur(c), n = Math.max(3, Math.round(d * 6)), a = 0.8;
      for (let i = 0; i <= n; i++) {
        const t = d * i / n;
        addKey(c, 'transform.x', t, i % 2 ? a : -a);
        addKey(c, 'transform.y', t, i % 3 ? -a * 0.7 : a * 0.6);
      }
      addKey(c, 'transform.x', d, 0); addKey(c, 'transform.y', d, 0);
    } },
    { id: 'fx-zoom-punch', group: 'Движение', name: 'Зум-панч', icon: 'zoom-in', tag: 'ключи', apply(c) {
      const d = clipDur(c), base = c.transform.scale || 100;
      addKey(c, 'transform.scale', 0, base); addKey(c, 'transform.scale', Math.min(0.28, d * .3), base + 16);
      addKey(c, 'transform.scale', Math.min(0.9, d * .75), base + 4); addKey(c, 'transform.scale', d, base);
    } },
    { id: 'fx-slide-in', group: 'Движение', name: 'Въезд слева', icon: 'insert', tag: 'ключи', apply(c) {
      const d = clipDur(c);
      addKey(c, 'transform.x', 0, -22); addKey(c, 'transform.x', Math.min(0.9, d * .45), 0);
      addKey(c, 'transform.opacity', 0, 0); addKey(c, 'transform.opacity', Math.min(0.6, d * .3), 100);
    } },
    { id: 'fx-rise', group: 'Движение', name: 'Подъём снизу', icon: 'insert', tag: 'ключи', apply(c) {
      const d = clipDur(c);
      addKey(c, 'transform.y', 0, 18); addKey(c, 'transform.y', Math.min(1.1, d * .5), 0);
      addKey(c, 'transform.opacity', 0, 0); addKey(c, 'transform.opacity', Math.min(0.7, d * .35), 100);
    } },
    { id: 'fx-pulse', group: 'Движение', name: 'Пульс', icon: 'wave', tag: 'ключи', apply(c) {
      const d = clipDur(c), base = c.transform.scale || 100, n = Math.max(2, Math.round(d * 2));
      for (let i = 0; i <= n; i++) addKey(c, 'transform.scale', d * i / n, i % 2 ? base + 6 : base);
    } },

    { id: 'pip', group: 'Предустановки', name: 'Картинка в картинке 25%', icon: 'image', tag: 'PiP', apply(c) { c.transform.scale = 25; c.transform.x = 32; c.transform.y = 30; } },
    { id: 'left-third', group: 'Предустановки', name: 'Треть экрана слева', icon: 'image', tag: '33%', apply(c) { c.transform.scale = 33; c.transform.x = -33; c.transform.y = 0; } },
    { id: 'scale-frame', group: 'Предустановки', name: 'Масштаб по кадру', icon: 'fit', tag: '100%', apply(c) { c.transform.fit = 'fill'; c.transform.scale = 100; } },
    { id: 'flip-h', group: 'Предустановки', name: 'Отразить по горизонтали', icon: 'layers', tag: '↔', apply(c) { c.transform.flipH = true; } },
    { id: 'rotate-90', group: 'Предустановки', name: 'Поворот на 90°', icon: 'reset', tag: '90°', apply(c) { c.transform.rotation = 90; } },
    { id: 'speed-2x', group: 'Скорость', name: 'Ускорение ×2', icon: 'speed', tag: '200%', apply(c) { c.speed = 2; } },
    { id: 'speed-half', group: 'Скорость', name: 'Замедление ×0.5', icon: 'speed', tag: '50%', apply(c) { c.speed = 0.5; } },
    { id: 'vol-up', group: 'Аудиоэффекты', name: 'Громкость +6 дБ', icon: 'volume', tag: '+6 dB', multi: true, apply(c) { c.audio.volume = Math.min(400, c.audio.volume * 2); } },
    { id: 'vol-down', group: 'Аудиоэффекты', name: 'Громкость −6 дБ', icon: 'volume', tag: '−6 dB', multi: true, apply(c) { c.audio.volume = Math.max(0, c.audio.volume / 2); } },
    { id: 'mute-clip', group: 'Аудиоэффекты', name: 'Выключить звук', icon: 'mute', tag: '0%', apply(c) { c.audio.volume = 0; } },
    { id: 'audio-fade-in', group: 'Аудиоэффекты', name: 'Нарастание звука', icon: 'wave', tag: '1 c', apply(c) { c.audio.fadeIn = 1; } },
    { id: 'audio-fade-out', group: 'Аудиоэффекты', name: 'Затухание звука', icon: 'wave', tag: '1 c', apply(c) { c.audio.fadeOut = 1; } },
    { id: 'pan-left', group: 'Аудиоэффекты', name: 'Панорама влево', icon: 'sliders', tag: 'L', apply(c) { c.audio.pan = -1; } },
    { id: 'pan-right', group: 'Аудиоэффекты', name: 'Панорама вправо', icon: 'sliders', tag: 'R', apply(c) { c.audio.pan = 1; } }
  ];

  /* --------------------------------- exports --------------------------------- */
  Object.assign(S, {
    defaultTransform, defaultColor, defaultAudio, defaultProject, defaultTextData,
    makeTrack, newClip, addTrack, removeTrack, renameTracks,
    clipDuration, clipEnd, allClips, findClip, findTrack, trackOf, findMedia, sequenceDuration, sourceDuration,
    valueAt, addKey, removeKeyAt, findKeyAt, setClipParam, getBase, setBase, allKeyParams,
    allKeyTimes, keysAtTime, removeKeysAtTime, addKeysAtTime, hasKeys,
    serialize, rehydrate, persist, loadPersisted, clearPersisted, newProject, exportProjectFile, cleanProject,
    begin, end, change, undo, redo, markDirty, historyChanged,
    applyEffect, removeEffect, findPrevClip
  });
})(window);
