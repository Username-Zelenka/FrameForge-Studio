/* =========================================================================
   media.js — import, probing, thumbnails, waveforms, audio graph, clip sources
   ========================================================================= */
(function (root) {
  'use strict';
  const PPE = root.PPE = root.PPE || {};
  const U = PPE.utils, S = PPE.state;
  const uid = U.uid;
  const $ = U.$;

  /* --------------------------------- audio graph --------------------------------- */
  const A = {
    ctx: null, master: null, speaker: null, analyser: null, recordDest: null,
    tracks: new Map(), clips: new Map(), failed: false
  };
  function ensureAudio() {
    if (A.ctx || A.failed) return A.ctx;
    try {
      const Ctor = root.AudioContext || root.webkitAudioContext;
      if (!Ctor) throw new Error('Web Audio недоступен');
      A.ctx = new Ctor({ latencyHint: 'interactive' });
      A.master = A.ctx.createGain(); A.master.gain.value = 1;
      A.speaker = A.ctx.createGain(); A.speaker.gain.value = 1;
      A.analyser = A.ctx.createAnalyser(); A.analyser.fftSize = 512;
      A.recordDest = A.ctx.createMediaStreamDestination();
      A.master.connect(A.speaker);
      A.speaker.connect(A.analyser);
      A.analyser.connect(A.ctx.destination);
      A.master.connect(A.recordDest);
    } catch (e) { console.warn('Audio graph unavailable', e); A.failed = true; }
    return A.ctx;
  }
  function resumeAudio() {
    const ctx = ensureAudio();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }
  function trackNodes(trackId) {
    const ctx = ensureAudio(); if (!ctx) return null;
    let n = A.tracks.get(trackId);
    if (n && n.ctx === ctx) return n;
    const gain = ctx.createGain();
    const analyser = ctx.createAnalyser(); analyser.fftSize = 256;
    let panner = null;
    try { panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null; } catch (e) {}
    gain.connect(analyser);
    analyser.connect(A.master);
    n = { ctx, gain, analyser, panner, buf: new Uint8Array(analyser.frequencyBinCount) };
    A.tracks.set(trackId, n);
    return n;
  }
  function attachAudio(el, clip) {
    const ctx = ensureAudio(); if (!ctx) return null;
    const t = trackNodes(clip.trackId); if (!t) return null;
    let node;
    try { node = ctx.createMediaElementSource(el); }
    catch (e) { console.warn('createMediaElementSource failed', e); return null; }
    // Как только элемент попадает в Web Audio-граф, его собственный вывод
    // отключается — поэтому нулевая громкость/ mute здесь означали бы тишину.
    try { el.muted = false; el.volume = 1; } catch (e) {}
    const gain = ctx.createGain(); gain.gain.value = 0;
    let pan = null;
    try { pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null; } catch (e) {}
    node.connect(gain);
    if (pan) { gain.connect(pan); pan.connect(t.gain); } else gain.connect(t.gain);
    A.clips.set(clip.id, { el, node, gain, pan, ctx, trackId: clip.trackId });
    return gain;
  }
  function hasClipAudio(clipId) { const n = A.clips.get(clipId); return !!(n && n.ctx && n.ctx === A.ctx); }
  /**
   * Подключить звук клипа, если элемент уже существует, но ещё не в графе
   * (например, элемент создан до первого жеста пользователя — тогда AudioContext
   * был недоступен и звук молча пропадал).
   */
  function ensureClipAudio(clip, el) {
    if (!clip || !el) return null;
    if (hasClipAudio(clip.id)) return A.clips.get(clip.id);
    const old = A.clips.get(clip.id);
    if (old) { try { old.node.disconnect(); old.gain.disconnect(); if (old.pan) old.pan.disconnect(); } catch (e) {} A.clips.delete(clip.id); }
    return attachAudio(el, clip);
  }
  /** Re-route a clip's audio into its current track (after moving between tracks). */
  function ensureClipTrack(clip) {
    const an = A.clips.get(clip.id);
    if (!an || an.trackId === clip.trackId) return;
    const t = trackNodes(clip.trackId); if (!t) return;
    try { (an.pan || an.gain).disconnect(); } catch (e) {}
    try { (an.pan || an.gain).connect(t.gain); } catch (e) {}
    an.trackId = clip.trackId;
  }
  function setClipGain(clipId, value) {
    const n = A.clips.get(clipId);
    if (!n || !n.ctx) return;
    try { n.gain.gain.setTargetAtTime(Math.max(0, value), n.ctx.currentTime, 0.012); }
    catch (e) { n.gain.gain.value = Math.max(0, value); }
  }
  function setClipPan(clipId, value) {
    const n = A.clips.get(clipId);
    if (n && n.pan) { try { n.pan.pan.value = U.clamp(value, -1, 1); } catch (e) {} }
  }
  function setTrackGain(trackId, value, panValue) {
    const n = trackNodes(trackId); if (!n) return;
    try { n.gain.gain.setTargetAtTime(Math.max(0, value), n.ctx.currentTime, 0.02); }
    catch (e) { n.gain.gain.value = Math.max(0, value); }
  }
  function setMasterGain(value) {
    const ctx = ensureAudio(); if (!ctx || !A.master) return;
    try { A.master.gain.setTargetAtTime(Math.max(0, value), ctx.currentTime, 0.02); }
    catch (e) { A.master.gain.value = Math.max(0, value); }
  }
  /** Controls only the speakers (recording path is unaffected). Returns previous value. */
  function setSpeakerGain(value) {
    const ctx = ensureAudio(); if (!ctx || !A.speaker) return 1;
    const prev = A.speaker.gain.value;
    try { A.speaker.gain.setTargetAtTime(Math.max(0, value), ctx.currentTime, 0.02); }
    catch (e) { A.speaker.gain.value = Math.max(0, value); }
    return prev;
  }
  function meterLevel(trackId) {
    const n = A.tracks.get(trackId); if (!n) return 0;
    n.analyser.getByteTimeDomainData(n.buf);
    let peak = 0;
    for (let i = 0; i < n.buf.length; i++) { const v = Math.abs(n.buf[i] - 128) / 128; if (v > peak) peak = v; }
    return peak;
  }
  function meterMaster() {
    if (!A.analyser) return 0;
    const buf = new Uint8Array(A.analyser.frequencyBinCount);
    A.analyser.getByteTimeDomainData(buf);
    let peak = 0;
    for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i] - 128) / 128; if (v > peak) peak = v; }
    return peak;
  }
  function recordStream() { ensureAudio(); return A.recordDest ? A.recordDest.stream : null; }

  /* --------------------------------- clip source elements --------------------------------- */
  const runtime = new Map();
  function disposeClip(clipId) {
    const r = runtime.get(clipId);
    if (r) {
      try { if (r.el) { r.el.pause(); r.el.removeAttribute('src'); r.el.load(); } } catch (e) {}
      const an = A.clips.get(clipId);
      if (an) { try { an.node.disconnect(); an.gain.disconnect(); if (an.pan) an.pan.disconnect(); } catch (e) {} A.clips.delete(clipId); }
      runtime.delete(clipId);
    }
  }
  function pruneClips() {
    const ids = new Set(S.allClips().map(c => c.id));
    Array.from(runtime.keys()).forEach(id => { if (!ids.has(id)) disposeClip(id); });
  }
  function resetRuntime() { Array.from(runtime.keys()).forEach(disposeClip); runtime.clear(); }
  function sourceFor(clip) {
    const media = S.findMedia(clip.mediaId);
    const track = S.findTrack(clip.trackId);
    const trackType = track && track.type;
    let r = runtime.get(clip.id);
    if (r && (r.clip !== clip || r.mediaId !== clip.mediaId || r.trackType !== trackType)) { disposeClip(clip.id); r = null; }
    if (!media) return { kind: 'offline', media: null };
    if (media.generated) return { kind: media.type, media, data: media.data };
    if (!media.url) return { kind: 'offline', media };
    if (r) return r;

    // A video file placed on an audio track only needs its audio decoded.
    const audioOnly = media.type === 'audio' || trackType === 'audio';
    if (audioOnly && media.type === 'image') return { kind: 'audio', el: null, image: null, media, clip, mediaId: clip.mediaId, trackType };
    let el, image = null, kind = audioOnly ? 'audio' : media.type;
    if (!audioOnly && media.type === 'image') {
      image = new Image(); image.src = media.url;
      if (image.decode) image.decode().catch(() => {});
    } else {
      el = document.createElement(audioOnly ? 'audio' : 'video');
      el.src = media.url; el.preload = 'auto'; el.playsInline = true;
      el.crossOrigin = 'anonymous';
      el.setAttribute('playsinline', '');
      // Keep the element technically rendered (not display:none) so browsers keep decoding frames for canvas.
      Object.assign(el.style, { position: 'fixed', left: '-10000px', top: '0', width: '2px', height: '2px', opacity: '0', pointerEvents: 'none' });
      document.body.appendChild(el);
      el.volume = 1;
      attachAudio(el, clip);
      el.addEventListener('error', () => console.warn('Media error', media.name));
    }
    r = { kind, el, image, media, clip, mediaId: clip.mediaId, trackType, gainAttached: !!el };
    runtime.set(clip.id, r);
    return r;
  }

  /* --------------------------------- file type detection --------------------------------- */
  function kindOfFile(file) {
    const name = (file.name || '').toLowerCase();
    const mime = (file.type || '').toLowerCase();
    if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|avif|svg)$/.test(name)) return 'image';
    if (mime.startsWith('audio/') || /\.(mp3|wav|ogg|oga|flac|aac|m4a|opus|weba|aiff?)$/.test(name)) return 'audio';
    if (mime.startsWith('video/') || /\.(mp4|m4v|mov|webm|mkv|avi|ogv|ogm|ts|3gp)$/.test(name)) return 'video';
    return 'video';
  }

  function probe(url, type) {
    return new Promise((resolve) => {
      let settled = false;
      const fallback = { duration: type === 'image' ? 5 : 1, width: 0, height: 0 };
      const softTimer = setTimeout(() => { if (!settled) check(); }, 350);
      const hardTimer = setTimeout(() => finish(fallback), 2600);
      function finish(v) { if (settled) return; settled = true; clearTimeout(softTimer); clearTimeout(hardTimer); resolve(v); }
      if (type === 'image') {
        const img = new Image();
        img.onload = () => finish({ duration: 5, width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => finish(fallback);
        img.src = url;
        return;
      }
      const el = document.createElement(type === 'audio' ? 'audio' : 'video');
      el.preload = 'metadata'; el.src = url;
      function check() {
        if (settled) return;
        if (isFinite(el.duration) && el.duration > 0) {
          finish({ duration: el.duration, width: el.videoWidth || 0, height: el.videoHeight || 0 });
        }
      }
      ['loadedmetadata', 'durationchange', 'canplay', 'loadeddata'].forEach(ev => el.addEventListener(ev, check));
      el.addEventListener('error', () => finish(fallback), { once: true });
      check();
    });
  }

  /* --------------------------------- thumbnails --------------------------------- */
  function svgDataURI(svg) { return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); }
  function waveThumb() {
    let bars = '';
    for (let i = 0; i < 24; i++) {
      const h = 6 + Math.abs(Math.sin(i * 1.7) * 30) + (i % 3) * 4;
      bars += `<rect x="${4 + i * 7}" y="${50 - h / 2}" width="4" height="${h}" rx="2" fill="#6fae86" opacity=".85"/>`;
    }
    return svgDataURI(`<svg xmlns="http://www.w3.org/2000/svg" width="176" height="100"><rect width="176" height="100" fill="#1b241e"/>${bars}</svg>`);
  }
  function generatedThumb(type, data) {
    const c = document.createElement('canvas'); c.width = 176; c.height = 100;
    const x = c.getContext('2d');
    if (type === 'color') { x.fillStyle = (data && data.color) || '#ffffff'; x.fillRect(0, 0, 176, 100); }
    else {
      x.fillStyle = '#1b1b22'; x.fillRect(0, 0, 176, 100);
      x.fillStyle = (data && data.color) || '#ffffff';
      // Мелкий кегль и запас по краям: карточка проекта обрезает превью по
      // вертикали (cover), и крупная надпись превращалась в «обрезки» букв.
      x.font = 'bold 13px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle';
      let t = (data && data.text) || 'Титр';
      if (t.length > 24) t = t.slice(0, 23) + '…';
      while (t.length > 1 && x.measureText(t).width > 164) t = t.slice(0, -2) + '…';
      x.fillText(t, 88, 52);
      x.fillStyle = '#6a6a78'; x.font = '9px Arial'; x.fillText('TITLE', 88, 76);
    }
    return c.toDataURL('image/jpeg', .75);
  }
  async function makeThumb(media, url) {
    if (media.type === 'audio') return waveThumb();
    if (media.generated) return generatedThumb(media.type, media.data);
    if (media.type === 'image') { try { return await imageThumb(url); } catch (e) { return waveThumb(); } }
    return new Promise(resolve => {
      const v = document.createElement('video');
      v.preload = 'auto'; v.muted = true; v.playsInline = true; v.src = url;
      let finished = false;
      const finish = (val) => { if (finished) return; finished = true; clearTimeout(timer); v.removeAttribute('src'); resolve(val); };
      const draw = () => {
        try {
          const c = document.createElement('canvas'); c.width = 176; c.height = 100;
          c.getContext('2d').drawImage(v, 0, 0, 176, 100);
          finish(c.toDataURL('image/jpeg', .72));
        } catch (e) { finish(waveThumb()); }
      };
      const timer = setTimeout(() => finish(waveThumb()), 5000);
      // Draw whatever frame is available after a short grace period: some containers
      // never fire 'seeked', and waiting for it would leave the bin without previews.
      setTimeout(() => { if (!finished && v.readyState >= 2) draw(); }, 1100);
      v.addEventListener('loadeddata', () => { try { v.currentTime = Math.min(1, Math.max(0, (media.duration || 2) * 0.2)); } catch (e) { draw(); } });
      v.addEventListener('seeked', draw, { once: true });
      v.addEventListener('error', () => finish(waveThumb()), { once: true });
    });
  }
  function imageThumb(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas'); c.width = 176; c.height = 100;
        const x = c.getContext('2d');
        x.fillStyle = '#111'; x.fillRect(0, 0, 176, 100);
        const s = Math.min(176 / img.width, 100 / img.height);
        x.drawImage(img, (176 - img.width * s) / 2, (100 - img.height * s) / 2, img.width * s, img.height * s);
        resolve(c.toDataURL('image/jpeg', .75));
      };
      img.onerror = reject; img.src = url;
    });
  }

  /* --------------------------------- peaks / waveform --------------------------------- */
  function fakePeaks(seedName, count) {
    let h = 2166136261;
    for (let i = 0; i < seedName.length; i++) { h ^= seedName.charCodeAt(i); h = Math.imul(h, 16777619); }
    const out = [];
    for (let i = 0; i < count; i++) {
      h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
      const r = ((h >>> 0) % 1000) / 1000;
      out.push(0.12 + r * 0.55 + 0.25 * Math.abs(Math.sin(i * 0.09)));
    }
    return out;
  }
  async function computePeaks(file, media) {
    const count = 700;
    try {
      if (!file || file.size > 40 * 1024 * 1024 || !ensureAudio()) return fakePeaks(media.name, count);
      const buf = await file.arrayBuffer();
      const decoded = await new Promise((res, rej) => {
        const p = A.ctx.decodeAudioData(buf, res, rej);
        if (p && p.then) p.then(res, rej);
      });
      const ch = decoded.getChannelData(0);
      const step = Math.max(1, Math.floor(ch.length / count));
      const out = [];
      for (let i = 0; i < count; i++) {
        let max = 0;
        const start = i * step;
        for (let j = 0; j < step; j += Math.max(1, Math.floor(step / 32))) {
          const v = Math.abs(ch[start + j] || 0); if (v > max) max = v;
        }
        out.push(Math.min(1, max * 1.35));
      }
      return out;
    } catch (e) { return fakePeaks(media.name, count); }
  }

  /* --------------------------------- import --------------------------------- */
  let importing = 0;
  /* Ключ файла: имя + размер + дата изменения. По нему отсекаем повторный импорт
     того же файла (двойной клик по «Импорт», drag&drop дважды, повторный выбор
     в диалоге) — файл должен загружаться ровно один раз. */
  function fileKey(f) { return (f.name || '') + '|' + (f.size || 0) + '|' + (f.lastModified || 0); }
  const inflightKeys = new Set();

  async function importFiles(files, opts) {
    opts = opts || {};
    const incoming = Array.from(files || []).filter(f => f && (f.size > 0 || f.name));
    if (!incoming.length) return [];

    // 1) уже в проекте (старые проекты хранят только имя файла)
    const known = new Set(), legacyNames = new Set();
    S.project.media.forEach(m => {
      if (!m.fileName) return;
      if (m.fileKey) known.add(m.fileKey); else legacyNames.add(m.fileName);
    });
    // 2) прямо сейчас импортируется
    const dupes = [], list_ = [];
    incoming.forEach(f => {
      const k = fileKey(f);
      if (known.has(k) || inflightKeys.has(k) || legacyNames.has(f.name)) { dupes.push(f.name); return; }
      list_.push(f);
    });
    if (dupes.length) {
      U.toast(dupes.length === 1
        ? '«' + dupes[0] + '» уже загружен в проект'
        : 'Пропущено уже загруженных файлов: ' + dupes.length, 'warn', 2600);
    }
    const list = list_;
    if (!list.length) { if (!opts.silent) U.status('Файлы уже в проекте', null, true); return []; }

    list.forEach(f => inflightKeys.add(fileKey(f)));
    try { return await doImport(list, opts); }
    finally { list.forEach(f => inflightKeys.delete(fileKey(f))); }
  }

  async function doImport(list, opts) {
    U.status('Импорт медиафайлов…', 'busy');
    U.hint('Читаю метаданные и создаю миниатюры');
    const wasIdle = importing === 0;
    importing += list.length;
    if (wasIdle) S.begin('Импорт медиа');
    // Probe all files in parallel — a slow container must not block the rest of the batch.
    const added = await Promise.all(list.map(async file => {
      const type = kindOfFile(file);
      const url = URL.createObjectURL(file);
      const info = await probe(url, type);
      return {
        id: uid('media'), name: file.name.replace(/\.[^.]+$/, ''), fileName: file.name, type: type,
        url: url, file: file, duration: info.duration, width: info.width, height: info.height,
        hasAudio: type !== 'image', thumb: null, peaks: null, offline: false, generated: false, data: null,
        fileKey: fileKey(file), fileSize: file.size || 0
      };
    }));
    const refreshProject = U.raf(() => { if (PPE.panels) PPE.panels.renderProject(); });
    const refreshTimeline = U.raf(() => { if (PPE.timeline) PPE.timeline.render(); });
    added.forEach(m => {
      S.project.media.push(m);
      makeThumb(m, m.url).then(t => { m.thumb = t; refreshProject(); }).catch(() => {});
      computePeaks(m.file, m).then(p => { m.peaks = p; refreshTimeline(); }).catch(() => {});
    });
    importing -= list.length;
    if (!importing) { U.status('Импортировано файлов: ' + list.length, null, true); S.end(); }
    if (added.length && !opts.silentSource) PPE.panels.openSource(added[0].id);
    if (PPE.renderAll) PPE.renderAll();
    return added;
  }

  async function relinkMedia(files) {
    const list = Array.from(files || []);
    if (!list.length) return 0;
    let linked = 0;
    for (const file of list) {
      let m = S.project.media.find(x => !x.generated && x.offline && (x.fileName === file.name || x.name === file.name.replace(/\.[^.]+$/, '')));
      if (!m) m = S.project.media.find(x => !x.generated && x.offline);
      if (!m) break;
      const url = URL.createObjectURL(file);
      const info = await probe(url, m.type);
      m.url = url; m.file = file; m.fileName = file.name; m.offline = false;
      m.duration = info.duration; m.width = info.width; m.height = info.height;
      makeThumb(m, url).then(t => { m.thumb = t; PPE.panels.renderProject(); }).catch(() => {});
      computePeaks(file, m).then(p => { m.peaks = p; PPE.timeline.render(); }).catch(() => {});
      linked++;
    }
    S.relinkNeeded = S.project.media.some(x => !x.generated && x.offline);
    resetRuntime();
    if (PPE.renderAll) PPE.renderAll();
    if (PPE.animationUI && PPE.animationUI.isOpen()) PPE.animationUI.render();
    U.toast('Перепривязано файлов: ' + linked, 'success');
    return linked;
  }

  function removeMedia(id) {
    const m = S.findMedia(id); if (!m) return;
    const used = S.allClips().filter(c => c.mediaId === id).length;
    const adoc=S.project.x&&S.project.x.animation;let animationUses=0;
    if(adoc){(adoc.scenes||[]).forEach(sc=>{(sc.sounds||[]).forEach(a=>{if(a.mediaId===id)animationUses++;});(sc.layers||[]).forEach(l=>(l.keys||[]).forEach(k=>(k.objects||[]).forEach(o=>{if(o.mediaId===id)animationUses++;})));});(adoc.assets||[]).forEach(a=>(a.objects||[]).forEach(o=>{if(o.mediaId===id)animationUses++;}));}
    const warn=(used?'Этот файл используется в '+used+' клипах; они будут удалены. ':'')+(animationUses?'Он также используется в анимации ('+animationUses+'); объекты станут офлайн. Вернуть файл можно отменой удаления. ':'');
    if(warn&&!confirm(warn+'Удалить файл?'))return;
    S.change('Удаление медиа', () => {
      S.project.tracks.forEach(t => { t.clips = t.clips.filter(c => c.mediaId !== id); });
      S.project.media = S.project.media.filter(x => x.id !== id);
      if (S.source.mediaId === id) S.source.mediaId = null;
    });
    resetRuntime();
    if (PPE.renderAll) PPE.renderAll();
  }

  function createGenerated(type, data, name) {
    const d = data || (type === 'text' ? S.defaultTextData() : { color: '#ffffff' });
    const m = {
      id: uid('media'), name: name || (type === 'text' ? 'Титр' : 'Цветовая заливка'), fileName: null,
      type: type, url: null, file: null, duration: 3600, width: S.project.width, height: S.project.height,
      hasAudio: false, thumb: generatedThumb(type, d), peaks: null, offline: false, generated: true, data: d
    };
    S.project.media.push(m);
    return m;
  }
  function updateGeneratedThumb(m) { m.thumb = generatedThumb(m.type, m.data); }

  function mediaIcon(m) {
    if (!m) return 'film';
    return ({ video: 'film', audio: 'music', image: 'image', text: 'text', color: 'color' })[m.type] || 'film';
  }

  PPE.media = {
    ensureAudio, resumeAudio, trackNodes, ensureClipTrack, ensureClipAudio, hasClipAudio, attachAudio, setClipGain, setClipPan, setTrackGain, setMasterGain, setSpeakerGain,
    meterLevel, meterMaster, recordStream, sourceFor, disposeClip, pruneClips, resetRuntime,
    kindOfFile, probe, makeThumb, generatedThumb, svgDataURI, fakePeaks, computePeaks,
    importFiles, relinkMedia, removeMedia, createGenerated, updateGeneratedThumb, mediaIcon,
    audio: A
  };
})(window);
