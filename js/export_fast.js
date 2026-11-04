/* =========================================================================
   export_fast.js — оффлайн-экспорт через WebCodecs.

   Раньше видео писалось MediaRecorder'ом с canvas.captureStream(): кадры
   снимались в реальном времени, поэтому экспорт длился столько же, сколько
   сам ролик, терял кадры при нагрузке и тормозил редактор.

   Здесь кадры рисуются в фоне (не на экране), кодируются встроенным кодеком
   браузера (H.264/VP9 + AAC/Opus) и упаковываются мультиплексором в MP4 или
   WebM. Никаких внешних файлов и сети: всё внутри одного index.html.
   ========================================================================= */
(function (root) {
  'use strict';
  const PPE = root.PPE = root.PPE || {};
  const U = PPE.utils, S = PPE.state;
  const $ = U.$, clamp = U.clamp;

  let job = null;

  /* ------------------------------ возможности ------------------------------ */
  function supported() {
    return !!(root.VideoEncoder && root.VideoFrame && root.VideoEncoder.isConfigSupported);
  }
  const MP4_VIDEO = ['avc1.640028', 'avc1.4D4028', 'avc1.42E01E'];
  const WEBM_VIDEO = ['vp09.00.10.08', 'vp09.00.31.08', 'vp8'];
  async function pickCodec(container, w, h, fps, bitrate) {
    if (!supported()) return null;
    const list = container === 'mp4' ? MP4_VIDEO : WEBM_VIDEO;
    for (const codec of list) {
      try {
        const r = await root.VideoEncoder.isConfigSupported({ codec, width: w, height: h, bitrate: bitrate, framerate: fps });
        if (r && r.supported) return codec;
      } catch (e) { /* кодек не поддержан — пробуем следующий */ }
    }
    return null;
  }
  async function pickAudioCodec(container) {
    if (!root.AudioEncoder || !root.AudioEncoder.isConfigSupported) return null;
    const list = container === 'mp4' ? ['mp4a.40.2', 'opus'] : ['opus'];
    for (const codec of list) {
      try {
        const r = await root.AudioEncoder.isConfigSupported({ codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 });
        if (r && r.supported) return codec;
      } catch (e) {}
    }
    return null;
  }
  /** Что реально умеет этот браузер — для диалога экспорта. */
  async function capabilities(w, h, fps, bitrate) {
    const out = { video: supported(), mp4: null, webm: null, audioMp4: null, audioWebm: null, muxer: !!(root.Mp4Muxer && root.WebMMuxer) };
    if (!supported()) return out;
    out.mp4 = await pickCodec('mp4', w || 1920, h || 1080, fps || 30, (bitrate || 8) * 1e6);
    out.webm = await pickCodec('webm', w || 1920, h || 1080, fps || 30, (bitrate || 8) * 1e6);
    out.audioMp4 = await pickAudioCodec('mp4');
    out.audioWebm = await pickAudioCodec('webm');
    return out;
  }

  /* -------------------------------- звук -------------------------------- */
  const decodeCache = new Map();
  async function decodeMedia(media, rate, channels) {
    if (!media || !media.url) return null;
    if (decodeCache.has(media.id)) return decodeCache.get(media.id);
    const p = (async () => {
      try {
        const res = await fetch(media.url);
        const buf = await res.arrayBuffer();
        const ctx = new root.OfflineAudioContext(channels, 1, rate);
        return await ctx.decodeAudioData(buf);
      } catch (e) { return null; }
    })();
    decodeCache.set(media.id, p);
    return p;
  }
  /** Микширование звука всей последовательности в один AudioBuffer. */
  async function renderAudio(start, end, rate) {
    const len = Math.max(0, end - start);
    if (len <= 0) return null;
    const channels = 2;
    const oac = new root.OfflineAudioContext(channels, Math.ceil(len * rate), rate);
    const solo = S.project.tracks.some(t => t.solo);
    const clips = S.allClips();
    let used = 0;
    for (const clip of clips) {
      if (clip.disabled) continue;
      const track = S.findTrack(clip.trackId);
      if (!track || track.type !== 'audio' || track.muted || (solo && !track.solo)) continue;
      const media = S.findMedia(clip.mediaId);
      if (!media || (!media.url && !media.generated)) continue;
      if (media.generated) continue;                 // у генераторов нет звука
      const buf = await decodeMedia(media, rate, channels);
      if (!buf) continue;
      const dur = S.clipDuration(clip);
      const t0 = Math.max(clip.start, start);
      const t1 = Math.min(clip.start + dur, end);
      if (t1 <= t0) continue;
      const speed = clip.speed || 1;
      const offset = clip.inPoint + (t0 - clip.start) * speed;
      const source = oac.createBufferSource();
      source.buffer = buf;
      source.playbackRate.value = clamp(speed, .0625, 16);
      const gain = oac.createGain();
      const g0 = (track.gain == null ? 1 : track.gain);
      const vol = (p) => clamp((S.valueAt(clip, 'audio.volume', p) || 0) / 100, 0, 4) * g0;
      const keys = (clip.keys && clip.keys['audio.volume']) || [];
      if (keys.length > 1) {
        gain.gain.setValueAtTime(vol(0), 0);
        keys.forEach(k => {
          const at = clamp(clip.start + k.t - start, 0, len);
          gain.gain.linearRampToValueAtTime(clamp(k.v / 100, 0, 4) * g0, at);
        });
        gain.gain.setValueAtTime(vol(dur), Math.max(0, clamp(clip.start + dur - start, 0, len)));
      } else {
        gain.gain.value = vol(Math.max(0, t0 - clip.start));
      }
      // нарастание и затухание
      const fi = S.valueAt(clip, 'audio.fadeIn', 0) || 0, fo = S.valueAt(clip, 'audio.fadeOut', 0) || 0;
      if (fi > 0) {
        const w0 = Math.max(0, clip.start - start), w1 = w0 + Math.min(fi, dur);
        gain.gain.setValueAtTime(0, w0);
        gain.gain.linearRampToValueAtTime(gain.gain.value || 1, Math.min(len, w1));
      }
      if (fo > 0) {
        const w1 = Math.max(0, clip.start + dur - start), w0 = Math.max(0, w1 - fo);
        gain.gain.setValueAtTime(gain.gain.value || 1, w0);
        gain.gain.linearRampToValueAtTime(0, Math.min(len, w1));
      }
      source.connect(gain); gain.connect(oac.destination);
      const playDur = Math.min((t1 - t0) * speed, Math.max(0, buf.duration - offset));
      if (playDur > 0) source.start(Math.max(0, t0 - start), offset, playDur);
      used++;
    }
    if (!used) return null;
    return await oac.startRendering();
  }

  /* ------------------------------ сам экспорт ------------------------------ */
  function progress(pct, extra) {
    U.bus.emit('exportProgress', Object.assign({ pct: clamp(pct, 0, 1), time: 0, end: 1 }, extra || {}));
  }
  function log(text) { U.bus.emit('exportProgress', { log: text }); }
  /* Быстрый yield: setTimeout(0) в браузере округляется до ~4 мс, а на тысячах
     кадров это секунды ожидания. MessageChannel даёт управление почти мгновенно. */
  const chan = root.MessageChannel ? new root.MessageChannel() : null;
  const waiters = [];
  if (chan) chan.port1.onmessage = () => { const r = waiters.shift(); if (r) r(); };
  const tick = () => new Promise(r => {
    if (chan) { waiters.push(r); chan.port2.postMessage(0); } else setTimeout(r, 0);
  });

  async function startExport(opts) {
    opts = opts || {};
    if (job) { U.toast('Экспорт уже идёт', 'warn'); return false; }
    if (!supported()) { U.toast('Браузер не поддерживает WebCodecs — используем запись в реальном времени', 'warn', 4200); return false; }
    const start = opts.range === 'inout' && S.project.seqOut > S.project.seqIn ? S.project.seqIn : 0;
    const end = opts.range === 'inout' && S.project.seqOut > S.project.seqIn ? Math.min(S.project.seqOut, S.sequenceDuration()) : S.sequenceDuration();
    if (end - start <= 0) { U.toast('Нечего экспортировать', 'warn'); return false; }
    const w = Math.max(16, Math.round(opts.width || S.project.width));
    const h = Math.max(16, Math.round(opts.height || S.project.height));
    const fps = clamp(opts.fps || S.project.fps || 30, 1, 120);
    const bitrate = Math.max(1, opts.bitrate || 8) * 1e6;

    let container = opts.format === 'mp4' || opts.format === 'webm' ? opts.format : 'mp4';
    let codec = await pickCodec(container, w, h, fps, bitrate);
    if (!codec && container === 'mp4') { container = 'webm'; codec = await pickCodec('webm', w, h, fps, bitrate); }
    if (!codec) { U.toast('Нет доступного кодека WebCodecs — попробуйте запись в реальном времени', 'error', 5000); return false; }
    if (container === 'mp4' && !root.Mp4Muxer) { container = 'webm'; codec = await pickCodec('webm', w, h, fps, bitrate); }
    if (container === 'webm' && !root.WebMMuxer) { U.toast('Мультиплексор WebM не загружен', 'error'); return false; }

    const audioCodec = opts.audio === false ? null : await pickAudioCodec(container);
    const audioRate = 48000;
    const muxer = container === 'mp4'
      ? new root.Mp4Muxer.Muxer({
          target: new root.Mp4Muxer.ArrayBufferTarget(),
          video: { codec: 'avc', width: w, height: h },
          audio: audioCodec ? { codec: audioCodec === 'opus' ? 'opus' : 'aac', sampleRate: audioRate, numberOfChannels: 2 } : undefined,
          fastStart: 'in-memory', firstTimestampBehavior: 'offset'
        })
      : new root.WebMMuxer.Muxer({
          target: new root.WebMMuxer.ArrayBufferTarget(),
          video: { codec: codec.indexOf('vp09') === 0 ? 'V_VP9' : 'V_VP8', width: w, height: h, frameRate: fps },
          audio: audioCodec ? { codec: 'A_OPUS', sampleRate: audioRate, numberOfChannels: 2 } : undefined,
          firstTimestampBehavior: 'offset'
        });

    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { alpha: false });
    const myJob = job = { cancelled: false, started: performance.now() };

    let videoEncoder, audioEncoder;
    try {
      videoEncoder = new root.VideoEncoder({
        output: (chunk, meta) => { try { muxer.addVideoChunk(chunk, meta); } catch (e) {} },
        error: e => { console.error(e); U.toast('Ошибка кодирования видео: ' + e.message, 'error', 5000); }
      });
      videoEncoder.configure({ codec, width: w, height: h, bitrate: bitrate, framerate: fps, latencyMode: 'quality' });
    } catch (e) {
      U.toast('Не удалось запустить кодек ' + codec + ': ' + e.message, 'error', 5000);
      job = null; return false;
    }

    S.exporting = true;
    U.status('Экспорт (оффлайн)…', 'busy');
    log('Кодек видео: ' + codec + (audioCodec ? ' · звук: ' + audioCodec : ' · без звука'));

    const frames = Math.max(1, Math.round((end - start) * fps));
    const frameDur = Math.round(1e6 / fps);
    const prevPlayhead = S.playhead;
    const prevPlaying = S.playing;
    try { if (PPE.engine && PPE.engine.pause) PPE.engine.pause(); } catch (e) {}

    /* ---- звук: рендерим заранее, чтобы не мешать видео ---- */
    let audioBuffer = null;
    if (audioCodec) {
      try {
        progress(0.01, { stage: 'звук' });
        audioBuffer = await renderAudio(start, end, audioRate);
      } catch (e) { console.warn('audio mixdown failed', e); }
      if (myJob.cancelled) throw new Error('cancelled');
      if (audioBuffer) log('Звук смикширован: ' + audioBuffer.duration.toFixed(2) + ' с');
      else log('Звуковых дорожек нет — файл будет без звука');
    }

    /* ---- видео: кадр за кадром, без реального времени ---- */
    let encodeError = null;
    try {
      for (let i = 0; i < frames; i++) {
        if (myJob.cancelled) throw new Error('cancelled');
        const t = start + i / fps;
        if (PPE.engine && PPE.engine.prepareFrame) {
          try { await PPE.engine.prepareFrame(t); } catch (e) {}
        }
        PPE.engine.drawTo(ctx, w, h, t);
        const frame = new root.VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / fps), duration: frameDur });
        videoEncoder.encode(frame, { keyFrame: i === 0 || i % Math.round(fps * 2) === 0 });
        frame.close();
        // не даём очереди энкодера расти: он работает на другом потоке
        if (videoEncoder.encodeQueueSize > 12) { while (videoEncoder.encodeQueueSize > 4) await tick(); }
        if (i % 5 === 0) {
          progress(0.05 + 0.9 * (i / frames), { time: t, end: end, stage: 'кадры' });
          if (i % 30 === 0) {
            const el = (performance.now() - myJob.started) / 1000;
            const eta = i > 4 ? Math.max(0, Math.round(el / (i / frames) - el)) : null;
            log('Кадр ' + (i + 1) + ' / ' + frames + ' · ' + Math.round((i / frames) * 100) + '%' +
              (eta != null ? ' · осталось ~' + (eta > 90 ? Math.round(eta / 60) + ' мин' : eta + ' с') : ''));
          }
        }
        if (i % 10 === 0) await tick();
      }
      await videoEncoder.flush();
    } catch (e) {
      encodeError = e;
    } finally {
      try { videoEncoder.close(); } catch (e) {}
    }
    if (myJob.cancelled || (encodeError && encodeError.message === 'cancelled')) {
      job = null; S.exporting = false;
      try { PPE.engine.seek(prevPlayhead); } catch (e) {}
      U.toast('Экспорт отменён', 'warn'); U.status('Экспорт отменён', null, true);
      U.bus.emit('exportProgress', { done: true, cancelled: true });
      return true;
    }
    if (encodeError) {
      job = null; S.exporting = false;
      U.toast('Ошибка экспорта: ' + encodeError.message, 'error', 6000);
      U.status('Экспорт не удался', 'error', true);
      U.bus.emit('exportProgress', { done: true, error: true });
      return true;
    }

    /* ---- звук в контейнер ---- */
    if (audioBuffer && audioCodec) {
      try {
        audioEncoder = new root.AudioEncoder({
          output: (chunk, meta) => { try { muxer.addAudioChunk(chunk, meta); } catch (e) {} },
          error: e => console.error(e)
        });
        audioEncoder.configure({ codec: audioCodec, sampleRate: audioRate, numberOfChannels: 2, bitrate: 192000 });
        const ch0 = audioBuffer.getChannelData(0);
        const ch1 = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : ch0;
        const block = 1024;
        for (let i = 0; i < ch0.length; i += block) {
          if (myJob.cancelled) break;
          const n = Math.min(block, ch0.length - i);
          const data = new Float32Array(n * 2);
          data.set(ch0.subarray(i, i + n), 0);
          data.set(ch1.subarray(i, i + n), n);
          const ad = new root.AudioData({
            format: 'f32-planar', sampleRate: audioRate, numberOfFrames: n, numberOfChannels: 2,
            timestamp: Math.round((i / audioRate) * 1e6), data: data
          });
          audioEncoder.encode(ad);
          ad.close();
          while (audioEncoder.encodeQueueSize > 20) await tick();
        }
        await audioEncoder.flush();
        try { audioEncoder.close(); } catch (e) {}
      } catch (e) {
        console.warn('audio encode failed', e);
        log('Звук не закодировался: ' + e.message + ' — файл сохранён без звука');
      }
    }

    try { muxer.finalize(); } catch (e) {
      job = null; S.exporting = false;
      U.toast('Не удалось собрать контейнер: ' + e.message, 'error', 6000);
      return true;
    }
    const buffer = muxer.target.buffer;
    const blob = new Blob([buffer], { type: container === 'mp4' ? 'video/mp4' : 'video/webm' });
    const name = U.safeFileName(S.project.name || 'sequence', container, true);
    U.download(blob, name);
    const secs = (performance.now() - myJob.started) / 1000;
    job = null; S.exporting = false;
    try { PPE.engine.seek(prevPlayhead); if (prevPlaying) PPE.engine.play(); } catch (e) {}
    log('Готово за ' + secs.toFixed(1) + ' с (ролик ' + (end - start).toFixed(1) + ' с)');
    U.toast('Экспорт завершён: ' + name + ' (' + (blob.size / 1048576).toFixed(1) + ' МБ)', 'success', 6000);
    U.status('Экспорт завершён', null, true);
    progress(1, { done: true, seconds: secs });
    return true;
  }

  function cancel() {
    if (!job) return false;
    job.cancelled = true;
    return true;
  }
  function isRunning() { return !!job; }

  PPE.fastExport = { supported, capabilities, startExport, cancel, isRunning, renderAudio, pickCodec };
})(window);
