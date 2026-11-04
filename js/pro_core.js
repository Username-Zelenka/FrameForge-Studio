/* =========================================================================
   pro_core.js — расширенные функции Premiere-класса:
   Lumetri, маски, мультикам, вложенности, time remapping, interpret footage,
   прокси, аудио (Essential Sound, ducking), анализ изображения,render&replace.
   ========================================================================= */
(function (root) {
  'use strict';
  const PPE = root.PPE = root.PPE || {};
  const U = PPE.utils, S = PPE.state;
  const $ = U.$, $$ = U.$$, el = U.el, clamp = U.clamp, uid = U.uid, esc = U.escapeHtml;
  const PRO = PPE.pro = {};
  const M = () => PPE.media, E = () => PPE.engine, T = () => PPE.timeline, P = () => PPE.panels;

  function x(o) { if (!o) return {}; if (!o.x || typeof o.x !== 'object') o.x = {}; return o.x; }
  PRO.x = x;
  function selClip() { return S.findClip(Array.from(S.selection)[0]) || null; }
  function needClip() { const c = selClip(); if (!c) U.toast('Сначала выберите клип на таймлайне', 'warn'); return c; }
  PRO.selClip = selClip; PRO.needClip = needClip;

  /* ------------------------------- defaults ------------------------------- */
  const curve = () => [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  function defaultLumetri() {
    return {
      basic: { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, saturation: 100, temperature: 0, tint: 0 },
      creative: { look: 0, faded: 0, vibrance: 0, sharpen: 0, saturation: 100 },
      curves: { enabled: false, master: curve(), r: curve(), g: curve(), b: curve() },
      wheels: { shadows: [0, 0, 0], mids: [0, 0, 0], highs: [0, 0, 0] },
      hsl: { enabled: false, hue: 0, range: 40, sat: 0, lum: 0, hueShift: 0 },
      vignette: { amount: 0, midpoint: 50, roundness: 50, feather: 50 }
    };
  }
  PRO.defaultLumetri = defaultLumetri;
  function lumetri(clip) {
    const q = x(clip);
    if (!q.lumetri) q.lumetri = defaultLumetri();
    const d = defaultLumetri(), L = q.lumetri;
    for (const k in d) { if (!L[k]) L[k] = d[k]; else for (const j in d[k]) if (L[k][j] === undefined) L[k][j] = d[k][j]; }
    return L;
  }
  PRO.lumetri = lumetri;
  function defaultAudioFX() { return { tag: 'auto', enhance: 0, duck: false, duckAmount: 60, gainDb: 0, reduceNoise: 0, reverb: 0 }; }
  PRO.defaultAudioFX = defaultAudioFX;
  function audioFX(clip) {
    const q = x(clip); if (!q.audioFX) q.audioFX = defaultAudioFX();
    const d = defaultAudioFX(); for (const k in d) if (q.audioFX[k] === undefined) q.audioFX[k] = d[k];
    return q.audioFX; // живой объект: изменения сохраняются в проекте
  }
  PRO.audioFX = audioFX;
  function masks(clip) { const q = x(clip); if (!q.masks) q.masks = []; return q.masks; }
  PRO.masks = masks;
  function defaultInterpret() { return { fps: 0, srcFps: 0, par: 1, alpha: 'straight', channels: 2, reverse: false }; }
  PRO.defaultInterpret = defaultInterpret;
  function interpret(media) {
    const q = x(media); if (!q.interpret) q.interpret = defaultInterpret();
    const d = defaultInterpret(); for (const k in d) if (q.interpret[k] === undefined) q.interpret[k] = d[k];
    return q.interpret; // живой объект — диалоги Interpret Footage пишут прямо в него
  }
  PRO.interpret = interpret;
  function ingest() { const q = x(S.project); if (!q.ingest) q.ingest = { mode: 'copy', proxyPreset: '480p', transcode: false, createProxies: false }; return q.ingest; }
  PRO.ingest = ingest;

  /* --------------------------- interpret / PAR --------------------------- */
  function interpretScale(media) {
    if (!media) return 1;
    const i = interpret(media);
    if (!i.fps) return 1;
    const src = i.srcFps || media.fps || S.project.fps || 30;
    return clamp(i.fps / src, .125, 8);
  }
  PRO.interpretScale = interpretScale;
  function pixelAspect(clip) {
    const m = S.findMedia(clip.mediaId); if (!m) return 1;
    return clamp(interpret(m).par || 1, .25, 4);
  }
  PRO.pixelAspect = pixelAspect;

  /* --------------------------- time remapping --------------------------- */
  function remap(clip) { return x(clip).remap || null; }
  PRO.remap = remap;
  function initRemap(clip) {
    const q = x(clip);
    const dur = S.clipDuration(clip), srcLen = Math.max(.001, clip.outPoint - clip.inPoint);
    q.remap = { keys: [{ t: 0, s: 0 }, { t: dur, s: srcLen }] };
    clip.speed = 1; clip.outPoint = clip.inPoint + dur;
    return q.remap;
  }
  PRO.initRemap = initRemap;
  function remapDuration(clip) { const r = remap(clip); return r && r.keys.length ? r.keys[r.keys.length - 1].t : S.clipDuration(clip); }
  function sourceTime(clip, local) {
    const r = remap(clip);
    const scale = interpretScale(S.findMedia(clip.mediaId));
    if (!r) return Math.max(0, local) * (clip.speed || 1);
    const k = r.keys;
    if (local <= k[0].t) return k[0].s * scale;
    const last = k[k.length - 1];
    if (local >= last.t) return last.s * scale;
    for (let i = 1; i < k.length; i++) {
      if (local <= k[i].t) {
        const a = k[i - 1], b = k[i], f = (local - a.t) / Math.max(1e-6, b.t - a.t);
        return (a.s + (b.s - a.s) * f) * scale;
      }
    }
    return last.s * scale;
  }
  PRO.sourceTime = sourceTime;
  function speedAt(clip, local) {
    const r = remap(clip);
    const scale = interpretScale(S.findMedia(clip.mediaId));
    if (!r) return (clip.speed || 1);
    const k = r.keys;
    for (let i = 1; i < k.length; i++) if (local <= k[i].t) {
      const a = k[i - 1], b = k[i];
      return ((b.s - a.s) / Math.max(1e-6, b.t - a.t)) * scale || .001;
    }
    return Math.abs((k[k.length - 1].s - k[k.length - 2].s) / Math.max(1e-6, k[k.length - 1].t - k[k.length - 2].t)) * scale || .001;
  }
  PRO.speedAt = speedAt;
  function commitRemap(clip) {
    const r = remap(clip); if (!r) return;
    r.keys.sort((a, b) => a.t - b.t);
    clip.speed = 1;
    clip.outPoint = clip.inPoint + r.keys[r.keys.length - 1].t;
    S.markDirty();
  }
  PRO.commitRemap = commitRemap;

  /* ------------------------------ multicam ------------------------------ */
  function multicam(clip) { return x(clip).multicam || null; }
  PRO.multicam = multicam;
  function angleAt(clip, T) {
    const mc = multicam(clip); if (!mc) return 0;
    const local = T - clip.start;
    let a = mc.active == null ? 0 : mc.active;
    (mc.switches || []).forEach(s => { if (local >= s.t) a = s.angle; });
    return clamp(a, 0, mc.angles.length - 1);
  }
  PRO.angleAt = angleAt;
  // Кэш держим ВНЕ модели проекта: иначе clip.x._eff.x === clip.x создаёт
  // циклическую ссылку и JSON-сериализация истории/проекта падает.
  const effCache = new Map();
  function effectiveClip(clip, T) {
    if (!clip || !clip.x || !clip.x.multicam) return clip;
    const mc = clip.x.multicam, a = angleAt(clip, T);
    let e = effCache.get(clip.id);
    if (!e) { e = Object.assign({}, clip); e.x = {}; effCache.set(clip.id, e); }
    e.mediaId = mc.angles[a] || clip.mediaId;
    e.trackId = clip.trackId; e.transform = clip.transform; e.color = clip.color;
    e.audio = clip.audio; e.keys = clip.keys; e.speed = clip.speed;
    e.inPoint = clip.inPoint; e.outPoint = clip.outPoint; e.start = clip.start;
    return e;
  }
  PRO.effectiveClip = effectiveClip;

  /* ------------------------------- nesting ------------------------------- */
  function drawNest(c, data, local, pw, ph, depth) {
    const tracks = (data && data.tracks) || [];
    E().drawSequence(c, tracks, local, pw, ph, (depth || 0) + 1);
  }
  PRO.drawNest = drawNest;

  /* ---------------------------- shapes & masks ---------------------------- */
  function drawShape(c, d, pw, ph) {
    if (!d) return;
    d = d || {};
    const w = (Number(d.w) || 40) / 100 * pw, h = (Number(d.h) || 30) / 100 * ph;
    const px = (Number(d.x) || 50) / 100 * pw - pw / 2;
    const py = (Number(d.y) || 50) / 100 * ph - ph / 2;
    c.fillStyle = d.color || '#5aa9ff';
    c.strokeStyle = d.stroke || 'rgba(0,0,0,0)';
    c.lineWidth = Number(d.strokeWidth) || 0;
    c.globalAlpha *= clamp((Number(d.opacity) == null ? 100 : Number(d.opacity)) / 100, 0, 1);
    if (d.shape === 'ellipse') {
      c.beginPath(); c.ellipse(px, py, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2); c.closePath();
    } else {
      c.beginPath(); c.rect(px - w / 2, py - h / 2, w, h); c.closePath();
    }
    if (d.stroke && Number(d.strokeWidth)) c.stroke();
    c.fill();
  }
  PRO.drawShape = drawShape;
  function interpKey(arr, t, key) {
    if (!arr || !arr.length) return null;
    const a = arr.slice().sort((p, q) => p.t - q.t);
    if (t <= a[0].t) return a[0][key];
    if (t >= a[a.length - 1].t) return a[a.length - 1][key];
    for (let i = 1; i < a.length; i++) if (t <= a[i].t) {
      const f = (t - a[i - 1].t) / Math.max(1e-6, a[i].t - a[i - 1].t);
      return a[i - 1][key] + (a[i][key] - a[i - 1][key]) * f;
    }
    return a[a.length - 1][key];
  }
  function applyMask(c, clip, local, pw, ph) {
    const list = x(clip).masks; if (!list || !list.length) return;
    const path = new Path2D();
    let any = false;
    list.forEach(m => {
      if (m.enabled === false) return;
      const g = (k, d) => { const v = m.keys && m.keys.length ? interpKey(m.keys, local, k) : m[k]; return v == null ? d : v; };
      const cx = (g('x', 50) / 100) * pw - pw / 2, cy = (g('y', 50) / 100) * ph - ph / 2;
      const w = (g('w', 60) / 100) * pw, h = (g('h', 60) / 100) * ph;
      if (m.type === 'ellipse') path.ellipse(cx, cy, Math.max(1, w / 2), Math.max(1, h / 2), 0, 0, Math.PI * 2);
      else path.rect(cx - w / 2, cy - h / 2, w, h);
      any = true;
    });
    if (any) { try { c.clip(path); } catch (e) {} }
  }
  PRO.applyMask = applyMask;

  /* --------------------------- audio processing --------------------------- */
  let duckLevel = 0;
  function audioPost(clip, local, v, T) {
    const a = audioFX(clip);
    if (a.gainDb) v *= Math.pow(10, a.gainDb / 20);
    if (a.enhance) {
      // Простой динамический компрессор/подъём тихих участков на основе огибающей.
      v *= 1 + (a.enhance / 100) * (1 - clamp(v, 0, 1)) * 1.4;
      if (a.reduceNoise) v *= 1 - (a.reduceNoise / 100) * .25;
    }
    if (a.duck) {
      const diag = (S.project.tracks || []).filter(t => t.type === 'audio' && x(t).audioTag === 'dialogue');
      let peak = 0; diag.forEach(t => { peak = Math.max(peak, M().meterLevel(t.id)); });
      duckLevel = duckLevel * .82 + peak * .18;
      v *= 1 - (a.duckAmount / 100) * clamp(duckLevel * 1.8, 0, 1);
    }
    return Math.max(0, v);
  }
  PRO.audioPost = audioPost;

  /* =========================================================================
     Lumetri / Scopes — SVG-фильтры на canvas (реально влияют на картинку)
     ========================================================================= */
  const COLOR = PPE.proColor = {};
  let svgRoot = null, filterCache = new Map();
  function filterHost() {
    if (svgRoot && svgRoot.isConnected) return svgRoot;
    svgRoot = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgRoot.setAttribute('width', '0'); svgRoot.setAttribute('height', '0');
    svgRoot.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    svgRoot.id = 'ffProFilters';
    document.body.appendChild(svgRoot);
    filterCache.clear();
    return svgRoot;
  }
  function samples(pts) {
    const a = (pts && pts.length ? pts : curve()).slice().sort((p, q) => p.x - q.x);
    const out = [];
    for (let i = 0; i <= 16; i++) {
      const xx = i / 16;
      let y = 1;
      if (xx <= a[0].x) y = a[0].y;
      else if (xx >= a[a.length - 1].x) y = a[a.length - 1].y;
      else for (let j = 1; j < a.length; j++) if (xx <= a[j].x) {
        const f = (xx - a[j - 1].x) / Math.max(1e-6, a[j].x - a[j - 1].x);
        y = a[j - 1].y + (a[j].y - a[j - 1].y) * f; break;
      }
      out.push(clamp(y, 0, 1).toFixed(3));
    }
    return out.join(' ');
  }
  function svgFilterFor(clip, L) {
    const need = L.curves.enabled;
    const wheels = L.wheels && (L.wheels.shadows.some(v => v) || L.wheels.mids.some(v => v) || L.wheels.highs.some(v => v));
    const hsl = L.hsl.enabled;
    if (!need && !wheels && !hsl) return '';
    const host = filterHost();
    const sig = JSON.stringify([L.curves, L.wheels, L.hsl]);
    const id = 'ffc-' + clip.id;
    const cached = filterCache.get(id);
    if (cached && cached.sig === sig) return 'url(#' + id + ')';
    if (cached) { try { cached.node.remove(); } catch (e) {} }
    const f = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    f.setAttribute('id', id); f.setAttribute('color-interpolation-filters', 'sRGB');
    if (need) {
      const ct = document.createElementNS('http://www.w3.org/2000/svg', 'feComponentTransfer');
      ['r', 'g', 'b'].forEach(ch => {
        const fn = document.createElementNS('http://www.w3.org/2000/svg', 'feFunc' + ch.toUpperCase());
        fn.setAttribute('type', 'table');
        const master = samples(L.curves.master), chS = samples(L.curves[ch]);
        // комбинируем мастер-кривую и канальную
        const m = master.split(' ').map(Number), c = chS.split(' ').map(Number);
        fn.setAttribute('tableValues', m.map((v, i) => clamp(c[i] * .5 + v * .5, 0, 1).toFixed(3)).join(' '));
        ct.appendChild(fn);
      });
      f.appendChild(ct);
    }
    if (wheels) {
      const all = [L.wheels.shadows, L.wheels.mids, L.wheels.highs];
      const avg = [0, 1, 2].map(i => (all[0][i] + all[1][i] + all[2][i]) / 3 / 100);
      const cm = document.createElementNS('http://www.w3.org/2000/svg', 'feColorMatrix');
      cm.setAttribute('type', 'matrix');
      cm.setAttribute('values', [
        1, 0, 0, 0, avg[0] * .12,
        0, 1, 0, 0, avg[1] * .12,
        0, 0, 1, 0, avg[2] * .12,
        0, 0, 0, 1, 0
      ].join(' '));
      f.appendChild(cm);
    }
    if (hsl) {
      const hr = document.createElementNS('http://www.w3.org/2000/svg', 'feColorMatrix');
      hr.setAttribute('type', 'hueRotate');
      hr.setAttribute('values', String((L.hsl.hueShift || 0) * (L.hsl.range / 100)));
      f.appendChild(hr);
      const sat = document.createElementNS('http://www.w3.org/2000/svg', 'feColorMatrix');
      sat.setAttribute('type', 'saturate');
      sat.setAttribute('values', String(clamp(1 + (L.hsl.sat || 0) / 100, 0, 4)));
      f.appendChild(sat);
    }
    host.appendChild(f);
    filterCache.set(id, { sig: sig, node: f });
    return 'url(#' + id + ')';
  }
  COLOR.filterString = function (clip, local) {
    const q = x(clip); if (!q.lumetri) return '';
    const L = lumetri(clip);
    const b = L.basic, cr = L.creative;
    const parts = [];
    if (b.exposure) parts.push('brightness(' + clamp(Math.pow(2, b.exposure / 80), .2, 3).toFixed(3) + ')');
    if (b.contrast || cr.look) parts.push('contrast(' + clamp(1 + (b.contrast + cr.look * .3) / 100, .1, 3).toFixed(3) + ')');
    if (cr.faded) parts.push('contrast(' + (1 - cr.faded / 220).toFixed(3) + ') brightness(' + (1 + cr.faded / 260).toFixed(3) + ')');
    const sat = (b.saturation / 100) * (cr.saturation / 100) * (1 + cr.vibrance / 160);
    if (Math.abs(sat - 1) > .001) parts.push('saturate(' + clamp(sat, 0, 4).toFixed(3) + ')');
    if (b.temperature || b.tint) parts.push('hue-rotate(' + ((b.temperature * .18 - b.tint * .12)).toFixed(1) + 'deg)');
    if (b.temperature > 0) parts.push('sepia(' + clamp(b.temperature / 250, 0, .8).toFixed(3) + ')');
    if (b.highlights || b.shadows || b.whites || b.blacks) {
      const lift = (b.shadows + b.blacks) / 200, gain = (b.highlights + b.whites) / 200;
      parts.push('brightness(' + clamp(1 + lift * .35 + gain * .12, .2, 2.4).toFixed(3) + ')');
    }
    const sf = svgFilterFor(clip, L);
    if (sf) parts.push(sf);
    return parts.join(' ');
  };
  COLOR.dropCache = function (clipId) { if (!clipId) { filterCache.clear(); return; } const c = filterCache.get('ffc-' + clipId); if (c) { try { c.node.remove(); } catch (e) {} filterCache.delete('ffc-' + clipId); } };

  /* ------------------------------ Lumetri scopes ------------------------------ */
  COLOR.drawScope = function (canvas, type, srcCanvas) {
    if (!canvas || !srcCanvas) return;
    const w = canvas.width = canvas.clientWidth || 260, h = canvas.height = canvas.clientHeight || 120;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#0d0d10'; g.fillRect(0, 0, w, h);
    let data;
    try {
      const tmp = COLOR._sample || (COLOR._sample = document.createElement('canvas'));
      tmp.width = 160; tmp.height = 90;
      const tg = tmp.getContext('2d', { willReadFrequently: true }); tg.drawImage(srcCanvas, 0, 0, 160, 90);
      data = tg.getImageData(0, 0, 160, 90).data;
    } catch (e) { return; }
    g.strokeStyle = 'rgba(255,255,255,.07)'; g.lineWidth = 1;
    for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(0, h * i / 4); g.lineTo(w, h * i / 4); g.stroke(); }
    if (type === 'histogram') {
      const bins = new Array(64).fill(0);
      for (let i = 0; i < data.length; i += 4) { const l = (data[i] * .2126 + data[i + 1] * .7152 + data[i + 2] * .0722) / 255; bins[Math.min(63, (l * 63) | 0)]++; }
      const max = Math.max(1, ...bins);
      ['r', 'g', 'b'].forEach((ch, ci) => {
        const bb = new Array(64).fill(0);
        for (let i = 0; i < data.length; i += 4) bb[Math.min(63, (data[i + ci] / 255 * 63) | 0)]++;
        g.strokeStyle = ['rgba(255,90,90,.8)', 'rgba(90,255,120,.8)', 'rgba(100,150,255,.8)'][ci];
        g.beginPath();
        bb.forEach((v, i) => { const X = i / 63 * w, Y = h - (v / max) * h * .92; i ? g.lineTo(X, Y) : g.moveTo(X, Y); });
        g.stroke();
      });
    } else if (type === 'waveform') {
      g.fillStyle = 'rgba(90,220,140,.35)';
      for (let X = 0; X < w; X += 2) {
        const sx = Math.floor(X / w * 160);
        for (let sy = 0; sy < 90; sy += 2) {
          const i = (sy * 160 + sx) * 4;
          const l = (data[i] * .2126 + data[i + 1] * .7152 + data[i + 2] * .0722) / 255;
          g.fillRect(X, h - l * h, 2, 2);
        }
      }
    } else {
      const cx = w / 2, cy = h / 2, R = Math.min(w, h) * .44;
      g.strokeStyle = 'rgba(255,255,255,.16)'; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
      g.fillStyle = 'rgba(120,220,255,.5)';
      for (let i = 0; i < data.length; i += 16) {
        const r = data[i] / 255, gg = data[i + 1] / 255, b = data[i + 2] / 255;
        const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), d = mx - mn;
        if (d < .02) continue;
        let hue = 0;
        if (mx === r) hue = ((gg - b) / d) % 6; else if (mx === gg) hue = (b - r) / d + 2; else hue = (r - gg) / d + 4;
        hue *= Math.PI / 3;
        g.fillRect(cx + Math.cos(hue) * d * R, cy + Math.sin(hue) * d * R, 1.5, 1.5);
      }
    }
  };

  /* =========================================================================
     Renderer — покадровый рендер в Blob (Render & Replace / Proxy / Quick Export)
     ========================================================================= */
  async function renderRange(start, end, w, h, fps, onProgress) {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    const stream = cv.captureStream(0);
    const audio = M().recordStream();
    if (audio && audio.getAudioTracks) audio.getAudioTracks().forEach(t => { try { stream.addTrack(t); } catch (e) {} });
    const mime = E().supportedMime();
    const opts = { videoBitsPerSecond: 6000000 }; if (mime) opts.mimeType = mime;
    const rec = new MediaRecorder(stream, opts);
    const chunks = [];
    rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    const done = new Promise(res => { rec.onstop = res; });
    const track = stream.getVideoTracks()[0];
    rec.start(200);
    const eng = E(), total = Math.max(1, Math.round((end - start) * fps));
    for (let i = 0; i <= total; i++) {
      const t = start + i / fps;
      try { eng.syncMedia(t); eng.drawTo(ctx, w, h, t, { drawSlate: false }); } catch (e) {}
      if (track && track.requestFrame) track.requestFrame();
      if (onProgress && i % 4 === 0) onProgress(i / total, t);
      await new Promise(r => setTimeout(r, Math.max(8, 1000 / fps)));
    }
    rec.stop(); await done;
    return new Blob(chunks, { type: mime || 'video/webm' });
  }
  PRO.renderRange = renderRange;

  /** Отдельное скрытое видео для покадрового анализа — не мешает воспроизведению. */
  async function analysisVideo(clip) {
    const m = S.findMedia(clip.mediaId);
    if (!m || !m.url) return null;
    const v = document.createElement('video');
    v.src = m.url; v.muted = true; v.playsInline = true; v.preload = 'auto';
    v.style.cssText = 'position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
    document.body.appendChild(v);
    try {
      if (v.readyState < 2) await new Promise((res, rej) => {
        const to = setTimeout(() => res(), 4500);
        v.addEventListener('loadeddata', () => { clearTimeout(to); res(); }, { once: true });
        v.addEventListener('error', () => { clearTimeout(to); rej(new Error('Нет данных')); }, { once: true });
      });
    } catch (e) { v.remove(); return null; }
    if (!v.videoWidth) { v.remove(); return null; }
    return v;
  }
  PRO.analysisVideo = analysisVideo;
  async function seekFrame(v, t) {
    try {
      const target = clamp(t, 0, Math.max(0, (isFinite(v.duration) ? v.duration : t) - .04));
      v.currentTime = target;
      await new Promise(r => { let done = false; const fin = () => { if (!done) { done = true; r(); } }; v.addEventListener('seeked', fin, { once: true }); setTimeout(fin, 130); });
    } catch (e) { await new Promise(r => setTimeout(r, 60)); }
  }

  /* =========================================================================
     Команды
     ========================================================================= */
  const C = PRO.cmd = {};

  C.threePoint = function (mode) {
    if (!S.source.mediaId) { U.toast('Откройте клип в исходном мониторе', 'warn'); return; }
    const srcLen = S.source.outPoint - S.source.inPoint;
    if (srcLen <= 0) { U.toast('Задайте точки входа/выхода в исходном мониторе', 'warn'); return; }
    let dest = mode === 'insert' ? (S.project.seqIn || S.playhead) : (S.project.seqIn || S.playhead);
    let out = S.project.seqOut || 0;
    // Три точки: если заданы вход и выход последовательности, но не задан исходный выход —
    // вычисляем его; если задан только вход — используем исходный диапазон.
    if (S.project.seqIn && S.project.seqOut && S.project.seqOut > S.project.seqIn) {
      S.source.outPoint = S.source.inPoint + (S.project.seqOut - S.project.seqIn);
      U.status('Трёхточечный монтаж: длительность взята из программы', null, true);
    }
    S.playhead = dest;
    T().insertSource(mode === 'insert' ? 'insert' : 'overwrite');
  };
  C.matchFrame = function (reverse) {
    const t = S.playhead;
    const c = S.allClips().filter(cl => t >= cl.start && t < S.clipEnd(cl) && !cl.disabled).sort((a, b) => a.start - b.start)[0];
    if (!c) { U.toast('В точке курсора нет клипа', 'warn'); return; }
    const local = t - c.start;
    if (reverse) {
      S.source.position = c.inPoint + PRO.sourceTime(c, local);
      E().updateSourceUI();
      U.toast('Обратное совмещение: исходный курсор установлен', 'success');
    } else {
      E().openSource(c.mediaId);
      S.source.inPoint = c.inPoint; S.source.outPoint = c.outPoint;
      S.source.position = c.inPoint + PRO.sourceTime(c, local);
      E().sourceSeek(S.source.position); E().updateSourceUI();
      U.toast('Совмещение кадра: клип открыт в исходном мониторе', 'success');
    }
  };
  C.toggleSyncLock = function (trackId) {
    const track = S.findTrack(trackId || (selClip() && selClip().trackId) || (S.project.tracks.find(t => t.target) || {}).id);
    if (!track) return;
    S.change('Синхронизация дорожки', () => { track.syncLock = track.syncLock === false; });
    PRO.refresh && PRO.refresh();
    U.toast(track.name + ': Sync Lock ' + (track.syncLock !== false ? 'вкл' : 'выкл'));
  };
  C.toggleTrackLock = function (trackId) {
    const track = S.findTrack(trackId || (selClip() && selClip().trackId) || (S.project.tracks.find(t => t.target) || {}).id);
    if (!track) return;
    S.change('Блокировка дорожки', () => { track.locked = !track.locked; });
    PRO.refresh && PRO.refresh();
  };
  C.nest = function () {
    const ids = new Set(S.selection);
    const clips = S.allClips().filter(c => ids.has(c.id));
    if (clips.length < 1) { U.toast('Выберите клипы для вложения', 'warn'); return; }
    const min = Math.min(...clips.map(c => c.start)), max = Math.max(...clips.map(c => S.clipEnd(c)));
    const byTrack = new Map();
    clips.forEach(c => {
      if (!byTrack.has(c.trackId)) byTrack.set(c.trackId, []);
      byTrack.get(c.trackId).push(Object.assign({}, c, { start: c.start - min, x: JSON.parse(JSON.stringify(c.x || {})) }));
    });
    const tracks = Array.from(byTrack.entries()).map(([id, list], i) => {
      const src = S.findTrack(id) || {};
      return { id: uid('tr'), type: src.type || 'video', name: (src.type === 'audio' ? 'A' : 'V') + (i + 1), clips: list, hidden: false };
    });
    const nm = { id: uid('media'), name: 'Вложенная ' + (clips.length > 1 ? clips.length + ' клипов' : clips[0].name), type: 'nest', generated: true, data: { tracks: tracks }, duration: max - min, width: S.project.width, height: S.project.height, hasAudio: true, thumb: null, offline: false, url: null, fileName: null, x: {} };
    const track = S.findTrack(clips[0].trackId);
    S.change('Вложенная последовательность', () => {
      S.project.media.push(nm);
      S.project.tracks.forEach(t => { t.clips = t.clips.filter(c => !ids.has(c.id)); });
      const nc = S.newClip(nm.id, track.id, min, { generatedDuration: max - min });
      nc.name = nm.name; track.clips.push(nc);
      S.selection.clear(); S.selection.add(nc.id);
    });
    PRO.refresh(); U.toast('Создана вложенная последовательность', 'success');
  };
  C.unnest = function () {
    const c = needClip(); if (!c) return;
    const m = S.findMedia(c.mediaId);
    if (!m || m.type !== 'nest') { U.toast('Это не вложенная последовательность', 'warn'); return; }
    S.change('Развернуть вложение', () => {
      const track = S.findTrack(c.trackId);
      track.clips = track.clips.filter(q => q.id !== c.id);
      (m.data.tracks || []).forEach(nt => {
        let t = S.project.tracks.find(q => q.type === nt.type);
        if (!t) { t = S.addTrack(nt.type); }
        (nt.clips || []).forEach(q => { const n = Object.assign({}, q, { id: uid('clip'), trackId: t.id, start: q.start + c.start }); t.clips.push(n); });
      });
    });
    PRO.refresh();
  };
  C.multicam = function () {
    let clips = S.allClips().filter(c => S.selection.has(c.id));
    if (clips.length < 2) {
      // Удобство: если явного выделения нет, берём клипы в точке курсора,
      // иначе — первые несколько видеоклипов.
      const at = S.allClips().filter(c => S.playhead >= c.start && S.playhead < S.clipEnd(c) && !c.disabled);
      const pool = (at.length >= 2 ? at : S.allClips().filter(c => { const m = S.findMedia(c.mediaId); return m && m.type !== 'audio' && !c.disabled; })).slice(0, 6);
      if (pool.length < 2) { U.toast('Нужно минимум 2 клипа-ракурса', 'warn'); return; }
      clips = pool;
    }
    clips = clips.slice(0, 9);
    const start = Math.min(...clips.map(c => c.start));
    const dur = Math.max(...clips.map(c => S.clipEnd(c))) - start;
    const angles = clips.map(c => c.mediaId);
    const nm = { id: uid('media'), name: 'Мультикам ' + angles.length, type: 'multicam', generated: true, data: { angles: angles }, duration: dur, width: S.project.width, height: S.project.height, hasAudio: true, thumb: null, offline: false, url: null, fileName: null, x: { multicam: { angles: angles, switches: [], active: 0 } } };
    const track = S.findTrack(clips[0].trackId);
    S.change('Создание мультикама', () => {
      S.project.media.push(nm);
      S.project.tracks.forEach(t => { t.clips = t.clips.filter(c => !S.selection.has(c.id)); });
      const nc = S.newClip(nm.id, track.id, start, { generatedDuration: dur });
      nc.x.multicam = { angles: angles, switches: [], active: 0 };
      nc.name = nm.name; track.clips.push(nc);
      S.selection.clear(); S.selection.add(nc.id);
      x(S.project).multicam = { active: 0, angles: angles.map((id, i) => 'Камера ' + (i + 1)) };
    });
    PRO.refresh(); U.toast('Мультикам создан — переключайте ракурсы в мониторе', 'success');
  };
  C.switchAngle = function (n) {
    const c = selClip(); const mc = c && multicam(c);
    if (!mc) { const q = x(S.project).multicam; if (q) { q.active = clamp(n, 0, q.angles.length - 1); PRO.refresh(); } else U.toast('Мультикам не создан', 'warn'); return; }
    S.change('Переключение ракурса', () => {
      if (S.playing) (mc.switches = mc.switches || []).push({ t: S.playhead - c.start, angle: n });
      mc.active = n; x(S.project).multicam = x(S.project).multicam || { angles: mc.angles.map((_, i) => 'Камера ' + (i + 1)) };
      x(S.project).multicam.active = n;
    });
    PRO.refresh();
  };
  C.timeRemapDialog = function () {
    const c = needClip(); if (!c) return;
    const r = remap(c) || initRemap(c);
    const body = el('div');
    const draw = () => {
      body.innerHTML = '<div class="form-note">Time Remapping — grafik «время последовательности → время источника». Точки можно добавлять в точке курсора.</div>' +
        '<div class="remap-list">' + r.keys.map((k, i) => '<div class="remap-row"><span>#' + i + '</span><span>t ' + k.t.toFixed(2) + ' c</span><span>→ source ' + k.s.toFixed(2) + ' c</span><button class="icon-btn tiny" data-del="' + i + '">' + U.icon('trash') + '</button></div>').join('') + '</div>' +
        '<div class="form-row"><label>Источник в курсоре</label><div class="form-control"><input type="number" id="trSrc" step="0.1" value="' + PRO.sourceTime(c, S.playhead - c.start).toFixed(2) + '"><span class="unit">c</span></div></div>' +
        '<div class="btn-group"><button class="btn small" id="trAdd">Добавить точку</button><button class="btn small" id="trFreeze">Заморозить кадр</button><button class="btn small" id="trReverse">Реверс</button><button class="btn small" id="trRamp">Разгон 2×</button><button class="btn small" id="trReset">Сбросить</button></div>';
      $$('[data-del]', body).forEach(b => b.onclick = () => { if (r.keys.length > 2) { r.keys.splice(Number(b.dataset.del), 1); commitRemap(c); draw(); PRO.refresh(); } });
      $('#trAdd', body).onclick = () => {
        const t = clamp(S.playhead - c.start, 0, S.clipDuration(c) - .04);
        r.keys.push({ t: t, s: Number($('#trSrc', body).value) || 0 }); commitRemap(c); draw(); PRO.refresh();
      };
      $('#trFreeze', body).onclick = () => { const t = clamp(S.playhead - c.start, .04, S.clipDuration(c) - .04), s = PRO.sourceTime(c, t); r.keys = [{ t: 0, s: 0 }, { t: t, s: s }, { t: S.clipDuration(c), s: s }]; commitRemap(c); draw(); PRO.refresh(); };
      $('#trReverse', body).onclick = () => { const d = S.clipDuration(c), sl = Math.max(.001, c.outPoint - c.inPoint); r.keys = [{ t: 0, s: sl }, { t: d, s: 0 }]; c.outPoint = c.inPoint + d; commitRemap(c); draw(); PRO.refresh(); };
      $('#trRamp', body).onclick = () => { const d = S.clipDuration(c), sl = Math.max(.001, c.outPoint - c.inPoint); r.keys = [{ t: 0, s: 0 }, { t: d * .5, s: sl * .25 }, { t: d, s: sl }]; commitRemap(c); draw(); PRO.refresh(); };
      $('#trReset', body).onclick = () => { delete x(c).remap; draw(); PRO.refresh(); };
    };
    draw();
    U.modal({ title: 'Перегон времени (Time Remapping)', icon: 'speed', wide: true, body: body, buttons: [
      { label: 'Готово', class: 'primary', action: () => { commitRemap(c); PRO.refresh(); } }
    ] });
  };
  C.interpret = function () {
    const c = selClip(); const m = S.findMedia(c ? c.mediaId : S.source.mediaId);
    if (!m || m.generated) { U.toast('Выберите импортированный клип', 'warn'); return; }
    const i = interpret(m);
    U.modal({
      title: 'Интерпретация материала — ' + m.name, icon: 'sliders',
      body: '<div class="form-row"><label>Предполагаемая частота кадров</label><div class="form-control"><input type="number" id="ifFps" min="0" step="0.01" value="' + (i.fps || '') + '"><span class="unit">0 = как есть</span></div></div>' +
        '<div class="form-row"><label>Исходная частота кадров</label><div class="form-control"><input type="number" id="ifSrc" min="1" step="0.01" value="' + (i.srcFps || S.project.fps) + '"></div></div>' +
        '<div class="form-row"><label>Пропорции пикселя (PAR)</label><div class="form-control"><input type="number" id="ifPar" min="0.25" max="4" step="0.01" value="' + i.par + '"></div></div>' +
        '<div class="form-row"><label>Альфа-канал</label><div class="form-control"><select id="ifAlpha"><option value="straight">Прямая</option><option value="ignore">Игнорировать</option><option value="premultiplied">Предумноженная</option></select></div></div>' +
        '<div class="form-row"><label>Аудиоканалы</label><div class="form-control"><select id="ifCh"><option value="2">Стерео</option><option value="1">Моно</option></select></div></div>' +
        '<div class="form-row"><label>Реверс</label><div class="form-control"><label class="mini-check"><input type="checkbox" id="ifRev"> Обратное воспроизведение</label></div></div>' +
        '<div class="form-note">Изменение частоты кадров масштабирует длительность через перегон времени. PAR влияет на отображение кадра.</div>',
      onOpen: b => { $('#ifAlpha', b).value = i.alpha; $('#ifCh', b).value = String(i.channels); $('#ifRev', b).checked = !!i.reverse; },
      buttons: [{ label: 'Отмена' }, { label: 'Применить', class: 'primary', action: b => {
        S.change('Интерпретация материала', () => {
          const q = interpret(m);
          q.fps = Number($('#ifFps', b).value) || 0; q.srcFps = Number($('#ifSrc', b).value) || S.project.fps;
          q.par = Number($('#ifPar', b).value) || 1; q.alpha = $('#ifAlpha', b).value;
          q.channels = Number($('#ifCh', b).value); q.reverse = $('#ifRev', b).checked;
          if (q.reverse) { const cl = selClip(); if (cl) { const r = initRemap(cl), d = S.clipDuration(cl), sl = Math.max(.001, cl.outPoint - cl.inPoint); r.keys = [{ t: 0, s: sl }, { t: d, s: 0 }]; cl.outPoint = cl.inPoint + d; commitRemap(cl); } }
          COLOR.dropCache && COLOR.dropCache();
        });
        PRO.refresh(); U.toast('Интерпретация применена', 'success');
      } }]
    });
  };
  C.ingestSettings = function () {
    const g = ingest();
    U.modal({ title: 'Настройки захвата (Ingest Settings)', icon: 'settings',
      body: '<div class="form-row"><label>Режим</label><div class="form-control"><select id="igMode"><option value="copy">Копировать в проект (локально)</option><option value="link">Только ссылка</option><option value="transcode">Перекодировать</option></select></div></div>' +
        '<div class="form-row"><label>Пресет прокси</label><div class="form-control"><select id="igProxy"><option value="360p">360p</option><option value="480p">480p</option><option value="720p">720p</option></select></div></div>' +
        '<div class="form-row"><label>Авто-прокси</label><div class="form-control"><label class="mini-check"><input type="checkbox" id="igAuto"> Создавать прокси при импорте</label></div></div>' +
        '<div class="form-note">В браузере нет доступа к файловой системе: «копирование» означает создание Blob URL и сохранение структуры проекта. Прокси создаётся локальным перекодированием через MediaRecorder.</div>',
      onOpen: b => { $('#igMode', b).value = g.mode; $('#igProxy', b).value = g.proxyPreset; $('#igAuto', b).checked = !!g.createProxies; },
      buttons: [{ label: 'Отмена' }, { label: 'Сохранить', class: 'primary', action: b => { g.mode = $('#igMode', b).value; g.proxyPreset = $('#igProxy', b).value; g.createProxies = $('#igAuto', b).checked; S.markDirty(); U.toast('Настройки захвата сохранены', 'success'); } }]
    });
  };
  C.proxy = async function () {
    const c = selClip(); const m = S.findMedia(c ? c.mediaId : S.source.mediaId);
    if (!m || !m.url) { U.toast('Выберите импортированный онлайн-клип', 'warn'); return; }
    const q = x(m);
    if (q.proxy && q.proxy.url) {
      U.modal({ title: 'Прокси — ' + m.name, icon: 'layers',
        body: '<div class="form-note">Прокси: ' + q.proxy.width + '×' + q.proxy.height + ', WebM. originalUrl сохранён.</div>' +
          '<div class="form-row"><label>Использовать прокси</label><div class="form-control"><label class="mini-check"><input type="checkbox" id="pxOn" ' + (q.proxy.enabled ? 'checked' : '') + '> Подменить оригинал</label></div></div>',
        buttons: [{ label: 'Отмена' }, { label: 'Применить', class: 'primary', action: b => { const on = $('#pxOn', b).checked; q.proxy.enabled = on; if (on) { q.proxy.originalUrl = q.proxy.originalUrl || m.url; m.url = q.proxy.url; } else if (q.proxy.originalUrl) m.url = q.proxy.originalUrl; M().resetRuntime(); PRO.refresh(); U.toast(on ? 'Прокси включён' : 'Оригинал восстановлен', 'success'); } }]
      });
      return;
    }
    U.toast('Создание прокси…', null, 4000);
    try {
      const preset = ingest().proxyPreset || '480p';
      const h = preset === '360p' ? 360 : preset === '720p' ? 720 : 480;
      const w = Math.round(h * (m.width && m.height ? m.width / m.height : S.project.width / S.project.height));
      const src = document.createElement('video');
      src.src = m.url; src.muted = true; src.playsInline = true; src.preload = 'auto';
      await new Promise((res, rej) => { src.onloadeddata = res; src.onerror = () => rej(new Error('Не удалось загрузить медиа')); setTimeout(res, 4000); });
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d');
      const stream = cv.captureStream(0);
      const mime = E().supportedMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 1200000 } : { videoBitsPerSecond: 1200000 });
      const chunks = []; rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      const done = new Promise(res => rec.onstop = res);
      const track = stream.getVideoTracks()[0];
      rec.start(200);
      const dur = Math.min(isFinite(src.duration) ? src.duration : 10, 60);
      const fps = 15;
      for (let i = 0; i < dur * fps; i++) {
        const t = i / fps;
        try { src.currentTime = t; await new Promise(r => { src.onseeked = r; setTimeout(r, 80); }); ctx.drawImage(src, 0, 0, w, h); } catch (e) {}
        if (track && track.requestFrame) track.requestFrame();
        await new Promise(r => setTimeout(r, 1000 / fps));
      }
      rec.stop(); await done;
      const blob = new Blob(chunks, { type: mime || 'video/webm' });
      q.proxy = { url: URL.createObjectURL(blob), width: w, height: h, enabled: false, originalUrl: m.url, size: blob.size };
      src.removeAttribute('src'); src.load();
      S.markDirty(); PRO.refresh();
      U.toast('Прокси создан (' + (blob.size / 1024 / 1024).toFixed(1) + ' МБ). Включите его повторным вызовом команды.', 'success', 6000);
    } catch (e) { U.toast('Ошибка прокси: ' + e.message, 'error'); }
  };
  C.linkMedia = function () {
    const ids = Array.from(S.selection);
    if (ids.length < 2) { U.toast('Выделите 2 клипа (видео + аудио)', 'warn'); return; }
    S.change('Связать клипы', () => {
      for (let i = 0; i < ids.length; i++) { const a = S.findClip(ids[i]), b = S.findClip(ids[(i + 1) % ids.length]); if (a && b) { a.linkedTo = b.id; b.linkedTo = a.id; } }
    });
    PRO.refresh(); U.toast('Клипы связаны', 'success');
  };
  C.linkUnlinkUI = function () {
    U.dropdown($('#projectsBtn') || document.body, [
      { label: 'Связать выбранные клипы', icon: 'link', action: () => C.linkMedia() },
      { label: 'Разорвать связь', icon: 'unlock', action: () => C.unlinkMedia() },
      { label: 'Связь A/V при перемещении', icon: 'link', checked: S.settings.linkAV, action: () => { S.settings.linkAV = !S.settings.linkAV; S.markDirty(); U.toast('Связь A/V: ' + (S.settings.linkAV ? 'вкл' : 'выкл')); } }
    ]);
  };
  C.unlinkMedia = function () {
    const ids = Array.from(S.selection); if (!ids.length) return;
    S.change('Разорвать связь', () => ids.forEach(id => { const c = S.findClip(id); if (c) delete c.linkedTo; }));
    PRO.refresh(); U.toast('Связи разорваны', 'success');
  };
  C.audioGain = function () {
    const c = needClip(); if (!c) return;
    const a = audioFX(c);
    U.modal({ title: 'Усиление звука (Audio Gain) — ' + c.name, icon: 'volume',
      body: '<div class="form-row"><label>Усиление</label><div class="form-control"><input type="number" id="agDb" step="0.5" value="' + a.gainDb + '"><span class="unit">дБ</span></div></div>' +
        '<div class="form-row"><label>Громкость клипа</label><div class="form-control"><input type="range" id="agVol" min="0" max="400" value="' + c.audio.volume + '"><span class="unit" id="agVal">' + c.audio.volume + '%</span></div></div>' +
        '<div class="form-row"><label>Метка Essential Sound</label><div class="form-control"><select id="agTag"><option value="auto">Авто</option><option value="dialogue">Диалог</option><option value="music">Музыка</option><option value="ambience">Атмосфера</option><option value="sfx">Эффекты</option></select></div></div>' +
        '<div class="form-row"><label>Улучшить речь</label><div class="form-control"><input type="range" id="agEnh" min="0" max="100" value="' + a.enhance + '"></div></div>' +
        '<div class="form-row"><label>Шумоподавление</label><div class="form-control"><input type="range" id="agNoise" min="0" max="100" value="' + a.reduceNoise + '"></div></div>' +
        '<div class="form-row"><label>Автозатухание (ducking)</label><div class="form-control"><label class="mini-check"><input type="checkbox" id="agDuck" ' + (a.duck ? 'checked' : '') + '> Приглушать при громком диалоге</label></div></div>',
      onOpen: b => { $('#agTag', b).value = a.tag; $('#agVol', b).oninput = e => $('#agVal', b).textContent = e.target.value + '%'; },
      buttons: [{ label: 'Отмена' }, { label: 'Применить', class: 'primary', action: b => {
        S.change('Усиление звука', () => {
          const q = audioFX(c); Object.assign(x(c).audioFX, q);
          c.audio.volume = Number($('#agVol', b).value);
          x(c).audioFX.gainDb = Number($('#agDb', b).value) || 0;
          x(c).audioFX.tag = $('#agTag', b).value;
          x(c).audioFX.enhance = Number($('#agEnh', b).value);
          x(c).audioFX.reduceNoise = Number($('#agNoise', b).value);
          x(c).audioFX.duck = $('#agDuck', b).checked;
          const tr = S.findTrack(c.trackId); if (tr && x(c).audioFX.tag !== 'auto') x(tr).audioTag = x(c).audioFX.tag;
        });
        PRO.refresh(); U.toast('Звук настроен', 'success');
      } }]
    });
  };
  C.essentialSound = function (tag) {
    const c = needClip(); if (!c) return;
    const presets = {
      dialogue: { enhance: 45, reduceNoise: 30, duck: false, gainDb: 3 },
      music: { enhance: 0, reduceNoise: 0, duck: true, gainDb: -4, duckAmount: 65 },
      ambience: { enhance: 10, reduceNoise: 20, duck: true, gainDb: -6, duckAmount: 45 },
      sfx: { enhance: 15, reduceNoise: 10, duck: false, gainDb: 0 }
    };
    const p = presets[tag] || presets.dialogue;
    S.change('Essential Sound: ' + tag, () => {
      const a = x(c).audioFX = Object.assign(audioFX(c), p, { tag: tag });
      const tr = S.findTrack(c.trackId); if (tr) x(tr).audioTag = tag;
    });
    PRO.refresh(); U.toast('Пресет «' + tag + '» применён', 'success');
  };
  C.addMask = function (type) {
    const c = needClip(); if (!c) return;
    S.change('Добавление маски', () => masks(c).push({ type: type, x: 50, y: 50, w: 55, h: 55, feather: 0, enabled: true, keys: [] }));
    PRO.refresh(); U.toast((type === 'ellipse' ? 'Эллиптическая' : 'Прямоугольная') + ' маска добавлена', 'success');
  };
  C.maskKey = function () {
    const c = needClip(); if (!c) return;
    const list = masks(c); if (!list.length) { U.toast('Сначала добавьте маску', 'warn'); return; }
    S.change('Ключ маски', () => {
      const t = clamp(S.playhead - c.start, 0, S.clipDuration(c));
      list.forEach(m => { m.keys = m.keys || []; const i = m.keys.findIndex(k => Math.abs(k.t - t) < .02); const k = { t: t, x: m.x, y: m.y, w: m.w, h: m.h }; if (i >= 0) m.keys[i] = k; else m.keys.push(k); m.keys.sort((a, b) => a.t - b.t); });
    });
    PRO.refresh(); U.toast('Ключевой кадр маски добавлен', 'success');
  };
  C.trackMask = async function () {
    const c = needClip(); if (!c) return;
    const list = masks(c); if (!list.length) { U.toast('Сначала добавьте маску', 'warn'); return; }
    const m = list[0]; const v = await analysisVideo(c);
    if (!v) { U.toast('Для трекинга нужен импортированный видеоклип', 'warn'); return; }
    const tmp = document.createElement('canvas'); tmp.width = 80; tmp.height = 45;
    const g = tmp.getContext('2d', { willReadFrequently: true });
    const keys = [];
    const d = Math.min(S.clipDuration(c), 10), n = 20;
    for (let i = 0; i <= n; i++) {
      const t = c.inPoint + (d / n) * i * (c.speed || 1);
      try { await seekFrame(v, t); g.drawImage(v, 0, 0, 80, 45); } catch (e) { continue; }
      const data = g.getImageData(0, 0, 80, 45).data;
      let sx = 0, sy = 0, sw = 0;
      for (let yy = 0; yy < 45; yy += 2) for (let xx = 0; xx < 80; xx += 2) {
        const j = (yy * 80 + xx) * 4, lum = (data[j] + data[j + 1] + data[j + 2]) / 765;
        const wgt = Math.pow(lum, 2); sx += xx * wgt; sy += yy * wgt; sw += wgt;
      }
      if (sw > 0) keys.push({ t: (d / n) * i, x: clamp(sx / sw / 80 * 100, 2, 98), y: clamp(sy / sw / 45 * 100, 2, 98), w: m.w, h: m.h });
    }
    v.remove();
    if (!keys.length) { U.toast('Не удалось отследить объект', 'warn'); return; }
    S.change('Трекинг маски', () => { m.keys = keys; });
    PRO.refresh(); U.toast('Трекинг завершён: ' + keys.length + ' ключей (яркостный центроид)', 'success');
  };
  C.autoReframe = async function () {
    const c = needClip(); if (!c) return;
    const v = await analysisVideo(c);
    if (!v) { U.toast('Для Auto Reframe нужен импортированный видеоклип', 'warn'); return; }
    {
      const tmp = document.createElement('canvas'); tmp.width = 64; tmp.height = 36;
      const g = tmp.getContext('2d', { willReadFrequently: true }); const keys = [];
      const d = Math.min(S.clipDuration(c), 12), n = 18;
      for (let i = 0; i <= n; i++) {
        const t = c.inPoint + (d / n) * i * (c.speed || 1);
        try { await seekFrame(v, t); g.drawImage(v, 0, 0, 64, 36); } catch (e) { continue; }
        const data = g.getImageData(0, 0, 64, 36).data;
        let sx = 0, sw = 0;
        for (let yy = 0; yy < 36; yy += 2) for (let xx = 0; xx < 64; xx += 2) {
          const j = (yy * 64 + xx) * 4, lum = (data[j] * .2126 + data[j + 1] * .7152 + data[j + 2] * .0722) / 255;
          const wgt = Math.pow(lum, 3); sx += xx * wgt; sw += wgt;
        }
        if (sw > 0) keys.push({ t: (d / n) * i, x: clamp((sx / sw / 64 - .5) * 38, -30, 30) });
      }
      v.remove();
      if (!keys.length) { U.toast('Не удалось выполнить авто-кадрирование', 'warn'); return; }
      S.change('Auto Reframe', () => {
        c.transform.scale = 118; c.transform.fit = 'fill';
        c.keys['transform.x'] = keys.map(k => ({ t: k.t, v: k.x, ease: 'ease' }));
      });
      PRO.refresh(); U.toast('Auto Reframe: ' + keys.length + ' ключей позиции', 'success');
    }
  };
  C.warpStabilizer = async function () {
    const c = needClip(); if (!c) return;
    const v = await analysisVideo(c);
    if (!v) { U.toast('Для стабилизации нужен импортированный видеоклип', 'warn'); return; }
    {
      const tmp = document.createElement('canvas'); tmp.width = 48; tmp.height = 27;
      const g = tmp.getContext('2d', { willReadFrequently: true });
      let prev = null; const offsets = [];
      const d = Math.min(S.clipDuration(c), 10), n = 16, fps = S.project.fps;
      for (let i = 0; i <= n; i++) {
        const t = c.inPoint + (d / n) * i * (c.speed || 1);
        try { await seekFrame(v, t); g.drawImage(v, 0, 0, 48, 27); } catch (e) { continue; }
        const cur = g.getImageData(0, 0, 48, 27).data;
        let ox = 0, oy = 0;
        if (prev) {
          let best = 1e18;
          for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
            let sum = 0, cnt = 0;
            for (let y = 6; y < 21; y += 2) for (let xx = 6; xx < 42; xx += 2) {
              const j = (y * 48 + xx) * 4, yy = y + dy, xx2 = xx + dx;
              if (yy < 0 || yy >= 27 || xx2 < 0 || xx2 >= 48) continue;
              const j2 = (yy * 48 + xx2) * 4;
              sum += Math.abs(cur[j] - prev[j2]); cnt++;
            }
            const score = sum / Math.max(1, cnt);
            if (score < best) { best = score; ox = dx; oy = dy; }
          }
        }
        offsets.push({ t: (d / n) * i, x: ox, y: oy });
        prev = new Uint8ClampedArray(cur);
      }
      // интегрируем смещения и сглаживаем (убираем низкочастотную тряску)
      let cx = 0, cy = 0; const path = offsets.map(o => { cx += o.x; cy += o.y; return { t: o.t, x: cx, y: cy }; });
      const smooth = path.map((p, i) => {
        let sx = 0, sy = 0, n2 = 0;
        for (let j = Math.max(0, i - 2); j <= Math.min(path.length - 1, i + 2); j++) { sx += path[j].x; sy += path[j].y; n2++; }
        return { t: p.t, x: -(p.x - sx / n2) / 48 * 100 * .35, y: -(p.y - sy / n2) / 27 * 100 * .35 };
      });
      v.remove();
      if (!smooth.length) { U.toast('Недостаточно кадров для стабилизации', 'warn'); return; }
      S.change('Warp Stabilizer', () => {
        c.transform.scale = 112; c.transform.fit = 'fill';
        c.keys['transform.x'] = smooth.map(k => ({ t: k.t, v: clamp(k.x, -18, 18), ease: 'ease' }));
        c.keys['transform.y'] = smooth.map(k => ({ t: k.t, v: clamp(k.y, -18, 18), ease: 'ease' }));
        x(c).stabilized = true;
      });
      PRO.refresh(); U.toast('Стабилизация: ' + smooth.length + ' ключей (локальный анализ движения)', 'success');
    }
  };
  C.generativeExtend = function () {
    const c = needClip(); if (!c) return;
    U.modal({ title: 'Generative Extend', icon: 'film',
      body: '<div class="form-note">В браузере нет генеративной модели. Локальный аналог продлевает клип за счёт повтора/заморозки граничных кадров с медленным масштабированием.</div>' +
        '<div class="form-row"><label>Продлить вправо</label><div class="form-control"><input type="number" id="geAfter" min="0" max="20" step="0.5" value="2"><span class="unit">c</span></div></div>' +
        '<div class="form-row"><label>Продлить влево</label><div class="form-control"><input type="number" id="geBefore" min="0" max="20" step="0.5" value="0"><span class="unit">c</span></div></div>' +
        '<div class="form-row"><label>Режим</label><div class="form-control"><select id="geMode"><option value="hold">Заморозить кадр</option><option value="pingpong">Пинг-понг (реверс)</option></select></div></div>',
      buttons: [{ label: 'Отмена' }, { label: 'Продлить', class: 'primary', action: b => {
        const after = Number($('#geAfter', b).value) || 0, before = Number($('#geBefore', b).value) || 0;
        const mode = $('#geMode', b).value;
        S.change('Generative Extend', () => {
          const q = x(c); q.extend = { after: after, before: before, mode: mode, originalDur: S.clipDuration(c) };
          if (before > 0) { c.start = Math.max(0, c.start - before); }
          const r = initRemap(c);
          const d = (q.extend.originalDur || S.clipDuration(c)), sl = Math.max(.001, c.outPoint - c.inPoint);
          const t0 = before, t1 = t0 + d, t2 = t1 + after;
          r.keys = mode === 'pingpong' ? [
            { t: 0, s: before > 0 ? Math.min(sl, before) : 0 }, { t: t0, s: 0 }, { t: t1, s: sl }, { t: t2, s: Math.max(0, sl - after) }
          ] : [
            { t: 0, s: 0 }, { t: t1, s: sl }, { t: t2, s: sl }
          ];
          if (before > 0) r.keys.unshift({ t: 0, s: 0 });
          commitRemap(c);
          c.transitionIn = Math.max(c.transitionIn, .25);
          c.transitionOut = Math.max(c.transitionOut, .35);
        });
        PRO.refresh(); U.toast('Клип продлён локальным алгоритмом', 'success');
      } }]
    });
  };
  C.dynamicLink = function () {
    U.modal({ title: 'Adobe Dynamic Link', icon: 'link',
      body: '<div class="fx-hint">' + U.icon('info') + '<br><b>Dynamic Link недоступен в браузере.</b><br><br>Это проприетарный IPC между Adobe-приложениями (Premiere ↔ After Effects). В вебе нет доступа к процессу After Effects и его проектам.<br><br><b>Рабочая альтернатива:</b> «Render & Replace» — отрендерить выбранный фрагмент в WebM и заменить клип на готовый медиафайл, либо экспортировать композицию и импортировать её обратно.</div>',
      buttons: [{ label: 'Понятно' }, { label: 'Render & Replace', class: 'primary', action: () => C.renderAndReplace() }]
    });
  };
  C.renderAndReplace = async function () {
    const c = needClip(); if (!c) return;
    const start = c.start, end = S.clipEnd(c);
    if (end - start > 60) { U.toast('Фрагмент длиннее 60 с — сократите его', 'warn'); return; }
    const w = Math.min(1280, S.project.width), h = Math.round(w * S.project.height / S.project.width);
    U.toast('Render & Replace: рендер ' + (end - start).toFixed(1) + ' c…', null, 5000);
    try {
      const blob = await renderRange(start, end, w, h, Math.min(30, S.project.fps), (p) => U.status('Рендер: ' + Math.round(p * 100) + '%', 'busy'));
      const url = URL.createObjectURL(blob);
      const media = { id: uid('media'), name: c.name + ' (render)', fileName: c.name + '_render.webm', type: 'video', url: url, file: blob, duration: end - start, width: w, height: h, fps: S.project.fps, hasAudio: true, thumb: null, peaks: null, offline: false, generated: false, data: null, x: {} };
      S.change('Render & Replace', () => {
        S.project.media.push(media);
        S.project.tracks.forEach(t => { t.clips = t.clips.filter(q => q.id === c.id || S.clipEnd(q) <= start || q.start >= end); });
        const nc = S.newClip(media.id, c.trackId, start, { outPoint: end - start });
        nc.name = media.name; S.findTrack(c.trackId).clips.push(nc);
        S.selection.clear(); S.selection.add(nc.id);
      });
      M().resetRuntime(); PRO.refresh();
      U.toast('Готово: клип заменён отрендеренным WebM', 'success');
      U.status('Render & Replace завершён', null, true);
    } catch (e) { U.toast('Ошибка рендера: ' + e.message, 'error'); }
  };
  C.quickExport = function () {
    const q = x(S.project).quick || { width: S.project.width, height: S.project.height, fps: S.project.fps, bitrate: 8, range: 'entire', audio: true };
    if (E().startExport(q)) U.toast('Быстрый экспорт запущен', 'success');
  };
  C.speedRampPreset = function (kind) {
    const c = needClip(); if (!c) return;
    S.change('Скоростной профиль: ' + kind, () => {
      const r = initRemap(c), d = S.clipDuration(c), sl = Math.max(.001, c.outPoint - c.inPoint);
      if (kind === 'ramp-up') r.keys = [{ t: 0, s: 0 }, { t: d * .5, s: sl * .2 }, { t: d, s: sl }];
      else if (kind === 'ramp-down') r.keys = [{ t: 0, s: 0 }, { t: d * .5, s: sl * .8 }, { t: d, s: sl }];
      else if (kind === 'freeze') r.keys = [{ t: 0, s: 0 }, { t: d * .4, s: sl * .4 }, { t: d * .6, s: sl * .4 }, { t: d, s: sl }];
      commitRemap(c);
    });
    PRO.refresh(); U.toast('Скоростной профиль применён', 'success');
  };
  C.captionImport = function () { PPE.proPanels && PPE.proPanels.captionImport(); };
  C.speechToText = function () { PPE.proPanels && PPE.proPanels.speechToText(); };
  C.mogrt = function () { PPE.proPanels && PPE.proPanels.mogrtDialog(); };
  C.exportPanel = function () { PPE.proPanels && PPE.proPanels.showTab('export'); };
  C.colorPanel = function () { PPE.proPanels && PPE.proPanels.showTab('color'); };
  C.soundPanel = function () { PPE.proPanels && PPE.proPanels.showTab('sound'); };
  C.browserPanel = function () { PPE.proPanels && PPE.proPanels.showTab('browser'); };
  C.graphicsPanel = function () { PPE.proPanels && PPE.proPanels.showTab('graphics'); };
  C.commandPalette = function () { PPE.proPanels && PPE.proPanels.palette(); };

  PRO.refresh = function () { if (PPE.renderAll) PPE.renderAll(); else { T().render(); P().renderEffectControls(); } COLOR.dropCache(); };

  /* --------------------------- реестр всех функций --------------------------- */
  PRO.registry = [
    { group: 'Инструменты', name: 'Selection Tool', key: 'V', status: 'ok', run: () => T().setTool('select') },
    { group: 'Инструменты', name: 'Track Select Forward Tool', key: 'A', status: 'ok', run: () => T().setTool('trackForward') },
    { group: 'Инструменты', name: 'Track Select Backward Tool', key: 'Shift+A', status: 'ok', run: () => T().setTool('trackBackward') },
    { group: 'Инструменты', name: 'Ripple Edit Tool', key: 'B', status: 'ok', run: () => T().setTool('ripple') },
    { group: 'Инструменты', name: 'Rolling Edit Tool', key: 'N', status: 'ok', run: () => T().setTool('rolling') },
    { group: 'Инструменты', name: 'Rate Stretch Tool', key: 'R', status: 'ok', run: () => T().setTool('rateStretch') },
    { group: 'Инструменты', name: 'Razor Tool', key: 'C', status: 'ok', run: () => T().setTool('razor') },
    { group: 'Инструменты', name: 'Slip Tool', key: 'Y', status: 'ok', run: () => T().setTool('slip') },
    { group: 'Инструменты', name: 'Slide Tool', key: 'U', status: 'ok', run: () => T().setTool('slide') },
    { group: 'Инструменты', name: 'Pen Tool', key: 'P', status: 'ok', run: () => T().setTool('pen') },
    { group: 'Инструменты', name: 'Hand Tool', key: 'H', status: 'ok', run: () => T().setTool('hand') },
    { group: 'Инструменты', name: 'Zoom Tool', key: 'Z', status: 'ok', run: () => T().setTool('zoom') },
    { group: 'Инструменты', name: 'Type Tool', key: 'T', status: 'ok', run: () => T().setTool('type') },
    { group: 'Инструменты', name: 'Vertical Type Tool', status: 'ok', run: () => T().setTool('vtype') },
    { group: 'Инструменты', name: 'Rectangle Tool', status: 'ok', run: () => T().setTool('rect') },
    { group: 'Инструменты', name: 'Ellipse Tool', status: 'ok', run: () => T().setTool('ellipse') },
    { group: 'Медиа', name: 'Import', key: 'Ctrl+I', status: 'ok', run: () => $('#fileInput').click() },
    { group: 'Медиа', name: 'Media Browser', status: 'ok', run: () => C.browserPanel() },
    { group: 'Медиа', name: 'Proxy Creation', status: 'part', run: () => C.proxy() },
    { group: 'Медиа', name: 'Interpret Footage', status: 'ok', run: () => C.interpret() },
    { group: 'Медиа', name: 'Ingest Settings', status: 'part', run: () => C.ingestSettings() },
    { group: 'Медиа', name: 'Link / Unlink Media', status: 'ok', run: () => C.linkUnlinkUI() },
    { group: 'Мониторы', name: 'Source Monitor', status: 'ok', run: () => { if (isMobile() && PPE.setMobileView) PPE.setMobileView('monitor', 'source'); E().updateSourceUI(); } },
    { group: 'Мониторы', name: 'Program Monitor', status: 'ok', run: () => { if (isMobile() && PPE.setMobileView) PPE.setMobileView('monitor', 'program'); E().renderFrame(S.playhead); } },
    { group: 'Мониторы', name: 'Lumetri Scopes', status: 'ok', run: () => C.colorPanel() },
    { group: 'Монтаж', name: 'Multicam Editing', status: 'ok', run: () => C.multicam() },
    { group: 'Монтаж', name: 'Nesting', status: 'ok', run: () => C.nest() },
    { group: 'Монтаж', name: 'Time Remapping', status: 'ok', run: () => C.timeRemapDialog() },
    { group: 'Монтаж', name: 'Three-Point Editing', status: 'ok', run: () => C.threePoint('insert') },
    { group: 'Монтаж', name: 'Match Frame', key: 'F', status: 'ok', run: () => C.matchFrame(false) },
    { group: 'Монтаж', name: 'Reverse Match Frame', status: 'ok', run: () => C.matchFrame(true) },
    { group: 'Монтаж', name: 'Lift', key: ';', status: 'ok', run: () => T().lift() },
    { group: 'Монтаж', name: 'Extract', key: "'", status: 'ok', run: () => T().extract() },
    { group: 'Монтаж', name: 'Sync Lock', status: 'ok', run: () => C.toggleSyncLock() },
    { group: 'Монтаж', name: 'Track Lock', status: 'ok', run: () => C.toggleTrackLock() },
    { group: 'Цвет', name: 'Basic Correction (Lumetri)', status: 'ok', run: () => C.colorPanel() },
    { group: 'Цвет', name: 'Creative (Lumetri)', status: 'ok', run: () => C.colorPanel() },
    { group: 'Цвет', name: 'Curves (Lumetri)', status: 'ok', run: () => C.colorPanel() },
    { group: 'Цвет', name: 'Color Wheels & Match (Lumetri)', status: 'part', run: () => C.colorPanel() },
    { group: 'Цвет', name: 'HSL Secondary (Lumetri)', status: 'part', run: () => C.colorPanel() },
    { group: 'Цвет', name: 'Vignette (Lumetri)', status: 'ok', run: () => C.colorPanel() },
    { group: 'Звук', name: 'Essential Sound', status: 'ok', run: () => C.soundPanel() },
    { group: 'Звук', name: 'Audio Gain', status: 'ok', run: () => C.audioGain() },
    { group: 'Звук', name: 'Audio Track Mixer', status: 'ok', run: () => PPE.proPanels ? PPE.proPanels.showTab('mixer') : P().setLeftTab('mixer') },
    { group: 'Звук', name: 'Audio Clip Mixer', status: 'ok', run: () => C.soundPanel() },
    { group: 'Звук', name: 'Audio Ducking', status: 'ok', run: () => C.audioGain() },
    { group: 'Звук', name: 'Dialogue Enhance', status: 'part', run: () => C.essentialSound('dialogue') },
    { group: 'Эффекты', name: 'Effect Controls', status: 'ok', run: () => P().setLeftTab('effects') },
    { group: 'Эффекты', name: 'Keyframing', status: 'ok', run: () => T().addKeyAtPlayhead() },
    { group: 'Эффекты', name: 'Masking & Tracking', status: 'part', run: () => C.addMask('ellipse') },
    { group: 'Эффекты', name: 'Warp Stabilizer', status: 'part', run: () => C.warpStabilizer() },
    { group: 'Эффекты', name: 'Auto Reframe', status: 'part', run: () => C.autoReframe() },
    { group: 'Эффекты', name: 'Video Transitions', status: 'ok', run: () => T().applyEffectToSelected('cross-dissolve') },
    { group: 'Эффекты', name: 'Audio Transitions', status: 'ok', run: () => PPE.proAudioTransition && PPE.proAudioTransition() },
    { group: 'Графика', name: 'Essential Graphics', status: 'ok', run: () => C.graphicsPanel() },
    { group: 'Графика', name: 'MOGRT Templates', status: 'part', run: () => C.mogrt() },
    { group: 'Графика', name: 'Speech to Text', status: 'part', run: () => C.speechToText() },
    { group: 'Графика', name: 'Create Captions', status: 'ok', run: () => C.captionImport() },
    { group: 'Экспорт', name: 'Dynamic Link', status: 'none', run: () => C.dynamicLink() },
    { group: 'Экспорт', name: 'Render & Replace', status: 'ok', run: () => C.renderAndReplace() },
    { group: 'Экспорт', name: 'Quick Export', status: 'ok', run: () => C.quickExport() },
    { group: 'Экспорт', name: 'Export Panel', status: 'ok', run: () => C.exportPanel() },
    { group: 'Прочее', name: 'Generative Extend', status: 'part', run: () => C.generativeExtend() },
    { group: 'Прочее', name: 'Команды и возможности', key: 'Ctrl+Shift+K', status: 'ok', run: () => C.commandPalette() },
    { group: 'Справка', name: 'Туториал для начинающих', status: 'ok', run: () => PPE.tutorial && PPE.tutorial.start({ force: true }) }
  ];
  function isMobile() { return document.body.classList.contains('portrait-mode') || window.matchMedia('(max-width:820px), (pointer:coarse) and (max-width:1100px)').matches; }
  PRO.isMobile = isMobile;

  /* Аудио-переход (кроссфейд) между двумя соседними клипами */
  PPE.proAudioTransition = function () {
    const ids = Array.from(S.selection);
    if (ids.length < 2) { U.toast('Выделите два соседних аудиоклипа', 'warn'); return; }
    const a = S.findClip(ids[0]), b = S.findClip(ids[1]); if (!a || !b) return;
    const first = a.start < b.start ? a : b, second = first === a ? b : a;
    const ov = Math.min(.6, Math.max(.05, S.clipEnd(first) - second.start), S.clipDuration(first) / 3, S.clipDuration(second) / 3);
    S.change('Аудио-переход', () => { first.audio.fadeOut = ov; second.audio.fadeIn = ov; });
    PRO.refresh(); U.toast('Кроссфейд ' + ov.toFixed(2) + ' с применён', 'success');
  };
})(window);
