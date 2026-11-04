/* =========================================================================
   animation_sprite.js — настройки спрайтов векторной сцены.
   «Спрайт» = векторный объект внутри ключевого кадра слоя.

   Основные:  склейка, кадрирование, замена, фильтры, настройка фильтра,
              удаление фона, коррекция освещения, слой, маска.
   Ключевые:  кривые, настройки кривых, перенос ключевых кадров на другой спрайт.
   ========================================================================= */
(function (root) {
  'use strict';
  const PPE = root.PPE = root.PPE || {}, U = PPE.utils, S = PPE.state;
  const el = U.el, $ = U.$, $$ = U.$$, clamp = U.clamp, uid = U.uid;
  const A = () => PPE.animation;

  /* ------------------------------- контекст ------------------------------- */
  function st() { return (PPE.animationUI && PPE.animationUI.state) || { selected: new Set(), frame: 0 }; }
  function doc() { return A().doc(); }
  function scene() { const d = doc(); return d ? A().scene(d, st().sceneId) : null; }
  function layer() { const sc = scene(); return sc ? A().layer(sc, st().layerId) : null; }
  function frame() { return st().frame || 0; }
  function render() { if (PPE.animationUI) PPE.animationUI.render(); }
  function toast(msg, type, ms) { U.toast(msg, type || null, ms || 2400); }
  function selectedObjects() {
    const l = layer(); if (!l) return [];
    const ids = new Set(Array.from(st().selected || []));
    return A().objectsAt(l, frame()).filter(o => ids.has(o.id));
  }
  function one() {
    const objs = selectedObjects();
    if (!objs.length) { toast('Сначала выделите спрайт на сцене', 'warn', 2600); return null; }
    return objs[0];
  }
  /** Правка текущего ключевого кадра: гарантирует ключ и пишет историю. */
  function edit(label, fn) {
    const l = layer();
    if (!l) { toast('Нет активного слоя', 'warn'); return false; }
    if (l.locked) { toast('Слой заблокирован', 'warn'); return false; }
    let ok = false;
    S.change(label, () => {
      const k = A().editKey(l, frame());
      if (!k) { ok = false; return; }
      ok = fn(k.objects, k, l) !== false;
    });
    render();
    return ok;
  }
  /** Живая правка (диалог со слайдерами): одна запись в истории на весь диалог. */
  function live(label, fn) {
    const l = layer();
    if (!l || l.locked) { toast(l ? 'Слой заблокирован' : 'Нет активного слоя', 'warn'); return null; }
    S.begin(label);
    const k = A().ensureKey(l, frame(), false);
    let finished = false;
    const api = {
      objects: k.objects,
      refresh() { if (PPE.animationUI) { PPE.animationUI.requestDraw(); } PPE.animationUI.render(); },
      finish() { if (finished) return; finished = true; S.end(); render(); }
    };
    try { fn(api, k, l); } catch (err) { api.finish(); throw err; }
    return api;
  }

  /* --------------------------------- утилиты --------------------------------- */
  function bbox(objs) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    objs.forEach(o => {
      const r = rotatedBox(o);
      r.forEach(p => { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); });
    });
    if (!isFinite(x0)) return { x: 0, y: 0, w: 1, h: 1 };
    return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
  }
  function rotatedBox(o) {
    const cx = o.x + o.w / 2, cy = o.y + o.h / 2, a = (o.rotation || 0) * Math.PI / 180;
    return [[0, 0], [o.w, 0], [o.w, o.h], [0, o.h]].map(([dx, dy]) => {
      const x = dx - o.w / 2, y = dy - o.h / 2;
      return { x: cx + x * Math.cos(a) - y * Math.sin(a), y: cy + x * Math.sin(a) + y * Math.cos(a) };
    });
  }
  function sliderRow(label, value, min, max, step, onInput, unit) {
    const row = el('label', { class: 'sp-row' });
    const out = el('output', { text: String(value) + (unit || '') });
    const inp = el('input', { type: 'range', min: String(min), max: String(max), step: String(step || 1), value: String(value) });
    inp.addEventListener('input', () => {
      const v = Number(inp.value);
      out.textContent = (Math.round(v * 100) / 100) + (unit || '');
      if (onInput) onInput(v);
    });
    row.appendChild(el('span', { text: label })); row.appendChild(inp); row.appendChild(out);
    return row;
  }
  function section(title) { return el('div', { class: 'sp-section', text: title }); }
  function plural(n, one, few, many) {
    const n10 = n % 10, n100 = n % 100;
    if (n10 === 1 && n100 !== 11) return one;
    if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
    return many;
  }

  /* =============================== 1. СКЛЕЙКА =============================== */
  function merge() {
    const objs = selectedObjects();
    if (objs.length === 1 && objs[0].type === 'group') { ungroup(objs[0]); return; }
    if (objs.length < 2) { toast('Выделите два и более спрайта, затем «Склейка» (Shift+клик по сцене)', 'warn', 4200); return; }
    edit('Склейка спрайтов', (list) => {
      const b = bbox(objs);
      const children = objs.map(o => { const q = A().clone(o); q.x -= b.x; q.y -= b.y; return q; });
      const g = A().makeObject('group', b.x, b.y, b.w, b.h, {});
      g.gw = b.w; g.gh = b.h; g.children = children; g.strokeWidth = 0; g.fill = 'transparent';
      const ids = new Set(objs.map(o => o.id));
      for (let i = list.length - 1; i >= 0; i--) if (ids.has(list[i].id)) list.splice(i, 1);
      list.push(g);
      st().selected = new Set([g.id]);
    });
    toast('Спрайты склеены в один — двигается, масштабируется и фильтруется целиком', 'success', 4200);
  }
  function ungroup(group) {
    edit('Разгруппировать спрайт', (list) => {
      const i = list.findIndex(o => o.id === group.id); if (i < 0) return false;
      const sw = group.w / Math.max(.001, group.gw || group.w), sh = group.h / Math.max(.001, group.gh || group.h);
      const kids = (group.children || []).map(ch => {
        const q = A().clone(ch);
        q.id = uid('obj');
        q.x = group.x + q.x * sw; q.y = group.y + q.y * sh;
        q.w = q.w * sw; q.h = q.h * sh;
        return q;
      });
      delete group.children; delete group.gw; delete group.gh;
      list.splice(i, 1, ...kids);
      st().selected = new Set(kids.map(k => k.id));
    });
    toast('Спрайт разгруппирован', 'success');
  }

  /* ============================= 2. КАДРИРОВАНИЕ ============================= */
  function cropDialog(focus) {
    const o = one(); if (!o) return;
    const cur = Object.assign({ l: 0, t: 0, r: 0, b: 0 }, o.crop || {});
    const body = el('div', { class: 'sp-form' });
    body.appendChild(el('div', { class: 'sp-note', text: 'Кадрирование обрезает видимую область спрайта, не сдвигая его на сцене.' }));
    const api = live('Кадрирование спрайта', () => {});
    const apply = () => {
      const t = findLive(o.id);
      if (t) applyCropTo(t);
      if (api) api.refresh();
    };
    const findLive = (id) => api && api.objects.find(q => q.id === id);
    const state = Object.assign({}, cur);
    const applyCropTo = (target) => {
      const l = state.l, t = state.t, r = state.r, b = state.b;
      if (!l && !t && !r && !b) delete target.crop;
      else target.crop = { l, t, r, b };
    };
    [['Слева', 'l'], ['Сверху', 't'], ['Справа', 'r'], ['Снизу', 'b']].forEach(([label, key]) => {
      body.appendChild(sliderRow(label, Math.round(cur[key] * 100), 0, 45, 1, (v) => { state[key] = v / 100; apply(); }, ' %'));
    });
    U.modal({
      title: 'Кадрирование спрайта', icon: 'fit', body,
      buttons: [
        { label: 'Сбросить', action: () => { Object.assign(state, { l: 0, t: 0, r: 0, b: 0 }); apply(); setTimeout(() => cropDialog(), 30); } },
        { label: 'Отмена', action: () => { if (api) { S.undo(); api.finish(); } } },
        { label: 'Применить', class: 'primary', action: () => { if (api) api.finish(); toast('Кадрирование применено', 'success'); } }
      ],
      onClose: () => { if (api) api.finish(); }
    });
  }

  /* ================================ 3. ЗАМЕНА ================================ */
  function replaceDialog() {
    const o = one(); if (!o) return;
    const body = el('div', { class: 'sp-form' });
    if (o.type === 'text' || o.type === 'button' || o.type === 'input') {
      body.appendChild(el('div', { class: 'sp-note', text: 'Замена текста спрайта. Размер и стиль сохраняются.' }));
      const inp = el('input', { class: 'sp-input', value: o.text || '' });
      body.appendChild(inp);
      U.modal({
        title: 'Замена содержимого', icon: 'text', body,
        buttons: [{ label: 'Отмена' }, { label: 'Заменить', class: 'primary', action: () => {
          const v = inp.value;
          edit('Замена текста спрайта', (list) => { const t = list.find(q => q.id === o.id); if (!t) return false; t.text = v; });
          toast('Текст заменён', 'success');
        } }]
      });
      return;
    }
    const media = (S.project.media || []).filter(m => m.type === 'image' || m.type === 'video');
    body.appendChild(el('div', { class: 'sp-note', text: media.length ? 'Выберите другой файл проекта — размер спрайта подстроится под пропорции.' : 'В проекте нет изображений. Добавьте файл кнопкой ниже.' }));
    const grid = el('div', { class: 'sp-media' });
    media.forEach(m => {
      const card = el('button', { class: 'sp-media-card' + (o.mediaId === m.id ? ' on' : ''), title: m.name });
      const thumb = el('div', { class: 'sp-media-thumb' });
      if (m.thumb) thumb.style.backgroundImage = 'url("' + m.thumb + '")';
      card.appendChild(thumb);
      card.appendChild(el('span', { text: m.name }));
      card.addEventListener('click', () => {
        edit('Замена изображения спрайта', (list) => {
          const t = list.find(q => q.id === o.id); if (!t) return false;
          const cw = t.x + t.w / 2, ch = t.y + t.h / 2;
          t.mediaId = m.id; t.type = 'image';
          const mw = m.width || 16, mh = m.height || 9;
          t.h = Math.max(1, t.w * mh / Math.max(1, mw));
          t.x = cw - t.w / 2; t.y = ch - t.h / 2;
        });
        U.closeModal();
        toast('Изображение заменено', 'success');
      });
      grid.appendChild(card);
    });
    body.appendChild(grid);
    U.modal({
      title: 'Замена спрайта', icon: 'image', wide: true, body,
      buttons: [
        { label: 'Отмена' },
        { label: 'Добавить файл…', action: () => {
          const inp = el('input', { type: 'file', accept: 'image/*' });
          inp.addEventListener('change', async () => {
            const f = inp.files && inp.files[0]; if (!f) return;
            try {
              const added = await PPE.media.importFiles([f], { silentSource: true });
              const m = added.find(q => q.type === 'image');
              if (!m) { toast('Это не изображение', 'warn'); return; }
              edit('Замена изображения спрайта', (list) => {
                const t = list.find(q => q.id === o.id); if (!t) return false;
                const cw = t.x + t.w / 2, ch = t.y + t.h / 2;
                t.mediaId = m.id; t.type = 'image';
                t.h = Math.max(1, t.w * (m.height || 9) / Math.max(1, m.width || 16));
                t.x = cw - t.w / 2; t.y = ch - t.h / 2;
              });
              toast('Изображение заменено', 'success');
            } catch (e) { toast('Не удалось: ' + e.message, 'error', 4000); }
          });
          inp.click();
          return false;
        } }
      ]
    });
  }

  /* ================================ 4. ФИЛЬТРЫ ================================ */
  const FILTERS = [
    ['none', 'Без фильтра'], ['bw', 'Чёрно-белое'], ['noir', 'Нуар'], ['sepia', 'Сепия'],
    ['vintage', 'Винтаж'], ['warm', 'Тёплый'], ['cold', 'Холодный'], ['contrast', 'Контраст'],
    ['vivid', 'Яркий'], ['neon', 'Неон'], ['blur', 'Размытие']
  ];
  function filterMenu(anchor) {
    const o = one(); if (!o) return;
    const cur = (o.fx || {}).preset || 'none';
    U.dropdown(anchor, FILTERS.map(([id, label]) => ({
      label, checked: cur === id,
      action: () => {
        edit('Фильтр спрайта', (list) => {
          const t = list.find(q => q.id === o.id); if (!t) return false;
          if (id === 'none') delete t.fx;
          else t.fx = { preset: id };
        });
        toast('Фильтр: ' + label, 'success', 1800);
      }
    })));
  }
  function filterDialog() {
    const objs = selectedObjects(); if (!objs.length) { toast('Сначала выделите спрайт', 'warn'); return; }
    const fx = Object.assign({ brightness: 100, contrast: 100, saturate: 100, blur: 0, hue: 0, sepia: 0, gray: 0, invert: 0 }, (objs[0].fx || {}).preset === 'custom' ? objs[0].fx : {});
    const body = el('div', { class: 'sp-form' });
    body.appendChild(el('div', { class: 'sp-note', text: 'Тонкая настройка фильтра. Применяется ко всем выделенным спрайтам.' }));
    const api = live('Настройка фильтра', () => {});
    const state = Object.assign({ preset: 'custom' }, fx);
    const apply = () => {
      if (!api) return;
      api.objects.filter(o => st().selected.has(o.id)).forEach(o => { o.fx = Object.assign({}, state); });
      api.refresh();
    };
    [['Яркость', 'brightness', 0, 200, 1, '%'], ['Контраст', 'contrast', 0, 200, 1, '%'],
     ['Насыщенность', 'saturate', 0, 300, 1, '%'], ['Размытие', 'blur', 0, 20, .5, ' px'],
     ['Оттенок', 'hue', -180, 180, 1, '°'], ['Сепия', 'sepia', 0, 100, 1, '%'],
     ['Ч/Б', 'gray', 0, 100, 1, '%'], ['Негатив', 'invert', 0, 100, 1, '%']].forEach(([label, key, min, max, step, unit]) => {
      body.appendChild(sliderRow(label, state[key], min, max, step, (v) => { state[key] = v; apply(); }, unit));
    });
    U.modal({
      title: 'Настроить фильтр', icon: 'sliders', body,
      buttons: [
        { label: 'Сбросить', action: () => {
            Object.assign(state, { brightness: 100, contrast: 100, saturate: 100, blur: 0, hue: 0, sepia: 0, gray: 0, invert: 0 });
            apply(); setTimeout(() => filterDialog(), 30);
        } },
        { label: 'Отмена', action: () => { S.undo(); if (api) api.finish(); } },
        { label: 'Готово', class: 'primary', action: () => { if (api) api.finish(); } }
      ],
      onClose: () => { if (api) api.finish(); }
    });
  }

  /* ============================= 5. УДАЛЕНИЕ ФОНА ============================= */
  function removeBgDialog() {
    const o = one(); if (!o) return;
    if (o.type !== 'image' && o.type !== 'group') { toast('Удаление фона работает для спрайтов-изображений', 'warn', 3200); return; }
    const target = o.type === 'group' ? (o.children || []).find(c => c.type === 'image') : o;
    const media = target && S.findMedia(target.mediaId);
    const img = o.type === 'group' ? null : A().imageFor(o);
    if (!img || !img.naturalWidth) { toast('Нет доступа к изображению спрайта', 'warn', 3200); return; }
    const color = autoKeyColor(img);
    const body = el('div', { class: 'sp-form' });
    body.appendChild(el('div', { class: 'sp-note', text: 'Фон вырезается по цвету (как «хромакей»). Результат добавляется в проект отдельным PNG с прозрачностью.' }));
    const preview = el('canvas', { class: 'sp-preview', width: 360, height: 200 });
    body.appendChild(preview);
    const swatch = el('input', { type: 'color', value: color, class: 'sp-color' });
    const state = { color, tol: 34, soft: 18 };
    const rowColor = el('label', { class: 'sp-row' }, [el('span', { text: 'Цвет фона' }), swatch]);
    body.appendChild(rowColor);
    const draw = () => drawKeyPreview(preview, img, state);
    draw();
    swatch.addEventListener('input', () => { state.color = swatch.value; draw(); });
    body.appendChild(sliderRow('Допуск', state.tol, 0, 120, 1, (v) => { state.tol = v; draw(); }));
    body.appendChild(sliderRow('Смягчение краёв', state.soft, 0, 80, 1, (v) => { state.soft = v; draw(); }));
    U.modal({
      title: 'Удалить фон', icon: 'scissors', wide: true, body,
      buttons: [
        { label: 'Отмена' },
        { label: 'Удалить фон', class: 'primary', action: (bodyEl, close) => {
          const canvas = keyOut(img, state);
          canvasToMedia(canvas, (media ? media.name : 'Спрайт') + ' (без фона)').then(m => {
            const l = layer();
            if (!l) return;
            S.change('Удаление фона', () => {
              const k = A().ensureKey(l, frame(), false);
              const t = k.objects.find(q => q.id === o.id); if (!t) return;
              const cw = t.x + t.w / 2, ch = t.y + t.h / 2;
              t.mediaId = m.id; t.type = 'image';
              t.h = Math.max(1, t.w * m.height / Math.max(1, m.width));
              t.x = cw - t.w / 2; t.y = ch - t.h / 2;
            });
            render();
            toast('Фон удалён: новый PNG добавлен в проект', 'success', 3600);
          }).catch(err => toast('Не удалось обработать: ' + err.message, 'error', 4000));
          close();
          return false;
        } }
      ]
    });
  }
  function autoKeyColor(img) {
    try {
      const c = document.createElement('canvas'); c.width = 24; c.height = 24;
      const x = c.getContext('2d'); x.drawImage(img, 0, 0, 24, 24);
      const d = x.getImageData(0, 0, 24, 24).data;
      const count = new Map();
      for (let i = 0; i < d.length; i += 4) {
        const key = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3);
        count.set(key, (count.get(key) || 0) + 1);
      }
      let best = 0, bestN = -1;
      count.forEach((n, k) => { if (n > bestN) { bestN = n; best = k; } });
      const r = ((best >> 10) & 31) * 8 + 4, g = ((best >> 5) & 31) * 8 + 4, b = (best & 31) * 8 + 4;
      return '#' + [r, g, b].map(v => clamp(v, 0, 255).toString(16).padStart(2, '0')).join('');
    } catch (e) { return '#ffffff'; }
  }
  function keyOut(img, state) {
    const max = 1400;
    const scale = Math.min(1, max / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const w = Math.max(1, Math.round((img.naturalWidth || 640) * scale));
    const h = Math.max(1, Math.round((img.naturalHeight || 480) * scale));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0, w, h);
    const data = x.getImageData(0, 0, w, h);
    const px = data.data;
    const kr = parseInt(state.color.slice(1, 3), 16), kg = parseInt(state.color.slice(3, 5), 16), kb = parseInt(state.color.slice(5, 7), 16);
    const tol = state.tol * 1.6, soft = Math.max(1, state.soft * 1.6);
    for (let i = 0; i < px.length; i += 4) {
      const dr = px[i] - kr, dg = px[i + 1] - kg, db = px[i + 2] - kb;
      const dist = Math.sqrt(dr * dr * 0.9 + dg * dg * 1.15 + db * db * 0.95);
      if (dist <= tol) px[i + 3] = 0;
      else if (dist < tol + soft) px[i + 3] = Math.round(px[i + 3] * (dist - tol) / soft);
    }
    x.putImageData(data, 0, 0);
    return c;
  }
  function drawKeyPreview(canvas, img, state) {
    const x = canvas.getContext('2d');
    x.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < canvas.width; i += 12) for (let j = 0; j < canvas.height; j += 12) {
      x.fillStyle = ((i / 12 + j / 12) % 2) ? '#2a2d34' : '#202329';
      x.fillRect(i, j, 12, 12);
    }
    const src = keyOut(img, Object.assign({}, state, { tol: state.tol, soft: state.soft }));
    const k = Math.min(canvas.width / src.width, canvas.height / src.height);
    const w = src.width * k, h = src.height * k;
    x.drawImage(src, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  }
  function canvasToMedia(canvas, name) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (!blob) { reject(new Error('canvas.toBlob вернул пусто')); return; }
        try {
          const file = new File([blob], U.safeFileName(name, 'png', true), { type: 'image/png' });
          const m = {
            id: uid('media'), name, fileName: file.name, type: 'image', url: URL.createObjectURL(file), file,
            duration: 5, width: canvas.width, height: canvas.height, hasAudio: false, thumb: null, peaks: null,
            offline: false, generated: false, data: null
          };
          try { m.thumb = canvas.toDataURL('image/jpeg', .75); } catch (e) {}
          S.project.media.push(m);
          resolve(m);
        } catch (e) { reject(e); }
      }, 'image/png');
    });
  }

  /* ========================= 6. КОРРЕКЦИЯ ОСВЕЩЕНИЯ ========================= */
  function lightDialog() {
    const objs = selectedObjects(); if (!objs.length) { toast('Сначала выделите спрайт', 'warn'); return; }
    const cur = Object.assign({ exposure: 0, contrast: 0, shadows: 0, temp: 0, vibrance: 0 }, objs[0].light || {});
    const body = el('div', { class: 'sp-form' });
    body.appendChild(el('div', { class: 'sp-note', text: 'Освещение правит сам спрайт: экспозиция, контраст, вытягивание теней и температура.' }));
    const state = Object.assign({}, cur);
    const api = live('Коррекция освещения', () => {});
    const apply = () => {
      if (!api) return;
      api.objects.filter(o => st().selected.has(o.id)).forEach(o => {
        const any = state.exposure || state.contrast || state.shadows || state.temp || state.vibrance;
        if (any) o.light = Object.assign({}, state); else delete o.light;
      });
      api.refresh();
    };
    [['Экспозиция', 'exposure', -100, 100, 1], ['Контраст', 'contrast', -100, 100, 1],
     ['Тени', 'shadows', 0, 100, 1], ['Температура', 'temp', -100, 100, 1], ['Сочность', 'vibrance', -100, 100, 1]]
      .forEach(([label, key, min, max, step]) => body.appendChild(sliderRow(label, state[key], min, max, step, (v) => { state[key] = v; apply(); })));
    body.appendChild(el('div', { class: 'sp-row sp-presets', html:
      '<button class="an-btn" data-l="0,0,0,0,0">Норма</button>' +
      '<button class="an-btn" data-l="18,8,26,14,10">День</button>' +
      '<button class="an-btn" data-l="-22,16,0,-26,16">Ночь</button>' +
      '<button class="an-btn" data-l="10,22,40,22,-10">Плёночное</button>' }));
    setTimeout(() => {
      $$('[data-l]', document.querySelector('#modalRoot')).forEach(b => b.addEventListener('click', () => {
        const [e, c, s2, t, v] = b.dataset.l.split(',').map(Number);
        Object.assign(state, { exposure: e, contrast: c, shadows: s2, temp: t, vibrance: v });
        apply();
        toast('Освещение: ' + b.textContent, 'success', 1600);
      }));
    }, 30);
    U.modal({
      title: 'Коррекция освещения', icon: 'eye', body,
      buttons: [
        { label: 'Сбросить', action: () => { Object.assign(state, { exposure: 0, contrast: 0, shadows: 0, temp: 0, vibrance: 0 }); apply(); setTimeout(() => lightDialog(), 30); } },
        { label: 'Отмена', action: () => { S.undo(); if (api) api.finish(); } },
        { label: 'Готово', class: 'primary', action: () => { if (api) api.finish(); } }
      ],
      onClose: () => { if (api) api.finish(); }
    });
  }

  /* ================================= 7. СЛОЙ ================================= */
  function layerMenu(anchor) {
    const sc = scene(), l = layer(), objs = selectedObjects();
    if (!l) return;
    if (!objs.length) { toast('Сначала выделите спрайт', 'warn'); return; }
    const items = [];
    items.push({ label: 'Выше в слое (поверх)', action: () => reorder(1) });
    items.push({ label: 'Ниже в слое', action: () => reorder(-1) });
    items.push('-');
    sc.layers.forEach(target => {
      if (target.id === l.id || target.type === 'folder') return;
      items.push({ label: 'Переместить на слой «' + target.name + '»', action: () => moveToLayer(target.id) });
    });
    items.push('-');
    items.push({ label: 'Новый слой сверху', action: () => moveToLayer(null) });
    items.push({ label: l.locked ? 'Разблокировать слой' : 'Заблокировать слой', checked: l.locked, action: () => {
      S.change('Блокировка слоя', () => { l.locked = !l.locked; }); render();
    } });
    U.dropdown(anchor, items);
  }
  function reorder(dir) {
    const objs = selectedObjects(); if (!objs.length) return;
    edit(dir > 0 ? 'Поднять спрайт' : 'Опустить спрайт', (list) => {
      const sel = list.filter(o => objs.some(s => s.id === o.id));
      const rest = list.filter(o => !objs.some(s => s.id === o.id));
      return sel.length ? (dir > 0 ? list.push(...sel) : list.unshift(...sel), true) : false;
    });
  }
  function moveToLayer(targetId) {
    const sc = scene(), l = layer(), objs = selectedObjects();
    if (!l || !objs.length) return;
    let target = targetId ? sc.layers.find(q => q.id === targetId) : null;
    S.change('Перемещение спрайта на другой слой', () => {
      const srcKey = A().ensureKey(l, frame(), false);
      if (!target) {
        target = A().newLayer('Слой ' + (sc.layers.length + 1));
        const i = sc.layers.findIndex(q => q.id === l.id);
        sc.layers.splice(Math.max(0, i), 0, target);
      }
      const dstKey = A().ensureKey(target, frame(), false);
      objs.forEach(o => {
        const i = srcKey.objects.findIndex(q => q.id === o.id);
        if (i >= 0) srcKey.objects.splice(i, 1);
        dstKey.objects.push(o);
      });
      st().layerId = target.id;
      st().selected = new Set(objs.map(o => o.id));
    });
    render();
    toast('Спрайт перемещён на слой «' + target.name + '»', 'success');
  }

  /* ================================== 8. МАСКА ================================== */
  function maskMenu(anchor) {
    const objs = selectedObjects(), l = layer();
    if (!l) return;
    const o = objs[0];
    const items = [
      { label: 'Использовать второй выделенный спрайт как маску', disabled: objs.length < 2, action: () => maskWithOther(objs) },
      { label: 'Создать маску-слой из спрайта', action: () => maskLayer(o) },
      '-',
      { label: 'Снять маску со спрайта', disabled: !(o && o.maskBy), action: () => clearMask(o) }
    ];
    U.dropdown(anchor, items);
  }
  function maskWithOther(objs) {
    if (objs.length < 2) { toast('Выделите спрайт и маску (Shift+клик)', 'warn', 3200); return; }
    const target = objs[0], mask = objs[1];
    edit('Маска спрайта', (list) => {
      const t = list.find(q => q.id === target.id); if (!t) return false;
      t.maskBy = mask.id; t.maskName = mask.type;
    });
    toast('Маска применена: спрайт виден только внутри «' + (mask.type) + '»', 'success', 3600);
  }
  function maskLayer(o) {
    if (!o) { toast('Сначала выделите спрайт', 'warn'); return; }
    const sc = scene(), l = layer();
    S.change('Маска из спрайта', () => {
      const m = A().newLayer('Маска ' + (sc.layers.length + 1), 'mask');
      const k = m.keys[0];
      const copy = A().clone(o);
      copy.strokeWidth = Math.max(1, (o.strokeWidth || 0));
      k.objects = [copy]; k.tween = 'hold';
      const i = sc.layers.findIndex(q => q.id === l.id);
      // Маска действует на слой, который лежит ПОД ней.
      sc.layers.splice(Math.max(0, i), 0, m);
    });
    render();
    toast('Создан слой-маска над текущим слоем', 'success', 3600);
  }
  function clearMask(o) {
    if (!o) return;
    edit('Снять маску', (list) => { const t = list.find(q => q.id === o.id); if (!t) return false; delete t.maskBy; delete t.maskName; });
    toast('Маска снята', 'success');
  }

  /* ========================= 8б. ДЕФОРМАЦИЯ СПРАЙТА ========================= */
  function deformMenu(anchor) {
    const o = one(); if (!o) return;
    const cur = A().validWarp(o.warp) ? o.warp : null;
    const items = [3, 4, 5, 6].map(n => ({
      label: 'Сетка деформации ' + n + '×' + n,
      checked: !!cur && cur.cols === n && cur.rows === n,
      action: () => setWarpGrid(o, n)
    }));
    items.push('-');
    items.push({ label: 'Инструмент «Сетка» — тянуть узлы вручную', action: () => {
      PPE.animationUI.setTool('meshwarp');
      PPE.animationUI.setPanel('timeline');
      toast('Инструмент деформации включён: тяните узлы прямо на сцене', 'success', 3200);
    } });
    items.push({ label: 'Сбросить деформацию', disabled: !cur, action: () => clearWarp(o) });
    U.dropdown(anchor, items);
  }
  function setWarpGrid(o, n) {
    edit('Деформация спрайта', (list) => {
      const t = list.find(q => q.id === o.id); if (!t) return false;
      t.warp = A().makeWarp(n, n);
    });
    toast('Сетка деформации ' + n + '×' + n + ' — тяните узлы инструментом «Сетка»', 'success', 3400);
  }
  function clearWarp(o) {
    edit('Сброс деформации', (list) => {
      const t = list.find(q => q.id === o.id); if (!t) return false;
      delete t.warp;
    });
    toast('Деформация сброшена', 'success');
  }

  /* ============================ 9. КРИВЫЕ (EASING) ============================ */
  const CURVES = [
    ['Линейно', [0, 0, 1, 1], 'Ровная скорость'],
    ['Плавно', [.25, .1, .25, 1], 'Как в CSS ease'],
    ['Ускорение', [.42, 0, 1, 1], 'Ease-in'],
    ['Замедление', [0, 0, .58, 1], 'Ease-out'],
    ['Пружина', [.34, 1.56, .64, 1], 'С отскоком'],
    ['Резко', [.9, 0, .1, 1], 'Быстрый вход и выход'],
    ['Ступень', [0, 0, 0, 1], 'Почти «hold»']
  ];
  function curveKeys(layerId) {
    const sc = scene(); const l = sc ? sc.layers.find(q => q.id === (layerId || st().layerId)) : null;
    return l ? (l.keys || []) : [];
  }
  function curveMenu(anchor) {
    const objs = selectedObjects();
    const l = layer();
    if (!l) return;
    const keys = layerKeysWithSelection(objs, l);
    U.dropdown(anchor, CURVES.map(([label, curve]) => ({
      label, checked: keys.length ? keys.every(k => k.tween === 'curve' && JSON.stringify(k.curve) === JSON.stringify(curve)) : false,
      action: () => applyCurve(label, curve)
    })).concat(['-', { label: 'Настроить кривую вручную…', action: () => curveDialog() }]));
  }
  function layerKeysWithSelection(objs, l) {
    const ids = new Set(objs.map(o => o.id));
    if (!ids.size) return l.keys || [];
    return (l.keys || []).filter(k => (k.objects || []).some(o => ids.has(o.id)));
  }
  function applyCurve(label, curve) {
    const l = layer(); if (!l) return;
    const keys = layerKeysWithSelection(selectedObjects(), l);
    if (!keys.length) { toast('У спрайта нет ключевых кадров', 'warn'); return; }
    S.change('Кривая ключевых кадров', () => {
      keys.forEach(k => { k.tween = 'curve'; k.curve = curve.slice(); });
    });
    render();
    toast('Кривая «' + label + '» применена к ' + keys.length + ' ключам', 'success', 3000);
  }
  function curveDialog(curveInit) {
    const l = layer(); if (!l) return;
    const keys = layerKeysWithSelection(selectedObjects(), l);
    if (!keys.length) { toast('У спрайта нет ключевых кадров — движение нечему сглаживать', 'warn', 3600); return; }
    const start = curveInit || (keys[0].curve || [.25, .1, .25, 1]);
    const state = { curve: start.slice() };
    const body = el('div', { class: 'sp-form sp-curve' });
    const cv = el('canvas', { class: 'sp-curve-canvas', width: 260, height: 260 });
    body.appendChild(cv);
    const fields = el('div', { class: 'sp-curve-fields' });
    ['X1', 'Y1', 'X2', 'Y2'].forEach((name, i) => {
      const inp = el('input', { type: 'number', step: '0.05', min: i % 2 === 0 ? '0' : '-2', max: i % 2 === 0 ? '1' : '3', value: String(state.curve[i]) });
      inp.addEventListener('input', () => { state.curve[i] = Number(inp.value) || 0; drawCurve(cv, state.curve); });
      fields.appendChild(el('label', {}, [el('span', { text: name }), inp]));
    });
    body.appendChild(fields);
    const presets = el('div', { class: 'sp-row sp-presets' });
    CURVES.forEach(([label, c]) => {
      const b = el('button', { class: 'an-btn', text: label });
      b.addEventListener('click', () => { state.curve = c.slice(); drawCurve(cv, state.curve); $$('input', fields).forEach((n, i) => n.value = String(state.curve[i])); });
      presets.appendChild(b);
    });
    body.appendChild(presets);
    body.appendChild(el('div', { class: 'sp-note', text: 'Кривая задаёт скорость перехода от этого ключа к следующему. Y больше 1 — «перелёт» с отскоком.' }));
    drawCurve(cv, state.curve);
    U.modal({
      title: 'Настройки кривых', icon: 'wave', body,
      buttons: [
        { label: 'Отмена' },
        { label: 'Применить к ' + keys.length + ' ' + plural(keys.length, 'ключу', 'ключам', 'ключам'), class: 'primary', action: () => {
          S.change('Кривая ключевых кадров', () => {
            layerKeysWithSelection(selectedObjects(), layer()).forEach(k => { k.tween = 'curve'; k.curve = state.curve.slice(); });
          });
          render();
          toast('Кривая применена', 'success');
        } }
      ]
    });
  }
  function drawCurve(cv, curve) {
    const x = cv.getContext('2d'), w = cv.width, h = cv.height, pad = 26;
    x.clearRect(0, 0, w, h);
    x.fillStyle = '#14161b'; x.fillRect(0, 0, w, h);
    x.strokeStyle = '#2b2f38'; x.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const gx = pad + (w - pad * 2) * i / 4, gy = pad + (h - pad * 2) * i / 4;
      x.beginPath(); x.moveTo(gx, pad); x.lineTo(gx, h - pad); x.stroke();
      x.beginPath(); x.moveTo(pad, gy); x.lineTo(w - pad, gy); x.stroke();
    }
    const px = t => pad + (w - pad * 2) * t;
    const py = v => h - pad - (h - pad * 2) * (v / 1.6);
    x.strokeStyle = '#3d8bff'; x.lineWidth = 2.5; x.beginPath();
    const [x1, y1, x2, y2] = curve;
    x.moveTo(px(0), py(0));
    x.bezierCurveTo(px(x1), py(y1), px(x2), py(y2), px(1), py(1));
    x.stroke();
    [[x1, y1, '#79b2ff'], [x2, y2, '#9fe8c8']].forEach(([cx, cy, col]) => {
      x.strokeStyle = col; x.lineWidth = 1.5; x.beginPath(); x.moveTo(px(0), py(0)); x.lineTo(px(cx), py(cy)); x.stroke();
      x.fillStyle = col; x.beginPath(); x.arc(px(cx), py(cy), 4.5, 0, Math.PI * 2); x.fill();
    });
    x.fillStyle = '#6d7078'; x.font = '11px system-ui,sans-serif';
    x.fillText('время →', pad, h - 6); x.fillText('значение ↑', 4, pad - 8);
  }

  /* ================= 10. ПЕРЕНОС КЛЮЧЕВЫХ КАДРОВ НА ДРУГОЙ СПРАЙТ ================= */
  function transferDialog(explicit) {
    const objs = selectedObjects(); const l = layer(); const sc = scene();
    const src = explicit || objs[0];
    if (!src) { toast('Сначала выделите спрайт-источник', 'warn'); return; }
    const targets = [];
    sc.layers.forEach(lay => {
      if (lay.type === 'folder' || lay.type === 'mask') return;
      const seen = new Set();
      (lay.keys || []).forEach(k => (k.objects || []).forEach(o => {
        if (o.id === src.id || seen.has(o.id)) return;
        seen.add(o.id);
        if (o.type === 'mesh') return;
        targets.push({ layer: lay, obj: o });
      }));
    });
    if (!targets.length) { toast('В сцене нет других спрайтов', 'warn', 3200); return; }
    const body = el('div', { class: 'sp-form' });
    body.appendChild(el('div', { class: 'sp-note', text: 'Ключевые кадры вместе со значениями переносятся с «' + (src.type) + '» на выбранный спрайт. Удобно, когда анимация уже настроена, а картинку нужно заменить.' }));
    const list = el('div', { class: 'sp-transfer' });
    let picked = targets[0];
    targets.forEach((t, i) => {
      const b = el('button', { class: 'sp-transfer-item' + (i === 0 ? ' on' : '') }, [
        el('span', { text: t.layer.name }), el('strong', { text: t.obj.type + ' · ' + Math.round(t.obj.w) + '×' + Math.round(t.obj.h) })
      ]);
      b.addEventListener('click', () => { picked = t; $$('.sp-transfer-item', list).forEach(n => n.classList.remove('on')); b.classList.add('on'); });
      list.appendChild(b);
    });
    body.appendChild(list);
    const mode = el('label', { class: 'sp-row' }, [
      el('span', { text: 'Режим' }),
      el('select', { class: 'sp-input' }, [
        el('option', { value: 'copy', text: 'Скопировать ключи (источник остаётся' }),
        el('option', { value: 'move', text: 'Перенести (у источника ключи удалятся)' })
      ])
    ]);
    body.appendChild(mode);
    U.modal({
      title: 'Перенести ключевые кадры на другой спрайт', icon: 'diamond', wide: true, body,
      buttons: [
        { label: 'Отмена' },
        { label: 'Перенести', class: 'primary', action: () => {
          const how = $('select', mode).value;
          transferKeys(src, picked, how);
        } }
      ]
    });
  }
  function transferKeys(src, target, how) {
    const sc = scene(); const srcLayer = layer();
    let moved = 0;
    S.change('Перенос ключевых кадров', () => {
      const frames = [];
      (srcLayer.keys || []).forEach(k => {
        if ((k.objects || []).some(o => o.id === src.id)) frames.push(k.frame);
      });
      frames.forEach(f => {
        const srcKey = (srcLayer.keys || []).find(k => k.frame === f);
        const srcObj = srcKey && (srcKey.objects || []).find(o => o.id === src.id);
        if (!srcObj) return;
        const dstKey = A().ensureKey(target.layer, f, false);
        let dstObj = (dstKey.objects || []).find(o => o.id === target.obj.id);
        if (!dstObj) {
          const c = A().clone(target.obj); c.id = target.obj.id; dstKey.objects.push(c); dstObj = c;
        }
        ['x', 'y', 'w', 'h', 'rotation', 'opacity', 'fill', 'fill2', 'stroke', 'strokeWidth', 'gradient', 'crop', 'warp', 'fx', 'light', 'text', 'fontSize', 'textScaleX']
          .forEach(key => {
            if (srcObj[key] === undefined) delete dstObj[key];
            else dstObj[key] = A().clone(srcObj[key]);
          });
        if (how === 'move') {
          srcKey.objects = (srcKey.objects || []).filter(o => o.id !== src.id);
        }
        moved++;
      });
    });
    render();
    toast('Ключевые кадры ' + (how === 'move' ? 'перенесены' : 'скопированы') + ': ' + moved, 'success', 3600);
  }

  /* ======================= МЕНЮ КЛЮЧЕВОГО КАДРА (в таймлайне) ======================= */
  /** Контекстное меню самого ключевого кадра слоя: кривые и перенос анимации. */
  function keyMenu(x, y, opts) {
    opts = opts || {};
    const sc = scene();
    const layerId = opts.layerId || st().layerId;
    const frameNo = opts.frame != null ? opts.frame : frame();
    const lay = sc ? sc.layers.find(q => q.id === layerId) : null;
    const key = lay && (lay.keys || []).find(k => k.frame === frameNo);
    const anchor = { getBoundingClientRect: () => ({ left: x, right: x, top: y, bottom: y }) };
    const sprites = key ? (key.objects || []).length : 0;
    const items = [
      { label: 'Кадр ' + (frameNo + 1) + ' · ' + sprites + ' объ.', disabled: true },
      { label: 'Кривые — скорость перехода', disabled: !key, action: () => curveMenuFor(anchor, layerId, frameNo) },
      { label: 'Настройки кривых…', disabled: !key, action: () => curveDialogFor(layerId, frameNo) },
      '-',
      { label: 'Перенести ключевые кадры на другой спрайт…', disabled: !sprites, action: () => transferDialogFor(layerId, frameNo) }
    ];
    U.contextMenu(x, y, items);
  }
  /** Кривые для конкретного слоя/кадра (без зависимости от выделения). */
  function curveMenuFor(anchor, layerId, frameNo) {
    const sc = scene();
    const lay = sc && sc.layers.find(q => q.id === layerId);
    const key = lay && (lay.keys || []).find(k => k.frame === frameNo);
    if (!key) { toast('В этом кадре нет ключа', 'warn'); return; }
    U.dropdown(anchor, CURVES.map(([label, curve]) => ({
      label, checked: key.tween === 'curve' && JSON.stringify(key.curve) === JSON.stringify(curve),
      action: () => {
        S.change('Кривая ключевого кадра', () => { key.tween = 'curve'; key.curve = curve.slice(); });
        render();
        toast('Кривая «' + label + '» применена к кадру ' + (frameNo + 1), 'success', 2600);
      }
    })).concat(['-', { label: 'Настроить кривую вручную…', action: () => curveDialogFor(layerId, frameNo) }]));
  }
  /** Диалог кривых для конкретного ключевого кадра. */
  function curveDialogFor(layerId, frameNo) {
    const sc = scene();
    const lay = sc && sc.layers.find(q => q.id === layerId);
    const key = lay && (lay.keys || []).find(k => k.frame === frameNo);
    if (!key) { toast('В этом кадре нет ключа', 'warn'); return; }
    const st0 = { curve: (key.curve || [.25, .1, .25, 1]).slice() };
    const body = el('div', { class: 'sp-form sp-curve' });
    const cv = el('canvas', { class: 'sp-curve-canvas', width: 260, height: 260 });
    body.appendChild(cv);
    const fields = el('div', { class: 'sp-curve-fields' });
    ['X1', 'Y1', 'X2', 'Y2'].forEach((nm, i) => {
      const inp = el('input', { type: 'number', step: '0.05', value: String(st0.curve[i]) });
      inp.addEventListener('input', () => { st0.curve[i] = Number(inp.value) || 0; drawCurve(cv, st0.curve); });
      fields.appendChild(el('label', {}, [el('span', { text: nm }), inp]));
    });
    body.appendChild(fields);
    const presets = el('div', { class: 'sp-row sp-presets' });
    CURVES.forEach(([label, c]) => {
      const bt = el('button', { class: 'an-btn', text: label });
      bt.addEventListener('click', () => {
        st0.curve = c.slice(); drawCurve(cv, st0.curve);
        $$('input', fields).forEach((n, i) => n.value = String(st0.curve[i]));
      });
      presets.appendChild(bt);
    });
    body.appendChild(presets);
    body.appendChild(el('div', { class: 'sp-note', text: 'Кривая задаёт скорость перехода от кадра ' + (frameNo + 1) + ' к следующему ключу слоя «' + lay.name + '».' }));
    drawCurve(cv, st0.curve);
    U.modal({
      title: 'Настройки кривых · кадр ' + (frameNo + 1), icon: 'wave', body,
      buttons: [
        { label: 'Отмена' },
        { label: 'Применить', class: 'primary', action: () => {
          S.change('Кривая ключевого кадра', () => { key.tween = 'curve'; key.curve = st0.curve.slice(); });
          render();
          toast('Кривая применена', 'success');
        } }
      ]
    });
  }
  /** Перенос ключей на другой спрайт из контекста конкретного кадра. */
  function transferDialogFor(layerId, frameNo) {
    const sc = scene();
    const lay = sc && sc.layers.find(q => q.id === layerId);
    const key = lay && (lay.keys || []).find(k => k.frame === frameNo);
    if (!key || !(key.objects || []).length) { toast('В этом кадре нет спрайтов', 'warn'); return; }
    // Источник — первый (или выделенный) спрайт кадра.
    const sel = (key.objects || []).find(o => (st().selected || new Set()).has(o.id)) || key.objects[0];
    st().layerId = layerId; st().frame = frameNo;
    st().selected = new Set([sel.id]);
    transferDialog(sel);
  }

  /* ================================== ПАНЕЛЬ ================================== */
  function panel(box) {
    const objs = selectedObjects();
    const wrap = el('div', { class: 'sp-panel' });
    const bar = el('div', { class: 'an-bar' });
    bar.appendChild(el('span', { class: 'sp-count', text: objs.length ? 'Выбрано спрайтов: ' + objs.length : 'Спрайт не выбран' }));
    const clear = el('button', { class: 'an-btn', text: 'Снять выделение' });
    clear.addEventListener('click', () => { st().selected = new Set(); render(); });
    bar.appendChild(clear);
    wrap.appendChild(bar);

    // Все настройки спрайта живут в контекстном меню (правый клик по сцене).
    // Здесь — только вход в него, чтобы ничего не искать.
    const open = el('button', { class: 'an-btn sp-open', title: 'Открыть контекстное меню спрайта' }, [
      el('strong', { text: 'Настройки спрайта…' }),
      el('small', { text: 'Склейка · Замена · Фильтры · Удалить фон · Освещение · Деформация · Слой · Маска · Кадрирование · сборка ' + (PPE_BUILD || '—') }),
    ]);
    open.addEventListener('click', (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      contextMenu(r.right - 8, r.bottom + 4);
    });
    wrap.appendChild(open);

    wrap.appendChild(section('Что в меню спрайта'));
    const list = el('div', { class: 'sp-menu-list' });
    [['Склейка', 'объединить выделенные спрайты в один'],
     ['Замена спрайта', 'картинка или текст'],
     ['Фильтры / Настроить фильтр', 'Ч/Б, сепия, винтаж, неон, яркость и контраст'],
     ['Удалить фон', 'вырезать фон по цвету'],
     ['Коррекция освещения', 'экспозиция, тени, температура'],
     ['Деформация спрайта', 'сетка 3×3 … 6×6'],
     ['Слой', 'перенос на другой слой, порядок, блокировка'],
     ['Маска', 'второй спрайт как маска или маска-слой']].forEach(([t, d]) => {
      list.appendChild(el('div', { class: 'sp-menu-item' }, [el('strong', { text: t }), el('small', { text: d })]));
    });
    wrap.appendChild(list);
    wrap.appendChild(el('div', { class: 'sp-note', text: 'Правый клик по спрайту на сцене открывает это меню. Кривые и перенос ключевых кадров — в меню самого ключевого кадра (правый клик по ◆ в таймлайне).' }));
    box.appendChild(wrap);
  }

  /** Контекстное меню по правому клику на сцене. */
  function contextMenu(x, y) {
    const objs = selectedObjects();
    const anchor = { getBoundingClientRect: () => ({ left: x, right: x, top: y, bottom: y }) };
    const off = !objs.length;
    const items = [
      { label: 'Склейка' + (objs.length === 1 && objs[0].type === 'group' ? ' / разгруппировать' : ''), disabled: off, action: () => merge() },
      { label: 'Замена спрайта…', disabled: off, action: () => replaceDialog() },
      { label: 'Кадрирование…', disabled: off, action: () => cropDialog() },
      '-',
      { label: 'Фильтры', disabled: off, action: () => filterMenu(anchor) },
      { label: 'Настроить фильтр…', disabled: off, action: () => filterDialog() },
      { label: 'Удалить фон…', disabled: off, action: () => removeBgDialog() },
      { label: 'Коррекция освещения…', disabled: off, action: () => lightDialog() },
      { label: 'Деформация спрайта', disabled: off, action: () => deformMenu(anchor) },
      { label: 'Слой', disabled: off, action: () => layerMenu(anchor) },
      { label: 'Маска', disabled: off, action: () => maskMenu(anchor) }
    ];
    U.contextMenu(x, y, items);
  }

  PPE.sprite = {
    panel, contextMenu, merge, ungroup, cropDialog, replaceDialog, filterMenu, filterDialog,
    removeBgDialog, lightDialog, layerMenu, maskMenu, curveMenu, curveDialog, transferDialog,
    transferKeys, canvasToMedia, selectedObjects, applyCurve, reorder, moveToLayer, maskWithOther, maskLayer, clearMask, keyOut, drawCurve, FILTERS, CURVES,
    keyMenu, curveMenuFor, curveDialogFor, transferDialogFor, deformMenu, setWarpGrid, clearWarp
  };
})(window);
