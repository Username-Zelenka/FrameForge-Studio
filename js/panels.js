/* =========================================================================
   panels.js — project bin, effects browser, markers, history, mixer,
                effect controls and item dialogs
   ========================================================================= */
(function (root) {
  'use strict';
  const PPE = root.PPE = root.PPE || {};
  const U = PPE.utils, S = PPE.state, M = PPE.media;
  const $ = U.$, $$ = U.$$, el = U.el, clamp = U.clamp, esc = U.escapeHtml;
  let initialized = false, activeLeftTab = 'effects', groupCollapsed = {};

  const PARAMS = {
    'transform.x': { label: 'Позиция X', min: -150, max: 150, step: 1, unit: '%' },
    'transform.y': { label: 'Позиция Y', min: -150, max: 150, step: 1, unit: '%' },
    'transform.scale': { label: 'Масштаб', min: 0, max: 500, step: 1, unit: '%' },
    'transform.rotation': { label: 'Поворот', min: -360, max: 360, step: 1, unit: '°' },
    'transform.opacity': { label: 'Непрозрачность', min: 0, max: 100, step: 1, unit: '%' },
    'color.brightness': { label: 'Яркость', min: 0, max: 300, step: 1, unit: '%' },
    'color.contrast': { label: 'Контраст', min: 0, max: 300, step: 1, unit: '%' },
    'color.saturate': { label: 'Насыщенность', min: 0, max: 400, step: 1, unit: '%' },
    'color.blur': { label: 'Размытие', min: 0, max: 60, step: .5, unit: 'px' },
    'color.grayscale': { label: 'Обесцвечивание', min: 0, max: 100, step: 1, unit: '%' },
    'color.sepia': { label: 'Сепия', min: 0, max: 100, step: 1, unit: '%' },
    'color.hue': { label: 'Оттенок', min: -180, max: 180, step: 1, unit: '°' },
    'color.vignette': { label: 'Виньетка', min: 0, max: 100, step: 1, unit: '%' },
    'audio.volume': { label: 'Громкость', min: 0, max: 400, step: 1, unit: '%' },
    'audio.pan': { label: 'Панорама', min: -1, max: 1, step: .05, unit: '' },
    'audio.fadeIn': { label: 'Нарастание', min: 0, max: 20, step: .1, unit: 'с' },
    'audio.fadeOut': { label: 'Затухание', min: 0, max: 20, step: .1, unit: 'с' },
    'speed': { label: 'Скорость', min: 5, max: 500, step: 5, unit: '%' }
  };

  let effectsDirty = false;   // список эффектов нужно пересобрать при показе вкладки
  let effectsSig = '';        // подпись состояния списка эффектов

  /* =============================== init =============================== */
  function init() {
    if (initialized) return; initialized = true;
    // Drop target for OS files (inline handlers are unreliable inside sandboxed previews).
    const ml = $('#mediaList');
    if (ml) {
      ml.addEventListener('dragover', e => e.preventDefault());
      ml.addEventListener('drop', onDropImport);
    }
    $('#mediaSearch').addEventListener('input', U.debounce(renderProject, 120));
    $('#effectSearch').addEventListener('input', U.debounce(renderEffects, 120));
    $('#viewListBtn').addEventListener('click', () => { S.mediaView = 'list'; renderProject(); });
    $('#viewGridBtn').addEventListener('click', () => { S.mediaView = 'grid'; renderProject(); });
    $$('#leftTabs .ptab').forEach(b => b.addEventListener('click', () => setLeftTab(b.dataset.ltab)));
    $$('.panel-tabs[data-tabs="projectHead"] .ptab').forEach(b => b.addEventListener('click', () => {
      $$('.panel-tabs[data-tabs="projectHead"] .ptab').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      if (b.dataset.tab === 'mediabrowser') { $('#mediaList').innerHTML = mediaBrowserHTML(); bindMediaBrowser(); }
      else renderProject();
    }));
    setLeftTab('effects');
  }
  function setLeftTab(tab) {
    activeLeftTab = tab;
    $$('#leftTabs .ptab').forEach(b => b.classList.toggle('active', b.dataset.ltab === tab));
    ['effectsList', 'markersList', 'historyList', 'mixerList', 'colorPanel', 'soundPanel', 'browserPanel', 'graphicsPanel', 'exportPanel'].forEach(id => { const n = $('#' + id); if (n) { n.style.display = 'none'; n.classList.add('hidden'); } });
    const show = id => { const n = $('#' + id); if (n) { n.classList.remove('hidden'); n.style.display = ''; } };
    const sub = $('#leftTabSubhead'); if (sub) sub.style.display = tab === 'effects' ? '' : 'none';
    if (tab === 'effects') { show('effectsList'); renderEffects(); }
    if (tab === 'markers') { show('markersList'); renderMarkers(); }
    if (tab === 'history') { show('historyList'); renderHistory(); }
    if (tab === 'mixer') { show('mixerList'); renderMixer(); }
    if (PPE.proPanels) { PPE.proPanels.renderTab(tab); }
  }
  function mediaBrowserHTML() {
    return '<div class="empty-note">' + U.icon('folder') + 'Медиа-браузер<br>Перетащите файлы в окно или нажмите «Импорт».<br><br>' +
      '<button class="btn small" id="mbImport">Выбрать файлы…</button></div>';
  }
  function bindMediaBrowser() { const b = $('#mbImport'); if (b) b.onclick = () => $('#fileInput').click(); }

  /* =============================== project bin =============================== */
  let projectSig = '';
  function renderProject() {
    if (!initialized) init();
    const box = $('#mediaList'); if (!box) return;
    const q = ($('#mediaSearch') && $('#mediaSearch').value || '').toLowerCase().trim();
    // Дешёвая проверка: если список медиа и выделение не изменились — не пересобираем DOM.
    const sig = [S.mediaView, q, S.selectedMedia || '', S.relinkNeeded ? 1 : 0,
      S.project.media.map(m => m.id + (m.thumb ? '*' : '') + (m.offline ? '!' : '') + m.name).join(','),
      (S.project.name || '') + (S.dirty ? '*' : '')].join('#');
    if (sig === projectSig && box.childElementCount) return;
    projectSig = sig;
    box.className = 'panel-body scroll' + (S.mediaView === 'list' ? ' media-list' : '');
    box.innerHTML = '';
    // Вместо красного баннера «медиа офлайн» — тихая строка, и только если файл
    // действительно не нашёлся ни в проекте, ни во встроенном хранилище.
    if (S.relinkNeeded) {
      const missing = S.project.media.filter(m => !m.generated && !m.url).length;
      const line = el('div', { class: 'relink-hint', html: '<span>Нет файлов: ' + missing + '</span><button class="btn tiny" id="relinkBtn">Найти</button>' });
      box.appendChild(line);
      $('#relinkBtn', box).onclick = relinkDialog;
    }
    const items = S.project.media.filter(m => !q || m.name.toLowerCase().includes(q) || (m.fileName || '').toLowerCase().includes(q));
    if (!items.length) {
      box.appendChild(el('div', { class: 'empty-note', html: U.icon('film') + (S.project.media.length ? 'Ничего не найдено' : 'Проект пуст.<br>Перетащите видео, аудио или изображения сюда<br>либо нажмите «Импорт».') }));
    } else {
      const grid = el('div', { class: S.mediaView === 'grid' ? 'media-grid' : 'media-list' });
      items.forEach(m => grid.appendChild(mediaCell(m)));
      box.appendChild(grid);
    }
    $('#mediaCount').textContent = S.project.media.length + ' элементов';
    $('#projectLabel').textContent = (S.project.name || 'Без имени') + (S.dirty ? ' *' : '') + '.prproj';
  }
  function mediaCell(m) {
    const node = el('div', {
      class: 'media-cell' + (S.selectedMedia === m.id ? ' selected' : '') + (m.offline ? ' offline' : ''),
      draggable: 'true', dataset: { mediaId: m.id },
      title: m.name + '\nТип: ' + m.type + '\nДлительность: ' + U.formatTC(S.sourceDuration(m), S.project.fps)
    });
    // Иконку типа рисуем только когда превью нет — иначе она висела поверх кадра.
    const thumb = el('div', { class: 'media-thumb', style: m.thumb ? { backgroundImage: 'url("' + m.thumb + '")' } : {} },
      m.thumb ? [] : [U.iconEl(M.mediaIcon(m))]);
    if (m.thumb) thumb.style.backgroundSize = 'cover';
    thumb.appendChild(el('span', { class: 'media-type-badge', text: m.type.toUpperCase() }));
    node.appendChild(thumb);
    node.appendChild(el('div', { class: 'media-name', text: m.name }));
    node.appendChild(el('div', { class: 'media-meta', html: '<span>' + (m.generated ? 'генератор' : U.formatTC(S.sourceDuration(m), S.project.fps)) + '</span><span>' + (m.width ? m.width + '×' + m.height : m.type) + '</span>' }));
    node.addEventListener('click', () => { S.selectedMedia = m.id; renderProject(); });
    node.addEventListener('dblclick', () => openSource(m.id));
    node.addEventListener('contextmenu', e => {
      e.preventDefault(); S.selectedMedia = m.id; renderProject();
      U.contextMenu(e.clientX, e.clientY, [
        { label: 'Открыть в исходном мониторе', icon: 'film', action: () => openSource(m.id) },
        { label: 'Добавить в таймлайн', icon: 'insert', action: () => PPE.timeline.placeMedia(m.id, PPE.timeline.targetTrack(m.type === 'audio' ? 'audio' : 'video').id, S.playhead) },
        { label: 'Добавить в конец', icon: 'plus', action: () => PPE.timeline.placeMedia(m.id, PPE.timeline.targetTrack(m.type === 'audio' ? 'audio' : 'video').id, S.sequenceDuration()) },
        '-',
        { label: 'Переименовать', icon: 'text', action: () => renameMedia(m) },
        { label: 'Перепривязать…', icon: 'link', disabled: m.generated, action: () => relinkDialog(m.id) },
        { label: 'Свойства…', icon: 'info', action: () => mediaInfo(m) },
        '-',
        { label: 'Удалить', icon: 'trash', danger: true, action: () => M.removeMedia(m.id) }
      ]);
    });
    node.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/ppe-media', m.id);
      e.dataTransfer.setData('text/plain', m.id);
      e.dataTransfer.effectAllowed = 'copy';
      const g = $('#dragGhost'); g.textContent = m.name; g.classList.remove('hidden');
      g.style.left = (e.clientX + 12) + 'px'; g.style.top = (e.clientY + 12) + 'px';
      e.dataTransfer.setDragImage(g, 0, 0);
    });
    node.addEventListener('dragend', () => $('#dragGhost').classList.add('hidden'));
    return node;
  }
  function renameMedia(m) {
    U.modal({
      title: 'Переименовать', icon: 'text',
      body: '<div class="form-row"><label>Имя</label><div class="form-control"><input type="text" id="medName" value="' + esc(m.name) + '"></div></div>',
      buttons: [{ label: 'Отмена' }, { label: 'ОК', class: 'primary', action: (b) => { const v = $('#medName', b).value.trim(); if (v) { S.change('Переименование', () => m.name = v); renderProject(); } } }]
    });
  }
  function mediaInfo(m) {
    U.modal({
      title: 'Свойства: ' + m.name, icon: 'info',
      body: '<div class="form-row"><label>Тип</label><div class="form-control">' + esc(m.type) + '</div></div>' +
        '<div class="form-row"><label>Имя файла</label><div class="form-control">' + esc(m.fileName || '—') + '</div></div>' +
        '<div class="form-row"><label>Длительность</label><div class="form-control">' + (m.generated ? 'не ограничена (генератор)' : U.formatTC(S.sourceDuration(m), S.project.fps)) + '</div></div>' +
        '<div class="form-row"><label>Разрешение</label><div class="form-control">' + (m.width ? m.width + ' × ' + m.height : '—') + '</div></div>' +
        '<div class="form-row"><label>Статус</label><div class="form-control">' + (m.generated ? 'Генерируемый' : m.offline ? 'Офлайн' : 'Подключён') + '</div></div>'
    });
  }
  function openSource(id) { S.selectedMedia = id; renderProject(); PPE.engine.openSource(id); }
  function onDropImport(e) {
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) { e.preventDefault(); M.importFiles(e.dataTransfer.files); }
  }

  /* =============================== effects browser =============================== */
  function renderEffects() {
    const box = $('#effectsList'); if (!box) return;
    // Список эффектов тяжёлый (сотни строк): если вкладка не активна или панель
    // скрыта (мобильная раскладка), пересборка не нужна — сделаем её при показе.
    if (box.classList.contains('hidden') || !box.getClientRects().length) { effectsDirty = true; return; }
    effectsDirty = false;
    const q = ($('#effectSearch') && $('#effectSearch').value || '').toLowerCase().trim();
    // Список эффектов — самая тяжёлая часть renderAll (сотни строк DOM).
    // Пересобираем его только когда реально изменились выделение, поиск или
    // свёрнутые группы.
    const sel0 = S.findClip(Array.from(S.selection)[0]);
    const fxSig = [sel0 ? sel0.id : '', sel0 && sel0.effects ? sel0.effects.map(f => f.uid).join(',') : '',
      q, JSON.stringify(groupCollapsed)].join('#');
    if (fxSig === effectsSig && box.childElementCount) return;
    effectsSig = fxSig;
    box.innerHTML = '';
    const sel = S.findClip(Array.from(S.selection)[0]);
    // applied effects
    const applied = el('div', { class: 'fx-group' });
    applied.appendChild(el('div', { class: 'fx-group-head', html: U.icon('chevron', 'caret') + '<span>Применённые эффекты ' + (sel ? '— ' + esc(sel.name) : '') + '</span>' }));
    const appliedItems = el('div', { class: 'fx-items' });
    if (!sel || !sel.effects || !sel.effects.length) appliedItems.appendChild(el('div', { class: 'fx-hint', text: sel ? 'Нет эффектов. Дважды щёлкните по эффекту ниже или перетащите его на клип.' : 'Выберите клип на таймлайне.' }));
    else (sel.effects || []).forEach(fx => {
      const row = el('div', { class: 'applied-item', html: U.icon('fx') + '<span>' + esc(fx.label) + '</span>' });
      row.appendChild(el('button', { class: 'fx-remove', title: 'Удалить эффект', html: U.icon('close'), onclick: () => { S.change('Удаление эффекта', () => S.removeEffect(sel, fx.uid)); if (PPE.renderAll) PPE.renderAll(); } }));
      appliedItems.appendChild(row);
    });
    applied.appendChild(appliedItems);
    box.appendChild(applied);
    const groups = {};
    PPE.effectCatalog.forEach(e => { if (q && !(e.name.toLowerCase().includes(q) || e.group.toLowerCase().includes(q) || (e.tag || '').toLowerCase().includes(q))) return; (groups[e.group] = groups[e.group] || []).push(e); });
    Object.keys(groups).forEach(g => {
      const group = el('div', { class: 'fx-group' + (groupCollapsed[g] ? ' collapsed' : '') });
      const head = el('div', { class: 'fx-group-head', html: U.icon('chevron', 'caret') + '<span>' + esc(g) + '</span>' });
      head.addEventListener('click', () => { groupCollapsed[g] = !groupCollapsed[g]; renderEffects(); });
      group.appendChild(head);
      const items = el('div', { class: 'fx-items' });
      groups[g].forEach(def => {
        const row = el('div', { class: 'fx-item', draggable: 'true', html: U.icon(def.icon) + '<span>' + esc(def.name) + '</span><span class="fx-tag">' + esc(def.tag || '') + '</span>', title: 'Перетащите на клип или дважды щёлкните' });
        row.addEventListener('dblclick', () => PPE.timeline.applyEffectToSelected(def.id));
        row.addEventListener('dragstart', e => {
          e.dataTransfer.setData('text/ppe-effect', def.id);
          e.dataTransfer.setData('text/plain', def.id);
          e.dataTransfer.effectAllowed = 'copy';
          const g2 = $('#dragGhost'); g2.textContent = def.name; g2.classList.remove('hidden');
          g2.style.left = (e.clientX + 12) + 'px'; g2.style.top = (e.clientY + 12) + 'px';
        });
        row.addEventListener('dragend', () => $('#dragGhost').classList.add('hidden'));
        items.appendChild(row);
      });
      group.appendChild(items);
      box.appendChild(group);
    });
  }

  /* =============================== markers =============================== */
  function renderMarkers() {
    const box = $('#markersList'); if (!box) return;
    box.innerHTML = '';
    const btns = el('div', { style: { padding: '6px', display: 'flex', gap: '5px' } }, [
      el('button', { class: 'btn small', html: U.icon('plus') + ' Добавить', onclick: () => { PPE.timeline.addMarkerAt(S.playhead); } }),
      el('button', { class: 'btn small', html: U.icon('trash') + ' Очистить', onclick: () => { S.change('Очистка маркеров', () => S.project.markers = []); renderAll(); } })
    ]);
    box.appendChild(btns);
    if (!S.project.markers.length) box.appendChild(el('div', { class: 'fx-hint', text: 'Маркеров пока нет. Нажмите M во время воспроизведения или дважды щёлкните по таймлайну.' }));
    S.project.markers.slice().sort((a, b) => a.time - b.time).forEach(m => {
      const row = el('div', { class: 'list-row', html: U.icon('marker') + '<span class="grow">' + esc(m.name) + (m.comment ? ' — ' + esc(m.comment) : '') + '</span><span class="tc-mini">' + U.formatTC(m.time, S.project.fps) + '</span>' });
      row.addEventListener('click', () => PPE.engine.seek(m.time));
      row.appendChild(el('button', { class: 'icon-btn tiny', title: 'Удалить', html: U.icon('close'), onclick: e => { e.stopPropagation(); PPE.timeline.removeMarker(m.id); } }));
      box.appendChild(row);
    });
  }

  /* =============================== history =============================== */
  function renderHistory() {
    const box = $('#historyList'); if (!box) return;
    box.innerHTML = '';
    box.appendChild(el('div', { style: { padding: '5px 8px', color: 'var(--text-3)' }, text: 'Отменено: ' + S.history.undo.length + ' · Повторено: ' + S.history.redo.length }));
    const head = el('div', { class: 'list-row', html: U.icon('reset') + '<span class="grow"><b>Начальное состояние</b></span>' });
    box.appendChild(head);
    S.history.undo.slice().reverse().forEach((h, i) => {
      const n = S.history.undo.length - i;
      box.appendChild(el('div', { class: 'list-row', style: { paddingLeft: (10 + Math.min(n, 12) * 3) + 'px' }, html: U.icon('undo') + '<span class="grow">' + esc(h.label) + '</span><span class="tc-mini">#' + n + '</span>' }));
    });
  }

  /* =============================== audio mixer =============================== */
  function renderMixer() {
    const box = $('#mixerList'); if (!box) return;
    box.innerHTML = '';
    const wrap = el('div', { class: 'mixer' });
    S.project.tracks.filter(t => t.type === 'audio').forEach(t => {
      const strip = el('div', { class: 'mixer-strip' });
      strip.appendChild(el('div', { class: 'mixer-name', text: t.name }));
      const body = el('div', { class: 'mixer-body' });
      const fader = el('input', { type: 'range', min: 0, max: 2, step: .01, value: t.gain == null ? 1 : t.gain, class: 'mixer-fader' });
      fader.addEventListener('input', () => { t.gain = parseFloat(fader.value); M.setTrackGain(t.id, t.gain); S.markDirty(); $('#db-' + t.id, strip).textContent = dbText(t.gain); });
      body.appendChild(fader);
      const meter = el('div', { class: 'mixer-meter' }, [el('canvas', { dataset: { meter: t.id } })]);
      body.appendChild(meter);
      strip.appendChild(body);
      strip.appendChild(el('div', { class: 'mixer-db', id: 'db-' + t.id, text: dbText(t.gain) }));
      const btns = el('div', { class: 'mixer-btns' });
      btns.appendChild(el('button', { class: t.muted ? 'm-on' : '', text: 'M', title: 'Mute', onclick: () => { S.change('Mute', () => t.muted = !t.muted); renderMixer(); PPE.timeline.render(); } }));
      btns.appendChild(el('button', { class: t.solo ? 'on' : '', text: 'S', title: 'Solo', onclick: () => { S.change('Solo', () => t.solo = !t.solo); renderMixer(); PPE.timeline.render(); } }));
      strip.appendChild(btns);
      wrap.appendChild(strip);
    });
    const master = el('div', { class: 'mixer-strip master' });
    master.appendChild(el('div', { class: 'mixer-name', text: 'Мастер' }));
    const mbody = el('div', { class: 'mixer-body' });
    const mf = el('input', { type: 'range', min: 0, max: 2, step: .01, value: 1, class: 'mixer-fader' });
    mf.addEventListener('input', () => M.setMasterGain(parseFloat(mf.value)));
    mbody.appendChild(mf);
    mbody.appendChild(el('div', { class: 'mixer-meter' }, [el('canvas', { dataset: { meter: 'master' } })]));
    master.appendChild(mbody);
    master.appendChild(el('div', { class: 'mixer-db', text: '0.0 dB' }));
    wrap.appendChild(master);
    box.appendChild(wrap);
  }
  function dbText(g) { return g <= 0 ? '−∞ dB' : (20 * Math.log10(g)).toFixed(1) + ' dB'; }
  function updateMeters() {
    // Hidden panels (phone tabs) have zero-size canvases — skip the work entirely.
    const visible = $$('canvas[data-meter]').filter(c => c.getClientRects && c.getClientRects().length);
    if (!visible.length) return;
    visible.forEach(cv => {
      const id = cv.dataset.meter;
      const level = id === 'master' ? M.meterMaster() : M.meterLevel(id);
      const w = cv.width = Math.max(6, cv.clientWidth || 9), h = cv.height = Math.max(20, cv.clientHeight || 90);
      const x = cv.getContext('2d');
      x.fillStyle = '#111'; x.fillRect(0, 0, w, h);
      const fill = Math.min(1, level * 1.4) * h;
      const g = x.createLinearGradient(0, h, 0, 0);
      g.addColorStop(0, '#3da35f'); g.addColorStop(.7, '#9dc14f'); g.addColorStop(1, '#d9534f');
      x.fillStyle = g; x.fillRect(1, h - fill, w - 2, fill);
      for (let i = 1; i < 8; i++) { x.fillStyle = 'rgba(0,0,0,.35)'; x.fillRect(0, h * i / 8, w, 1); }
    });
  }

  /* =============================== effect controls =============================== */
  function section(title, iconName, body, key, openDefault) {
    const collapsed = groupCollapsed['sec-' + key] === undefined ? !openDefault : groupCollapsed['sec-' + key];
    const sec = el('div', { class: 'fx-section' + (collapsed ? ' collapsed' : '') });
    const head = el('div', { class: 'fx-section-head', html: U.icon('chevron', 'caret') + U.icon(iconName, 'sec-icon') + '<span>' + esc(title) + '</span>' });
    head.addEventListener('click', () => { groupCollapsed['sec-' + key] = !collapsed; renderEffectControls(); });
    sec.appendChild(head);
    sec.appendChild(el('div', { class: 'fx-section-body' }, [body]));
    return sec;
  }
  function paramRow(clip, path, override) {
    const def = Object.assign({}, PARAMS[path] || {}, override || {});
    // ВАЖНО: время и наличие ключа считаем в момент клика, а не при отрисовке
    // панели. Раньше здесь захватывался старый playhead, поэтому второй ключ
    // ставился в ту же точку (или снимал первый) — «получался только один ключ».
    const localAt = () => S.playhead - clip.start;
    const hasKeysNow = () => !!(clip.keys && clip.keys[path] && clip.keys[path].length);
    const atKeyNow = () => !!S.findKeyAt(clip, path, localAt());
    const val = S.valueAt(clip, path, localAt());
    const hasKeys = hasKeysNow();
    const atKey = atKeyNow();
    const row = el('div', { class: 'param-row', dataset: { path: path } });
    const kf = el('div', { class: 'kf' + (hasKeys ? ' has-kf' : '') + (atKey ? ' at-kf' : ''), dataset: { path: path }, title: 'Ключевой кадр в точке воспроизведения (Shift+K)', html: U.icon(atKey ? 'diamond' : 'diamond-o') });
    kf.addEventListener('click', () => {
      S.activeParam = path;
      const local = localAt();
      const exists = !!S.findKeyAt(clip, path, local);
      S.change(exists ? 'Удаление ключевого кадра' : 'Ключевой кадр', () => {
        if (exists) S.removeKeyAt(clip, path, local);
        else S.addKey(clip, path, local, S.valueAt(clip, path, local));
      });
      renderAll();
      if (PPE.timeline) PPE.timeline.updateKeyButton();
    });
    row.appendChild(kf);
    const lbl = el('div', { class: 'p-label', text: def.label, title: 'Параметр: ' + path + '. Щелчок — сделать активным для ключевых кадров.' });
    lbl.addEventListener('click', () => { S.activeParam = path; renderAll(); });
    row.appendChild(lbl);
    const slider = el('input', { type: 'range', class: 'p-slider', min: def.min, max: def.max, step: def.step, value: path === 'speed' ? val * 100 : val });
    const num = el('input', { type: 'number', class: 'mini-num', min: def.min, max: def.max, step: def.step, value: U.round(path === 'speed' ? val * 100 : val, 2) });
    const apply = (raw, finish) => {
      let v = parseFloat(raw);
      if (!isFinite(v)) return;
      if (path === 'speed') v = v / 100;
      const keyed = (PPE.engine && PPE.engine.shouldKeyframe) ? PPE.engine.shouldKeyframe(clip, path) : (hasKeysNow() || atKeyNow());
      S.setClipParam(clip, path, v, localAt(), keyed);
      PPE.engine.renderFrame(S.playhead);
      if (finish) { S.end(); renderAll(); }
    };
    const beginEdit = () => S.begin('Изменение: ' + def.label);
    slider.addEventListener('pointerdown', beginEdit);
    slider.addEventListener('input', () => { num.value = slider.value; apply(slider.value, false); });
    slider.addEventListener('change', () => { beginEdit(); apply(slider.value, true); });
    num.addEventListener('focus', beginEdit);
    num.addEventListener('input', () => { slider.value = num.value; apply(num.value, false); });
    num.addEventListener('change', () => { beginEdit(); apply(num.value, true); });
    num.addEventListener('blur', () => S.end());
    row.appendChild(slider); row.appendChild(num);
    if (S.activeParam === path) row.style.background = 'rgba(59,142,230,.10)';
    return row;
  }
  function selectRow(clip, path, label, options) {
    const row = el('div', { class: 'param-row' });
    row.appendChild(el('div', { class: 'kf' }));
    row.appendChild(el('div', { class: 'p-label', text: label }));
    const sel = el('select', { class: 'mini-select' });
    options.forEach(o => sel.appendChild(el('option', { value: o[0], text: o[1] })));
    sel.value = S.getBase(clip, path);
    sel.addEventListener('change', () => { S.change('Изменение: ' + label, () => S.setBase(clip, path, sel.value)); renderAll(); });
    row.appendChild(sel);
    return row;
  }
  function checkRow(label, value, onChange) {
    const row = el('div', { class: 'param-row' });
    row.appendChild(el('div', { class: 'kf' }));
    const lab = el('label', { class: 'p-label', text: label, style: { gridColumn: '2', cursor: 'pointer' } });
    const cb = el('input', { type: 'checkbox', style: { justifySelf: 'start' } });
    cb.checked = !!value;
    cb.addEventListener('change', () => S.change('Изменение: ' + label, () => onChange(cb.checked)));
    lab.appendChild(document.createTextNode(''));
    row.appendChild(lab); row.appendChild(cb);
    return row;
  }
  function generatedRow(media, key, label, type, opts) {
    opts = opts || {};
    const row = el('div', { class: 'param-row' + (opts.full ? ' full' : '') });
    row.appendChild(el('div', { class: 'kf' }));
    row.appendChild(el('div', { class: 'p-label', text: label }));
    let input;
    if (type === 'textarea') {
      input = el('textarea', { text: media.data[key] || '' });
      row.classList.add('full');
    } else if (type === 'select') {
      input = el('select', { class: 'mini-select' });
      (opts.options || []).forEach(o => input.appendChild(el('option', { value: o[0], text: o[1] })));
      input.value = media.data[key];
    } else if (type === 'color') {
      const line = el('div', { class: 'color-line' });
      input = el('input', { type: 'color', value: media.data[key] || '#ffffff' });
      line.appendChild(input);
      const alpha = el('input', { type: 'range', min: 0, max: 100, step: 1, value: Math.round((media.data[key + 'Opacity'] != null ? media.data[key + 'Opacity'] : 1) * 100), title: 'Непрозрачность фона' });
      if (key === 'bg') { line.appendChild(alpha); alpha.addEventListener('input', () => { media.data.bgOpacity = alpha.value / 100; M.updateGeneratedThumb(media); PPE.engine.renderFrame(S.playhead); }); }
      line.appendChild(el('span', { class: 'tc-label', text: opts.unit || '' }));
      row.appendChild(line);
    } else {
      input = el('input', { type: type, class: 'mini-input', value: media.data[key], min: opts.min, max: opts.max, step: opts.step || 1 });
    }
    if (type !== 'color' && type !== 'textarea') row.appendChild(input);
    if (type === 'textarea') row.appendChild(input);
    const commit = () => {
      let v = input.value;
      if (type === 'number' || type === 'range') v = parseFloat(v);
      media.data[key] = v;
      M.updateGeneratedThumb(media);
      PPE.engine.renderFrame(S.playhead);
      PPE.engine.openSource && S.source.mediaId === media.id;
    };
    if (type === 'select' || type === 'checkbox') input.addEventListener('change', () => S.change('Параметры титра', commit));
    else {
      input.addEventListener('focus', () => S.begin('Параметры титра'));
      input.addEventListener('input', commit);
      input.addEventListener('change', () => { S.begin('Параметры титра'); commit(); S.end(); renderProject(); });
      input.addEventListener('blur', () => S.end());
    }
    return row;
  }

  let currentClip = null;
  function renderEffectControls() {
    const box = $('#fxControls'); if (!box) return;
    const clip = S.findClip(Array.from(S.selection)[0]);
    currentClip = clip || null;
    const thumb = $('#fxClipThumb'), title = $('#fxClipTitle'), meta = $('#fxClipMeta');
    if (!clip) {
      box.innerHTML = '<div class="fx-hint">' + U.icon('info') + '<br>Выберите клип на таймлайне, чтобы настроить движение, непрозрачность, цвет, скорость, звук и ключевые кадры.<br><br>Эффекты можно перетаскивать из панели «Эффекты» прямо на клип.</div>';
      thumb.style.backgroundImage = ''; title.textContent = 'Клип не выбран'; meta.textContent = '';
      return;
    }
    const m = S.findMedia(clip.mediaId);
    thumb.style.backgroundImage = m && m.thumb ? 'url("' + m.thumb + '")' : '';
    thumb.style.backgroundSize = 'cover';
    title.textContent = clip.name;
    meta.textContent = U.formatTC(S.clipDuration(clip), S.project.fps);
    box.innerHTML = '';

    // Полоска кадров. Для титров и генераторов кадров нет — как в CapCut,
    // там текстовая дорожка просто залита цветом, а не «нарезкой» надписи.
    const hasFrames = !!(m && m.thumb) && m.type !== 'text';
    const strip = el('div', { class: hasFrames ? 'fx-filmstrip' : 'fx-filmstrip fx-flat' });
    for (let i = 0; i < (hasFrames ? 4 : 1); i++) {
      const cv = el('canvas', { width: 120, height: 40 });
      strip.appendChild(cv);
      if (m && m.thumb && hasFrames) {
        const img = new Image();
        img.onload = () => {
          const x = cv.getContext('2d');
          // Кроп «cover»: иначе вертикальные кадры и титры обрезались по центру
          // и в полоске кадров был виден только фрагмент надписи.
          const target = 120 / 40, ar = (img.width || 1) / (img.height || 1);
          let sw = img.width, sh = img.height, sx = 0, sy = 0;
          if (ar > target) { sw = img.height * target; sx = (img.width - sw) / 2; }
          else if (ar < target) { sh = img.width / target; sy = (img.height - sh) / 2; }
          try { x.drawImage(img, sx, sy, sw, sh, 0, 0, 120, 40); } catch (e) {}
        };
        img.src = m.thumb;
      } else {
        // Титры и генераторы: ровная плашка с подписью, без «нарезки» кадра.
        const x = cv.getContext('2d');
        x.fillStyle = '#2a2140'; x.fillRect(0, 0, 120, 40);
        x.fillStyle = 'rgba(255,255,255,.08)';
        for (let k = 0; k < 12; k++) x.fillRect(k * 10, 0, 5, 40);
        x.fillStyle = '#c9c2e6';
        x.font = '600 11px "Segoe UI", system-ui, sans-serif';
        x.textAlign = 'center'; x.textBaseline = 'middle';
        const t = (clip.name || '').slice(0, 18);
        x.fillText(t, 60, 20);
      }
    }
    box.appendChild(strip);

    // keyframe navigator
    const keys = (clip.keys && clip.keys[S.activeParam]) || [];
    const nav = el('div', { class: 'kf-nav' });
    nav.appendChild(el('span', { class: 'kf-nav-label', text: '◇ ' + paramLabel(S.activeParam) + ' (' + keys.length + ')' }));
    const prev = el('button', { title: 'Предыдущий ключевой кадр', html: U.icon('step-back') });
    prev.onclick = () => PPE.timeline.jumpKey(-1);
    const add = el('button', { class: 'on', title: 'Добавить/удалить ключевой кадр', html: U.icon('diamond') });
    add.onclick = () => PPE.timeline.addKeyAtPlayhead();
    const del = el('button', { title: 'Удалить ключевой кадр', html: U.icon('close') });
    del.onclick = () => PPE.timeline.removeKeyAtPlayhead();
    const next = el('button', { title: 'Следующий ключевой кадр', html: U.icon('step-fwd') });
    next.onclick = () => PPE.timeline.jumpKey(1);
    [prev, add, del, next].forEach(b => nav.appendChild(b));
    box.appendChild(nav);

    // Motion
    const motion = el('div');
    ['transform.x', 'transform.y', 'transform.scale', 'transform.rotation'].forEach(p => motion.appendChild(paramRow(clip, p)));
    motion.appendChild(selectRow(clip, 'transform.fit', 'Масштабирование', [['fit', 'Вписать'], ['fill', 'Заполнить'], ['stretch', 'Растянуть']]));
    motion.appendChild(checkRow('Отразить по горизонтали', clip.transform.flipH, v => clip.transform.flipH = v));
    motion.appendChild(checkRow('Отразить по вертикали', clip.transform.flipV, v => clip.transform.flipV = v));
    box.appendChild(section('Движение', 'sliders', motion, 'motion', true));

    const op = el('div'); op.appendChild(paramRow(clip, 'transform.opacity'));
    box.appendChild(section('Непрозрачность', 'eye', op, 'opacity', true));

    const color = el('div');
    ['color.brightness', 'color.contrast', 'color.saturate', 'color.blur', 'color.grayscale', 'color.sepia', 'color.hue', 'color.vignette'].forEach(p => color.appendChild(paramRow(clip, p)));
    box.appendChild(section('Цветокоррекция', 'color', color, 'color', false));

    const time = el('div');
    time.appendChild(paramRow(clip, 'speed'));
    time.appendChild(el('div', { class: 'fx-hint', style: { padding: '2px 0' }, text: 'Вход: ' + U.formatTC(clip.inPoint, S.project.fps) + ' · Выход: ' + U.formatTC(clip.outPoint, S.project.fps) + ' · Начало: ' + U.formatTC(clip.start, S.project.fps) }));
    const bSpeed = el('button', { class: 'btn small', html: U.icon('speed') + ' Скорость и длительность…' });
    bSpeed.onclick = () => PPE.timeline.speedDialog(clip);
    time.appendChild(bSpeed);
    box.appendChild(section('Время', 'speed', time, 'time', false));

    const audio = el('div');
    ['audio.volume', 'audio.pan', 'audio.fadeIn', 'audio.fadeOut'].forEach(p => audio.appendChild(paramRow(clip, p)));
    box.appendChild(section('Аудио', 'volume', audio, 'audio', false));

    if (m && m.type === 'text') {
      const d = el('div');
      d.appendChild(generatedRow(m, 'text', 'Текст', 'textarea', { full: true }));
      d.appendChild(generatedRow(m, 'font', 'Шрифт', 'select', { options: [['Arial', 'Arial'], ['Georgia', 'Georgia'], ['Times New Roman', 'Times New Roman'], ['Verdana', 'Verdana'], ['Courier New', 'Courier New'], ['Impact', 'Impact'], ['Trebuchet MS', 'Trebuchet MS']] }));
      d.appendChild(generatedRow(m, 'size', 'Размер', 'number', { min: 8, max: 400, unit: 'px' }));
      d.appendChild(generatedRow(m, 'color', 'Цвет текста', 'color'));
      d.appendChild(generatedRow(m, 'bg', 'Фон', 'color'));
      d.appendChild(generatedRow(m, 'align', 'Выравнивание', 'select', { options: [['left', 'По левому краю'], ['center', 'По центру'], ['right', 'По правому краю']] }));
      d.appendChild(generatedRow(m, 'x', 'Позиция X', 'number', { min: 0, max: 100, unit: '%' }));
      d.appendChild(generatedRow(m, 'y', 'Позиция Y', 'number', { min: 0, max: 100, unit: '%' }));
      d.appendChild(generatedRow(m, 'letterSpacing', 'Межбуквенный', 'number', { min: -20, max: 100, unit: 'px' }));
      d.appendChild(generatedRow(m, 'lineHeight', 'Межстрочный', 'number', { min: .5, max: 3, step: .1, unit: '' }));
      d.appendChild(checkRow('Полужирный', m.data.bold, v => { m.data.bold = v; M.updateGeneratedThumb(m); }));
      d.appendChild(checkRow('Курсив', m.data.italic, v => { m.data.italic = v; M.updateGeneratedThumb(m); }));
      d.appendChild(checkRow('Тень', m.data.shadow, v => { m.data.shadow = v; M.updateGeneratedThumb(m); }));
      box.appendChild(section('Титр', 'text', d, 'text', true));
    }
    if (m && m.type === 'color') {
      const d = el('div'); d.appendChild(generatedRow(m, 'color', 'Цвет заливки', 'color'));
      box.appendChild(section('Цветовая заливка', 'color', d, 'matte', true));
    }
    const eff = el('div');
    if (!clip.effects.length) eff.appendChild(el('div', { class: 'fx-hint', text: 'Нет эффектов.' }));
    clip.effects.forEach(fx => {
      const row = el('div', { class: 'applied-item', html: U.icon('fx') + '<span>' + esc(fx.label) + '</span>' });
      row.appendChild(el('button', { class: 'fx-remove', html: U.icon('close'), title: 'Удалить', onclick: () => { S.change('Удаление эффекта', () => S.removeEffect(clip, fx.uid)); renderAll(); } }));
      eff.appendChild(row);
    });
    box.appendChild(section('Эффекты (' + clip.effects.length + ')', 'fx', eff, 'effects', false));
    const buttons = el('div', { class: 'fx-buttons' }, [
      el('button', { class: 'btn small', html: U.icon('copy') + ' Дублировать', onclick: () => PPE.timeline.duplicate() }),
      el('button', { class: 'btn small', html: U.icon('scissors') + ' Разрезать', onclick: () => PPE.timeline.splitSelected() }),
      el('button', { class: 'btn small', html: U.icon('reset') + ' Сбросить', onclick: resetClip })
    ]);
    box.appendChild(buttons);
  }
  function resetClip() {
    const c = S.findClip(Array.from(S.selection)[0]); if (!c) return;
    S.change('Сброс параметров', () => {
      c.transform = S.defaultTransform(); c.color = S.defaultColor(); c.audio = S.defaultAudio();
      c.speed = 1; c.keys = {}; c.effects = []; c.transitionIn = 0; c.transitionOut = 0;
    });
    renderAll();
  }

  function updateTransport() {
    const b = $('#progPlay'); if (b) b.innerHTML = U.icon(S.playing ? 'pause' : 'play');
    const s = $('#srcPlay'); if (s) s.innerHTML = U.icon(S.source.playing ? 'pause' : 'play');
    const loop = $('#srcLoop'); if (loop) loop.classList.toggle('active', S.source.loop);
    const safe = $('#safeBtn'); if (safe) safe.classList.toggle('active', S.settings.safeMargins);
    $('#programSafe').classList.toggle('hidden', !S.settings.safeMargins);
    $('#sourceSafe').classList.toggle('hidden', !S.settings.safeMargins);
    const seq = $('#programSeqRange'), dur = Math.max(.001, S.sequenceDuration());
    if (seq) {
      if (S.project.seqOut > S.project.seqIn) {
        seq.style.left = (S.project.seqIn / dur * 100) + '%';
        seq.style.width = ((S.project.seqOut - S.project.seqIn) / dur * 100) + '%';
      } else { seq.style.left = '0'; seq.style.width = '100%'; }
    }
    const markers = $('#programMarkers');
    if (markers) {
      markers.innerHTML = '';
      (S.project.markers || []).forEach(m => markers.appendChild(el('div', { class: 'scrub-marker', style: { left: (m.time / dur * 100) + '%' }, title: m.name })));
    }
    const undo = $('#undoBtn'), redo = $('#redoBtn');
    if (undo) undo.disabled = !S.history.undo.length;
    if (redo) redo.disabled = !S.history.redo.length;
    const seqName = S.project.name || 'Последовательность 01';
    $('#seqName').textContent = S.project.name ? S.project.name + ' / Последовательность 01' : 'Последовательность 01';
    $('#seqNameShort').textContent = S.project.name ? S.project.name : 'Последовательность 01';
    $('#projectLabel').textContent = (S.project.name || 'Без имени') + (S.dirty ? ' *' : '') + '.prproj';
  }

  /* =============================== new items & dialogs =============================== */
  function newItemMenu(anchor) {
    U.dropdown(anchor, [
      { label: 'Титр…', icon: 'text', action: createTextItem },
      { label: 'Цветовая заливка…', icon: 'color', action: createColorItem },
      { label: 'Чёрное видео', icon: 'film', action: () => createColorItem({ color: '#000000', name: 'Чёрное видео' }) },
      { label: 'Белый фон', icon: 'color', action: () => createColorItem({ color: '#ffffff', name: 'Белый фон' }) },
      '-',
      { label: 'Добавить видеодорожку', icon: 'plus', action: () => PPE.timeline.addTrackUI('video') },
      { label: 'Добавить аудиодорожку', icon: 'plus', action: () => PPE.timeline.addTrackUI('audio') },
      '-',
      { label: 'Настройки последовательности…', icon: 'settings', action: sequenceSettings }
    ]);
  }
  function createTextItem() {
    const d = S.defaultTextData();
    let mediaRef = null;
    U.modal({
      title: 'Новый титр', icon: 'text',
      body: '<div class="form-row"><label>Текст</label><div class="form-control"><textarea id="txtText">Ваш заголовок</textarea></div></div>' +
        '<div class="form-row"><label>Шрифт</label><div class="form-control"><select id="txtFont"><option>Arial</option><option>Georgia</option><option>Impact</option><option>Verdana</option><option>Times New Roman</option><option>Courier New</option></select></div></div>' +
        '<div class="form-row"><label>Размер</label><div class="form-control"><input type="number" id="txtSize" value="96" min="8" max="400"><span class="unit">px</span></div></div>' +
        '<div class="form-row"><label>Цвет</label><div class="form-control"><input type="color" id="txtColor" value="#ffffff" style="width:60px"></div></div>' +
        '<div class="form-row"><label>Выравнивание</label><div class="form-control"><select id="txtAlign"><option value="center">По центру</option><option value="left">По левому краю</option><option value="right">По правому краю</option></select></div></div>' +
        '<div class="form-row"><label>Длительность</label><div class="form-control"><input type="text" id="txtDur" value="00:00:05:00"><span class="unit">ЧЧ:ММ:СС:КК</span></div></div>',
      buttons: [{ label: 'Отмена' }, { label: 'Создать', class: 'primary', action: (b) => {
        d.text = $('#txtText', b).value; d.font = $('#txtFont', b).value; d.size = parseFloat($('#txtSize', b).value) || 96;
        d.color = $('#txtColor', b).value; d.align = $('#txtAlign', b).value;
        const dur = U.parseTC($('#txtDur', b).value, S.project.fps) || 5;
        addGenerated('text', d, d.text.split('\n')[0].slice(0, 24) || 'Титр', dur);
      } }]
    });
  }
  function createColorItem(pre) {
    pre = pre || {};
    let color = pre.color || '#2b6cb3', name = pre.name || 'Цветовая заливка';
    if (pre.color) { addGenerated('color', { color: color }, name, 5); return; }
    U.modal({
      title: 'Цветовая заливка', icon: 'color',
      body: '<div class="form-row"><label>Имя</label><div class="form-control"><input type="text" id="colName" value="Цветовая заливка"></div></div>' +
        '<div class="form-row"><label>Цвет</label><div class="form-control"><input type="color" id="colColor" value="#2b6cb3" style="width:80px"></div></div>' +
        '<div class="form-row"><label>Длительность</label><div class="form-control"><input type="text" id="colDur" value="00:00:05:00"></div></div>',
      buttons: [{ label: 'Отмена' }, { label: 'Создать', class: 'primary', action: (b) => {
        addGenerated('color', { color: $('#colColor', b).value }, $('#colName', b).value || 'Цветовая заливка', U.parseTC($('#colDur', b).value, S.project.fps) || 5);
      } }]
    });
  }
  function addGenerated(type, data, name, dur) {
    const track = PPE.timeline.targetTrack('video');
    if (!track) { U.toast('Нет видеодорожки', 'error'); return; }
    let media = null, clip = null;
    S.change('Новый элемент: ' + name, () => {
      media = M.createGenerated(type, data, name);
      clip = S.newClip(media.id, track.id, S.playhead, { generatedDuration: Math.max(.1, dur) });
      clip.name = name;
      track.clips.push(clip);
      S.selection.clear(); S.selection.add(clip.id);
    });
    renderAll();
    openSource(media.id);
    U.toast('Создан: ' + name, 'success');
  }
  function sequenceSettings() {
    const p = S.project;
    U.modal({
      title: 'Настройки последовательности', icon: 'settings',
      body: '<h4>Видео</h4>' +
        '<div class="form-row"><label>Ширина кадра</label><div class="form-control"><input type="number" id="seqW" value="' + p.width + '" min="16" max="4096"><span class="unit">px</span></div></div>' +
        '<div class="form-row"><label>Высота кадра</label><div class="form-control"><input type="number" id="seqH" value="' + p.height + '" min="16" max="4096"><span class="unit">px</span></div></div>' +
        '<div class="form-row"><label>Частота кадров</label><div class="form-control"><select id="seqFps"><option>23.976</option><option>24</option><option>25</option><option>29.97</option><option>30</option><option>50</option><option>59.94</option><option>60</option></select></div></div>' +
        '<div class="form-row"><label>Имя проекта</label><div class="form-control"><input type="text" id="seqName" value="' + esc(p.name) + '"></div></div>' +
        '<div class="form-note">Разрешение влияет на область просмотра и размер экспортируемого кадра. Предустановки: 1920×1080, 1280×720, 3840×2160, 1080×1920.</div>',
      onOpen: (b) => { $('#seqFps', b).value = String(p.fps); },
      buttons: [{ label: 'Отмена' }, { label: 'Применить', class: 'primary', action: (b) => {
        S.change('Настройки последовательности', () => {
          p.width = clamp(parseInt($('#seqW', b).value) || 1920, 16, 4096);
          p.height = clamp(parseInt($('#seqH', b).value) || 1080, 16, 4096);
          p.fps = parseFloat($('#seqFps', b).value) || 30;
          p.name = $('#seqName', b).value.trim() || 'Без имени';
          S.fps = p.fps;
        });
        PPE.engine.resize(); renderAll();
      } }]
    });
  }
  function relinkDialog(onlyId) {
    U.modal({
      title: 'Перепривязка медиа', icon: 'link',
      body: '<div class="form-note">После перезагрузки страницы браузер теряет доступ к локальным файлам. Выберите исходные файлы ещё раз — они будут сопоставлены по имени.</div>' +
        '<div class="form-row"><label>Файлы</label><div class="form-control"><input type="file" id="relinkFiles" multiple accept="video/*,audio/*,image/*"></div></div>' +
        '<div class="fx-hint">Офлайн: ' + S.project.media.filter(m => !m.generated && m.offline).map(m => esc(m.fileName || m.name)).join(', ') + '</div>',
      buttons: [{ label: 'Закрыть' }, { label: 'Перепривязать', class: 'primary', close: false, action: (b, close) => {
        const f = $('#relinkFiles', b).files;
        if (!f.length) { U.toast('Выберите файлы', 'warn'); return false; }
        M.relinkMedia(f).then(() => { close(); renderAll(); });
        return false;
      } }]
    });
  }
  /** Название параметра для подсказок и кнопки ключевого кадра. */
  function paramLabel(path) { return PARAMS[path] ? PARAMS[path].label : path; }
  /**
   * Лёгкое обновление индикаторов ключевых кадров при движении плейхеда:
   * без пересборки панели (важно для производительности).
   */
  function syncKeyIndicators() {
    const clip = currentClip || S.findClip(Array.from(S.selection)[0]);
    if (!clip) return;
    const body = $('#fxControls'); if (!body) return;
    const local = S.playhead - clip.start;
    body.querySelectorAll('.param-row[data-path]').forEach(row => {
      const path = row.dataset.path;
      const kf = row.querySelector('.kf'); if (!kf) return;
      const has = !!(clip.keys && clip.keys[path] && clip.keys[path].length);
      const at = !!S.findKeyAt(clip, path, local);
      if (kf.classList.contains('has-kf') !== has) kf.classList.toggle('has-kf', has);
      if (kf.classList.contains('at-kf') !== at) {
        kf.classList.toggle('at-kf', at);
        kf.innerHTML = U.icon(at ? 'diamond' : 'diamond-o');
      }
      row.classList.toggle('at-key-row', at);
    });
    const nav = body.querySelector('.kf-nav-label');
    if (nav) {
      const n = (clip.keys && clip.keys[S.activeParam] || []).length;
      const txt = '◇ ' + paramLabel(S.activeParam) + ' (' + n + ')';
      if (nav.textContent !== txt) nav.textContent = txt;
    }
  }

  function renderAll() { if (PPE.renderAll) PPE.renderAll(); }

  PPE.panels = {
    init, renderProject, renderEffects, renderMarkers, renderHistory, renderMixer, renderEffectControls,
    updateTransport, updateMeters, openSource, onDropImport, newItemMenu, createTextItem, createColorItem,
    paramLabel, syncKeyIndicators,
    sequenceSettings, relinkDialog, setLeftTab, resetClip
  };
})(window);
