/* =========================================================================
   pro_panels.js — Lumetri Color + Scopes, Essential Sound, Media Browser,
   Essential Graphics / MOGRT / Captions, Export Panel, Command Palette
   ========================================================================= */
(function (root) {
  'use strict';
  const PPE = root.PPE = root.PPE || {};
  const U = PPE.utils, S = PPE.state, PRO = PPE.pro, COLOR = PPE.proColor;
  const $ = U.$, $$ = U.$$, el = U.el, clamp = U.clamp, uid = U.uid, esc = U.escapeHtml;
  const E = () => PPE.engine, T = () => PPE.timeline, P = () => PPE.panels, M = () => PPE.media;
  const TAB_IDS = { color: 'colorPanel', sound: 'soundPanel', browser: 'browserPanel', graphics: 'graphicsPanel', export: 'exportPanel' };
  let activeTab = 'effects', scopeTimer = null, browserFiles = [], collapsed = {}, scopeType = 'histogram';

  const PP = PPE.proPanels = {};

  function section(title, key, bodyFn, hint) {
    const wrap = el('div', { class: 'fx-section' + (collapsed[key] ? ' collapsed' : '') });
    const head = el('div', { class: 'fx-section-head' }, [
      el('span', { class: 'fx-caret', html: U.icon('chevron') }),
      el('span', { class: 'fx-icon', html: U.icon('sliders') }),
      el('b', { text: title })
    ]);
    head.addEventListener('click', () => { collapsed[key] = !collapsed[key]; PP.render(); });
    const body = el('div', { class: 'fx-section-body' });
    if (!collapsed[key]) bodyFn(body);
    wrap.appendChild(head); wrap.appendChild(body);
    if (hint && !collapsed[key]) wrap.appendChild(el('div', { class: 'form-note', text: hint }));
    return wrap;
  }
  function slider(box, label, val, min, max, step, set, tag) {
    const row = el('div', { class: 'param-row' }, [
      el('span', { class: 'kf' }),
      el('span', { class: 'p-label', text: label }),
      el('div', { class: 'p-slider-wrap' })
    ]);
    const wrap = row.children[2];
    const input = el('input', { type: 'range', class: 'p-slider', min: min, max: max, step: step, value: val });
    const num = el('input', { type: 'number', class: 'mini-num', min: min, max: max, step: step, value: val });
    const commitLabel = tag || label;
    const apply = v => { set(v); input.value = v; num.value = v; try { E().renderFrame(S.playhead); } catch (e) {} COLOR.dropCache(); };
    let began = false;
    input.addEventListener('pointerdown', () => { if (!began) { S.begin(commitLabel); began = true; } });
    input.addEventListener('input', () => { if (!began) { S.begin(commitLabel); began = true; } apply(Number(input.value)); });
    input.addEventListener('change', () => { if (!began) S.begin(commitLabel); apply(Number(input.value)); S.end(); began = false; });
    num.addEventListener('focus', () => { S.begin(commitLabel); began = true; });
    num.addEventListener('change', () => { if (!began) S.begin(commitLabel); apply(Number(num.value)); S.end(); began = false; });
    wrap.appendChild(input); wrap.appendChild(num);
    box.appendChild(row);
    return row;
  }
  function btnRow(box, items) {
    const row = el('div', { class: 'btn-group' });
    items.forEach(i => { const b = el('button', { class: 'btn small' + (i.primary ? ' primary' : ''), html: (i.icon ? U.icon(i.icon) : '') + '<span>' + esc(i.label) + '</span>' }); b.addEventListener('click', i.run); row.appendChild(b); });
    box.appendChild(row); return row;
  }
  function empty(text) { return el('div', { class: 'fx-hint', text: text }); }

  /* ================================ COLOR ================================ */
  function curveEditor(box, clip, L, channel, label) {
    const cv = el('canvas', { class: 'curve-edit', width: 220, height: 110 });
    const pts = L.curves[channel];
    const draw = () => {
      const g = cv.getContext('2d');
      g.fillStyle = '#141418'; g.fillRect(0, 0, 220, 110);
      g.strokeStyle = 'rgba(255,255,255,.08)';
      for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(0, i * 27.5); g.lineTo(220, i * 27.5); g.stroke(); g.beginPath(); g.moveTo(i * 55, 0); g.lineTo(i * 55, 110); g.stroke(); }
      g.strokeStyle = channel === 'r' ? '#ff7b7b' : channel === 'g' ? '#7be08c' : channel === 'b' ? '#7fb4ff' : '#e8e8f0';
      g.lineWidth = 2; g.beginPath();
      pts.slice().sort((a, b) => a.x - b.x).forEach((p, i) => { const X = p.x * 220, Y = (1 - p.y) * 110; i ? g.lineTo(X, Y) : g.moveTo(X, Y); });
      g.stroke();
      pts.forEach(p => { g.fillStyle = '#fff'; g.beginPath(); g.arc(p.x * 220, (1 - p.y) * 110, 3.5, 0, Math.PI * 2); g.fill(); });
    };
    draw();
    let dragIdx = -1, began = false;
    const pos = e => { const r = cv.getBoundingClientRect(); return { x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp(1 - (e.clientY - r.top) / r.height, 0, 1) }; };
    cv.addEventListener('pointerdown', e => {
      const p = pos(e);
      dragIdx = pts.findIndex(q => Math.abs(q.x - p.x) < .045 && Math.abs(q.y - p.y) < .07);
      if (dragIdx < 0) { pts.push({ x: p.x, y: p.y }); pts.sort((a, b) => a.x - b.x); dragIdx = pts.findIndex(q => q.x === p.x && q.y === p.y); }
      S.begin('Кривые: ' + label); began = true; cv.setPointerCapture(e.pointerId); draw();
    });
    cv.addEventListener('pointermove', e => { if (dragIdx < 0) return; const p = pos(e); pts[dragIdx].x = p.x; pts[dragIdx].y = p.y; pts.sort((a, b) => a.x - b.x); draw(); COLOR.dropCache(); E().renderFrame(S.playhead); });
    const finish = () => { if (began) { S.end(); began = false; } dragIdx = -1; };
    cv.addEventListener('pointerup', finish); cv.addEventListener('pointercancel', finish);
    cv.addEventListener('dblclick', e => { const p = pos(e); if (pts.length > 2) { const i = pts.findIndex(q => Math.abs(q.x - p.x) < .05 && Math.abs(q.y - p.y) < .08); if (i > 0 && i < pts.length - 1) { S.change('Удаление точки кривой', () => pts.splice(i, 1)); draw(); } } });
    box.appendChild(el('div', { class: 'curve-label', text: label }));
    box.appendChild(cv);
  }
  function renderColor() {
    const box = $('#colorPanel'); if (!box) return;
    box.innerHTML = '';
    const clip = PRO.selClip();
    const scopes = el('div', { class: 'scopes-box' }, [
      el('div', { class: 'scope-tabs' }),
      el('canvas', { class: 'scope-canvas', id: 'scopeMain' }),
      el('div', { class: 'scope-mini' }, [
        el('canvas', { class: 'scope-mini-c', 'data-st': 'histogram' }),
        el('canvas', { class: 'scope-mini-c', 'data-st': 'waveform' }),
        el('canvas', { class: 'scope-mini-c', 'data-st': 'vector' })
      ])
    ]);
    [['histogram', 'Гистограмма'], ['waveform', 'Форма волны'], ['vector', 'Вектороскоп']].forEach(([k, n]) => {
      const b = el('button', { class: 'scope-tab' + (scopeType === k ? ' active' : ''), text: n });
      b.onclick = () => { scopeType = k; renderColor(); }; scopes.children[0].appendChild(b);
    });
    box.appendChild(scopes);
    if (!clip) { box.appendChild(empty('Выберите клип на таймлайне для цветокоррекции.')); return; }
    const L = PRO.lumetri(clip), b = L.basic, cr = L.creative, w = L.wheels, hs = L.hsl, vg = L.vignette;
    box.appendChild(section('Basic Correction', 'b', body => {
      slider(body, 'Экспозиция', b.exposure, -100, 100, 1, v => b.exposure = v);
      slider(body, 'Контраст', b.contrast, -100, 100, 1, v => b.contrast = v);
      slider(body, 'Света', b.highlights, -100, 100, 1, v => b.highlights = v);
      slider(body, 'Тени', b.shadows, -100, 100, 1, v => b.shadows = v);
      slider(body, 'Белый', b.whites, -100, 100, 1, v => b.whites = v);
      slider(body, 'Чёрный', b.blacks, -100, 100, 1, v => b.blacks = v);
      slider(body, 'Насыщенность', b.saturation, 0, 300, 1, v => b.saturation = v);
      slider(body, 'Температура', b.temperature, -100, 100, 1, v => b.temperature = v);
      slider(body, 'Оттенок', b.tint, -100, 100, 1, v => b.tint = v);
      btnRow(body, [{ label: 'Сброс', icon: 'reset', run: () => { S.change('Сброс Basic', () => Object.assign(b, PRO.defaultLumetri().basic)); COLOR.dropCache(clip.id); PP.render(); } }]);
    }, 'Реальные CSS/SVG-фильтры на canvas.'));
    box.appendChild(section('Creative', 'cr', body => {
      slider(body, 'Look', cr.look, 0, 100, 1, v => cr.look = v);
      slider(body, 'Faded Film', cr.faded, 0, 100, 1, v => cr.faded = v);
      slider(body, 'Vibrance', cr.vibrance, -100, 100, 1, v => cr.vibrance = v);
      slider(body, 'Saturation', cr.saturation, 0, 300, 1, v => cr.saturation = v);
      slider(body, 'Резкость (локально)', cr.sharpen, 0, 100, 1, v => { cr.sharpen = v; b.contrast = clamp(b.contrast + (v > 0 ? .4 : -.4), -100, 100); });
    }, 'Sharpen — локальная аппроксимация через контраст.'));
    box.appendChild(section('Curves', 'cur', body => {
      const chk = el('label', { class: 'mini-check' }, [el('input', { type: 'checkbox' }), document.createTextNode(' Включить кривые')]);
      chk.children[0].checked = !!L.curves.enabled;
      chk.children[0].onchange = e2 => { S.change('Кривые', () => L.curves.enabled = e2.target.checked); COLOR.dropCache(clip.id); PP.render(); };
      body.appendChild(chk);
      if (L.curves.enabled) ['master', 'r', 'g', 'b'].forEach(ch => curveEditor(body, clip, L, ch, { master: 'Master RGB', r: 'Red', g: 'Green', b: 'Blue' }[ch]));
    }, 'Клик — добавить точку, перетаскивание — изменить, двойной клик — удалить.'));
    box.appendChild(section('Color Wheels & Match', 'wh', body => {
      ['shadows', 'mids', 'highs'].forEach((z, i) => {
        body.appendChild(el('div', { class: 'curve-label', text: ['Тени', 'Средние тона', 'Света'][i] }));
        ['R', 'G', 'B'].forEach((c, j) => slider(body, c, w[z][j], -100, 100, 1, v => w[z][j] = v, 'Color Wheel'));
      });
      btnRow(body, [{ label: 'Auto Match (локально)', icon: 'color', run: () => { S.change('Auto Match', () => { L.basic.contrast = clamp(L.basic.contrast + 8, -100, 100); L.basic.saturation = clamp(L.basic.saturation + 6, 0, 300); }); COLOR.dropCache(clip.id); PP.render(); U.toast('Авто-сопоставление: контраст/насыщенность', 'success'); } }]);
    }, 'Колёса задают цветовой сдвиг через SVG feColorMatrix.'));
    box.appendChild(section('HSL Secondary', 'hsl', body => {
      const chk = el('label', { class: 'mini-check' }, [el('input', { type: 'checkbox' }), document.createTextNode(' Включить')]);
      chk.children[0].checked = !!hs.enabled;
      chk.children[0].onchange = e2 => { S.change('HSL Secondary', () => hs.enabled = e2.target.checked); COLOR.dropCache(clip.id); PP.render(); };
      body.appendChild(chk);
      slider(body, 'Целевой Hue', hs.hue, 0, 360, 1, v => hs.hue = v);
      slider(body, 'Диапазон', hs.range, 1, 100, 1, v => hs.range = v);
      slider(body, 'Сдвиг Hue', hs.hueShift, -180, 180, 1, v => hs.hueShift = v);
      slider(body, 'Насыщенность', hs.sat, -100, 100, 1, v => hs.sat = v);
      slider(body, 'Яркость', hs.lum, -100, 100, 1, v => hs.lum = v);
    }, 'Селективная коррекция approximated этим же SVG-фильтром.'));
    box.appendChild(section('Vignette', 'vg', body => {
      slider(body, 'Количество', vg.amount, 0, 100, 1, v => { vg.amount = v; clip.color.vignette = v; });
      slider(body, 'Средняя точка', vg.midpoint, 0, 100, 1, v => vg.midpoint = v);
      slider(body, 'Округлость', vg.roundness, 0, 100, 1, v => vg.roundness = v);
      slider(body, 'Растушёвка', vg.feather, 0, 100, 1, v => vg.feather = v);
    }, 'Виньетка рисуется поверх кадра.'));
    box.appendChild(section('Маски и трекинг', 'mask', body => {
      btnRow(body, [
        { label: 'Эллипс', icon: 'color', run: () => PRO.cmd.addMask('ellipse') },
        { label: 'Прямоуг.', icon: 'cards', run: () => PRO.cmd.addMask('rect') },
        { label: 'Ключ', icon: 'diamond', run: () => PRO.cmd.maskKey() },
        { label: 'Трекинг', icon: 'fit', run: () => PRO.cmd.trackMask() }
      ]);
      const list = PRO.masks(clip);
      if (!list.length) body.appendChild(empty('Масок нет.'));
      list.forEach((m, i) => {
        const row = el('div', { class: 'mask-row' });
        row.appendChild(el('span', { text: '#' + i + ' ' + m.type }));
        ['x', 'y', 'w', 'h'].forEach(k => {
          const inp = el('input', { type: 'number', class: 'mini-num', value: m[k], min: 0, max: 200, step: 1, title: k });
          inp.onchange = () => { S.change('Параметр маски', () => m[k] = Number(inp.value)); E().renderFrame(S.playhead); };
          row.appendChild(inp);
        });
        const del = el('button', { class: 'icon-btn tiny', html: U.icon('trash') });
        del.onclick = () => { S.change('Удаление маски', () => list.splice(i, 1)); PP.render(); };
        row.appendChild(del); body.appendChild(row);
      });
    }, 'Маски обрезают кадр, ключи анимируют геометрию.'));
    box.appendChild(section('Анализ и стабилизация', 'ai', body => {
      btnRow(body, [
        { label: 'Warp Stabilizer', icon: 'fit', run: () => PRO.cmd.warpStabilizer() },
        { label: 'Auto Reframe', icon: 'image', run: () => PRO.cmd.autoReframe() },
        { label: 'Generative Extend', icon: 'film', run: () => PRO.cmd.generativeExtend() }
      ]);
    }, 'Локальные CPU-алгоритмы вместо облачного Adobe Sensei.'));
  }

  /* ================================ SOUND ================================ */
  function renderSound() {
    const box = $('#soundPanel'); if (!box) return;
    box.innerHTML = '';
    const clip = PRO.selClip();
    box.appendChild(section('Essential Sound', 'es', body => {
      if (!clip) { body.appendChild(empty('Выберите аудио/видео клип.')); return; }
      const a = PRO.audioFX(clip);
      const tags = el('div', { class: 'tag-row' });
      [['dialogue', 'Диалог'], ['music', 'Музыка'], ['ambience', 'Атмосфера'], ['sfx', 'Эффекты']].forEach(([k, n]) => {
        const b = el('button', { class: 'tag-btn' + (a.tag === k ? ' active' : ''), text: n });
        b.onclick = () => PRO.cmd.essentialSound(k); tags.appendChild(b);
      });
      body.appendChild(tags);
      slider(body, 'Усиление, дБ', a.gainDb, -24, 24, .5, v => PRO.x(clip).audioFX.gainDb = v);
      slider(body, 'Улучшить речь', a.enhance, 0, 100, 1, v => PRO.x(clip).audioFX.enhance = v);
      slider(body, 'Шумоподавление', a.reduceNoise, 0, 100, 1, v => PRO.x(clip).audioFX.reduceNoise = v);
      slider(body, 'Громкость клипа', clip.audio.volume, 0, 400, 1, v => clip.audio.volume = v);
      const duck = el('label', { class: 'mini-check' }, [el('input', { type: 'checkbox' }), document.createTextNode(' Audio Ducking')]);
      duck.children[0].checked = !!a.duck;
      duck.children[0].onchange = e => { S.change('Ducking', () => PRO.x(clip).audioFX.duck = e.target.checked); };
      body.appendChild(duck);
      slider(body, 'Глубина ducking', a.duckAmount, 0, 100, 1, v => PRO.x(clip).audioFX.duckAmount = v);
      btnRow(body, [{ label: 'Audio Gain…', icon: 'volume', run: () => PRO.cmd.audioGain() }, { label: 'Кроссфейд', icon: 'wave', run: () => PPE.proAudioTransition() }]);
    }, 'Ducking следит за дорожками с меткой «Диалог».'));
    box.appendChild(section('Audio Clip Mixer', 'acm', body => {
      const clips = S.allClips().filter(c => { const m = S.findMedia(c.mediaId); return m && (m.hasAudio || m.type === 'audio'); }).slice(0, 12);
      if (!clips.length) body.appendChild(empty('Нет клипов со звуком.'));
      clips.forEach(c => {
        const row = el('div', { class: 'param-row' }, [el('span', { class: 'p-label', text: c.name.slice(0, 22) })]);
        const inp = el('input', { type: 'range', class: 'p-slider', min: 0, max: 400, value: c.audio.volume });
        inp.oninput = () => { c.audio.volume = Number(inp.value); S.markDirty(); };
        row.appendChild(inp); body.appendChild(row);
      });
    }, 'Быстрые фейдеры клипов.'));
    box.appendChild(section('Audio Track Mixer', 'atm', body => {
      S.project.tracks.filter(t => t.type === 'audio').forEach(t => {
        const row = el('div', { class: 'param-row' }, [el('span', { class: 'p-label', text: t.name })]);
        const inp = el('input', { type: 'range', class: 'p-slider', min: 0, max: 2, step: .01, value: t.gain == null ? 1 : t.gain });
        inp.oninput = () => { t.gain = Number(inp.value); M().setTrackGain(t.id, t.gain); S.markDirty(); };
        const tag = el('select', { class: 'mini-select' });
        [['auto', 'Авто'], ['dialogue', 'Диалог'], ['music', 'Музыка'], ['ambience', 'Атмосфера'], ['sfx', 'Эффекты']].forEach(([v, n]) => tag.appendChild(el('option', { value: v, text: n })));
        tag.value = PRO.x(t).audioTag || 'auto';
        tag.onchange = () => { S.change('Метка дорожки', () => PRO.x(t).audioTag = tag.value); };
        row.appendChild(inp); row.appendChild(tag); body.appendChild(row);
      });
    }, 'Метка «Диалог» управляет ducking.'));
  }

  /* ================================ MEDIA BROWSER ================================ */
  function renderBrowser() {
    const box = $('#browserPanel'); if (!box) return;
    box.innerHTML = '';
    const top = el('div', { class: 'btn-group' }, [
      el('button', { class: 'btn small primary', html: U.icon('folder') + '<span>Выбрать папку</span>' }),
      el('button', { class: 'btn small', html: U.icon('import') + '<span>Выбрать файлы</span>' })
    ]);
    const folderInput = el('input', { type: 'file', multiple: true, webkitdirectory: '', style: { display: 'none' } });
    const fileInput = el('input', { type: 'file', multiple: true, accept: 'video/*,audio/*,image/*', style: { display: 'none' } });
    const collect = inp => { browserFiles = Array.from(inp.files || []); renderBrowser(); };
    folderInput.onchange = () => collect(folderInput); fileInput.onchange = () => collect(fileInput);
    top.children[0].onclick = () => folderInput.click();
    top.children[1].onclick = () => fileInput.click();
    box.appendChild(top); box.appendChild(folderInput); box.appendChild(fileInput);
    btnRow(box, [
      { label: 'Импортировать всё', icon: 'import', run: () => { if (browserFiles.length) M().importFiles(browserFiles); } },
      { label: 'Ingest Settings', icon: 'settings', run: () => PRO.cmd.ingestSettings() },
      { label: 'Interpret Footage', icon: 'sliders', run: () => PRO.cmd.interpret() },
      { label: 'Proxy', icon: 'layers', run: () => PRO.cmd.proxy() }
    ]);
    const list = el('div', { class: 'browser-list' });
    if (!browserFiles.length) list.appendChild(empty('Выберите папку или файлы. Чтение локальной файловой системы в браузере возможно только через диалог выбора.'));
    browserFiles.forEach((f, i) => {
      const row = el('div', { class: 'list-row' }, [
        el('span', { class: 'browser-icon', html: U.icon(f.type && f.type.startsWith('video') ? 'film' : f.type && f.type.startsWith('audio') ? 'music' : 'image') }),
        el('span', { class: 'browser-name', text: (f.webkitRelativePath || f.name) }),
        el('span', { class: 'browser-size', text: (f.size / 1024 / 1024).toFixed(1) + ' МБ' })
      ]);
      const b = el('button', { class: 'icon-btn tiny', html: U.icon('import'), title: 'Импортировать' });
      b.onclick = () => M().importFiles([f]);
      row.appendChild(b); list.appendChild(row);
    });
    box.appendChild(list);
  }

  /* ================================ GRAPHICS / CAPTIONS ================================ */
  const MOGRTS = [
    { id: 'lower-third', name: 'Lower Third', fields: [{ k: 'title', label: 'Заголовок', v: 'ИМЯ ФАМИЛИЯ' }, { k: 'sub', label: 'Подпись', v: 'Должность' }] },
    { id: 'title-card', name: 'Title Card', fields: [{ k: 'title', label: 'Текст', v: 'НАЗВАНИЕ ФИЛЬМА' }] },
    { id: 'end-credits', name: 'End Credits', fields: [{ k: 'title', label: 'Строки (через ;)', v: 'Режиссёр;Оператор;Монтаж' }] },
    { id: 'bug', name: 'Logo Bug', fields: [{ k: 'title', label: 'Текст', v: 'FF' }] }
  ];
  function createMogrt(t, values) {
    const text = t.id === 'end-credits' ? values.title.split(';').join('\n') : t.id === 'lower-third' ? values.title + '\n' + values.sub : values.title;
    const d = Object.assign(S.defaultTextData(), {
      text: text, size: t.id === 'title-card' ? 120 : t.id === 'bug' ? 72 : 74,
      color: '#ffffff', bg: t.id === 'lower-third' ? '#12304d' : '#000000',
      bgOpacity: t.id === 'lower-third' ? 70 : 0,
      x: t.id === 'bug' ? 88 : 50, y: t.id === 'lower-third' ? 78 : 50,
      align: 'center', bold: true, shadow: true
    });
    const m = { id: uid('media'), name: t.name, fileName: null, type: 'text', generated: true, data: d, duration: 3600,
      width: S.project.width, height: S.project.height, fps: S.project.fps, hasAudio: false, thumb: null, peaks: null, offline: false, url: null,
      x: { mogrt: t.id, values: values } };
    S.change('MOGRT: ' + t.name, () => {
      S.project.media.push(m);
      const track = T().targetTrack('video');
      const c = S.newClip(m.id, track.id, S.playhead, { generatedDuration: 5 });
      c.name = t.name; track.clips.push(c);
      S.selection.clear(); S.selection.add(c.id);
    });
    PRO.refresh(); U.toast('Шаблон «' + t.name + '» добавлен', 'success');
  }
  function mogrtDialog(t) {
    if (!t) t = MOGRTS[0];
    const body = el('div');
    body.appendChild(el('div', { class: 'form-row' }, [
      el('label', { text: 'Шаблон' }),
      (() => { const s = el('select', { class: 'mini-select', id: 'mgTpl' }); MOGRTS.forEach(q => s.appendChild(el('option', { value: q.id, text: q.name }))); s.value = t.id; return s; })()
    ]));
    const fields = el('div', { id: 'mgFields' }); body.appendChild(fields);
    const fill = () => {
      fields.innerHTML = '';
      t.fields.forEach(f => fields.appendChild(el('div', { class: 'form-row' }, [el('label', { text: f.label }), el('div', { class: 'form-control' }, [el('input', { type: 'text', 'data-f': f.k, value: f.v })])])));
    };
    fill();
    body.children[0].children[1].onchange = e => { t = MOGRTS.find(q => q.id === e.target.value); fill(); };
    U.modal({ title: 'MOGRT Templates (Essential Graphics)', icon: 'text', wide: true, body: body, buttons: [
      { label: 'Отмена' }, { label: 'Добавить', class: 'primary', action: b => { const v = {}; $$('[data-f]', b).forEach(i => v[i.dataset.f] = i.value); createMogrt(t, v); } }
    ] });
  }
  PP.mogrtDialog = () => mogrtDialog();
  function parseSubs(text) {
    const out = [];
    const blocks = text.replace(/\r/g, '').split(/\n\s*\n/);
    const tc = s => { const m = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/.exec(s) || /(\d{1,2}):(\d{2})[,.](\d{1,3})/.exec(s); if (!m) return 0; return m.length === 5 ? (+m[1] * 3600 + +m[2] * 60 + +m[3]) + (+m[4] / 1000) : (+m[1] * 60 + +m[2]) + (+m[3] / 1000); };
    blocks.forEach(b => {
      const lines = b.trim().split('\n'); if (lines.length < 2) return;
      const tl = lines.findIndex(l => l.includes('-->'));
      if (tl < 0) return;
      const [a, c] = lines[tl].split('-->');
      const txt = lines.slice(tl + 1).join('\n').trim();
      if (txt) out.push({ start: tc(a), end: tc(c), text: txt });
    });
    return out.filter(q => q.end > q.start);
  }
  function createCaptions(subs, trackName) {
    if (!subs.length) { U.toast('Субтитры не найдены', 'warn'); return; }
    S.change('Создание субтитров', () => {
      let track = S.project.tracks.find(t => t.type === 'video' && t.name === trackName);
      if (!track) { track = S.addTrack('video'); track.name = trackName; }
      subs.forEach(q => {
        const d = Object.assign(S.defaultTextData(), { text: q.text, size: 52, color: '#ffffff', bg: '#000000', bgOpacity: 60, x: 50, y: 84, align: 'center', bold: false });
        const m = { id: uid('media'), name: 'Субтитр', fileName: null, type: 'text', generated: true, data: d, duration: 3600, width: S.project.width, height: S.project.height, fps: S.project.fps, hasAudio: false, thumb: null, peaks: null, offline: false, url: null, x: { caption: true } };
        S.project.media.push(m);
        const c = S.newClip(m.id, track.id, q.start, { generatedDuration: Math.max(.4, q.end - q.start) });
        c.name = q.text.slice(0, 24); track.clips.push(c);
      });
    });
    PRO.refresh(); U.toast('Создано субтитров: ' + subs.length, 'success');
  }
  PP.createCaptions = createCaptions;
  function captionImport() {
    const body = el('div');
    body.innerHTML = '<div class="form-note">Импорт SRT/VTT или ввод текста: каждая строка — отдельный субтитр, длительность задаётся ниже.</div>' +
      '<div class="form-row"><label>Файл SRT/VTT</label><div class="form-control"><input type="file" id="capFile" accept=".srt,.vtt,.txt"></div></div>' +
      '<div class="form-row"><label>Текст</label><div class="form-control"><textarea id="capText" rows="6" placeholder="Первая строка\nВторая строка"></textarea></div></div>' +
      '<div class="form-row"><label>Начать с</label><div class="form-control"><input type="number" id="capStart" value="0" step="0.5"><span class="unit">c</span></div></div>' +
      '<div class="form-row"><label>Длительность строки</label><div class="form-control"><input type="number" id="capDur" value="2.5" step="0.5"><span class="unit">c</span></div></div>';
    U.modal({ title: 'Create Captions', icon: 'text', wide: true, body: body, buttons: [
      { label: 'Отмена' }, { label: 'Создать', class: 'primary', action: async b => {
        const f = $('#capFile', b).files[0];
        let subs;
        if (f) { const txt = await f.text(); subs = parseSubs(txt); }
        else {
          const st = Number($('#capStart', b).value) || 0, du = Number($('#capDur', b).value) || 2.5;
          subs = ($('#capText', b).value || '').split('\n').filter(s => s.trim()).map((s, i) => ({ start: st + i * du, end: st + (i + 1) * du, text: s.trim() }));
        }
        createCaptions(subs, 'Субтитры');
      } }
    ] });
  }
  PP.captionImport = captionImport;
  function speechToText() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      U.modal({ title: 'Speech to Text', icon: 'text', wide: true,
        body: '<div class="fx-hint">' + U.icon('info') + '<br><b>Web Speech API недоступен в этом браузере.</b><br><br>Распознавание файлового аудио требует серверной модели; браузерный SpeechRecognition работает только с микрофоном и есть в Chrome/Edge.<br><br>Альтернатива: импорт готового SRT/VTT или ручной ввод.</div>',
        buttons: [{ label: 'Отмена' }, { label: 'Импорт SRT/VTT', class: 'primary', action: () => captionImport() }] });
      return;
    }
    const rec = new SR(); rec.lang = 'ru-RU'; rec.continuous = true; rec.interimResults = false;
    const subs = []; let t0 = S.playhead;
    rec.onresult = ev => { for (let i = ev.resultIndex; i < ev.results.length; i++) if (ev.results[i].isFinal) { const now = S.playhead; subs.push({ start: t0, end: Math.max(t0 + .8, now), text: ev.results[i][0].transcript.trim() }); t0 = now; } };
    rec.onerror = e => U.toast('Распознавание: ' + e.error, 'error');
    rec.onend = () => { if (subs.length) createCaptions(subs, 'Речь'); U.toast('Распознавание остановлено', 'success'); };
    try { rec.start(); U.toast('Слушаю микрофон… нажмите «Стоп» в окне', 'success', 6000); } catch (e) { U.toast('Не удалось запустить: ' + e.message, 'error'); return; }
    U.modal({ title: 'Speech to Text (live)', icon: 'text', body: '<div class="form-note">Идёт распознавание речи с микрофона. Субтитры будут созданы на отдельной дорожке в точках воспроизведения.</div>', buttons: [
      { label: 'Стоп', class: 'primary', action: () => { try { rec.stop(); } catch (e) {} } }
    ] });
  }
  PP.speechToText = speechToText;
  function renderGraphics() {
    const box = $('#graphicsPanel'); if (!box) return;
    box.innerHTML = '';
    box.appendChild(section('Essential Graphics', 'eg', body => {
      btnRow(body, [
        { label: 'Type Tool', icon: 'text', run: () => T().setTool('type') },
        { label: 'Vertical Type', icon: 'text', run: () => T().setTool('vtype') },
        { label: 'Rectangle', icon: 'cards', run: () => T().setTool('rect') },
        { label: 'Ellipse', icon: 'color', run: () => T().setTool('ellipse') }
      ]);
      btnRow(body, [{ label: 'Редактировать выбранный титр', icon: 'sliders', run: () => { const c = PRO.selClip(); const m = c && S.findMedia(c.mediaId); if (!m || !m.generated) { U.toast('Выберите титр или фигуру', 'warn'); return; } const d = m.data; U.modal({ title: 'Essential Graphics — ' + c.name, icon: 'text', wide: true, body: '<div class="form-row"><label>Текст</label><div class="form-control"><textarea id="egText" rows="3">' + esc(d.text || '') + '</textarea></div></div><div class="form-row"><label>Размер</label><div class="form-control"><input type="number" id="egSize" value="' + (d.size || 96) + '"></div></div><div class="form-row"><label>Цвет</label><div class="form-control"><input type="color" id="egColor" value="' + (d.color || '#ffffff') + '"></div></div>', buttons: [{ label: 'Отмена' }, { label: 'Применить', class: 'primary', action: b => { S.change('Правка графики', () => { d.text = $('#egText', b).value; d.size = Number($('#egSize', b).value); d.color = $('#egColor', b).value; }); PRO.refresh(); } }] }); } }]);
    }, 'Инструменты создают фигуру по клику в мониторе или таймлайне.'));
    box.appendChild(section('MOGRT Templates', 'mg', body => {
      MOGRTS.forEach(t => {
        const b = el('div', { class: 'list-row', html: U.icon('text') + '<span>' + esc(t.name) + '</span>' });
        b.onclick = () => mogrtDialog(t); body.appendChild(b);
      });
    }, 'Параметрические шаблоны instead of проприетарных .mogrt.'));
    box.appendChild(section('Captions', 'cap', body => {
      btnRow(body, [
        { label: 'Создать субтитры', icon: 'text', primary: true, run: () => captionImport() },
        { label: 'Импорт SRT/VTT', icon: 'import', run: () => captionImport() },
        { label: 'Speech to Text', icon: 'volume', run: () => speechToText() }
      ]);
      const caps = S.allClips().filter(c => { const m = S.findMedia(c.mediaId); return m && m.x && m.x.caption; });
      body.appendChild(el('div', { class: 'form-note', text: 'Субтитров на таймлайне: ' + caps.length }));
    }, 'Субтитры — обычные текстовые клипы на отдельной дорожке.'));
  }

  /* ================================ EXPORT PANEL ================================ */
  function renderExport() {
    const box = $('#exportPanel'); if (!box) return;
    box.innerHTML = '';
    const q = PRO.x(S.project).quick || (PRO.x(S.project).quick = { width: S.project.width, height: S.project.height, fps: S.project.fps, bitrate: 8, range: 'entire', audio: true });
    box.appendChild(section('Quick Export', 'qe', body => {
      const presets = [['1080p', 1920, 1080, 30, 8], ['720p', 1280, 720, 30, 5], ['4K', 3840, 2160, 30, 24], ['Вертикальный', 1080, 1920, 30, 8]];
      const sel = el('select', { class: 'mini-select', id: 'epPreset' });
      presets.forEach((p, i) => sel.appendChild(el('option', { value: i, text: p[0] + ' · ' + p[1] + '×' + p[2] })));
      body.appendChild(el('div', { class: 'form-row' }, [el('label', { text: 'Пресет' }), el('div', { class: 'form-control' }, [sel])]));
      sel.onchange = () => { const p = presets[+sel.value]; Object.assign(q, { width: p[1], height: p[2], fps: p[3], bitrate: p[4] }); renderExport(); };
      slider(body, 'Битрейт, Мбит/с', q.bitrate, 1, 40, .5, v => q.bitrate = v);
      btnRow(body, [
        { label: 'Быстрый экспорт', icon: 'export', primary: true, run: () => PRO.cmd.quickExport() },
        { label: 'Настроить…', icon: 'settings', run: () => $('#exportBtn').click() }
      ]);
    }, 'Экспорт в реальном времени через MediaRecorder.'));
    box.appendChild(section('Render & Replace', 'rr', body => {
      btnRow(body, [
        { label: 'Рендер и замена', icon: 'film', run: () => PRO.cmd.renderAndReplace() },
        { label: 'Dynamic Link', icon: 'link', run: () => PRO.cmd.dynamicLink() }
      ]);
    }, 'Предпросчёт тяжёлого фрагмента в WebM.'));
    box.appendChild(section('Прокси', 'px', body => {
      btnRow(body, [
        { label: 'Создать прокси', icon: 'layers', run: () => PRO.cmd.proxy() },
        { label: 'Ingest', icon: 'settings', run: () => PRO.cmd.ingestSettings() }
      ]);
    }, 'Локальное перекодирование в низкое разрешение.'));
    box.appendChild(section('Прогресс', 'pr', body => {
      body.appendChild(el('div', { class: 'progress-wrap' }, [el('div', { class: 'progress-bar', id: 'epBar' })]));
      body.appendChild(el('div', { class: 'export-log', id: 'epLog', text: 'Ожидание экспорта…' }));
    }));
  }
  U.bus.on('exportProgress', d => {
    const bar = $('#epBar'), log = $('#epLog'); if (!bar || !log) return;
    if (d.pct != null) bar.style.width = Math.round(d.pct * 100) + '%';
    if (d.done) log.textContent += '\n' + (d.cancelled ? 'Отменено' : 'Готово');
    else if (d.pct != null) log.textContent = Math.round(d.pct * 100) + '% · ' + U.formatTC(d.time, S.project.fps);
  });

  /* ================================ COMMAND PALETTE ================================ */
  function closeCmdPalette() {
    const rootEl = $('#commandPalette');
    if (!rootEl) return;
    rootEl.classList.add('hidden');
    rootEl.innerHTML = '';
    U.removeLayer(rootEl);
  }
  PP.closePalette = closeCmdPalette;
  function palette() {
    let rootEl = $('#commandPalette');
    if (!rootEl) { rootEl = el('div', { id: 'commandPalette', class: 'cmd-palette hidden' }); document.body.appendChild(rootEl); }
    // Повторный вызов (Ctrl+Shift+K или кнопка в шапке) закрывает палитру.
    if (U.isLayerOpen(rootEl)) { closeCmdPalette(); return; }
    rootEl.classList.remove('hidden');
    rootEl.innerHTML = '';
    U.addLayer(rootEl, closeCmdPalette, ['#cmdBtn']);
    const head = el('div', { class: 'cmd-head' }, [el('span', { html: U.icon('search') }), el('input', { type: 'text', id: 'cmdSearch', placeholder: 'Поиск функции или инструмента…' })]);
    const list = el('div', { class: 'cmd-list' });
    const foot = el('div', { class: 'cmd-foot', text: '● полностью   ◐ локальный аналог   ○ недоступно в браузере' });
    const close = () => closeCmdPalette();
    head.appendChild(el('button', { class: 'icon-btn tiny', html: U.icon('close') })).onclick = close;
    rootEl.appendChild(head); rootEl.appendChild(list); rootEl.appendChild(foot);
    const render = q => {
      list.innerHTML = '';
      const items = PRO.registry.filter(i => !q || (i.name + ' ' + i.group).toLowerCase().includes(q.toLowerCase()));
      items.forEach(it => {
        const row = el('div', { class: 'cmd-item' }, [
          el('span', { class: 'cmd-status s-' + it.status, text: it.status === 'ok' ? '●' : it.status === 'part' ? '◐' : '○' }),
          el('span', { class: 'cmd-name', text: it.name }),
          el('span', { class: 'cmd-group', text: it.group }),
          el('span', { class: 'cmd-key', text: it.key || '' })
        ]);
        row.onclick = () => { close(); try { it.run(); } catch (e) { U.toast('Ошибка: ' + e.message, 'error'); } };
        list.appendChild(row);
      });
      if (!items.length) list.appendChild(empty('Ничего не найдено'));
    };
    render('');
    const inp = $('#cmdSearch', rootEl);
    inp.oninput = () => render(inp.value);
    inp.onkeydown = e => { if (e.key === 'Escape') close(); if (e.key === 'Enter') { const f = list.querySelector('.cmd-item'); if (f) f.click(); } };
    rootEl.onclick = e => { if (e.target === rootEl) close(); };
    setTimeout(() => inp.focus(), 30);
  }
  PP.palette = palette;

  /* ================================ TABS ================================ */
  PP.renderTab = function (tab) {
    activeTab = tab;
    const id = TAB_IDS[tab]; if (!id) return;
    const node = $('#' + id); if (!node) return;
    node.classList.remove('hidden'); node.style.display = '';
    if (tab === 'color') renderColor();
    if (tab === 'sound') renderSound();
    if (tab === 'browser') renderBrowser();
    if (tab === 'graphics') renderGraphics();
    if (tab === 'export') renderExport();
  };
  PP.render = function () { if (TAB_IDS[activeTab]) PP.renderTab(activeTab); };
  PP.showTab = function (tab) { P().setLeftTab(tab); if (PRO.isMobile()) { if (PPE.setMobileView) PPE.setMobileView('fx', 'effects', true); else { document.body.dataset.mobileView = 'fx'; document.body.dataset.mobileSub = 'effects'; } } };
  PP.init = function () {
    PPE.proTools.init();
    U.bus.on('history', () => { if (TAB_IDS[activeTab]) PP.render(); });
    // Скопы перерисовываются только когда панель «Цвет» реально видна:
    // раньше таймер тикал всегда и впустую дёргал canvas каждые 180 мс.
    scopeTimer = setInterval(() => {
      if (activeTab !== 'color' || document.hidden) return;
      const main = $('#scopeMain');
      if (!main || !main.getClientRects().length) return;
      const src = E().canvas; if (!src) return;
      COLOR.drawScope(main, scopeType, src);
      $$('.scope-mini-c').forEach(c => { if (c.getClientRects().length) COLOR.drawScope(c, c.dataset.st, src); });
    }, 240);
    window.addEventListener('keydown', e => {
      if (PPE.animationUI && PPE.animationUI.isOpen()) return;
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'K' || e.key === 'k')) { e.preventDefault(); palette(); }
    });
  };
})(window);
