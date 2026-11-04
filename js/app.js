/* =========================================================================
   app.js — bootstrap, menus, buttons, shortcuts, dialogs, workspace layout
   ========================================================================= */
(function (root) {
  'use strict';
  const PPE = root.PPE = root.PPE || {};
  const U = PPE.utils, S = PPE.state, M = PPE.media, E = PPE.engine, T = PPE.timeline, P = PPE.panels, PR = PPE.projects;
  const $ = U.$, $$ = U.$$, el = U.el, clamp = U.clamp;
  let focusedMonitor = 'program';
  let exportUI = null;
  let layoutMode = 'bottom';
  const THEME_KEY = 'frameforge.theme.v1';

  /** Тема оформления: 'capcut' (по умолчанию) или 'classic'. */
  function applyTheme(name, silent) {
    const theme = name === 'classic' ? 'classic' : 'capcut';
    document.body.classList.toggle('capcut', theme === 'capcut');
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
    if (!silent) U.toast(theme === 'capcut' ? 'Тема: CapCut' : 'Тема: Классическая', 'success');
  }
  function currentTheme() { return document.body.classList.contains('capcut') ? 'capcut' : 'classic'; }
  PPE.applyTheme = applyTheme;
  PPE.currentTheme = currentTheme;

  /** Раскладка: «right» — нижняя панель уходит в правую часть экрана. */
  function applyLayout(mode) {
    // Без аргумента — сохраняем текущую раскладку (её же восстанавливаем при загрузке).
    if (!mode) mode = layoutMode;
    layoutMode = mode === 'right' ? 'right' : 'bottom';
    document.body.classList.toggle('layout-right', layoutMode === 'right');
    try { localStorage.setItem('frameforge.layout.v1', layoutMode); } catch (e) {}
    setTimeout(() => {
      try { E.applyProgramZoom(); T.render(); P.renderMixer(); P.updateTransport(); E.renderFrame(S.playhead); } catch (e) {}
    }, 60);
  }
  function toggleLayout() {
    applyLayout(layoutMode === 'right' ? 'bottom' : 'right');
    U.toast(layoutMode === 'right' ? 'Панель перенесена вправо' : 'Панель возвращена вниз', 'success');
  }

  /* =============================== render coordination =============================== */
  function renderAll() {
    try { M.pruneClips(); } catch (e) { console.warn(e); }
    P.init();
    P.renderProject();
    P.renderEffects();
    P.renderMarkers();
    P.renderHistory();
    P.renderMixer();
    P.renderEffectControls();
    P.updateTransport();
    if (PPE.proPanels) PPE.proPanels.render();
    T.init(); T.render();
    E.resize(); E.updateSourceUI(); E.applyProgramZoom();
    try { updateAspectButton(); updateMuteButton(); if (PPE.timeline) PPE.timeline.updateKeyButton(); } catch (e) {}
    // Отмена/повтор пересобирают проект — открытая студия анимации должна это увидеть.
    try { if (PPE.animationUI && PPE.animationUI.isOpen()) PPE.animationUI.render(); } catch (e) {}
    E.renderFrame(S.playhead);
    $('#statusHint').textContent = S.relinkNeeded ? 'Часть файлов не найдена — «Файл → Найти медиа»' :
      S.project.media.length ? 'Перетаскивайте клипы, режьте лезвием, настраивайте эффекты и ключевые кадры' :
      'Перетащите видео, аудио или изображения в окно, чтобы начать';
  }
  PPE.renderAll = renderAll;
  PPE.setMobileView = function (v, s) { setMobileView(v, s); };
  PPE.isMobileLayout = function () { return isMobileLayout(); };

  /* =============================== top menus =============================== */
  function menuDefs() {
    return [
      { label: 'Файл', items: () => [
        { label: 'Новый проект', icon: 'film', shortcut: 'Ctrl+N', action: newProject },
        { label: 'Открыть проект…', icon: 'folder', shortcut: 'Ctrl+O', action: openProjectDialog },
        { label: 'Все проекты…', icon: 'cards', shortcut: 'Ctrl+Shift+P', action: () => PR.show() },
        { label: 'Сохранить проект', icon: 'save', shortcut: 'Ctrl+S', action: saveProject },
        { label: 'Сохранить как JSON…', icon: 'export', action: saveProject },
        '-',
        { label: 'Импорт медиа…', icon: 'import', shortcut: 'Ctrl+I', action: () => $('#fileInput').click() },
        { label: 'Найти медиа…', icon: 'link', action: () => P.relinkDialog() },
        { label: 'Пересоздать демо-проект', icon: 'film', action: () => resetDemo() },
        '-',
        { label: 'Экспорт видео…', icon: 'export', shortcut: 'Ctrl+M', action: showExportDialog },
        { label: 'Студия анимации…', icon: 'layers', action: () => PPE.animationUI.open() },
        { label: 'Экспорт текущего кадра (PNG)', icon: 'image', shortcut: 'Ctrl+Shift+E', action: () => E.exportFramePNG() },
        '-',
        { label: 'Настройки последовательности…', icon: 'settings', action: () => P.sequenceSettings() }
      ] },
      { label: 'Хранилище', items: () => [
        { label: 'Автосохранение в файл с медиа…', icon: 'save', action: () => PPE.bridge.openDialog() },
        { label: 'Открыть .ffbundle…', icon: 'import', action: () => PPE.bridge.openExternal() },
        '-',
        { label: 'Сохранить сейчас', icon: 'check', action: () => PPE.bridge.saveNow({}) },
        { label: 'Отключить автосохранение в файл', icon: 'close', action: () => PPE.bridge.disconnect() }
      ] },
      { label: 'Правка', items: () => [
        { label: 'Отменить', icon: 'undo', shortcut: 'Ctrl+Z', disabled: !S.history.undo.length, action: () => S.undo() },
        { label: 'Повторить', icon: 'redo', shortcut: 'Ctrl+Shift+Z', disabled: !S.history.redo.length, action: () => S.redo() },
        '-',
        { label: 'Вырезать', icon: 'scissors', shortcut: 'Ctrl+X', action: () => T.cutSelected() },
        { label: 'Копировать', icon: 'copy', shortcut: 'Ctrl+C', action: () => T.copySelected() },
        { label: 'Вставить', icon: 'copy', shortcut: 'Ctrl+V', action: () => T.paste() },
        { label: 'Дублировать', icon: 'copy', shortcut: 'Ctrl+D', action: () => T.duplicate() },
        { label: 'Выделить всё', icon: 'select', shortcut: 'Ctrl+A', action: () => T.selectAll() },
        '-',
        { label: 'Удалить', icon: 'trash', shortcut: 'Del', action: () => T.deleteSelected(false) },
        { label: 'Удалить со сдвигом', icon: 'trash', shortcut: 'Shift+Del', action: () => T.deleteSelected(true) },
        { label: 'Разрезать', icon: 'scissors', shortcut: 'Ctrl+K', action: () => T.splitSelected() },
        '-',
        { label: 'Привязка', icon: 'magnet', shortcut: 'S', checked: S.settings.snap, action: () => toggleSetting('snap') },
        { label: 'Связать аудио и видео', icon: 'link', checked: S.settings.linkAV, action: () => toggleSetting('linkAV') },
        { label: 'Связать / разорвать связь клипов', icon: 'link', action: () => PPE.pro.cmd.linkMedia() },
        { label: 'Автосохранение', icon: 'save', checked: S.settings.autoSave, action: () => toggleSetting('autoSave') },
        { label: 'Предпросмотр звука', icon: S.settings.audioPreview === false ? 'mute' : 'volume', checked: S.settings.audioPreview !== false, action: toggleAudioPreview },
        { label: 'Авто-ключевой кадр', icon: 'record', checked: S.settings.autoKey !== false, action: () => toggleSetting('autoKey') }
      ] },
      { label: 'Последовательность', items: () => [
        { label: 'Добавить видеодорожку', icon: 'plus', action: () => T.addTrackUI('video') },
        { label: 'Добавить аудиодорожку', icon: 'plus', action: () => T.addTrackUI('audio') },
        '-',
        { label: 'Новый титр…', icon: 'text', action: () => P.createTextItem() },
        { label: 'Цветовая заливка…', icon: 'color', action: () => P.createColorItem() },
        { label: 'Отделить звук у выбранного клипа', icon: 'music', action: () => T.detachAudio(S.findClip(Array.from(S.selection)[0])) },
        { label: 'Добавить маркер', icon: 'marker', shortcut: 'M', action: () => T.addMarkerAt(S.playhead) },
        '-',
        { label: 'Точка входа', icon: 'in', shortcut: 'I', action: setIn },
        { label: 'Точка выхода', icon: 'out', shortcut: 'O', action: setOut },
        { label: 'Сбросить точки входа/выхода', icon: 'reset', action: clearInOut },
        { label: 'Изъять фрагмент', icon: 'scissors', action: () => T.extract() },
        { label: 'Поднять фрагмент', icon: 'layers', action: () => T.lift() },
        '-',
        '-',
        { label: 'Формат кадра: 16:9', icon: 'fit', checked: ratioName() === '16:9', action: () => setAspect('16:9') },
        { label: 'Формат кадра: 9:16 (вертикальный)', icon: 'fit', checked: ratioName() === '9:16', action: () => setAspect('9:16') },
        { label: 'Формат кадра: 1:1 (квадрат)', icon: 'fit', checked: ratioName() === '1:1', action: () => setAspect('1:1') },
        { label: 'Формат кадра: 4:5 (портрет)', icon: 'fit', checked: ratioName() === '4:5', action: () => setAspect('4:5') },
        { label: 'Все форматы кадра…', icon: 'grid', action: aspectDialog },
        '-',
        { label: 'Настройки последовательности…', icon: 'settings', action: () => P.sequenceSettings() }
      ] },
      { label: 'Инструменты', items: () => (PPE.proTools ? PPE.proTools.TOOLS.map(t => ({
        label: t.name, icon: PPE.proTools.ICON[t.id], shortcut: t.key, checked: S.tool === t.id,
        action: () => T.setTool(t.id)
      })) : []) },
      { label: 'Панели и эффекты', items: () => [
        { label: 'Lumetri Color + Scopes', icon: 'color', action: () => PPE.pro.cmd.colorPanel() },
        { label: 'Basic / Creative / Curves / HSL / Vignette', icon: 'sliders', action: () => PPE.pro.cmd.colorPanel() },
        { label: 'Essential Sound', icon: 'volume', action: () => PPE.pro.cmd.soundPanel() },
        { label: 'Audio Gain…', icon: 'volume', action: () => PPE.pro.cmd.audioGain() },
        { label: 'Audio Track Mixer / Clip Mixer', icon: 'sliders', action: () => PPE.proPanels.showTab('mixer') },
        { label: 'Media Browser', icon: 'folder', action: () => PPE.pro.cmd.browserPanel() },
        { label: 'Essential Graphics / MOGRT / Captions', icon: 'text', action: () => PPE.pro.cmd.graphicsPanel() },
        { label: 'Export Panel', icon: 'export', action: () => PPE.pro.cmd.exportPanel() },
        '-',
        { label: 'Interpret Footage…', icon: 'sliders', action: () => PPE.pro.cmd.interpret() },
        { label: 'Ingest Settings…', icon: 'settings', action: () => PPE.pro.cmd.ingestSettings() },
        { label: 'Proxy Creation…', icon: 'layers', action: () => PPE.pro.cmd.proxy() },
        { label: 'Multicam Editing (создать)', icon: 'film', action: () => PPE.pro.cmd.multicam() },
        { label: 'Nesting', icon: 'layers', action: () => PPE.pro.cmd.nest() },
        { label: 'Time Remapping…', icon: 'speed', action: () => PPE.pro.cmd.timeRemapDialog() },
        { label: 'Speed Ramp / Reverse / Freeze', icon: 'speed', action: () => PPE.pro.cmd.speedRampPreset('ramp-up') },
        { label: 'Three-Point Editing', icon: 'insert', action: () => PPE.pro.cmd.threePoint('insert') },
        { label: 'Match Frame / Reverse Match Frame', icon: 'fit', action: () => PPE.pro.cmd.matchFrame(false) },
        { label: 'Sync Lock / Track Lock', icon: 'lock', action: () => PPE.pro.cmd.toggleSyncLock() },
        { label: 'Masking & Tracking', icon: 'diamond', action: () => PPE.pro.cmd.addMask('ellipse') },
        { label: 'Warp Stabilizer', icon: 'fit', action: () => PPE.pro.cmd.warpStabilizer() },
        { label: 'Auto Reframe', icon: 'image', action: () => PPE.pro.cmd.autoReframe() },
        { label: 'Generative Extend', icon: 'film', action: () => PPE.pro.cmd.generativeExtend() },
        { label: 'Video / Audio Transitions', icon: 'layers', action: () => T.applyEffectToSelected('cross-dissolve') },
        { label: 'Speech to Text / Create Captions', icon: 'text', action: () => PPE.pro.cmd.captionImport() },
        { label: 'Dynamic Link', icon: 'link', action: () => PPE.pro.cmd.dynamicLink() },
        { label: 'Render & Replace', icon: 'film', action: () => PPE.pro.cmd.renderAndReplace() },
        { label: 'Quick Export', icon: 'export', action: () => PPE.pro.cmd.quickExport() },
        '-',
        { label: 'Команды и возможности…', icon: 'search', shortcut: 'Ctrl+Shift+K', action: () => PPE.pro.cmd.commandPalette() }
      ] },
      { label: 'Вид', items: () => [
        { label: 'Увеличить масштаб таймлайна', icon: 'zoom-in', shortcut: '+', action: () => T.setZoom(S.zoom * 1.3) },
        { label: 'Уменьшить масштаб таймлайна', icon: 'zoom-out', shortcut: '−', action: () => T.setZoom(S.zoom / 1.3) },
        { label: 'Вписать последовательность', icon: 'fit', action: () => T.fitZoom() },
        { label: 'Перейти к курсору', icon: 'select', action: () => T.gotoPlayhead() },
        '-',
        { label: 'Безопасные зоны', icon: 'grid', checked: S.settings.safeMargins, action: () => toggleSetting('safeMargins') },
        { label: 'Формы волн', icon: 'wave', shortcut: 'W', checked: S.settings.waveforms, action: () => toggleSetting('waveforms') },
        { label: 'Миниатюры клипов', icon: 'image', checked: S.settings.showThumbnails, action: () => toggleSetting('showThumbnails') },
        { label: 'Качество предпросмотра', icon: 'sliders', items: () => previewQualityItems() },
        '-',
        { label: 'Тема: CapCut', icon: 'cards', checked: currentTheme() === 'capcut', action: () => applyTheme('capcut') },
        { label: 'Тема: Классическая', icon: 'grid', checked: currentTheme() === 'classic', action: () => applyTheme('classic') },
        '-',
        { label: 'Панель справа (таймлайн / управление)', icon: 'layers', checked: layoutMode === 'right', action: toggleLayout },
        { label: 'Программный монитор на весь экран', icon: 'fullscreen', shortcut: 'Ctrl+Shift+F', action: toggleFullscreen },
        { label: 'Сбросить расположение панелей', icon: 'reset', action: resetLayout }
      ] },
      { label: 'Справка', items: () => [
        { label: 'Туториал для начинающих…', icon: 'info', shortcut: '', action: () => PPE.tutorial && PPE.tutorial.start({ force: true }) },
        { label: 'Горячие клавиши', icon: 'keyboard', shortcut: '?', action: showShortcuts },
        '-',
        { label: 'О программе', icon: 'info', action: showAbout }
      ] }
    ];
  }
  function buildMenus() {
    const bar = $('#menuBar'); bar.innerHTML = '';
    menuDefs().forEach(def => {
      const b = el('button', { class: 'menu-top', text: def.label });
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        // U.dropdown сам закрывает меню, если оно уже открыто этим же якорем.
        U.dropdown(b, def.items());
      });
      // Автопереключение меню при наведении — только для мыши. На тач-экранах
      // pointerenter срабатывает от касания, и меню закрывалось сразу после открытия.
      b.addEventListener('pointerenter', (ev) => {
        if (ev.pointerType && ev.pointerType !== 'mouse') return;
        if ($('.menu-drop') && !b.classList.contains('open')) U.dropdown(b, def.items());
      });
      bar.appendChild(b);
    });
  }
  /* Качество предпросмотра: «Авто» рисует кадр не крупнее экрана (и не больше
     1280 px по ширине) — это главный рычаг против тормозов на слабых машинах.
     Экспорт при этом всегда идёт в полном разрешении проекта. */
  function previewQualityItems() {
    const q = S.settings.previewQuality || 'auto';
    return [
      { label: 'Авто (по размеру экрана)', checked: q === 'auto', action: () => setPreviewQuality('auto') },
      { label: 'Полное разрешение проекта', checked: q === 'full', action: () => setPreviewQuality('full') },
      { label: 'Быстрое (½ разрешения)', checked: q === 'fast', action: () => setPreviewQuality('fast') }
    ];
  }
  function setPreviewQuality(q) {
    S.change('Качество предпросмотра', () => { S.settings.previewQuality = q; });
    if (PPE.engine) { PPE.engine.resize ? PPE.engine.resize() : 0; PPE.engine.invalidate(); }
    U.toast('Предпросмотр: ' + ({ auto: 'авто', full: 'полное разрешение', fast: 'быстрый' })[q] || q, null, 2200);
  }

  function toggleSetting(key) {
    if (key === 'audioPreview') { setAudioPreview(!S.settings.audioPreview); return; }
    S.change('Настройка: ' + key, () => { S.settings[key] = !S.settings[key]; });
    renderAll();
    U.toast((S.settings[key] ? 'Включено: ' : 'Выключено: ') + key);
  }

  /* =============================== звук предпросмотра =============================== */
  function setAudioPreview(on, silent) {
    S.settings.audioPreview = !!on;
    // Громкоговоритель мог остаться в нуле после прерванного экспорта —
    // поэтому состояние звука всегда синхронизируется принудительно.
    try { M.resumeAudio(); M.setSpeakerGain(on ? 1 : 0); } catch (e) {}
    updateMuteButton();
    S.markDirty();
    if (!silent) U.toast(on ? 'Звук включён' : 'Звук выключен — нажмите значок динамика, чтобы вернуть', on ? 'success' : 'warn', on ? 1600 : 3200);
  }
  function toggleAudioPreview() { setAudioPreview(!S.settings.audioPreview); PPE.engine.renderFrame(S.playhead); }
  PPE.setAudioPreview = setAudioPreview;
  function updateMuteButton() {
    const b = $('#progMute'); if (!b) return;
    const on = S.settings.audioPreview !== false;
    b.classList.toggle('muted', !on);
    b.title = on ? 'Звук включён — нажмите, чтобы выключить' : 'Звук выключен — нажмите, чтобы включить';
    const use = b.querySelector('use');
    if (use) use.setAttribute('href', on ? '#i-volume' : '#i-mute');
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  /* =============================== соотношение сторон =============================== */
  // Ключ → [ширина, высота] эталона. Реальный размер считается от короткой
  // стороны текущего проекта, чтобы 720p-проект остался 720p при смене формата.
  const RATIOS = [
    { id: '16:9', label: '16:9 · Широкая (YouTube)', w: 16, h: 9 },
    { id: '9:16', label: '9:16 · Вертикальная (Reels, Shorts)', w: 9, h: 16 },
    { id: '1:1', label: '1:1 · Квадрат (пост)', w: 1, h: 1 },
    { id: '4:5', label: '4:5 · Портрет (Instagram)', w: 4, h: 5 },
    { id: '4:3', label: '4:3 · Классическая', w: 4, h: 3 },
    { id: '3:2', label: '3:2 · Фото', w: 3, h: 2 },
    { id: '21:9', label: '21:9 · Кинематографическая', w: 21, h: 9 },
    { id: '2.39:1', label: '2.39:1 · Анаморфная', w: 239, h: 100 }
  ];
  function even(n) { return Math.max(2, Math.round(n / 2) * 2); }
  function ratioName() {
    const p = S.project, r = p.width / Math.max(1, p.height);
    let best = null, diff = 1e9;
    RATIOS.forEach(x => { const d = Math.abs(r - x.w / x.h); if (d < diff) { diff = d; best = x; } });
    return diff < 0.02 ? best.id : (r > 2 ? r.toFixed(2) : r.toFixed(2)) + ':1';
  }
  function setAspect(id) {
    const r = RATIOS.find(x => x.id === id);
    if (!r) return;
    const p = S.project;
    const short = Math.min(p.width, p.height) || 1080;
    const ratio = r.w / r.h;
    let w, h;
    if (ratio >= 1) { h = short; w = even(short * ratio); }
    else { w = short; h = even(short / ratio); }
    if (p.width === w && p.height === h) { U.toast('Формат уже ' + r.id); return; }
    S.change('Соотношение сторон: ' + r.id, () => {
      // Клипы остаются на местах: меняется только «полотно», картинка вписывается заново.
      p.width = clamp(w, 16, 4096); p.height = clamp(h, 16, 4096);
    });
    E.resize(); E.applyProgramZoom(); E.renderFrame(S.playhead);
    renderAll();
    updateAspectButton();
    U.toast('Формат кадра: ' + r.id + ' · ' + p.width + '×' + p.height, 'success', 2400);
    U.status('Соотношение сторон: ' + r.id + ' — ' + p.width + '×' + p.height, null, true);
  }
  function updateAspectButton() {
    const b = $('#aspectBtn'); if (!b) return;
    const t = b.querySelector('.aspect-label');
    const label = ratioName();
    if (t) t.textContent = label; else b.title = 'Соотношение сторон: ' + label;
    b.title = 'Соотношение сторон: ' + label + ' — нажмите, чтобы изменить';
  }
  function aspectMenu(anchor) {
    const cur = ratioName();
    const items = RATIOS.map(r => ({
      label: r.label + (r.id === cur ? '  ✓' : ''), icon: 'fit', action: () => setAspect(r.id)
    }));
    items.push('-', { label: 'Все форматы…', icon: 'grid', action: aspectDialog });
    items.push({ label: 'Свои размеры…', icon: 'settings', action: () => P.sequenceSettings() });
    if (U.dropdown) U.dropdown(anchor, items);
  }
  /** Диалог выбора формата кадра: плитки с превью пропорций (как в CapCut). */
  function aspectDialog() {
    const cur = ratioName(), p = S.project, short = Math.min(p.width, p.height) || 1080;
    const tiles = RATIOS.map(r => {
      const ratio = r.w / r.h;
      const w = ratio >= 1 ? even(short * ratio) : short;
      const h = ratio >= 1 ? short : even(short / ratio);
      const box = ratio >= 1
        ? 'width:34px;height:' + Math.max(6, Math.round(34 / ratio)) + 'px'
        : 'height:34px;width:' + Math.max(6, Math.round(34 * ratio)) + 'px';
      return '<button class="ratio-tile' + (r.id === cur ? ' active' : '') + '" data-ratio="' + r.id + '">' +
        '<span class="ratio-box" style="' + box + '"></span>' +
        '<span class="ratio-id">' + r.id + '</span>' +
        '<span class="ratio-dim">' + w + '×' + h + '</span></button>';
    }).join('');
    U.modal({
      title: 'Формат кадра', icon: 'fit', wide: true,
      body: '<div class="ratio-grid">' + tiles + '</div>' +
        '<div class="form-note">Смена формата не двигает клипы: меняется только полотно кадра, ' +
        'картинка вписывается заново. Сейчас: ' + p.width + '×' + p.height + ' (' + ratioName() + ').</div>',
      onOpen: (b) => {
        b.querySelectorAll('[data-ratio]').forEach(btn => {
          btn.onclick = () => { const id = btn.dataset.ratio; U.closeModal(); setTimeout(() => setAspect(id), 40); };
        });
      },
      buttons: [{ label: 'Закрыть' }, { label: 'Свои размеры…', action: () => { setTimeout(() => P.sequenceSettings(), 40); } }]
    });
  }
  PPE.aspectDialog = aspectDialog;
  PPE.setAspect = setAspect;
  PPE.ratioName = ratioName;
  PPE.updateAspectButton = updateAspectButton;

  /* =============================== project file operations =============================== */
  /* Сохранение проекта: один файл .ffbundle со всеми медиа внутри.
     Так проект можно перенести на другой компьютер и открыть без перепривязки. */
  async function saveProject() {
    PR.saveCurrent();
    S.persist(true);
    if (PPE.bridge && PPE.bridge.saveAsFile) {
      try {
        const res = await PPE.bridge.saveAsFile();
        if (!res) return;             // пользователь закрыл диалог
        U.toast('Проект сохранён одним файлом' + (res.media ? ' (медиа: ' + res.media + ')' : '') + '. Откройте его через «Файл → Открыть проект».', 'success', 4200);
        return;
      } catch (e) { console.warn('bundle save', e); }
    }
    U.download(S.exportProjectFile(), U.safeFileName(S.project.name || 'project', 'json', true), 'application/json');
    U.toast('Проект сохранён (.json)', 'success');
  }
  function openProjectDialog() { $('#projectInput').click(); }
  async function loadProjectFile(file) { return PR.importFile(file); }
  function newProject() { PR.newProjectDialog(); }

  /* =============================== demo project =============================== */
  /* ------------------------------- демо-проект ------------------------------- */
  /** Синтез короткого саундтрека (WAV) прямо в браузере — демо звучит «из коробки». */
  function demoAudioFile() {
    const rate = 22050, dur = 9.6, n = Math.floor(rate * dur);
    const chords = [
      [220.00, 261.63, 329.63],  // Am
      [174.61, 220.00, 261.63],  // F
      [261.63, 329.63, 392.00],  // C
      [196.00, 246.94, 293.66]   // G
    ];
    const buf = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      const seg = Math.min(chords.length - 1, Math.floor(t / (dur / chords.length)));
      const local = t - seg * (dur / chords.length);
      const env = Math.min(1, local / 0.09) * Math.exp(-local * 0.55);
      let v = 0;
      chords[seg].forEach((f, k) => {
        v += Math.sin(2 * Math.PI * f * t + k) * (k === 0 ? 0.5 : 0.28);
        v += Math.sin(2 * Math.PI * f * 2 * t) * 0.05;
      });
      const trem = 0.86 + 0.14 * Math.sin(2 * Math.PI * 0.7 * t);
      // мягкое затухание в начале и в конце
      const fade = Math.min(1, t / 0.7) * Math.min(1, (dur - t) / 1.4);
      buf[i] = v * 0.30 * env * trem * Math.max(0, fade);
    }
    const bytes = new Uint8Array(44 + n * 2);
    const dv = new DataView(bytes.buffer);
    const writeStr = (off, str) => { for (let i = 0; i < str.length; i++) bytes[off + i] = str.charCodeAt(i); };
    writeStr(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); writeStr(8, 'WAVE');
    writeStr(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
    writeStr(36, 'data'); dv.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) {
      const v = Math.max(-1, Math.min(1, buf[i]));
      dv.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
    }
    return new File([bytes], 'FrameForge-демо.wav', { type: 'audio/wav', lastModified: Date.now() });
  }
  function createDemo() {
    // ВАЖНО: новый проект создаёт вызывающая сторона — так сохраняются выбранный
    // формат кадра и настройки, заданные перед созданием демо.
    S.project.name = 'Демо-проект';
    S.project.fps = 30;
    const tr = name => S.project.tracks.find(t => t.name === name) || S.project.tracks.find(t => t.type === 'video');
    const v1 = tr('V1'), v2 = tr('V2'), v3 = tr('V3');
    const a1 = S.project.tracks.find(t => t.type === 'audio');
    const v4 = S.addTrack('video', 0);           // верхняя дорожка для акцентов
    const fx = (clip, ...ids) => ids.forEach(id => { try { S.applyEffect(clip, id); } catch (e) {} });

    /* --- Фон 1: медленный наезд + зерно, виньетка и световой блик --- */
    const bg1 = M.createGenerated('color', { color: '#0e2740' }, 'Фон 1');
    const c1 = S.newClip(bg1.id, v1.id, 0, { generatedDuration: 4.2 });
    S.addKey(c1, 'transform.scale', 0, 100); S.addKey(c1, 'transform.scale', 4.2, 112);
    fx(c1, 'light-leak', 'film-grain', 'vignette');
    v1.clips.push(c1);

    /* --- Фон 2: обратный зум, ключи на глитче и растворение --- */
    const bg2 = M.createGenerated('color', { color: '#6d3122' }, 'Фон 2');
    const c2 = S.newClip(bg2.id, v1.id, 3.4, { generatedDuration: 6.2 });
    c1.transitionOut = .8; c2.transitionIn = .8;
    S.addKey(c2, 'transform.scale', 0, 112); S.addKey(c2, 'transform.scale', 6.2, 100);
    fx(c2, 'film-grain', 'vignette');
    // эффект тоже умеет анимироваться ключами: короткий глитч на 5.4–5.9 с
    c2.color.glitch = 0;
    S.addKey(c2, 'color.glitch', 1.4, 0); S.addKey(c2, 'color.glitch', 1.7, 75);
    S.addKey(c2, 'color.glitch', 2.0, 0); S.addKey(c2, 'color.glitch', 2.5, 40);
    S.addKey(c2, 'color.glitch', 2.8, 0);
    v1.clips.push(c2);

    /* --- Титр: масштаб + прозрачность на ключах --- */
    const title = M.createGenerated('text', Object.assign(S.defaultTextData(), {
      text: 'FrameForge Studio', size: 104, color: '#f2f6ff', align: 'center', y: 40, shadow: true
    }), 'Заголовок');
    const c3 = S.newClip(title.id, v2.id, .4, { generatedDuration: 7 });
    S.addKey(c3, 'transform.scale', 0, 78);
    S.addKey(c3, 'transform.scale', 2, 100);
    S.addKey(c3, 'transform.scale', 7, 104);
    S.addKey(c3, 'transform.opacity', 0, 0);
    S.addKey(c3, 'transform.opacity', .8, 100);
    S.addKey(c3, 'transform.opacity', 6.2, 100);
    S.addKey(c3, 'transform.opacity', 7, 0);
    v2.clips.push(c3);

    /* --- Подзаголовок въезжает по X и поднимается снизу --- */
    const sub = M.createGenerated('text', Object.assign(S.defaultTextData(), {
      text: 'Монтаж · Эффекты · Ключевые кадры · Звук', size: 42, color: '#9fc6f5', align: 'center', y: 58, bold: false
    }), 'Подзаголовок');
    const c4 = S.newClip(sub.id, v3.id, 1.2, { generatedDuration: 4.8 });
    S.addKey(c4, 'transform.x', 0, -14); S.addKey(c4, 'transform.x', 1.4, 0);
    S.addKey(c4, 'transform.opacity', 0, 0); S.addKey(c4, 'transform.opacity', .9, 100);
    S.addKey(c4, 'transform.opacity', 4.2, 100); S.addKey(c4, 'transform.opacity', 4.8, 0);
    v3.clips.push(c4);

    /* --- Подсказка про прямое управление в кадре --- */
    const tip = M.createGenerated('text', Object.assign(S.defaultTextData(), {
      text: 'Двигайте картинку прямо в кадре — ключевые кадры создаются сами', size: 38, color: '#9fe8c8', align: 'center', y: 78, bold: false
    }), 'Подсказка');
    const c5 = S.newClip(tip.id, v3.id, 6.6, { generatedDuration: 3 });
    S.addKey(c5, 'transform.opacity', 0, 0); S.addKey(c5, 'transform.opacity', .6, 100);
    S.addKey(c5, 'transform.opacity', 2.4, 100); S.addKey(c5, 'transform.opacity', 3, 0);
    v3.clips.push(c5);

    /* --- Векторная сцена из «Студии анимации» как картинка в картинке --- */
    let badge = null;
    try { badge = buildDemoScene(); } catch (e) { console.warn('demo scene', e); }
    if (badge) {
      const cb = S.newClip(badge.id, v4.id, 4.8, { generatedDuration: 4.2 });
      cb.transform.scale = 26; cb.transform.x = 32; cb.transform.y = 30;
      fx(cb, 'fx-rise');
      S.addKey(cb, 'transform.opacity', 3.9, 100);
      S.addKey(cb, 'transform.opacity', 4.2, 0);
      cb.name = 'Значок · анимация';
      v4.clips.push(cb);
    }

    /* --- Финальная плашка: шторки кадра, подъём титра --- */
    const endBg = M.createGenerated('color', { color: '#0b0f14' }, 'Финальный фон');
    const c6 = S.newClip(endBg.id, v1.id, 9.6, { generatedDuration: 2 });
    c6.transitionIn = .5; fx(c6, 'letterbox');
    v1.clips.push(c6);
    const endTxt = M.createGenerated('text', Object.assign(S.defaultTextData(), {
      text: 'Спасибо за просмотр', size: 72, color: '#eaf2ff', align: 'center', y: 50, shadow: true
    }), 'Финальный титр');
    const c7 = S.newClip(endTxt.id, v2.id, 9.8, { generatedDuration: 1.6 });
    fx(c7, 'fx-rise');
    S.addKey(c7, 'transform.opacity', 1.2, 100);
    S.addKey(c7, 'transform.opacity', 1.6, 0);
    v2.clips.push(c7);

    /* --- Звук: саундтрек и короткий «вжух» на переходе --- */
    if (a1) {
      addDemoAudio(a1, 'Демо-саундтрек', demoAudioFile(), 0, 9.6, { volume: 74, fadeIn: .8, fadeOut: 1.6 });
      try {
        const whoosh = demoWhooshFile();
        addDemoAudio(a1, 'Переход · вжух', whoosh, 9.35, .7, { volume: 88, fadeIn: .05, fadeOut: .45 });
      } catch (e) { console.warn('demo whoosh', e); }
    }

    S.project.markers = [
      { id: U.uid('mk'), time: .4, name: 'Титр', comment: 'Масштаб и прозрачность на ключах' },
      { id: U.uid('mk'), time: 3.4, name: 'Растворение', comment: 'Перекрёстное растворение 0,8 с' },
      { id: U.uid('mk'), time: 4.8, name: 'Анимация', comment: 'Сцена из студии анимации в кадре' },
      { id: U.uid('mk'), time: 4.8, name: 'Глитч на ключах', comment: 'Эффект анимирован ключами 0 → 75 → 0' },
      { id: U.uid('mk'), time: 6.6, name: 'Подсказка', comment: 'Движение в кадре = ключевой кадр' },
      { id: U.uid('mk'), time: 9.6, name: 'Финал', comment: 'Шторки кадра + подъём титра' },
      { id: U.uid('mk'), time: 11.6, name: 'Конец', comment: '' }
    ];
    S.project.seqIn = 0; S.project.seqOut = 11.6;
    S.playhead = 0; S.selection.clear();
    S.activeParam = 'transform.scale';
    S.dirty = false;
    S.persist(true);
  }

  /** Аудиодорожка демо: файл + клип с фейдами. */
  function addDemoAudio(track, name, file, start, dur, audio) {
    const m = {
      id: U.uid('media'), name, fileName: file.name, type: 'audio',
      url: URL.createObjectURL(file), file, duration: dur, width: 0, height: 0,
      hasAudio: true, thumb: null, peaks: null, offline: false, generated: false, data: null,
      fileKey: 'demo-' + name, fileSize: file.size
    };
    S.project.media.push(m);
    try { M.computePeaks(file, m).then(() => { if (PPE.timeline) PPE.timeline.render(); }).catch(() => {}); } catch (e) {}
    const clip = S.newClip(m.id, track.id, start, { generatedDuration: dur });
    clip.name = name;
    Object.assign(clip.audio, audio);
    track.clips.push(clip);
    return clip;
  }

  /** Векторная сцена для демо: вращающаяся звезда и «орбита» из кружков. */
  function buildDemoScene() {
    if (!PPE.animation) return null;
    const A = PPE.animation;
    const d = A.ensureDoc();
    const sc = d.scenes[0];
    sc.name = 'Значок';
    sc.background = null;
    sc.frames = 60;
    const w = d.width, h = d.height;
    const l = sc.layers[0];
    const star = A.makeObject('star', w * .34, h * .34, w * .32, h * .32, { fill: '#7fe3ff', stroke: '#ffffff', strokeWidth: 6 });
    star.sides = 5;
    const dot = A.makeObject('oval', w * .18, h * .42, w * .12, h * .12, { fill: '#ffd166', stroke: 'transparent', strokeWidth: 0 });
    const ring = A.makeObject('oval', w * .12, h * .12, w * .76, h * .76, { fill: 'transparent', stroke: '#9fe8c8', strokeWidth: 8 });
    S.change('Демо-сцена', () => {
      const k0 = A.ensureKey(l, 0, true);
      k0.objects = [A.clone(ring), A.clone(star), A.clone(dot)];
      k0.tween = 'linear';
      for (let f = 10; f <= 50; f += 10) {
        const k = A.ensureKey(l, f, false);
        k.tween = 'linear';
        const a = f / 50 * Math.PI * 2;
        k.objects.forEach(o => {
          if (o.id === star.id) { o.rotation = f * 9; o.w = w * .32 * (1 + 0.06 * Math.sin(f / 6)); }
          if (o.id === dot.id) { o.x = w * .5 + Math.cos(a) * w * .3 - o.w / 2; o.y = h * .5 + Math.sin(a) * h * .3 - o.h / 2; }
          if (o.id === ring.id) { o.rotation = -f * 4; }
        });
      }
    });
    return M.createGenerated('animation', { sceneId: sc.id }, 'Значок');
  }

  /** Короткий синтезированный «вжух» для перехода финала. */
  function demoWhooshFile() {
    const rate = 22050, dur = .7, n = Math.floor(rate * dur);
    const buf = new Float32Array(n);
    let seed = 12345;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff * 2 - 1; };
    for (let i = 0; i < n; i++) {
      const t = i / rate, u = t / dur;
      const env = Math.pow(1 - u, 2.2) * Math.min(1, u * 12);
      const sweep = Math.sin(2 * Math.PI * (180 + 900 * u * u) * t) * .35;
      buf[i] = ((rnd() * .8 + sweep) * env) * .5;
    }
    return waveFileFromBuffer(buf, rate, 'FrameForge-вжух.wav');
  }
  function waveFileFromBuffer(buf, rate, name) {
    const data = new DataView(new ArrayBuffer(44 + buf.length * 2));
    const w = (o, s) => { for (let i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); data.setUint32(4, 36 + buf.length * 2, true); w(8, 'WAVEfmt ');
    data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, 1, true);
    data.setUint32(24, rate, true); data.setUint32(28, rate * 2, true); data.setUint16(32, 2, true);
    data.setUint16(34, 16, true); w(36, 'data'); data.setUint32(40, buf.length * 2, true);
    let o = 44;
    for (let i = 0; i < buf.length; i++) { const s = Math.max(-1, Math.min(1, buf[i])); data.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
    return new File([data], name, { type: 'audio/wav' });
  }

  function resetDemo() {
    const run = () => {
      S.newProject();
      createDemo();
      renderAll();
      T.fitZoom();
      U.toast('Демо-проект обновлён: ключевые кадры, звук и подсказки', 'success', 3200);
    };
    if (U.confirm) U.confirm('Пересоздать демо-проект? Текущее содержимое демо будет заменено.', run);
    else run();
  }
  PPE.resetDemo = resetDemo;

  /* =============================== dialogs =============================== */
  function showShortcuts() {
    const rows = [
      ['Пробел', 'Воспроизведение / пауза'], ['J / K / L', 'Назад / стоп / ускоренно вперёд'],
      ['← / →', 'На один кадр'], ['Shift + ←/→', 'На одну секунду'], ['Alt + ←/→', 'Сдвинуть выбранные клипы'],
      ['Home / End', 'Начало / конец'], ['I / O', 'Точка входа / выхода'], ['M', 'Добавить маркер'],
      ['V / C / Y / H / Z', 'Выделение / лезвие / сдвиг / рука / масштаб'], ['S', 'Привязка'],
      ['A / Shift+A', 'Выделение дорожки вперёд / назад'], ['B / N / R', 'Ripple / Rolling / Rate Stretch'],
      ['U / P / T / Shift+T', 'Slide / Pen / Type / Vertical Type'],
      ['F / Shift+F', 'Match Frame / Reverse Match Frame'], ['; / \'', 'Lift / Extract'],
      ['1…9', 'Переключение ракурса мультикама'], ['Ctrl + Shift + K', 'Палитра команд и возможностей'],
      ['Ctrl + K', 'Разрезать в точке курсора'], ['Ctrl + D', 'Дублировать'], ['Ctrl + C / X / V', 'Копировать / вырезать / вставить'],
      ['Ctrl + Z / Shift + Z', 'Отменить / повторить'], ['Ctrl + A', 'Выделить все клипы'],
      ['Del / Shift + Del', 'Удалить / удалить со сдвигом'], ['[ / ]', 'Обрезать начало / конец до курсора'],
      ['+ / −', 'Масштаб таймлайна'], ['Ctrl + колесо', 'Масштаб у курсора'],
      ['Ctrl + N / O / S', 'Новый / открыть / сохранить проект'], ['Ctrl + Shift + P', 'Окно со всеми проектами'], ['Ctrl + I', 'Импорт медиа'],
      ['Ctrl + M', 'Экспорт видео'], ['Ctrl + Shift + E', 'Экспорт кадра PNG'],
      ['Ctrl + Shift + F', 'Монитор на весь экран'], ['W', 'Формы волн'], ['?', 'Эта справка']
    ];
    U.modal({
      title: 'Горячие клавиши', icon: 'keyboard', wide: true,
      body: '<div class="shortcuts">' + rows.map(r => '<div class="shortcut-row"><kbd>' + esc(r[0]) + '</kbd><span>' + esc(r[1]) + '</span></div>').join('') + '</div>',
      buttons: [{ label: 'Понятно', class: 'primary' }]
    });
  }
  function esc(s) { return U.escapeHtml(s); }
  function showAbout() {
    U.modal({
      title: 'О FrameForge Studio', icon: 'info', wide: true,
      body: '<div style="line-height:1.75;font-size:12px">' +
        '<p><b>FrameForge Studio</b> — браузерный видеоредактор с вертикальной компоновкой и векторной студией анимации. Интерфейс вдохновлён мобильными монтажными приложениями. Программа работает локально на HTML, CSS и JavaScript.</p>' +
        '<h4>Что умеет</h4>' +
        '<p>Импорт локального видео, аудио и изображений; исходный и программный мониторы; точки входа/выхода; вставка, наложение и добавление в конец; неограниченные видео- и аудиодорожки; перетаскивание и подрезка клипов; лезвие; удаление со сдвигом; копирование, дублирование, скорость; привязка; переходы (растворение, через чёрное, появление/затухание); эффекты движения, цветокоррекции и звука; ключевые кадры с интерполяцией; аудиомикшер с измерителями; титры и цветовые заливки; маркеры; история действий; автосохранение; экспорт видео и PNG-кадров.</p>' +
        '<h4>Расширенный набор Premiere Pro</h4>' +
        '<p>Добавлены 16 инструментов (Selection, Track Select, Ripple/Rolling/Rate Stretch, Razor, Slip/Slide, Pen, Hand, Zoom, Type, Vertical Type, Rectangle, Ellipse), Lumetri Color (Basic, Creative, Curves, Color Wheels, HSL Secondary, Vignette) с гистограммой/вектороскопом, Essential Sound и Audio Ducking, Essential Graphics + MOGRT + субтитры, Media Browser, Interpret Footage, Ingest Settings, Proxy, Multicam, Nesting, Time Remapping, Three-Point Editing, Match Frame, Sync/Track Lock, локальные аналоги Warp Stabilizer / Auto Reframe / Generative Extend, Render & Replace, Quick Export и Export Panel. Полный список — <b>Ctrl+Shift+K</b> или кнопка <b>«Команды и возможности»</b>; там же пометки: ● полностью, ◐ локальный аналог, ○ невозможно в браузере (Dynamic Link).</p>' +
        '<h4>Проекты и раскладка</h4>' +
        '<p>При запуске открывается окно со <b>всеми проектами</b>: можно создать новый (демо или пустой), открыть файл .json, переименовать, дублировать, удалить или скачать проект. Проекты хранятся в браузере; вернуться к списку можно кнопкой в верхней панели, меню «Файл → Все проекты» или Ctrl+Shift+P. После открытия проекта предпросмотр и таймлайн расположены вертикально, а панель действий — справа. Вернуть панель действий вниз можно в меню «Вид → Панель справа». Размеры и пропорции проектов при этом не меняются.</p>' +
        '<h4>Автономность и телефон</h4>' +
        '<p>Весь код (CSS и JavaScript) встроен прямо в <b>index.html</b> — внешних файлов нет, поэтому редактор открывается двойным щелчком, работает во встроенном предпросмотре и не требует сервера или интернета. Интерфейс адаптирован к вертикальному экрану: вкладки «Проект / Монитор / Эффекты / Таймлайн», переключатели мониторов, панель быстрых действий, сенсорное перетаскивание и <b>долгое нажатие</b> по клипу вместо правой кнопки мыши.</p>' +
        '<h4>Студия анимации</h4><p>Кнопка «Анимация» открывает векторный холст, сцены, слои, покадровый таймлайн, ключи и tween, библиотеку, звук и экспорт SVG/GIF/HTML/атласа. Сцену можно добавить на монтажный таймлайн. Инструменты Adobe и сложные функции частично заменены локальными аналогами; подробности — кнопка ? в студии.</p>' +
        '<h4>Ограничения браузера</h4>' +
        '<p>Экспорт видео по умолчанию идёт через <b>WebCodecs</b>: кадры рисуются в фоне и кодируются встроенным кодеком браузера (H.264 → MP4, VP9 → WebM, звук Opus/AAC), не требуя реального времени и не пропуская кадры. Скорость зависит от машины: с аппаратным кодировщиком экспорт в разы быстрее длительности ролика, на программном — в 2–4 раза медленнее. Запасной путь — запись canvas через MediaRecorder в реальном времени. Медиафайлы не сохраняются внутри проекта: после перезагрузки страницы их нужно перепривязать.</p>' +
        '<p><b>Предпросмотр.</b> Кадр рисуется «по требованию» (в паузе — только при изменениях) и в размере видимого монитора; если во время воспроизведения кадры не успевают, разрешение предпросмотра автоматически снижается и возвращается на паузе. Экспорт всегда идёт в полном разрешении проекта. Способ задаётся в меню «Вид → Качество предпросмотра».</p>' +
        '<p style="color:var(--text-3)">Все вычисления выполняются локально — файлы никуда не отправляются. Экспорт видео, кадра и проекта лучше запускать в отдельной вкладке браузера: встроенный предпросмотр с песочницей может запретить скачивание.</p>' +
        '</div>',
      buttons: [{ label: 'Отлично', class: 'primary' }]
    });
  }
  function showExportDialog() {
    const mime = E.supportedMime();
    const fast = !!(PPE.fastExport && PPE.fastExport.supported());
    const presets = [
      ['1080p', 1920, 1080, 30, 10], ['720p', 1280, 720, 30, 6], ['4K UHD', 3840, 2160, 30, 24],
      ['Вертикальный 1080×1920', 1080, 1920, 30, 10], ['Как в проекте', S.project.width, S.project.height, S.project.fps, 8]
    ];
    U.modal({
      title: 'Экспорт видео', icon: 'export', wide: true, backdropClose: false,
      onClose: () => { exportUI = null; },
      body: '<h4>Предустановка</h4>' +
        '<div class="form-row"><label>Профиль</label><div class="form-control"><select id="exPreset">' + presets.map((p, i) => '<option value="' + i + '">' + esc(p[0]) + ' — ' + p[1] + '×' + p[2] + '</option>').join('') + '</select></div></div>' +
        '<div class="form-row"><label>Способ</label><div class="form-control"><select id="exMethod">' +
          '<option value="fast"' + (fast ? '' : ' disabled') + '>Быстро · WebCodecs (кадр за кадром)</option>' +
          '<option value="realtime"' + (fast ? '' : ' selected') + '>Запись в реальном времени (MediaRecorder)</option></select></div></div>' +
        '<div class="form-row"><label>Контейнер</label><div class="form-control"><select id="exFormat"><option value="auto">Автоматически</option><option value="mp4">MP4 · H.264</option><option value="webm">WebM · VP9</option></select></div></div>' +
        '<div class="form-row"><label>Ширина</label><div class="form-control"><input type="number" id="exW" value="' + S.project.width + '"><span class="unit">px</span></div></div>' +
        '<div class="form-row"><label>Высота</label><div class="form-control"><input type="number" id="exH" value="' + S.project.height + '"><span class="unit">px</span></div></div>' +
        '<div class="form-row"><label>Частота кадров</label><div class="form-control"><select id="exFps"><option>24</option><option>25</option><option>30</option><option>50</option><option>60</option></select></div></div>' +
        '<div class="form-row"><label>Битрейт</label><div class="form-control"><input type="number" id="exBitrate" value="8" min="1" max="80"><span class="unit">Мбит/с</span></div></div>' +
        '<div class="form-row"><label>Диапазон</label><div class="form-control"><select id="exRange"><option value="entire">Вся последовательность</option><option value="inout">Между точками входа/выхода</option></select></div></div>' +
        '<div class="form-row"><label>Звук</label><div class="form-control"><label class="mini-check"><input type="checkbox" id="exAudio" checked> Записывать звук</label></div></div>' +
        '<h4>Прогресс</h4>' +
        '<div class="progress-wrap"><div class="progress-bar" id="exBar"></div></div>' +
        '<div class="export-log" id="exLog">Способ: ' + (fast ? 'WebCodecs, кадр за кадром' : 'запись в реальном времени (' + esc(mime || 'по умолчанию') + ')') + '\nДлительность: ' + U.formatTC(S.sequenceDuration(), S.project.fps) + '\nОжидание запуска…</div>' +
        '<div class="form-note" id="exNote">Быстрый способ рисует кадры в фоне и кодирует их встроенным кодеком браузера (WebCodecs) — экспорт не длится столько же, сколько ролик, и не нагружает редактор. Запасной путь — запись canvas в реальном времени. Звук микшируется из дорожек через Web Audio.</div>',
      onOpen: (body, close) => {
        exportUI = { body, close };
        const preset = $('#exPreset', body);
        preset.value = '4';
        preset.addEventListener('change', () => {
          const p = presets[parseInt(preset.value, 10)];
          $('#exW', body).value = p[1]; $('#exH', body).value = p[2]; $('#exFps', body).value = String(p[3]); $('#exBitrate', body).value = p[4];
        });
        $('#exFps', body).value = String(S.project.fps);
        $('#exFormat', body).value = fast ? 'mp4' : 'auto';
        if (PPE.fastExport && PPE.fastExport.capabilities) {
          PPE.fastExport.capabilities(S.project.width, S.project.height, S.project.fps, 8).then(c => {
            const note = $('#exNote', body); if (!note) return;
            const bits = [];
            bits.push(c.video ? 'WebCodecs доступен' : 'WebCodecs недоступен — только запись в реальном времени');
            bits.push('MP4/H.264: ' + (c.mp4 ? 'да' : 'нет'));
            bits.push('WebM: ' + (c.webm || 'нет'));
            if (!c.mp4 && c.webm) $('#exFormat', body).value = 'webm';
            note.textContent = bits.join(' · ') + '. Быстрый способ рисует кадры в фоне и кодирует встроенным кодеком; звук микшируется через Web Audio.';
          }).catch(() => {});
        }
      },
      buttons: [
        { label: 'Закрыть', close: false, action: (b, close) => { if (S.exporting) { E.cancelExport(); } close(); return false; } },
        { label: 'Отменить экспорт', class: 'danger', close: false, action: () => { E.cancelExport(); return false; } },
        { label: 'Начать экспорт', class: 'primary', close: false, action: (b) => {
          const opts = {
            width: clamp(parseInt($('#exW', b).value) || 1920, 16, 4096),
            height: clamp(parseInt($('#exH', b).value) || 1080, 16, 4096),
            fps: parseFloat($('#exFps', b).value) || 30,
            bitrate: clamp(parseFloat($('#exBitrate', b).value) || 8, 1, 80),
            range: $('#exRange', b).value,
            format: $('#exFormat', b).value,
            method: $('#exMethod', b).value,
            audio: $('#exAudio', b).checked
          };
          const log = $('#exLog', b);
          if (!E.startExport(opts)) { log.textContent += '\nНе удалось начать экспорт.'; return false; }
          log.textContent += opts.method === 'fast' ? '\nОффлайн-кодирование…' : '\nЗапись началась… (в реальном времени)';
          return false;
        } }
      ]
    });
  }
  U.bus.on('exportProgress', (d) => {
    if (!exportUI) return;
    const bar = $('#exBar', exportUI.body), log = $('#exLog', exportUI.body);
    if (!bar || !log) return;
    if (d.log) { log.textContent += '\n' + d.log; log.scrollTop = log.scrollHeight; return; }
    if (d.pct != null) bar.style.width = Math.round(d.pct * 100) + '%';
    if (d.done) {
      log.textContent += '\n' + (d.cancelled ? 'Экспорт отменён.' : 'Готово! Файл загружен браузером.');
      bar.style.width = d.cancelled ? '0%' : '100%';
    } else if (d.pct != null && Math.floor(d.pct * 10) !== (exportUI.lastTick || -1)) {
      exportUI.lastTick = Math.floor(d.pct * 10);
      log.textContent += '\n' + Math.round(d.pct * 100) + '% · ' + U.formatTC(d.time, S.project.fps);
      log.scrollTop = log.scrollHeight;
    }
  });

  /* =============================== sequence in / out =============================== */
  function setIn() {
    if (focusedMonitor === 'source' && S.source.mediaId) { E.markIn(); return; }
    S.change('Точка входа', () => { S.project.seqIn = S.playhead; if (S.project.seqOut <= S.project.seqIn) S.project.seqOut = 0; });
    renderAll(); U.status('Вход последовательности: ' + U.formatTC(S.playhead, S.project.fps), null, true);
  }
  function setOut() {
    if (focusedMonitor === 'source' && S.source.mediaId) { E.markOut(); return; }
    S.change('Точка выхода', () => { S.project.seqOut = S.playhead; if (S.project.seqIn >= S.project.seqOut) S.project.seqIn = 0; });
    renderAll(); U.status('Выход последовательности: ' + U.formatTC(S.playhead, S.project.fps), null, true);
  }
  function clearInOut() {
    if (focusedMonitor === 'source' && S.source.mediaId) { E.clearInOut(); return; }
    S.change('Сброс точек', () => { S.project.seqIn = 0; S.project.seqOut = 0; }); renderAll();
  }

  /* =============================== trim to playhead =============================== */
  function trimToPlayhead(side) {
    if (!S.selection.size) { U.toast('Выберите клипы', 'warn'); return; }
    S.change('Подрезка до курсора', () => {
      S.selection.forEach(id => {
        const c = S.findClip(id); if (!c) return;
        const f = 1 / S.project.fps;
        if (side === 'start') {
          if (S.playhead <= c.start + f || S.playhead >= S.clipEnd(c) - f) return;
          const delta = S.playhead - c.start;
          c.inPoint += delta * c.speed; c.start = S.playhead;
          const arr = c.keys || {}; Object.keys(arr).forEach(p => { arr[p] = arr[p].map(k => Object.assign({}, k, { t: Math.max(0, k.t - delta) })); });
        } else {
          if (S.playhead <= c.start + f || S.playhead >= S.clipEnd(c) - f) return;
          c.outPoint = c.inPoint + (S.playhead - c.start) * c.speed;
        }
      });
    });
    renderAll();
  }

  /* =============================== edit point navigation =============================== */
  function jumpEdit(dir) {
    const pts = [0, S.sequenceDuration()];
    S.allClips().forEach(c => pts.push(c.start, S.clipEnd(c)));
    (S.project.markers || []).forEach(m => pts.push(m.time));
    const sorted = Array.from(new Set(pts.map(v => Math.round(v * 1000) / 1000))).sort((a, b) => a - b);
    const eps = 1 / S.project.fps / 2;
    const t = dir > 0 ? sorted.find(v => v > S.playhead + eps) : sorted.slice().reverse().find(v => v < S.playhead - eps);
    if (t != null) E.seek(t);
  }

  /* =============================== workspace layout =============================== */
  function resetLayout() {
    $('#workspace').style.removeProperty('--bottom-h');
    $('#workspace').style.removeProperty('--right-w');
    $('#leftStack').style.removeProperty('--left-top-h');
    $('#fxPanel').style.display = '';
    $('#sourcePanel').style.display = '';
    $('#programPanel').style.display = '';
    E.applyProgramZoom();
    U.toast('Расположение панелей сброшено');
  }
  function toggleFullscreen() {
    document.body.classList.toggle('fullscreen-program');
    setTimeout(() => { E.applyProgramZoom(); T.render(); }, 30);
  }
  function setWorkspace(name) {
    $$('#workspaceTabs .wtab').forEach(b => b.classList.toggle('active', b.dataset.ws === name));
    const ws = $('#workspace');
    if (name === 'color') { ws.style.setProperty('--bottom-h', '280px'); P.setLeftTab('effects'); }
    else if (name === 'audio') { ws.style.setProperty('--bottom-h', '320px'); S.settings.waveforms = true; P.setLeftTab('mixer'); T.render(); }
    else if (name === 'effects') { ws.style.setProperty('--bottom-h', '330px'); P.setLeftTab('effects'); }
    else ws.style.removeProperty('--bottom-h');
    U.toast('Рабочее пространство: ' + name, null, 1800);
  }
  function buildWorkspaceTabs() {
    const tabs = [['editing', 'Монтаж'], ['color', 'Цвет'], ['audio', 'Аудио'], ['effects', 'Эффекты']];
    const box = $('#workspaceTabs'); box.innerHTML = '';
    tabs.forEach((t, i) => {
      const b = el('button', { class: 'wtab' + (i === 0 ? ' active' : ''), text: t[1], dataset: { ws: t[0] } });
      b.addEventListener('click', () => setWorkspace(t[0]));
      box.appendChild(b);
    });
  }
  function bindSplitters() {
    const main = $('#mainSplitter'), ws = $('#workspace');
    main.addEventListener('pointerdown', e => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = parseFloat(getComputedStyle(ws).getPropertyValue('--bottom-h')) || ws.getBoundingClientRect().height * .45;
      const move = ev => ws.style.setProperty('--bottom-h', clamp(startH + (startY - ev.clientY), 200, window.innerHeight - 220) + 'px');
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); setTimeout(() => { E.applyProgramZoom(); T.render(); }, 20); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    });
    const left = $('#leftSplitter'), stack = $('#leftStack');
    left.addEventListener('pointerdown', e => {
      e.preventDefault();
      const startY = e.clientY, rect = stack.getBoundingClientRect();
      const startPct = (parseFloat(getComputedStyle(stack).getPropertyValue('--left-top-h')) / 100) * rect.height || rect.height * .55;
      const move = ev => stack.style.setProperty('--left-top-h', clamp(startPct + (ev.clientY - startY), 70, rect.height - 90) + 'px');
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    });
  }

  /* =============================== scrub bars =============================== */
  function bindScrub(id, onSeek, durationFn) {
    const node = $(id); if (!node) return;
    let active = false;
    const seek = (e) => {
      const r = node.getBoundingClientRect();
      const t = clamp((e.clientX - r.left) / Math.max(1, r.width), 0, 1) * Math.max(.001, durationFn());
      onSeek(t);
    };
    node.addEventListener('pointerdown', e => { active = true; E.pause(); seek(e); e.preventDefault(); });
    const move = e => { if (active) seek(e); };
    const up = () => { active = false; };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }

  /* =============================== global file drag & drop =============================== */
  let dragDepth = 0, overlay = null;
  function showDropOverlay() {
    if (overlay) return;
    // Компактная подсказка внизу экрана: раньше на весь кадр (и на видео) падал
    // синий оверлей, который закрывал монитор программы и мешал смотреть материал.
    overlay = el('div', { class: 'drop-hint', html: U.icon('import') + '<span>Отпустите файлы, чтобы импортировать</span>' });
    document.body.appendChild(overlay);
  }
  function hideDropOverlay() { if (overlay) { overlay.remove(); overlay = null; } dragDepth = 0; }
  function hasFiles(e) {
    return !!(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files'));
  }
  function bindGlobalDrop() {
    window.addEventListener('dragenter', e => {
      if (!hasFiles(e)) return;
      dragDepth++; showDropOverlay();
    });
    window.addEventListener('dragleave', () => { if (--dragDepth <= 0) hideDropOverlay(); });
    window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
    // Подстраховка: если dragleave «потерялся» (уход курсора за пределы окна,
    // переключение вкладки, отмена перетаскивания), оверлей раньше оставался
    // висеть на весь экран и перехватывал ВСЕ клики — интерфейс «не реагировал».
    window.addEventListener('dragend', () => hideDropOverlay());
    window.addEventListener('blur', () => hideDropOverlay());
    document.addEventListener('visibilitychange', () => { if (document.hidden) hideDropOverlay(); });
    window.addEventListener('drop', e => {
      const files = e.dataTransfer && e.dataTransfer.files;
      hideDropOverlay();
      if (!files || !files.length) return;
      if (e.target.closest && (e.target.closest('.tl-lane') || e.target.closest('#mediaList') || e.target.closest('#relinkFiles'))) return;
      e.preventDefault();
      M.importFiles(files);
    });
  }

  /* =============================== keyboard =============================== */
  function isTyping(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }
  function bindKeyboard() {
    window.addEventListener('keydown', e => {
      if (PPE.animationUI && PPE.animationUI.isOpen()) return; // отдельные сочетания анимационной студии
      if (isTyping(e)) {
        if (e.key === 'Enter' && e.target.id === 'programTC') { e.target.blur(); }
        return;
      }
      const ctrl = e.ctrlKey || e.metaKey, shift = e.shiftKey, alt = e.altKey;
      const k = e.key;
      if (ctrl) {
        const map = {
          'n': newProject, 'o': openProjectDialog, 's': saveProject, 'i': () => $('#fileInput').click(),
          'm': showExportDialog, 'e': () => E.exportFramePNG(), 'k': () => T.splitSelected(),
          'd': () => T.duplicate(), 'a': () => T.selectAll(), 'c': () => T.copySelected(),
          'x': () => T.cutSelected(), 'v': () => T.paste(),
          'z': () => shift ? S.redo() : S.undo(), 'y': () => S.redo(),
          'f': () => shift ? toggleFullscreen() : null
        };
        const fn = map[k.toLowerCase()];
        if (fn) { e.preventDefault(); fn(); return; }
        if (shift && k.toLowerCase() === 'k') { e.preventDefault(); T.toggleKeyAtPlayhead(); return; }
        if (shift && k.toLowerCase() === 'p') { e.preventDefault(); PR.show(); return; }
        if (shift && k.toLowerCase() === 'e') { e.preventDefault(); E.exportFramePNG(); return; }
        return;
      }
      switch (k) {
        case ' ': e.preventDefault(); E.toggle(); break;
        case 'j': case 'J': e.preventDefault(); E.shuttle(-1); break;
        case 'k': case 'K': e.preventDefault(); E.pause(); break;
        case 'l': case 'L': e.preventDefault(); E.shuttle(1); break;
        case 'ArrowLeft': e.preventDefault(); if (alt) T.nudgeSelected(-1); else E.step(shift ? -S.project.fps : -1); break;
        case 'ArrowRight': e.preventDefault(); if (alt) T.nudgeSelected(1); else E.step(shift ? S.project.fps : 1); break;
        case 'ArrowUp': e.preventDefault(); jumpEdit(-1); break;
        case 'ArrowDown': e.preventDefault(); jumpEdit(1); break;
        case 'Home': e.preventDefault(); E.seek(0); break;
        case 'End': e.preventDefault(); E.seek(S.sequenceDuration()); break;
        case 'i': case 'I': setIn(); break;
        case 'o': case 'O': setOut(); break;
        case 'm': case 'M': T.addMarkerAt(S.playhead); break;
        case 'v': case 'V': T.setTool('select'); break;
        case 'c': case 'C': T.setTool('razor'); break;
        case 'y': case 'Y': T.setTool('slip'); break;
        case 'h': case 'H': T.setTool('hand'); break;
        case 'z': case 'Z': T.setTool('zoom'); break;
        case 's': case 'S': toggleSetting('snap'); break;
        case 'w': case 'W': toggleSetting('waveforms'); break;
        case '[': trimToPlayhead('start'); break;
        case ']': trimToPlayhead('end'); break;
        case '+': case '=': T.setZoom(S.zoom * 1.3); break;
        case '-': case '_': T.setZoom(S.zoom / 1.3); break;
        case 'Delete': case 'Backspace': e.preventDefault(); T.deleteSelected(shift); break;
        case 'Escape': U.closeMenus(); if (document.body.classList.contains('fullscreen-program')) toggleFullscreen(); break;
        case '?': showShortcuts(); break;
        case ',': T.insertSource('insert'); break;
        case '.': T.insertSource('overwrite'); break;
      }
    });
  }

  /* =============================== mobile shell =============================== */
  const MOBILE_Q = '(max-width:820px), (pointer:coarse) and (max-width:1100px)';
  function isMobileLayout() {
    return document.body.classList.contains('portrait-mode') || window.matchMedia(MOBILE_Q).matches;
  }
  function syncMobilePlay() {
    const b = $('#mPlay');
    if (b) {
      b.innerHTML = U.icon(S.playing ? 'pause' : 'play') + '<span>' + (S.playing ? 'Пауза' : 'Пуск') + '</span>';
      b.classList.toggle('on', S.playing);
    }
  }
  function setMobileView(view, sub, silent) {
    const defaults = { monitor: 'program', fx: 'effects' };
    view = view || 'monitor';
    document.body.dataset.mobileView = view;
    document.body.dataset.mobileSub = sub || defaults[view] || '';
    $$('#mobileNav button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    $$('#mobileSegments .seg-group').forEach(g => g.classList.add('hidden'));
    const group = view === 'monitor' ? $('#segMonitor') : view === 'fx' ? $('#segFx') : null;
    if (group) group.classList.remove('hidden');
    $$('#mobileSegments .seg-group button').forEach(b => b.classList.toggle('active', b.dataset.panel === document.body.dataset.mobileSub));
    const hint = $('#segHint');
    if (hint) hint.textContent = ({
      project: 'Файлы, титры, заливки', monitor: 'Кадр и воспроизведение',
      fx: 'Эффекты и параметры', timeline: 'Дорожки и клипы'
    })[view] || '';
    // Panels change size when they become visible — canvases and the timeline must be remeasured.
    setTimeout(() => {
      try {
        E.applyProgramZoom(); T.render(); P.renderMixer(); P.updateTransport(); E.renderFrame(S.playhead);
        // Панель эффектов могла быть скрыта в момент отрисовки — досрочно строим её сейчас.
        if (PPE.panels && PPE.panels.renderEffects) PPE.panels.renderEffects();
      } catch (e) {}
    }, 45);
    if (!silent) U.status('Панель: ' + view, null, true);
  }
  function openMobileMenu(anchor) {
    const items = [];
    menuDefs().forEach((def, i) => {
      if (i) items.push('-');
      items.push({ label: '— ' + def.label.toUpperCase() + ' —', disabled: true });
      def.items().forEach(it => items.push(it));
    });
    U.dropdown(anchor, items);
  }
  function mobileMoreMenu(anchor) {
    const clip = S.findClip(Array.from(S.selection)[0]);
    const common = [
      { label: 'Все проекты…', icon: 'cards', action: () => PR.show() },
      { label: 'Команды и возможности…', icon: 'search', action: () => PPE.pro.cmd.commandPalette() },
      { label: 'Студия анимации…', icon: 'layers', action: () => PPE.animationUI.open() },
      { label: 'Все инструменты…', icon: 'sliders', action: () => PPE.proTools && PPE.proTools.openPalette($('#allToolsBtn')) },
      { label: 'Формат кадра: ' + ratioName(), icon: 'fit', action: () => aspectMenu($('#mMore')) },
      { label: layoutMode === 'right' ? 'Вернуть панель вниз' : 'Перенести панель вправо', icon: 'layers', action: toggleLayout },
      '-'
    ];
    const clipItems = clip ? [
      { label: '— КЛИП: ' + esc(clip.name.toUpperCase()) + ' —', disabled: true },
      { label: 'Дублировать клип', icon: 'copy', action: () => T.duplicate() },
      { label: 'Удалить со сдвигом', icon: 'trash', action: () => T.deleteSelected(true) },
      { label: 'Скорость и длительность', icon: 'speed', action: () => T.speedDialog(clip) },
      { label: 'Перекрёстное растворение', icon: 'layers', action: () => T.applyEffectToSelected('cross-dissolve') },
      { label: 'Отделить звук', icon: 'music', action: () => T.detachAudio(clip) },
      { label: 'Добавить ключевой кадр', icon: 'diamond', action: () => T.addKeyAtPlayhead() },
      '-'
    ] : [];
    U.dropdown(anchor, common.concat(clipItems, [
      { label: 'Добавить маркер', icon: 'marker', action: () => T.addMarkerAt(S.playhead) },
      { label: 'Точка входа / выхода', icon: 'in', action: () => setIn() },
      { label: 'Сбросить точки', icon: 'reset', action: () => clearInOut() },
      { label: 'Изъять фрагмент', icon: 'scissors', action: () => T.extract() },
      '-',
      { label: 'Видеодорожка', icon: 'plus', action: () => T.addTrackUI('video') },
      { label: 'Аудиодорожка', icon: 'plus', action: () => T.addTrackUI('audio') },
      { label: 'Цветовая заливка', icon: 'color', action: () => P.createColorItem() },
      '-',
      { label: 'Привязка', icon: 'magnet', checked: S.settings.snap, action: () => toggleSetting('snap') },
      { label: 'Формы волн', icon: 'wave', checked: S.settings.waveforms, action: () => toggleSetting('waveforms') },
      { label: 'Безопасные зоны', icon: 'grid', checked: S.settings.safeMargins, action: () => toggleSetting('safeMargins') },
      '-',
      { label: 'Открыть проект…', icon: 'folder', action: openProjectDialog },
      { label: 'Сохранить проект', icon: 'save', action: saveProject },
      { label: 'Экспорт кадра PNG', icon: 'image', action: () => E.exportFramePNG() },
      { label: 'Найти медиа', icon: 'link', action: () => P.relinkDialog() },
      { label: 'Настройки последовательности', icon: 'settings', action: () => P.sequenceSettings() },
      '-',
      { label: 'Туториал для начинающих', icon: 'info', action: () => PPE.tutorial && PPE.tutorial.start({ force: true }) },
      { label: 'Горячие клавиши', icon: 'keyboard', action: showShortcuts },
      { label: 'О программе', icon: 'info', action: showAbout }
    ]), 'right');
  }
  function bindMobile() {
    $$('#mobileNav button').forEach(b => b.addEventListener('click', () => {
      const act = b.dataset.action;
      if (act === 'text') { P.createTextItem(); return; }
      if (act === 'audio') { P.setLeftTab('sound'); setMobileView('fx', 'effects'); return; }
      if (act === 'export') { showExportDialog(); return; }
      setMobileView(b.dataset.view);
    }));
    $$('#mobileSegments .seg-group button[data-panel]').forEach(b => b.addEventListener('click', () => {
      setMobileView(document.body.dataset.mobileView || 'monitor', b.dataset.panel);
    }));
    const btn = (id, fn) => { const n = $(id); if (n) n.addEventListener('click', fn); };
    btn('#mobileMenuBtn', e => openMobileMenu(e.currentTarget));
    btn('#mobileImportBtn', () => $('#fileInput').click());
    btn('#mPlay', () => E.toggle());
    btn('#mStepBack', () => E.step(-1));
    btn('#mStepFwd', () => E.step(1));
    btn('#mSplit', () => T.splitSelected());
    btn('#mTitle', () => P.createTextItem());
    btn('#mKey', () => T.toggleKeyAtPlayhead());
    btn('#mUndo', () => S.undo());
    btn('#mRedo', () => S.redo());
    btn('#mMore', e => mobileMoreMenu(e.currentTarget));
    U.bus.on('playState', syncMobilePlay);
    window.addEventListener('resize', U.debounce(() => {
      // Раскладка «телефон/десктоп» переключается вместе с шириной экрана.
      document.body.classList.toggle('portrait-mode', window.matchMedia(MOBILE_Q).matches);
      syncMobilePlay();
      if (isMobileLayout() && !document.body.dataset.mobileView) setMobileView('monitor', 'program', true);
      else { T.render(); E.applyProgramZoom(); E.renderFrame(S.playhead); }
    }, 220));
  }

  /* =============================== buttons =============================== */
  function bindButtons() {
    $('#importBtn').onclick = () => $('#fileInput').click();
    let inputBusy = false;
    $('#fileInput').addEventListener('change', e => {
      // FileList «живой»: обнуление value очищает и его, поэтому копируем список заранее.
      const files = Array.from(e.target.files || []);
      e.target.value = '';           // сразу очищаем: повторный выбор того же файла сработает
      if (!files.length || inputBusy) return;
      inputBusy = true;
      Promise.resolve(M.importFiles(files))
        .catch(err => { console.error(err); U.toast('Ошибка импорта: ' + (err && err.message || err), 'error'); })
        .then(() => { inputBusy = false; });
    });
    $('#projectInput').addEventListener('change', e => { if (e.target.files[0]) loadProjectFile(e.target.files[0]); e.target.value = ''; });
    $('#projectsBtn').onclick = () => PR.show();
    $('#cmdBtn').onclick = () => PPE.pro.cmd.commandPalette();
    $('#saveBtn').onclick = saveProject;
    $('#exportBtn').onclick = showExportDialog;
    $('#undoBtn').onclick = () => S.undo();
    $('#redoBtn').onclick = () => S.redo();
    $('#newItemBtn').onclick = e => P.newItemMenu(e.currentTarget);
    const muteBtn = $('#progMute'); if (muteBtn) muteBtn.onclick = () => toggleAudioPreview();
    const aspectBtn = $('#aspectBtn'); if (aspectBtn) aspectBtn.onclick = e => { e.stopPropagation(); aspectMenu(aspectBtn); };
    const kfBtn = $('#kfAddBtn'); if (kfBtn) kfBtn.onclick = () => T.toggleKeyAtPlayhead();
    const akBtn = $('#autoKeyBtn'); if (akBtn) akBtn.onclick = () => toggleSetting('autoKey');
    $('#viewListBtn').onclick = () => { S.mediaView = 'list'; P.renderProject(); };
    $('#viewGridBtn').onclick = () => { S.mediaView = 'grid'; P.renderProject(); };

    // generic panel menus
    $$('[data-menu]').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      const items = b.dataset.menu === 'timeline' ? [
        { label: 'Добавить видеодорожку', icon: 'plus', action: () => T.addTrackUI('video') },
        { label: 'Добавить аудиодорожку', icon: 'plus', action: () => T.addTrackUI('audio') },
        { label: 'Вписать последовательность', icon: 'fit', action: () => T.fitZoom() },
        '-',
        { label: 'Привязка', icon: 'magnet', checked: S.settings.snap, action: () => toggleSetting('snap') },
        { label: 'Формы волн', icon: 'wave', checked: S.settings.waveforms, action: () => toggleSetting('waveforms') },
        { label: 'Миниатюры', icon: 'image', checked: S.settings.showThumbnails, action: () => toggleSetting('showThumbnails') },
        '-',
        { label: 'Настройки последовательности…', icon: 'settings', action: () => P.sequenceSettings() }
      ] : [
        { label: 'Сбросить расположение панелей', icon: 'reset', action: resetLayout },
        { label: 'Показать/скрыть исходный монитор', icon: 'eye', action: () => { if (isMobileLayout()) setMobileView('monitor', 'source'); else { const n = $('#sourcePanel'); n.style.display = n.style.display === 'none' ? '' : 'none'; } } },
        { label: 'Показать/скрыть настройки эффектов', icon: 'fx', action: () => { if (isMobileLayout()) setMobileView('fx', 'controls'); else { const n = $('#fxPanel'); n.style.display = n.style.display === 'none' ? '' : 'none'; } } },
        '-',
        { label: 'Рабочее пространство: Монтаж', icon: 'grid', action: () => setWorkspace('editing') },
        { label: 'Рабочее пространство: Цвет', icon: 'color', action: () => setWorkspace('color') },
        { label: 'Рабочее пространство: Аудио', icon: 'volume', action: () => setWorkspace('audio') }
      ];
      U.dropdown(b, items, 'right');
    }));

    // source monitor
    $('#srcPlay').onclick = () => E.sourcePlayPause();
    $('#srcGoStart').onclick = () => E.sourceSeek(0);
    $('#srcGoEnd').onclick = () => E.sourceSeek(S.sourceDuration(S.findMedia(S.source.mediaId)));
    $('#srcStepBack').onclick = () => { if (S.source.playing) E.sourcePlayPause(); E.sourceStep(-1); };
    $('#srcStepFwd').onclick = () => { if (S.source.playing) E.sourcePlayPause(); E.sourceStep(1); };
    $('#srcLoop').onclick = () => { S.source.loop = !S.source.loop; P.updateTransport(); };
    $('#srcMarkIn').onclick = () => E.markIn();
    $('#srcMarkOut').onclick = () => E.markOut();
    $('#srcGoIn').onclick = () => E.sourceSeek(S.source.inPoint);
    $('#srcGoOut').onclick = () => E.sourceSeek(S.source.outPoint);
    $('#sourceFitBtn').onclick = () => { const v = E.sourceVideo; v.style.objectFit = v.style.objectFit === 'cover' ? 'contain' : 'cover'; U.toast('Масштаб: ' + (v.style.objectFit === 'cover' ? 'заполнить' : 'вписать')); };
    $('#insertBtn').onclick = () => T.insertSource('insert');
    $('#overwriteBtn').onclick = () => T.insertSource('overwrite');
    $('#appendBtn').onclick = () => T.insertSource('append');
    $('#sourceScrub').addEventListener('dblclick', () => E.clearInOut());
    bindScrub('#sourceScrub', t => E.sourceSeek(t), () => S.sourceDuration(S.findMedia(S.source.mediaId)) || 1);
    $('#sourcePanel').addEventListener('pointerdown', () => { focusedMonitor = 'source'; });
    // Раньше двойной щелчок по самому видео открывал системный диалог выбора файла —
    // он «выскакивал» прямо поверх кадра. Теперь импорт только по явной кнопке.
    const srcImport = $('#sourceImportBtn');
    if (srcImport) srcImport.onclick = e => { e.stopPropagation(); $('#fileInput').click(); };

    // program monitor
    $('#progPlay').onclick = () => E.toggle();
    $('#progGoStart').onclick = () => E.seek(0);
    $('#progGoEnd').onclick = () => E.seek(S.sequenceDuration());
    $('#progStepBack').onclick = () => E.step(-1);
    $('#progStepFwd').onclick = () => E.step(1);
    $('#progPlayBack').onclick = () => E.shuttle(-1);
    $('#progPlayFwd').onclick = () => E.shuttle(1);
    $('#markInBtn').onclick = setIn;
    $('#markOutBtn').onclick = setOut;
    $('#addMarkerBtn').onclick = () => T.addMarkerAt(S.playhead);
    $('#extractBtn').onclick = () => T.extract();
    $('#safeBtn').onclick = () => toggleSetting('safeMargins');
    $('#programFull').onclick = toggleFullscreen;
    $('#programZoom').onchange = () => E.applyProgramZoom();
    $('#programTC').addEventListener('keydown', e => {
      if (e.key === 'Enter') { const t = U.parseTC(e.target.value, S.project.fps); if (t != null) E.seek(t); e.target.blur(); }
    });
    $('#programScrub').addEventListener('dblclick', () => clearInOut());
    bindScrub('#programScrub', t => E.seek(U.snapTime(t, S.project.fps)), () => S.sequenceDuration());
    $('#programPanel').addEventListener('pointerdown', () => { focusedMonitor = 'program'; });

    // timeline head
    $$('#toolBar .tool[data-tool]').forEach(b => b.addEventListener('click', () => T.setTool(b.dataset.tool)));
    $('#snapBtn').onclick = () => toggleSetting('snap');
    $('#linkBtn').onclick = () => toggleSetting('linkAV');
    $('#waveBtn').onclick = () => toggleSetting('waveforms');
    $('#addTrackBtn').onclick = e => U.dropdown(e.currentTarget, [
      { label: 'Видеодорожка', icon: 'film', action: () => T.addTrackUI('video') },
      { label: 'Аудиодорожка', icon: 'music', action: () => T.addTrackUI('audio') }
    ]);
    $('#splitBtn').onclick = () => T.splitSelected();
    $('#rippleDeleteBtn').onclick = () => T.deleteSelected(true);
    $('#addTextBtn').onclick = () => P.createTextItem();
    $('#seqSettingsBtn').onclick = () => P.sequenceSettings();
    $('#zoomInBtn').onclick = () => T.setZoom(S.zoom * 1.3);
    $('#zoomOutBtn').onclick = () => T.setZoom(S.zoom / 1.3);
    $('#zoomFitBtn').onclick = () => T.fitZoom();
    $('#gotoPlayheadBtn').onclick = () => T.gotoPlayhead();
    $('#fxResetBtn').onclick = () => { if (P.resetClip) P.resetClip(); };
  }

  /* =============================== bootstrap =============================== */
  function boot() {
    let savedTheme = 'capcut';
    try { savedTheme = localStorage.getItem(THEME_KEY) || 'capcut'; } catch (e) {}
    applyTheme(savedTheme, true);
    // Раскладка по умолчанию — таймлайн внизу (как в CapCut/Premiere), если
    // пользователь раньше не выбрал «панель справа».
    try { const savedLayout = localStorage.getItem('frameforge.layout.v1'); if (savedLayout === 'right' || savedLayout === 'bottom') layoutMode = savedLayout; } catch (e) {}
    P.init(); T.init(); E.init();
    buildMenus(); buildWorkspaceTabs(); bindSplitters(); bindButtons(); bindKeyboard(); bindGlobalDrop(); bindMobile();
    if (PPE.proPanels) PPE.proPanels.init();
    if (PPE.animationUI) PPE.animationUI.init();
    // Safe defaults: on desktop these attributes are ignored, on phones they select the visible panel.
    document.body.dataset.mobileView = document.body.dataset.mobileView || 'monitor';
    document.body.dataset.mobileSub = document.body.dataset.mobileSub || 'program';
    U.bus.on('history', () => { P.renderHistory(); P.updateTransport(); });
    U.bus.on('modalClose', () => { if (S.exporting) E.cancelExport(); });
    // Восстанавливаем последний автосохранённый проект как «базу» за стартовым окном,
    // иначе создаём демо. Стартовое окно покажет все проекты из индекса.
    let seedName = 'Демо-проект', loaded = false;
    try { loaded = S.loadPersisted(); } catch (e) { loaded = false; }
    if (loaded) seedName = S.project.name || 'Проект';
    else { S.newProject(); createDemo(); seedName = S.project.name || 'Демо-проект'; }
    PR.init({ createDemo: createDemo, applyLayout: applyLayout });
    PR.seedIfEmpty(seedName, S.exportProjectFile());
    PR.restoreLast();
    renderAll();
    // Звук: состояние берётся из настроек проекта, но громкоговоритель всегда
    // синхронизируется с ним — иначе после сбоя экспорта остаётся тишина.
    setAudioPreview(S.settings.audioPreview !== false, true);
    updateMuteButton(); updateAspectButton();
    // Open something in the source monitor so both viewers are useful immediately.
    if (S.project.media.length) {
      const preferred = S.project.media.find(m => m.type === 'text') || S.project.media[0];
      try { P.openSource(preferred.id); } catch (e) { console.warn(e); }
    }
    // Мост автосохранения поднимаем ПОСЛЕ загрузки проекта, иначе он мог бы
    // записать в файл ещё пустое состояние.
    if (PPE.bridge) { try { PPE.bridge.init(); } catch (e) { console.warn('bridge', e); } }
    // Тихо подтягиваем медиа из встроенного хранилища — «офлайн» больше не пугает.
    if (PPE.bridge && PPE.bridge.adoptMedia) {
      PPE.bridge.adoptMedia().then(n => { if (n) { renderAll(); U.hint('Файлы проекта восстановлены из хранилища: ' + n); } }).catch(() => {});
    }
    U.status('Готов к работе');
    U.hint('Перетащите видео, аудио или изображения в окно, чтобы начать');
    // first user gesture unlocks Web Audio
    const unlock = () => { M.resumeAudio(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
    window.addEventListener('pointerdown', unlock); window.addEventListener('keydown', unlock);
    window.addEventListener('beforeunload', () => { try { S.persist(true); PR.saveCurrent(); } catch (e) {} });
    setMobileView(document.body.dataset.mobileView, document.body.dataset.mobileSub, true);
    syncMobilePlay();
    setTimeout(() => { T.fitZoom(); }, 140);
    // Стартовое окно со всеми проектами. После запуска проекта PR.open()
    // сам включит раскладку с панелью справа.
    PR.show({ initial: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
