/* =========================================================================
   tutorial.js — интерактивный туториал для начинающих
   -------------------------------------------------------------------------
   Пошаговый обзор интерфейса: подсвечивает нужный элемент, объясняет, что он
   делает, переключает мобильные панели, если элемент на телефоне скрыт.
   Запуск: PPE.tutorial.start() — из меню «Справка», стартового окна,
   палитры команд (Ctrl+Shift+K) или автоматически при первом запуске.
   Никаких внешних ресурсов — всё рисуется из styles.css и SVG-спрайта.
   ========================================================================= */
(function (root) {
  'use strict';
  const PPE = root.PPE = root.PPE || {};
  const U = PPE.utils;
  const $ = U.$, el = U.el;

  const STORE_KEY = 'frameforge.tutorial.v1';

  /* ------------------------------- шаги туториала ------------------------------- */
  /* target — селектор подсвечиваемого элемента (null = карточка по центру).
     mobile — какую панель открыть на телефоне перед показом шага.
     place  — 'auto' | 'center' | 'top' | 'bottom'.                        */
  const STEPS = [
    {
      title: 'Добро пожаловать в FrameForge Studio',
      text: 'Это видеоредактор, который работает прямо в браузере: без установки, без загрузки файлов на сервер. Покажем за минуту, как собрать первый ролик — от импорта до экспорта.',
      icon: 'film', target: null, place: 'center'
    },
    {
      title: 'Проект и медиатека',
      text: 'В панели «Проект» — вся ваша медиатека: видео, музыка и картинки. Нажмите «Импорт» или просто перетащите файлы в окно редактора — они появятся здесь.',
      icon: 'folder', target: '#projectPanel', mobile: { view: 'project' }
    },
    {
      title: 'Добавьте клип на таймлайн',
      text: 'Перетащите элемент из медиатеки на дорожку — или выделите его и нажмите «+ В конец». Двойной щелчок по медиа открывает его в исходном мониторе.',
      icon: 'insert', target: '#projectPanel', mobile: { view: 'project' }
    },
    {
      title: 'Исходный монитор',
      text: 'Здесь вы просматриваете материал и ставите точки входа (I) и выхода (O), чтобы взять на таймлайн только нужный фрагмент — кнопками «Вставить» или «Наложить».',
      icon: 'play', target: '#sourcePanel', mobile: { view: 'monitor', sub: 'source' }
    },
    {
      title: 'Монитор программы',
      text: 'Это итоговый кадр ролика. Пробел — воспроизведение, стрелки ← → — покадрово, Home/End — в начало и конец. Таймкод можно ввести вручную и нажать Enter.',
      icon: 'fullscreen', target: '#programPanel', mobile: { view: 'monitor', sub: 'program' }
    },
    {
      title: 'Таймлайн — сердце монтажа',
      text: 'Клипы двигаются перетаскиванием, край клипа — подрезка. Лезвие (C) режет по клику, инструмент «Рука» (H) двигает шкалу, «Привязка» (S) помогает стыковать кадры точно.',
      icon: 'layers', target: '#timelinePanel', mobile: { view: 'timeline' }
    },
    {
      title: 'Быстрые операции с клипами',
      text: 'Разрезать в точке курсора — Ctrl+K. Удалить со сдвигом (без дыр) — Shift+Del. Скопировать/вставить, дублировать (Ctrl+D) и отменить (Ctrl+Z) — всё работает как в больших редакторах.',
      icon: 'razor', target: '#toolBar', mobile: { view: 'timeline' }
    },
    {
      title: 'Все инструменты',
      text: 'Кнопка «Все инструменты» открывает полный набор, как в Premiere Pro: ripple, rolling, slip, slide, pen, титры и фигуры. У каждого инструмента есть горячая клавиша — она написана рядом.',
      icon: 'sliders', target: '#allToolsBtn', mobile: { view: 'timeline' }
    },
    {
      title: 'Эффекты',
      text: 'В библиотеке эффектов дважды щёлкните по эффекту или перетащите его прямо на клип. Всё применяется мгновенно и обратимо.',
      icon: 'fx', target: '#leftTabsPanel', mobile: { view: 'fx', sub: 'effects' }
    },
    {
      title: 'Настройки эффектов',
      text: 'Здесь параметры выбранного клипа: положение, масштаб, прозрачность, цветокоррекция, скорость и ключевые кадры (ромбик у шкалы времени).',
      icon: 'settings', target: '#fxPanel', mobile: { view: 'fx', sub: 'controls' }
    },
    {
      title: 'Титры и графика',
      text: 'Титры, цветные заливки и фигуры создаются кнопкой «+» в панели проекта или клавишей T на таймлайне. Текст и стиль правятся в настройках эффектов.',
      icon: 'text', target: '#newItemBtn', mobile: { view: 'project' }
    },
    {
      title: 'Студия анимации',
      text: 'Для слоёв, сцен и векторных анимаций есть отдельная студия — кнопка «Анимация» в шапке. Таймлайн монтажа при этом не меняется.',
      icon: 'layers', target: '#animationBtn'
    },
    {
      title: 'Экспорт',
      text: 'Когда ролик готов — кнопка «Экспорт»: видеофайл (WebM/MP4 — зависит от браузера), текущий кадр в PNG или проект в .json для резервной копии.',
      icon: 'export', target: '#exportBtn'
    },
    {
      title: 'Готово! Приятного монтажа',
      text: 'Полезное напоследок: ? — горячие клавиши, Ctrl+Shift+K — поиск любой команды, Ctrl+S — сохранить проект. Туториал всегда можно открыть заново: «Справка → Туториал для начинающих».',
      icon: 'check', target: null, place: 'center'
    }
  ];

  /* --------------------------------- состояние --------------------------------- */
  let open = false;
  let index = 0;
  let ui = null;            // {root, spot, card, ...}
  let rafTimer = 0;
  let autoTimer = 0;
  const reduceMotion = () => {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  };

  /* ------------------------------ сохранение флага ------------------------------ */
  function readState() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function writeState(patch) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(Object.assign(readState(), patch))); } catch (e) {}
  }
  function isDone() { return !!readState().done; }

  /* ---------------------------------- вёрстка ---------------------------------- */
  function buildUI() {
    const rootEl = el('div', { class: 'tour', id: 'tourRoot', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Туториал для начинающих' });
    const veil = el('div', { class: 'tour-veil' });
    const block = el('div', { class: 'tour-block' });
    const spot = el('div', { class: 'tour-spot hidden' });
    const card = el('div', { class: 'tour-card' });

    const kicker = el('div', { class: 'tour-kicker' });
    const title = el('h3', { class: 'tour-title' });
    const text = el('p', { class: 'tour-text' });
    const dots = el('div', { class: 'tour-dots' });
    const foot = el('div', { class: 'tour-foot' });
    const btnSkip = el('button', { class: 'tour-skip', text: 'Пропустить' });
    const btnPrev = el('button', { class: 'btn small tour-prev', html: 'Назад' });
    const btnNext = el('button', { class: 'btn small primary tour-next', html: 'Далее' });
    const spacer = el('span', { class: 'spacer' });
    foot.appendChild(btnSkip); foot.appendChild(spacer); foot.appendChild(btnPrev); foot.appendChild(btnNext);

    card.appendChild(kicker);
    card.appendChild(el('div', { class: 'tour-head' }, [el('span', { class: 'tour-ic' }), title]));
    card.appendChild(text);
    card.appendChild(dots);
    card.appendChild(el('div', { class: 'tour-hint', text: 'Клавиши: → далее · ← назад · Esc закрыть' }));
    card.appendChild(foot);

    rootEl.appendChild(veil);
    rootEl.appendChild(block);
    rootEl.appendChild(spot);
    rootEl.appendChild(card);
    document.body.appendChild(rootEl);

    // Кнопки: pointerdown останавливаем, чтобы общий обработчик слоёв не мешал.
    const stop = (n) => n.addEventListener('pointerdown', e => e.stopPropagation());
    [card, block].forEach(stop);

    btnNext.addEventListener('click', (e) => { e.stopPropagation(); next(); });
    btnPrev.addEventListener('click', (e) => { e.stopPropagation(); prev(); });
    btnSkip.addEventListener('click', (e) => { e.stopPropagation(); stop(); });
    block.addEventListener('click', () => next());

    return { root: rootEl, veil, block, spot, card, kicker, title, text, dots, foot, btnPrev, btnNext, btnSkip, ic: $('.tour-ic', card) };
  }

  /* --------------------------- позиционирование и показ --------------------------- */
  function targetNode(step) {
    if (!step.target) return null;
    const node = $(step.target);
    if (!node) return null;
    // Панель может быть скрыта (другая вкладка на телефоне) — тогда подсвечивать нечего.
    if (!node.getClientRects().length) return null;
    const r = node.getBoundingClientRect();
    if (r.width < 24 || r.height < 16) return null;
    return node;
  }

  function placeCard(rect) {
    const card = ui.card, vw = window.innerWidth, vh = window.innerHeight;
    const pad = 12;
    const cw = card.offsetWidth, ch = card.offsetHeight;
    let x, y;
    if (!rect) {
      x = (vw - cw) / 2;
      y = Math.max(pad, (vh - ch) / 2 - 10);
    } else {
      x = rect.left + rect.width / 2 - cw / 2;
      const below = rect.bottom + 14, above = rect.top - ch - 14;
      if (below + ch < vh - pad) y = below;
      else if (above > pad) y = above;
      else y = Math.max(pad, Math.min(vh - ch - pad, rect.bottom + 14));
    }
    x = Math.min(Math.max(pad, x), Math.max(pad, vw - cw - pad));
    y = Math.min(Math.max(pad, y), Math.max(pad, vh - ch - pad));
    card.style.left = Math.round(x) + 'px';
    card.style.top = Math.round(y) + 'px';
  }

  function paint() {
    if (!open || !ui) return;
    const step = STEPS[index];
    const node = targetNode(step);
    if (node) {
      const r = node.getBoundingClientRect();
      const pad = 6;
      const s = ui.spot;
      s.classList.remove('hidden');
      s.style.left = Math.round(r.left - pad) + 'px';
      s.style.top = Math.round(r.top - pad) + 'px';
      s.style.width = Math.round(r.width + pad * 2) + 'px';
      s.style.height = Math.round(r.height + pad * 2) + 'px';
      ui.card.classList.add('has-target');
      ui.veil.classList.add('hidden');
      // measure card after it is (re)populated
      placeCard({ left: r.left - pad, top: r.top - pad, bottom: r.bottom + pad, width: r.width + pad * 2, height: r.height + pad * 2 });
    } else {
      ui.spot.classList.add('hidden');
      ui.spot.style.width = '0px'; ui.spot.style.height = '0px';
      ui.card.classList.remove('has-target');
      ui.veil.classList.remove('hidden');
      placeCard(null);
    }
  }

  function render() {
    const step = STEPS[index];
    const total = STEPS.length;
    ui.kicker.textContent = 'Шаг ' + (index + 1) + ' из ' + total;
    ui.title.textContent = step.title;
    ui.text.innerHTML = U.escapeHtml(step.text);
    ui.ic.innerHTML = U.icon(step.icon || 'info');
    ui.btnPrev.style.visibility = index === 0 ? 'hidden' : 'visible';
    ui.btnNext.textContent = index === total - 1 ? 'Начать монтаж' : 'Далее';
    ui.btnSkip.style.visibility = index === total - 1 ? 'hidden' : 'visible';
    ui.dots.innerHTML = '';
    STEPS.forEach((s, i) => {
      const d = el('button', { class: 'tour-dot' + (i === index ? ' active' : '') + (i < index ? ' passed' : ''), title: s.title, 'aria-label': s.title });
      d.addEventListener('click', (e) => { e.stopPropagation(); go(i); });
      ui.dots.appendChild(d);
    });
    // Панель на телефоне переключаем ДО замера геометрии.
    const mv = step.mobile;
    const mobile = PPE.isMobileLayout ? PPE.isMobileLayout() : document.body.classList.contains('portrait-mode');
    if (mv && mobile && PPE.setMobileView) {
      PPE.setMobileView(mv.view, mv.sub, true);
      setTimeout(paint, 90);
    } else {
      setTimeout(paint, 0);
    }
    // Карточка могла изменить высоту — пересчитываем ещё раз после раскладки.
    setTimeout(() => { if (open) paint(); }, 220);
  }

  function go(i) {
    index = Math.max(0, Math.min(STEPS.length - 1, i));
    render();
    if (reduceMotion()) return;
    ui.card.classList.remove('pop');
    void ui.card.offsetWidth;
    ui.card.classList.add('pop');
  }
  function next() {
    if (index >= STEPS.length - 1) { finish(); return; }
    go(index + 1);
  }
  function prev() { if (index > 0) go(index - 1); }

  /* ----------------------------------- запуск ----------------------------------- */
  function start(options) {
    options = options || {};
    if (open) { go(0); return; }
    // Панели и меню могут перекрывать подсветку — закрываем их.
    try { U.closeLayers(); U.closeModal(); } catch (e) {}
    const startScreen = $('#startScreen');
    if (startScreen && !startScreen.classList.contains('hidden') && PPE.projects) {
      try { PPE.projects.hide(); } catch (e) {}
    }
    open = true;
    index = 0;
    document.body.classList.add('tour-open');
    ui = buildUI();
    requestAnimationFrame(() => { ui.root.classList.add('on'); });
    render();
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    if (!reduceMotion()) rafTimer = setInterval(paint, 400);
    U.status('Туториал для начинающих', null, true);
    if (options.force) writeState({ seen: true });
  }

  function stop(silent) {
    if (!open) return;
    open = false;
    clearInterval(rafTimer); rafTimer = 0;
    clearTimeout(autoTimer); autoTimer = 0;
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('orientationchange', onResize);
    document.body.classList.remove('tour-open');
    if (ui) { ui.root.classList.remove('on'); const r = ui.root; ui = null; setTimeout(() => r.remove(), 200); }
    writeState({ done: true, seen: true });
    if (!silent) U.toast('Туториал завершён. Открыть снова: «Справка → Туториал для начинающих»', 'success', 4200);
  }
  function finish() { stop(); }

  function onKey(e) {
    if (!open) return;
    if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); next(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); prev(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); stop(); }
  }
  function onResize() { if (open) paint(); }

  /* ------------------------- автозапуск при первом входе ------------------------- */
  function autoStart() {
    if (isDone()) return;
    const startScreen = $('#startScreen');
    const launch = () => {
      clearTimeout(autoTimer);
      autoTimer = setTimeout(() => {
        if (isDone() || open) return;
        // не перебиваем открытое модальное окно пользователя
        const modal = $('#modalRoot');
        if (modal && !modal.classList.contains('hidden')) { autoStart(); return; }
        start();
      }, 500);
    };
    if (startScreen && !startScreen.classList.contains('hidden')) {
      // Ждём, пока пользователь закроет стартовое окно (откроет проект).
      const mo = new MutationObserver(() => {
        if (startScreen.classList.contains('hidden')) { mo.disconnect(); launch(); }
      });
      mo.observe(startScreen, { attributes: true, attributeFilter: ['class'] });
    } else launch();
  }

  function reset() {
    writeState({ done: false });
    U.toast('Туториал снова будет показан при следующем запуске', 'success');
  }

  PPE.tutorial = {
    start, stop, reset, isOpen: () => open, isDone,
    steps: STEPS,
    next, prev,
    /** Кнопка «Туториал» на стартовом экране: закрывает его и запускает обучение. */
    startFromStartScreen: function () {
      if (PPE.projects) { try { PPE.projects.hide(); } catch (e) {} }
      setTimeout(() => start({ force: true }), 120);
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(autoStart, 900));
  else setTimeout(autoStart, 900);
})(window);
