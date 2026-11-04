/* Сенсорная студия векторной графики и покадровой анимации. */
(function(root){
  'use strict';
  const PPE=root.PPE=root.PPE||{}, U=PPE.utils, S=PPE.state, A=PPE.animation;
  const {$,$$,el,uid,clamp,escapeHtml:esc}=U;
  const ui={open:false,sceneId:null,layerId:null,frame:0,tool:'select',panel:'timeline',selected:new Set(),
    fill:'#21d5c1',fill2:'#687bff',stroke:'#ffffff',width:6,mode:'object',onion:false,grid:false,guides:false,
    zoom:1,panX:0,panY:0,viewRot:0,drag:null,pointerId:null,pendingMove:null,moveRAF:0,drawRAF:0,renderRAF:0,playing:false,playT:0,playFrame:0,audio:new Map(),pen:null};
  const TOOLS=[
    ['select','↖','Выделение','Выделение и перемещение'],['subselect','⌁','Узлы','Изменить узлы контура'],['lasso','◌','Лассо','Обвести объекты'],
    ['transform','⬚','Трансформ.','Перемещение и изменение размера'],['meshwarp','▦','Сетка','Деформация объекта по узлам сетки'],['brush','🖌','Кисть','Векторная кисть'],['fluid','〰','Fluid Brush','Кисть с толщиной по нажатию'],
    ['pencil','✎','Карандаш','Свободный контур'],['pen','✒','Перо','Клик по узлам; Enter или двойной клик завершает'],['text','T','Текст','Текстовый объект'],
    ['rect','▭','Прямоугольник','Прямоугольник'],['oval','◯','Овал','Овал'],['star','☆','Polystar','Звезда / многоугольник'],
    ['eraser','◩','Ластик','Векторное вычитание по траектории'],['width','↕','Ширина','Изменить толщину контура'],['dropper','◉','Пипетка','Взять цвет объекта'],
    ['bucket','▧','Заливка','Залить объект'],['ink','◒','Чернильница','Применить цвет и толщину обводки'],['gradient','◐','Градиент','Протянуть направление градиента'],
    ['camera','▣','Камера','Сместить виртуальную камеру'],['bone','⚭','Кость','Привязать одну кость к объекту'],['bind','⤴','Bind','Повернуть привязанный объект вокруг кости'],
    ['warp','⤧','Warp','Деформировать узлы контура'],['hand','✋','Рука','Сдвинуть рабочий холст'],['rotate','⟳','Поворот','Повернуть только вид холста'],
    ['zoom','⌕','Масштаб','Приблизить вид холста'],['button','▰','Кнопка','Интерактивная кнопка для HTML'],['input','▤','Поле','Поле ввода для HTML']
  ];
  function D(){return A.doc();} function SC(){return A.scene(D(),ui.sceneId);} function L(){return A.layer(SC(),ui.layerId);}
  function currentObjects(){const l=L();return l?A.objectsAt(l,ui.frame):[];}
  function currentSelection(){return currentObjects().filter(o=>ui.selected.has(o.id));}
  function actualSelected(){const l=L(),k=l&&A.keyAt(l,ui.frame);return k?(k.objects||[]).filter(o=>ui.selected.has(o.id)):[];}
  function activeObject(){return currentSelection()[0]||null;}
  function visible(){return ui.open;}
  function bind(id,fn){const n=$(id);if(n)n.addEventListener('click',fn);}
  function init(){
    $('#animationBtn').addEventListener('click',open); $('#mAnimate').addEventListener('click',open);
    window.addEventListener('resize',U.debounce(()=>{if(ui.open){fitCanvas();draw();}},90));
    window.addEventListener('keydown',keyboard);
    U.bus.on('history',()=>{if(ui.open&&!ui.renderRAF)ui.renderRAF=requestAnimationFrame(()=>{ui.renderRAF=0;if(ui.open)render();});});
  }
  function open(){
    if(ui.open)return; PPE.engine.pause(); const d=A.ensureDoc(),sc=A.scene(d,ui.sceneId);
    ui.open=true;ui.sceneId=sc.id;ui.layerId=(sc.layers.find(l=>l.type!=='folder')||sc.layers[0]).id;ui.frame=0;ui.selected.clear();
    const box=$('#animationWorkspace');box.classList.remove('hidden'); box.innerHTML=markup();
    setup();render();requestAnimationFrame(()=>{fitCanvas();draw();});
  }
  function close(){
    if(ui.pen)finishPen();pause();if(ui.drag){flushPointerMove();S.end();}if(ui.moveRAF)cancelAnimationFrame(ui.moveRAF);if(ui.drawRAF)cancelAnimationFrame(ui.drawRAF);if(ui.renderRAF)cancelAnimationFrame(ui.renderRAF);ui.moveRAF=ui.drawRAF=ui.renderRAF=0;ui.pendingMove=null;ui.drag=null;ui.pointerId=null;ui.open=false;$('#animationWorkspace').classList.add('hidden');$('#animationWorkspace').innerHTML='';
    if(PPE.renderAll)PPE.renderAll(); if(PPE.projects)PPE.projects.saveCurrent();
  }
  function markup(){return `
    <header class="an-header">
      <button class="an-icon" id="anBack" title="Вернуться к монтажу" aria-label="Вернуться к монтажу">‹</button>
      <div class="an-heading"><strong>Студия анимации</strong><small>Рисуйте. Оживляйте. Монтируйте.</small></div>
      <button class="an-ghost" id="anHelp" title="Возможности и ограничения">?</button>
      <button class="an-ghost" id="anImage" title="Добавить изображение на сцену">＋ Фото</button>
      <button class="an-ghost" id="anExport" title="Экспорт анимации">Экспорт</button>
      <button class="an-primary" id="anInsert" title="Добавить эту сцену в видеомонтаж">В монтаж <span>↗</span></button>
    </header>
    <div class="an-scenes">
      <span class="an-scene-label">СЦЕНА</span><select id="anScene" aria-label="Сцена"></select>
      <button class="an-mini" id="anSceneMenu" title="Сцены">＋</button>
      <button class="an-mini" id="anUndo" title="Отменить" aria-label="Отменить">↶</button>
      <button class="an-mini" id="anRedo" title="Повторить" aria-label="Повторить">↷</button>
      <div class="an-spacer"></div><span class="an-doc-label" id="anDocSize"></span>
      <button class="an-mini" id="anResetView" title="Вписать холст">⊡</button>
    </div>
    <div class="an-view" id="anView">
      <div class="an-stage-check" id="anCanvasWrap"><canvas id="anCanvas" aria-label="Холст анимации"></canvas></div>
      <div class="an-empty" id="anEmpty"><span>✦</span><strong>Здесь начинается движение</strong><small>Выберите инструмент и нарисуйте объект</small></div>
      <span class="an-stage-badge" id="anStageBadge">100%</span>
    </div>
    <div class="an-toolwrap"><button class="an-alltools" id="anToolsMenu" title="Все инструменты">☷</button><div class="an-tools" id="anTools"></div></div>
    <div class="an-stylebar">
      <button class="an-toggle hidden" id="anMeshReset" title="Сбросить деформацию выбранного объекта">Сбросить сетку</button>
      <label title="Заливка">Заливка <input id="anFill" type="color" value="#21d5c1"></label>
      <label title="Обводка">Контур <input id="anStroke" type="color" value="#ffffff"></label>
      <label title="Толщина контура">Ширина <input id="anWidth" type="number" min="1" max="300" value="6"></label>
      <select id="anDrawMode" title="Режим рисования" aria-label="Режим рисования"><option value="object">Object Drawing</option><option value="merge">Merge Drawing</option></select>
      <button class="an-toggle" id="anOnion" title="Луковичное шелушение">◉ Лук</button>
      <button class="an-toggle" id="anGrid" title="Сетка и направляющие">▦</button>
    </div>
    <div class="an-tabs" id="anTabs">
      <button data-panel="timeline" class="active">Таймлайн</button><button data-panel="layers">Слои</button><button data-panel="properties">Свойства</button>
      <button data-panel="sprite">Спрайт</button><button data-panel="library">Библиотека</button><button data-panel="project">Проект</button><button data-panel="actions">Код и звук</button>
    </div>
    <div class="an-bottom" id="anBottom"></div>
  `;}
  function setup(){
    bind('#anBack',close);bind('#anHelp',help);bind('#anImage',importImage);bind('#anUndo',()=>{if(ui.drag)return;if(ui.pen)finishPen();S.undo();});bind('#anRedo',()=>{if(ui.drag)return;if(ui.pen)finishPen();S.redo();});bind('#anMeshReset',resetWarp);bind('#anInsert',insertClip);bind('#anExport',e=>exportMenu(e.currentTarget));
    bind('#anSceneMenu',e=>sceneMenu(e.currentTarget));bind('#anResetView',()=>{ui.zoom=1;ui.panX=ui.panY=ui.viewRot=0;fitCanvas();draw();});
    bind('#anToolsMenu',e=>toolMenu(e.currentTarget));
    bind('#anOnion',()=>{ui.onion=!ui.onion;renderHeader();draw();});
    bind('#anGrid',e=>U.dropdown(e.currentTarget,[
      {label:'Сетка',checked:ui.grid,action:()=>{ui.grid=!ui.grid;renderHeader();draw();}},
      {label:'Направляющие по центру',checked:ui.guides,action:()=>{ui.guides=!ui.guides;renderHeader();draw();}},
      {label:'Вписать холст',action:()=>{ui.zoom=1;ui.panX=ui.panY=ui.viewRot=0;fitCanvas();draw();}}
    ]));
    $('#anScene').addEventListener('change',e=>changeScene(e.target.value));
    $('#anFill').addEventListener('input',e=>{ui.fill=e.target.value;});$('#anStroke').addEventListener('input',e=>{ui.stroke=e.target.value;});
    $('#anWidth').addEventListener('change',e=>{ui.width=clamp(Number(e.target.value)||6,1,300);e.target.value=ui.width;});
    $('#anDrawMode').addEventListener('change',e=>{ui.mode=e.target.value;U.toast(ui.mode==='merge'?'Merge: новое заполнение вычитает перекрытую область нижнего объекта':'Object: объекты остаются независимыми',null,2500);});
    $('#anTabs').addEventListener('click',e=>{const b=e.target.closest('[data-panel]');if(b){ui.panel=b.dataset.panel;renderBottom();renderHeader();}});
    const canvas=$('#anCanvas'); canvas.addEventListener('pointerdown',pointerDown); canvas.addEventListener('pointermove',queuePointerMove);
    canvas.addEventListener('pointerup',pointerUp);canvas.addEventListener('pointercancel',pointerUp);
    canvas.addEventListener('dblclick',e=>{if(ui.tool==='pen'&&ui.pen){e.preventDefault();finishPen();}});
    canvas.addEventListener('wheel',e=>{e.preventDefault();ui.zoom=clamp(ui.zoom*(e.deltaY<0?1.12:.89),.35,5);fitCanvas();draw();},{passive:false});
    /* Меню спрайта открывается: правым кликом по холсту, долгим нажатием на
       объект (тач/перо) и кнопкой «Настройки спрайта…» на вкладке «Спрайт». */
    const spriteMenuHit=(e)=>{
      if(!PPE.sprite)return;
      const hit=hitObject(A.worldFromStage(stagePoint(e),SC(),D(),ui.frame));
      if(hit){ ui.layerId=hit.l.id; if(!ui.selected.has(hit.o.id))ui.selected=new Set([hit.o.id]);
        if(ui.panel==='sprite'||ui.panel==='properties')renderBottom(); else {ui.panel='sprite';renderBottom();renderHeader();}
      } else { ui.panel=ui.panel==='sprite'?'sprite':ui.panel; renderBottom(); }
      PPE.sprite.contextMenu(e.clientX,e.clientY);
      const kill=ev=>{ev.stopPropagation();ev.preventDefault();};
      document.addEventListener('click',kill,true);
      setTimeout(()=>document.removeEventListener('click',kill,true),700);
    };
    canvas.addEventListener('contextmenu',e=>{e.preventDefault(); spriteMenuHit(e);});
    let lpTimer=0,lpStart=null;
    const lpCancel=()=>{clearTimeout(lpTimer);lpTimer=0;lpStart=null;};
    canvas.addEventListener('pointerdown',e=>{
      if(e.pointerType==='mouse'&&e.button!==0)return;
      lpStart={x:e.clientX,y:e.clientY,e:{clientX:e.clientX,clientY:e.clientY},ev:e};
      clearTimeout(lpTimer);
      lpTimer=setTimeout(()=>{
        lpTimer=0;
        const saved=lpStart; lpStart=null; if(!saved)return;
        if(ui.drag&&ui.drag.began){return;}
        if(ui.drag){ui.drag=null;} // нажатие без движения по объекту — открываем меню
        spriteMenuHit(saved.e);
        if(navigator.vibrate){try{navigator.vibrate(12);}catch(err){}}
      },520);
    });
    canvas.addEventListener('pointermove',e=>{
      if(lpStart&&(Math.abs(e.clientX-lpStart.x)>8||Math.abs(e.clientY-lpStart.y)>8))lpCancel();
    });
    ['pointerup','pointercancel','pointerleave'].forEach(t=>canvas.addEventListener(t,lpCancel));
  }
  function render(){if(ui.renderRAF){cancelAnimationFrame(ui.renderRAF);ui.renderRAF=0;}if(!ui.open)return;const d=D(),sc=SC();if(!d||!sc){close();return;}
    ui.sceneId=sc.id;if(!sc.layers.some(l=>l.id===ui.layerId))ui.layerId=(sc.layers.find(l=>l.type!=='folder')||sc.layers[0]).id;
    ui.frame=A.frameBound(sc,ui.frame);renderHeader();renderTools();renderBottom();fitCanvas();draw();
  }
  function renderHeader(){
    const d=D(),sc=SC(); if(!sc)return;
    const sel=$('#anScene');sel.innerHTML='';d.scenes.forEach(s=>sel.appendChild(el('option',{value:s.id,text:s.name})));sel.value=sc.id;
    $('#anDocSize').textContent=d.width+' × '+d.height+' · '+d.fps+' fps';$('#anUndo').disabled=!S.history.undo.length;$('#anRedo').disabled=!S.history.redo.length;
    $('#anOnion').classList.toggle('on',ui.onion);$('#anGrid').classList.toggle('on',ui.grid||ui.guides);$('#anMeshReset').classList.toggle('hidden',ui.tool!=='meshwarp'||!ui.selected.size);
    $$('#anTabs button').forEach(b=>b.classList.toggle('active',b.dataset.panel===ui.panel));
    $('#anStageBadge').textContent=Math.round(ui.zoom*100)+'%';
  }
  function renderTools(){
    const box=$('#anTools');box.innerHTML='';TOOLS.forEach(t=>{
      const b=el('button',{class:'an-tool'+(ui.tool===t[0]?' active':''),title:t[3],dataset:{tool:t[0]},'aria-label':t[2]},[
        el('span',{class:'an-tool-icon',text:t[1]}),el('small',{text:t[2]})]);
      b.onclick=()=>setTool(t[0]);box.appendChild(b);
    });
  }
  function setTool(id){if(ui.pen&&id!=='pen')finishPen();ui.tool=id;renderTools();const t=TOOLS.find(x=>x[0]===id);if(t){U.status(t[3],null,true);const b=$('#anTools [data-tool="'+id+'"]');if(b&&b.scrollIntoView)b.scrollIntoView({block:'nearest',inline:'nearest'});}if(ui.panel==='properties')renderBottom();renderHeader();draw();}
  function toolMenu(anchor){U.dropdown(anchor,TOOLS.map(t=>({label:t[2]+' — '+t[3],checked:ui.tool===t[0],action:()=>setTool(t[0])})));}
  function fitCanvas(){
    if(!ui.open)return;const d=D(),v=$('#anView'),wrap=$('#anCanvasWrap'),c=$('#anCanvas');if(!d||!v||!c)return;
    const s=Math.max(.001,Math.min((v.clientWidth-24)/d.width,(v.clientHeight-24)/d.height));
    const cssW=Math.max(1,d.width*s),cssH=Math.max(1,d.height*s);
    wrap.style.width=cssW+'px';wrap.style.height=cssH+'px';
    wrap.style.transform='translate('+ui.panX+'px,'+ui.panY+'px) rotate('+ui.viewRot+'deg) scale('+ui.zoom+')';
    // Разрешение документа и экспорта не меняется. Рабочий предпросмотр
    // ограничен реальным размером экрана, чтобы не перерисовывать 2 млн пикселей на каждое движение.
    const pixelRatio=Math.min(2,window.devicePixelRatio||1),r=Math.min(1,Math.max(.05,s*ui.zoom*pixelRatio));
    const pw=Math.max(1,Math.round(d.width*r)),ph=Math.max(1,Math.round(d.height*r));
    if(c.width!==pw||c.height!==ph){c.width=pw;c.height=ph;}
    $('#anStageBadge').textContent=Math.round(ui.zoom*100)+'%';
  }
  function requestDraw(){if(ui.drawRAF||!ui.open)return;ui.drawRAF=requestAnimationFrame(()=>{ui.drawRAF=0;if(ui.open)draw();});}
  function stagePoint(e){
    const d=D(),c=$('#anCanvas'),r=c.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2;
    const x=(e.clientX-cx)/ui.zoom,y=(e.clientY-cy)/ui.zoom,a=-ui.viewRot*Math.PI/180;
    const dx=x*Math.cos(a)-y*Math.sin(a),dy=x*Math.sin(a)+y*Math.cos(a);
    return {x:d.width/2+dx*d.width/Math.max(1,c.offsetWidth),y:d.height/2+dy*d.height/Math.max(1,c.offsetHeight)};
  }
  function pos(e){return A.worldFromStage(stagePoint(e),SC(),D(),ui.frame);}
  function draw(){
    if(!ui.open)return;const d=D(),sc=SC(),c=$('#anCanvas'),x=c.getContext('2d'); if(!sc)return;
    x.setTransform(1,0,0,1,0,0);x.clearRect(0,0,c.width,c.height);x.setTransform(c.width/d.width,0,0,c.height/d.height,0,0);
    if(ui.onion){const ghost=Object.assign({},sc,{background:null});x.save();x.globalAlpha=.19;if(ui.frame>0)A.drawAt(x,d,ghost,ui.frame-1,{guides:true});if(ui.frame<sc.frames-1)A.drawAt(x,d,ghost,ui.frame+1,{guides:true});x.restore();}
    A.drawAt(x,d,sc,ui.frame,{guides:true});
    const l=L();if(l&&l.type==='mask'&&l.visible){x.save();A.applyCamera(x,sc,d,ui.frame);x.globalAlpha=.55;A.objectsAt(l,ui.frame).forEach(o=>A.drawObject(x,o));x.restore();}
    x.save();A.applyCamera(x,sc,d,ui.frame);
    const scale=d.width/Math.max(1,c.offsetWidth)/ui.zoom/(A.cameraAt(sc,d,ui.frame).zoom||1); x.lineWidth=Math.max(1,scale*1.1);
    if(ui.grid){x.save();x.strokeStyle='rgba(205,255,247,.25)';x.beginPath();const step=Math.max(20,Math.round(d.width/20/10)*10);for(let gx=step;gx<d.width;gx+=step){x.moveTo(gx,0);x.lineTo(gx,d.height);}for(let gy=step;gy<d.height;gy+=step){x.moveTo(0,gy);x.lineTo(d.width,gy);}x.stroke();x.restore();}
    if(ui.guides){x.save();x.setLineDash([8*scale,5*scale]);x.strokeStyle='#4fead6';x.beginPath();x.moveTo(d.width/2,0);x.lineTo(d.width/2,d.height);x.moveTo(0,d.height/2);x.lineTo(d.width,d.height/2);x.stroke();x.restore();}
    currentSelection().forEach(o=>{
      x.save();x.translate(o.x+o.w/2,o.y+o.h/2);x.rotate((o.rotation||0)*Math.PI/180);x.translate(-o.w/2,-o.h/2);
      x.strokeStyle='#68f0df';x.lineWidth=Math.max(1,scale*1.25);x.setLineDash([5*scale,3*scale]);x.strokeRect(0,0,o.w,o.h);x.setLineDash([]);
      const h=8*scale;x.fillStyle='#ffffff';x.strokeStyle='#1bb9a6';
      if(ui.tool==='meshwarp'){
        const g=A.validWarp(o.warp)?o.warp:A.makeWarp(4,4);x.strokeStyle='rgba(105,240,223,.88)';x.lineWidth=1.3*scale;
        for(let row=0;row<g.rows;row++){x.beginPath();for(let col=0;col<g.cols;col++){const p=g.points[row*g.cols+col];col?x.lineTo(p.x*o.w,p.y*o.h):x.moveTo(p.x*o.w,p.y*o.h);}x.stroke();}
        for(let col=0;col<g.cols;col++){x.beginPath();for(let row=0;row<g.rows;row++){const p=g.points[row*g.cols+col];row?x.lineTo(p.x*o.w,p.y*o.h):x.moveTo(p.x*o.w,p.y*o.h);}x.stroke();}
        g.points.forEach(p=>{x.beginPath();x.arc(p.x*o.w,p.y*o.h,4.5*scale,0,Math.PI*2);x.fillStyle='#fff';x.fill();x.strokeStyle='#009e91';x.stroke();});
      }else if(ui.tool==='select'||ui.tool==='transform'){
        [[0,0],[.5,0],[1,0],[1,.5],[1,1],[.5,1],[0,1],[0,.5]].forEach(p=>{x.fillRect(p[0]*o.w-h/2,p[1]*o.h-h/2,h,h);x.strokeRect(p[0]*o.w-h/2,p[1]*o.h-h/2,h,h);});
      }
      if((ui.tool==='subselect'||ui.tool==='warp')&&o.type==='path'&&o.points){x.fillStyle='#ffca6d';o.points.forEach(p=>{x.beginPath();x.arc(p.x*o.w,p.y*o.h,3.3*scale,0,Math.PI*2);x.fill();});}
      if(o.bone){x.strokeStyle='#ffd774';x.lineWidth=2*scale;x.beginPath();x.moveTo(o.bone.a.x*o.w,o.bone.a.y*o.h);x.lineTo(o.bone.b.x*o.w,o.bone.b.y*o.h);x.stroke();[o.bone.a,o.bone.b].forEach(p=>{x.beginPath();x.arc(p.x*o.w,p.y*o.h,4*scale,0,Math.PI*2);x.fillStyle='#ffd774';x.fill();});}
      x.restore();
    });
    if(ui.drag && ui.drag.kind==='lasso' && ui.drag.points.length){x.save();x.strokeStyle='#70e8d9';x.lineWidth=2*scale;x.setLineDash([5*scale,4*scale]);x.beginPath();ui.drag.points.forEach((p,i)=>i?x.lineTo(p.x,p.y):x.moveTo(p.x,p.y));x.stroke();x.restore();}
    if(ui.drag && ui.drag.kind==='eraser' && ui.drag.points.length){x.save();x.strokeStyle='rgba(255,255,255,.7)';x.lineWidth=ui.width*2;x.lineCap='round';x.beginPath();ui.drag.points.forEach((p,i)=>i?x.lineTo(p.x,p.y):x.moveTo(p.x,p.y));x.stroke();x.restore();}
    x.restore();
    const count=sc.layers.some(q=>A.objectsAt(q,ui.frame).length>0);$('#anEmpty').classList.toggle('hidden',count||!!ui.drag);
  }
  function layerObjects(l){return A.objectsAt(l,ui.frame);}
  function hitObject(p){const sc=SC();for(const l of sc.layers){if(!A.isVisible(sc,l)||l.locked||l.type==='folder')continue;
      const objs=layerObjects(l);for(let i=objs.length-1;i>=0;i--){const o=objs[i],q=A.objLocal(o,p),tol=12*D().width/Math.max(1,$('#anCanvas').offsetWidth)/ui.zoom/(A.cameraAt(sc,D(),ui.frame).zoom||1);
        const pts=A.validWarp(o.warp)?o.warp.points:null,minx=pts?Math.min(0,...pts.map(v=>v.x))*o.w:0,maxx=pts?Math.max(1,...pts.map(v=>v.x))*o.w:o.w,miny=pts?Math.min(0,...pts.map(v=>v.y))*o.h:0,maxy=pts?Math.max(1,...pts.map(v=>v.y))*o.h:o.h;
        if(q.x < minx-tol || q.y < miny-tol || q.x > maxx+tol || q.y > maxy+tol)continue;
        if(!A.hasWarp(o.warp)&&o.type==='oval'&&Math.pow((q.x-o.w/2)/(o.w/2+tol),2)+Math.pow((q.y-o.h/2)/(o.h/2+tol),2)>1)continue;
        return {o,l};}}
    return null;}
  function toLocalNorm(o,p){const q=A.objLocal(o,p);return {x:q.x/Math.max(1,o.w),y:q.y/Math.max(1,o.h)};}
  function ensureEditable(){const l=L();if(!l||l.type==='folder'||l.locked||!l.visible){U.toast('Выберите видимый незаблокированный слой','warn');return null;}return A.editKey(l,ui.frame);}
  function ptrCapture(e){try{e.currentTarget.setPointerCapture(e.pointerId);}catch(err){}}
  function newObject(type,p){return A.makeObject(type,p.x,p.y,1,1,{fill:ui.fill,fill2:ui.fill2,stroke:ui.stroke,strokeWidth:ui.width,fontSize:D().width*.05});}
  function measureTextObject(o){const c=document.createElement('canvas').getContext('2d'),size=Math.max(1,o.fontSize||80);c.font=(o.bold?'bold ':'')+size+'px '+(o.font||'Arial');
    const lines=String(o.text||'Текст').split('\n');o.w=Math.max(1,...lines.map(line=>c.measureText(line).width*(o.textScaleX||1)));o.h=Math.max(1,size*(.99+Math.max(0,lines.length-1)*1.2));}
  function nearestHandle(o,q,tol){
    const hs=[[-1,-1],[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0]];let best=null,dist=Infinity;
    hs.forEach(v=>{const x=(v[0]+1)*o.w/2,y=(v[1]+1)*o.h/2,d=Math.hypot(q.x-x,q.y-y);if(d<tol&&d<dist){best=v;dist=d;}});return best;
  }
  function selectedHandleHit(p,tool){
    if(!['select','transform','meshwarp'].includes(tool))return null;
    const layer=L();if(!layer||layer.locked||!A.isVisible(SC(),layer))return null;
    const tol=14*D().width/Math.max(1,$('#anCanvas').offsetWidth)/ui.zoom/(A.cameraAt(SC(),D(),ui.frame).zoom||1);
    for(const o of currentSelection()){const q=A.objLocal(o,p);
      if((tool==='select'||tool==='transform')&&nearestHandle(o,q,tol))return {o,l:layer};
      if(tool==='meshwarp'){const g=A.validWarp(o.warp)?o.warp:A.makeWarp(4,4);if(g.points.some(v=>Math.hypot(v.x*o.w-q.x,v.y*o.h-q.y)<tol*1.4))return {o,l:layer};}
    }return null;
  }
  function pointerDown(e){
    if(e.button!==0||ui.drag)return; e.preventDefault(); const p=pos(e),stage=stagePoint(e),tool=ui.tool;let hit=selectedHandleHit(p,tool)||hitObject(p);
    ui.pointerId=e.pointerId;ptrCapture(e);
    if(tool==='hand'||tool==='rotate'){ui.drag={kind:tool,startClient:{x:e.clientX,y:e.clientY},panX:ui.panX,panY:ui.panY,rot:ui.viewRot};return;}
    if(tool==='zoom'){ui.zoom=clamp(ui.zoom*(e.shiftKey?.8:1.25),.35,5);fitCanvas();draw();return;}
    if(tool==='camera'){S.begin('Камера');const cam=A.ensureCamera(SC(),D(),ui.frame);ui.drag={kind:'camera',start:stage,cam,ox:cam.x,oy:cam.y};return;}
    if(tool==='lasso'){ui.selected.clear();ui.drag={kind:'lasso',points:[p]};draw();return;}
    if(tool==='dropper'){if(hit){ui.fill=hit.o.fill||ui.fill;ui.stroke=hit.o.stroke||ui.stroke;$('#anFill').value=ui.fill;$('#anStroke').value=ui.stroke;U.toast('Цвета объекта скопированы');}else U.toast('Нажмите на объект','warn');return;}
    if(tool==='bucket'||tool==='ink'){
      S.change(tool==='bucket'?'Заливка':'Обводка',()=>{if(hit){ui.layerId=hit.l.id;ui.selected=new Set([hit.o.id]);const k=ensureEditable(),o=k&&k.objects.find(q=>q.id===hit.o.id);if(o){if(tool==='bucket'){o.fill=ui.fill;delete o.gradient;}else{o.stroke=ui.stroke;o.strokeWidth=ui.width;}}}else if(tool==='bucket')SC().background=ui.fill;});render();return;
    }
    if(tool==='eraser'){S.begin('Ластик');if(!ensureEditable()){S.end();return;}ui.drag={kind:'eraser',points:[p]};draw();return;}
    if(tool==='pen'){penClick(p);return;}
    if(['rect','oval','star','text','button','input','brush','fluid','pencil'].includes(tool)){
      S.begin('Рисование: '+tool);const k=ensureEditable();if(!k){S.end();return;}
      const type=['brush','fluid','pencil'].includes(tool)?'path':tool, o=newObject(type,p);
      o.mode=ui.mode;if(type==='path'){o.fill='transparent';o.stroke=ui.stroke;o.points=[{x:0,y:0,p:e.pressure||.5}];o.closed=false;o.smooth=tool==='brush'||tool==='fluid';o.variable=tool==='fluid';}
      if(type==='text'){o.text='Текст';o.strokeWidth=0;measureTextObject(o);}
      if(type==='button'){o.text='Нажмите';o.action='toggle';o.textColor='#ffffff';}
      if(type==='input'){o.text='Введите текст';o.textColor='#ffffff';}
      k.objects.push(o);ui.selected=new Set([o.id]);
      ui.drag={kind:type==='path'?'drawpath':'shape',start:p,points:[{x:p.x,y:p.y,p:e.pressure||.5}],object:o,moved:false};draw();return;
    }
    if(['select','transform','subselect','warp','meshwarp','width','gradient','bone','bind'].includes(tool)){
      if(!hit){ui.selected.clear();renderHeader();draw();if(ui.panel==='timeline')refreshTimeline();else renderBottom();return;}
      ui.layerId=hit.l.id;if(e.shiftKey&&tool==='select'){if(ui.selected.has(hit.o.id))ui.selected.delete(hit.o.id);else ui.selected.add(hit.o.id);}else if(!ui.selected.has(hit.o.id)){ui.selected=new Set([hit.o.id]);}
      const o=hit.o,local=A.objLocal(o,p),tol=14*D().width/Math.max(1,$('#anCanvas').offsetWidth)/ui.zoom/(A.cameraAt(SC(),D(),ui.frame).zoom||1);
      let kind='move',pointIndex=-1,handle=null;
      if(tool==='transform'||tool==='select'){handle=nearestHandle(o,local,tol);if(handle)kind='resize';}
      if(tool==='meshwarp'){const g=A.validWarp(o.warp)?o.warp:A.makeWarp(4,4);let best=Infinity;g.points.forEach((pt,i)=>{const dist=Math.hypot(pt.x*o.w-local.x,pt.y*o.h-local.y);if(dist<best){best=dist;pointIndex=i;}});if(best<tol*1.4)kind='meshwarp';else pointIndex=-1;}
      if(tool==='subselect'||tool==='warp'){
        if(o.type==='path'&&o.points&&o.points.length){let best=Infinity;o.points.forEach((q,i)=>{const dist=Math.hypot(q.x*o.w-local.x,q.y*o.h-local.y);if(dist<best){best=dist;pointIndex=i;}});if(best<tol*2||tool==='warp')kind='node';}
        else if(tool==='warp')kind='warpShape';
      }
      if(tool==='width')kind='width';if(tool==='gradient')kind='gradient';if(tool==='bone')kind='bone';if(tool==='bind')kind='bind';
      if(kind==='bind'&&!o.bone){U.toast('Сначала проведите кость инструментом Bone','warn');draw();return;}
      ui.drag={kind,start:p,startClient:{x:e.clientX,y:e.clientY},objectId:o.id,original:A.clone(o),originals:currentSelection().map(A.clone),pointIndex,handle,began:false};
      draw();if(ui.panel==='timeline')refreshTimeline();else renderBottom();return;
    }
  }
  function beginDrag(){if(ui.drag.began)return true;S.begin('Изменение векторного объекта');const k=ensureEditable();if(!k){S.end();return false;}ui.drag.began=true;return true;}
  function pathUpdate(o,pts){let minx=Infinity,miny=Infinity,maxx=-Infinity,maxy=-Infinity;pts.forEach(p=>{minx=Math.min(minx,p.x);miny=Math.min(miny,p.y);maxx=Math.max(maxx,p.x);maxy=Math.max(maxy,p.y);});
    o.x=minx;o.y=miny;o.w=Math.max(1,maxx-minx);o.h=Math.max(1,maxy-miny);o.points=pts.map(p=>({x:(p.x-minx)/o.w,y:(p.y-miny)/o.h,p:p.p||.5}));}
  // Указатель может выдавать сотни событий в секунду: рисуем один раз за кадр.
  function queuePointerMove(e){if(!ui.drag||e.pointerId!==ui.pointerId)return;e.preventDefault();ui.pendingMove={clientX:e.clientX,clientY:e.clientY,pressure:e.pressure,preventDefault:()=>{}};
    if(!ui.moveRAF)ui.moveRAF=requestAnimationFrame(flushPointerMove);}
  function flushPointerMove(){if(ui.moveRAF)cancelAnimationFrame(ui.moveRAF);ui.moveRAF=0;const e=ui.pendingMove;ui.pendingMove=null;if(e&&ui.drag)pointerMove(e);}
  function pointerMove(e){
    const drag=ui.drag;if(!drag)return;e.preventDefault();const p=pos(e),stage=stagePoint(e);
    if(drag.kind==='hand'){ui.panX=drag.panX+e.clientX-drag.startClient.x;ui.panY=drag.panY+e.clientY-drag.startClient.y;fitCanvas();return;}
    if(drag.kind==='rotate'){ui.viewRot=drag.rot+(e.clientX-drag.startClient.x)*.6;fitCanvas();return;}
    if(drag.kind==='camera'){const c=drag.cam,z=c.zoom||1;c.x=drag.ox-(stage.x-drag.start.x)/z;c.y=drag.oy-(stage.y-drag.start.y)/z;draw();return;}
    if(drag.kind==='lasso'||drag.kind==='eraser'){const last=drag.points[drag.points.length-1],step=Math.max(1,D().width/Math.max(1,$('#anCanvas').offsetWidth)/ui.zoom*.7);if(Math.hypot(last.x-p.x,last.y-p.y)>step){drag.points.push(p);if(drag.points.length>2048)drag.points=drag.points.filter((_,i)=>i%2===0||i===drag.points.length-1);}draw();return;}
    if(drag.kind==='shape'){const o=drag.object;const dx=p.x-drag.start.x,dy=p.y-drag.start.y;if(Math.hypot(dx,dy)>4)drag.moved=true;
      if(o.type!=='text'){o.x=Math.min(drag.start.x,p.x);o.y=Math.min(drag.start.y,p.y);o.w=Math.max(1,Math.abs(dx));o.h=Math.max(1,Math.abs(dy));}draw();return;}
    if(drag.kind==='drawpath'){const prev=drag.points[drag.points.length-1],step=Math.max(1,D().width/Math.max(1,$('#anCanvas').offsetWidth)/ui.zoom*.7);if(Math.hypot(prev.x-p.x,prev.y-p.y)>step){drag.points.push({x:p.x,y:p.y,p:e.pressure||.5});if(drag.points.length>2048)drag.points=drag.points.filter((_,i)=>i%2===0||i===drag.points.length-1);pathUpdate(drag.object,drag.points);drag.moved=true;}draw();return;}
    const delta=Math.hypot(p.x-drag.start.x,p.y-drag.start.y);if(!drag.began && delta<2)return;if(!beginDrag())return;
    const k=A.keyAt(L(),ui.frame),o=k&&k.objects.find(x=>x.id===drag.objectId),orig=drag.original;if(!o)return;
    if(drag.kind==='move'){
      const dx=p.x-drag.start.x,dy=p.y-drag.start.y;drag.originals.forEach(v=>{const t=k.objects.find(q=>q.id===v.id);if(t){t.x=v.x+dx;t.y=v.y+dy;}});
    } else if(drag.kind==='resize'){
      const q=A.objLocal(orig,p),[hx,hy]=drag.handle||[1,1];
      const left=hx<0?Math.min(q.x,orig.w-2):0,right=hx>0?Math.max(q.x,2):orig.w;
      const top=hy<0?Math.min(q.y,orig.h-2):0,bottom=hy>0?Math.max(q.y,2):orig.h;
      const center=A.objWorld(orig,{x:(left+right)/2,y:(top+bottom)/2});o.w=right-left;o.h=bottom-top;o.x=center.x-o.w/2;o.y=center.y-o.h/2;
      if(orig.type==='text'){const sy=o.h/Math.max(1,orig.h),sx=o.w/Math.max(1,orig.w);o.fontSize=Math.max(1,(orig.fontSize||orig.h*.75)*sy);o.textScaleX=(orig.textScaleX||1)*sx/sy;}
    } else if(drag.kind==='meshwarp'){
      if(!A.validWarp(o.warp))o.warp=A.makeWarp(4,4);const q=toLocalNorm(orig,p);o.warp.points[drag.pointIndex]={x:clamp(q.x,-3,4),y:clamp(q.y,-3,4)};
    } else if(drag.kind==='width')o.strokeWidth=clamp(orig.strokeWidth+(drag.start.y-p.y)*.18,1,300);
    else if(drag.kind==='gradient'){const a=toLocalNorm(orig,drag.start),b=toLocalNorm(orig,p);o.gradient={x1:a.x,y1:a.y,x2:b.x,y2:b.y};o.fill2=ui.fill2;}
    else if(drag.kind==='node'){
      const q=toLocalNorm(orig,p);if(o.points&&o.points[drag.pointIndex]){o.points[drag.pointIndex].x=q.x;o.points[drag.pointIndex].y=q.y;}
    } else if(drag.kind==='warpShape'){
      if(o.type!=='path'){o.points=A.outline(orig,24);o.type='path';o.closed=true;let best=Infinity;const q=toLocalNorm(orig,drag.start);o.points.forEach((pt,i)=>{const d=Math.hypot((pt.x-q.x)*o.w,(pt.y-q.y)*o.h);if(d<best){best=d;drag.pointIndex=i;}});}
      const q=toLocalNorm(orig,p);o.points[drag.pointIndex].x=q.x;o.points[drag.pointIndex].y=q.y;
    } else if(drag.kind==='bone')o.bone={a:toLocalNorm(orig,drag.start),b:toLocalNorm(orig,p)};
    else if(drag.kind==='bind'){
      const anchor=A.objWorld(orig,{x:orig.bone.a.x*orig.w,y:orig.bone.a.y*orig.h});
      const a0=Math.atan2(drag.start.y-anchor.y,drag.start.x-anchor.x),a1=Math.atan2(p.y-anchor.y,p.x-anchor.x);
      o.rotation=orig.rotation+(a1-a0)*180/Math.PI;const after=A.objWorld(o,{x:o.bone.a.x*o.w,y:o.bone.a.y*o.h});o.x+=anchor.x-after.x;o.y+=anchor.y-after.y;
    }
    draw();
  }
  function pointInPolygon(p,poly){let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if(((a.y>p.y)!==(b.y>p.y))&&(p.x<(b.x-a.x)*(p.y-a.y)/((b.y-a.y)||1e-9)+a.x))inside=!inside;}return inside;}
  function applyEraser(points){const k=A.keyAt(L(),ui.frame);if(!k)return;const rad=ui.width*1.3;
    k.objects.forEach(o=>{const local=points.map(p=>toLocalNorm(o,p));const near=local.some(q=>q.x>=-rad/o.w&&q.x<=1+rad/o.w&&q.y>=-rad/o.h&&q.y<=1+rad/o.h);
      if(near){o.cuts=o.cuts||[];o.cuts.push({kind:'stroke',points:local,radius:rad/Math.max(1,Math.min(o.w,o.h))});}});
  }
  function mergeOverlaps(newObj,k){
    if(ui.mode!=='merge'||newObj.type==='path'||newObj.type==='text'||newObj.type==='button'||newObj.type==='input')return;
    const poly=A.outline(newObj,32).map(q=>A.objWorld(newObj,{x:q.x*newObj.w,y:q.y*newObj.h}));
    k.objects.forEach(o=>{if(o.id===newObj.id||o.mode!=='merge')return;
      if(o.x>newObj.x+newObj.w||o.x+o.w<newObj.x||o.y>newObj.y+newObj.h||o.y+o.h<newObj.y)return;
      o.cuts=o.cuts||[];o.cuts.push({kind:'polygon',points:poly.map(p=>toLocalNorm(o,p))});});
  }
  function pointerUp(e){
    const drag=ui.drag;if(!drag||e.pointerId!==ui.pointerId)return;e.preventDefault();flushPointerMove();if(e.type!=='pointercancel')pointerMove(e);
    if(drag.kind==='lasso'){
      if(drag.points.length>=3){const sc=SC();const found=[];sc.layers.forEach(l=>{if(l.type==='folder'||l.locked||!A.isVisible(sc,l))return;layerObjects(l).forEach(o=>{if(pointInPolygon({x:o.x+o.w/2,y:o.y+o.h/2},drag.points))found.push({o,l});});});
        if(found.length){ui.layerId=found[0].l.id;ui.selected=new Set(found.filter(x=>x.l.id===ui.layerId).map(x=>x.o.id));}}
    } else if(drag.kind==='eraser'){applyEraser(drag.points);S.end();}
    else if(drag.kind==='camera'){S.end();}
    else if(drag.kind==='shape'){
      const o=drag.object;if(!drag.moved&&o.type!=='text'){o.w=D().width*(o.type==='button'||o.type==='input'?.22:.18);o.h=D().height*(o.type==='button'||o.type==='input'?.1:.2);}
      mergeOverlaps(o,A.keyAt(L(),ui.frame));S.end();if(o.type==='text'||o.type==='button'||o.type==='input')ui.panel='properties';
    } else if(drag.kind==='drawpath'){if(!drag.moved){drag.object.w=drag.object.h=Math.max(1,ui.width);drag.object.points=[{x:.5,y:.5},{x:.51,y:.51}];}S.end();}
    else if(drag.began)S.end();
    ui.drag=null;ui.pointerId=null;renderAfterDrag();
  }
  function penClick(p){
    if(!ui.pen){S.begin('Контур пером');const k=ensureEditable();if(!k){S.end();return;}const o=newObject('path',p);o.fill='transparent';o.stroke=ui.stroke;o.closed=false;o.points=[{x:0,y:0}];k.objects.push(o);ui.selected=new Set([o.id]);ui.pen={object:o,points:[{x:p.x,y:p.y,p:.5}]};U.toast('Перо: добавляйте узлы, Enter или двойной клик — завершить',null,4500);}
    else{ui.pen.points.push({x:p.x,y:p.y,p:.5});pathUpdate(ui.pen.object,ui.pen.points);}draw();
  }
  function finishPen(){if(!ui.pen)return;const pen=ui.pen;if(pen.points.length<2){const k=A.keyAt(L(),ui.frame);if(k)k.objects=k.objects.filter(o=>o.id!==pen.object.id);}ui.pen=null;S.end();render();}
  // При завершении штриха обновляем только строку текущего слоя вместо
  // пересоздания тысяч ячеек большого таймлайна.
  function refreshTimeline(){const scroll=$('#anTimelineScroll');if(!scroll)return;
    $$('.an-tl-row',scroll).forEach(row=>{const label=$('.an-layer-label[data-layer]',row);if(!label)return;const id=label.dataset.layer,active=id===ui.layerId;row.classList.toggle('selected',active);label.classList.toggle('active',active);if(!active)return;
      const l=L(),keys=A.sortedKeys(l),cells=$$('.an-frame-cell',row);let k=0;
      cells.forEach(cell=>{const f=Number(cell.dataset.f);while(k+1<keys.length&&keys[k+1].frame<=f)k++;const prev=keys[k]&&keys[k].frame<=f?keys[k]:null,exact=prev&&prev.frame===f?prev:null,next=prev?keys[k+1]:keys[0];
        cell.classList.toggle('tween',!!(prev&&next&&prev.tween&&prev.tween!=='hold'));cell.classList.toggle('key',!!exact);cell.classList.toggle('blank',!!(exact&&!exact.objects.length));
        cell.textContent=exact?(exact.objects.length?'◆':'○'):'';cell.title=l.name+' · кадр '+(f+1)+(exact?' · ключ':'');});
    });const sel=$('#anTween',scroll.parentElement),key=L()&&A.keyAt(L(),ui.frame);if(sel)sel.value=key&&key.tween||'hold';}
  function refreshFrameHighlights(){const scroll=$('#anTimelineScroll');if(!scroll)return;
    $$('.an-frame-head.active,.an-frame-cell.active',scroll).forEach(cell=>cell.classList.remove('active'));
    $$('[data-f="'+ui.frame+'"]',scroll).forEach(cell=>cell.classList.add('active'));
    const number=$('.an-frame-num',$('#anBottom'));if(number)number.textContent=(ui.frame+1)+' / '+SC().frames;
    const sel=$('#anTween',scroll.parentElement),key=L()&&A.keyAt(L(),ui.frame);if(sel)sel.value=key&&key.tween||'hold';
  }
  function renderAfterDrag(){if(ui.renderRAF){cancelAnimationFrame(ui.renderRAF);ui.renderRAF=0;}if(!ui.open)return;renderHeader();if(ui.panel==='timeline')refreshTimeline();else renderBottom();draw();}
  function renderBottom(){
    if(!ui.open)return;const box=$('#anBottom');if(!box)return;const oldScroll=$('#anTimelineScroll',box);const scrollX=oldScroll?oldScroll.scrollLeft:0,scrollY=oldScroll?oldScroll.scrollTop:0;box.innerHTML='';
    ({timeline:timelinePanel,layers:layersPanel,properties:propertiesPanel,sprite:spritePanel,library:libraryPanel,project:projectPanel,actions:actionsPanel}[ui.panel]||timelinePanel)(box);
    const newScroll=$('#anTimelineScroll',box);if(newScroll){newScroll.scrollLeft=scrollX;newScroll.scrollTop=scrollY;}
    $$('#anTabs button').forEach(b=>b.classList.toggle('active',b.dataset.panel===ui.panel));
  }
  function spritePanel(box){ if(PPE.sprite) PPE.sprite.panel(box); else box.appendChild(el('div',{class:'an-note',text:'Модуль настроек спрайтов не загружен'})); }
  function small(label,title,fn,active){return el('button',{class:'an-btn'+(active?' on':''),title:title||label,text:label,onclick:fn});}
  function toolbar(box){const n=el('div',{class:'an-bar'});box.appendChild(n);return n;}
  function timelinePanel(box){
    const sc=SC(),l=L(),bar=toolbar(box);
    bar.appendChild(small(ui.playing?'❚❚':'▶','Воспроизведение / пауза',togglePlay,ui.playing));
    bar.appendChild(small('‹','Кадр назад',()=>setFrame(ui.frame-1)));bar.appendChild(small('›','Кадр вперёд',()=>setFrame(ui.frame+1)));
    bar.appendChild(el('span',{class:'an-frame-num',text:(ui.frame+1)+' / '+sc.frames}));
    bar.appendChild(small('+ кадр','Вставить удерживаемый кадр',insertFrame));
    bar.appendChild(small('◆ ключ','Добавить ключевой кадр',()=>addKey(false)));
    bar.appendChild(small('○ пустой','Пустой ключевой кадр',()=>addKey(true)));
    bar.appendChild(small('+ слой','Добавить слой',e=>layerMenu(e.currentTarget)));
    bar.appendChild(small('⋯','Дополнительные операции',e=>timelineMenu(e.currentTarget)));
    const sub=el('div',{class:'an-tween-row'},[
      el('span',{text:'Межкадровая анимация'}),
      el('select',{id:'anTween','aria-label':'Тип интерполяции'},[
        el('option',{value:'hold',text:'Нет (кадр за кадром)'}),el('option',{value:'motion',text:'Motion Tween · движение'}),
        el('option',{value:'classic',text:'Classic Tween · плавно'}),el('option',{value:'shape',text:'Shape Tween · форма'})
      ]),el('span',{class:'an-tween-hint',text:'Нужны два ключа'})]);box.appendChild(sub);
    const exact=l&&A.keyAt(l,ui.frame),tween=$('#anTween',box);tween.value=exact&&exact.tween||'hold';
    tween.onchange=()=>setTween(tween.value);
    const scroll=el('div',{class:'an-timeline-scroll',id:'anTimelineScroll'}),rows=el('div',{class:'an-timeline-grid'});
    const width=26;
    const ruler=el('div',{class:'an-tl-row an-ruler'});ruler.appendChild(el('div',{class:'an-layer-label sticky',text:'СЛОИ / КАДРЫ'}));
    for(let f=0;f<sc.frames;f++)ruler.appendChild(el('button',{class:'an-frame-head'+(f===ui.frame?' active':''),dataset:{f:String(f)},text:(f===0||(f+1)%5===0?String(f+1):'·'),title:'Кадр '+(f+1)}));rows.appendChild(ruler);
    sc.layers.forEach(lay=>{
      const row=el('div',{class:'an-tl-row'+(lay.id===ui.layerId?' selected':'')});
      const label=el('button',{class:'an-layer-label sticky'+(lay.id===ui.layerId?' active':''),title:lay.name,dataset:{layer:lay.id},text:(lay.type==='mask'?'◩ ':lay.type==='guide'?'⋯ ':lay.type==='folder'?'▸ ':'◫ ')+lay.name});
      row.appendChild(label);const keys=A.sortedKeys(lay);
      for(let f=0;f<sc.frames;f++){
        const exactKey=keys.find(k=>k.frame===f),prev=keys.filter(k=>k.frame<=f).pop(),next=keys.find(k=>k.frame>f);
        const tweening=prev&&next&&prev.tween&&prev.tween!=='hold';
        row.appendChild(el('button',{class:'an-frame-cell'+(f===ui.frame?' active':'')+(tweening?' tween':'')+(exactKey?' key':'')+(exactKey&&!exactKey.objects.length?' blank':''),dataset:{f:String(f),layer:lay.id},title:lay.name+' · кадр '+(f+1)+(exactKey?' · ключ':''),text:exactKey?(exactKey.objects.length?'◆':'○'):''}));
      }rows.appendChild(row);
    });
    scroll.appendChild(rows);box.appendChild(scroll);
    /* Ключевой кадр: наведение подсвечивает ромб (CSS), а зажатие или правый
       клик открывает меню самого ключа — кривые, настройки кривых, перенос на
       другой спрайт. */
    let kfTimer=0,kfFired=false;
    const openCellMenu=(cell,x,y)=>{
      if(!PPE.sprite)return;
      PPE.sprite.keyMenu(x,y,{layerId:cell.dataset.layer,frame:parseInt(cell.dataset.f,10)});
      /* Глушим «хвостовой» клик после долгого нажатия, иначе меню тут же закроется. */
      const kill=e=>{e.stopPropagation();e.preventDefault();};
      document.addEventListener('click',kill,true);
      setTimeout(()=>document.removeEventListener('click',kill,true),700);
    };
    scroll.addEventListener('pointerdown',e=>{
      const cell=e.target.closest('.an-frame-cell.key'); if(!cell)return;
      kfFired=false; clearTimeout(kfTimer);
      kfTimer=setTimeout(()=>{
        const r=cell.getBoundingClientRect(); kfFired=true;
        openCellMenu(cell,r.left+6,r.bottom+4);
        if(navigator.vibrate){try{navigator.vibrate(12);}catch(err){}}
      },460);
    });
    ['pointerup','pointercancel'].forEach(t=>scroll.addEventListener(t,()=>clearTimeout(kfTimer)));
    scroll.addEventListener('contextmenu',e=>{
      const cell=e.target.closest('.an-frame-cell.key'); if(!cell)return;
      e.preventDefault(); clearTimeout(kfTimer);
      openCellMenu(cell,e.clientX,e.clientY);
    });
    scroll.addEventListener('click',e=>{
      if(kfFired){kfFired=false;return;}
      const b=e.target.closest('[data-f],[data-layer]');if(!b)return;if(b.dataset.layer){ui.layerId=b.dataset.layer;ui.selected.clear();}if(b.dataset.f!=null){ui.frame=A.frameBound(sc,parseInt(b.dataset.f,10));}draw();renderBottom();});
  }
  function insertFrame(){const sc=SC();S.change('Вставить кадр',()=>{if(sc.frames>=360){U.toast('Ограничение: 360 кадров','warn');return;}sc.frames++;sc.layers.forEach(l=>(l.keys||[]).forEach(k=>{if(k.frame>ui.frame)k.frame++;}));(sc.camera||[]).forEach(k=>{if(k.frame>ui.frame)k.frame++;});(sc.sounds||[]).forEach(s=>{if(s.frame>ui.frame)s.frame++;});});render();}
  function addKey(blank){const l=L();if(!l||l.type==='folder'||l.locked){U.toast('Выберите незаблокированный слой','warn');return;}S.change(blank?'Пустой ключевой кадр':'Ключевой кадр',()=>A.ensureKey(l,ui.frame,blank,true));if(blank)ui.selected.clear();render();}
  function setTween(kind){const l=L();if(!l||l.locked||l.type==='folder'){U.toast('Выберите слой','warn');return;}
    S.change('Интерполяция',()=>{const k=A.ensureKey(l,ui.frame,false);k.tween=kind;});render();
    if(kind!=='hold'&&!A.sortedKeys(L()).some(k=>k.frame>ui.frame))U.toast('Добавьте следующий ключевой кадр и измените объект','warn',4200);
  }
  function timelineMenu(anchor){U.dropdown(anchor,[
    {label:'Вставить 12 кадров',action:()=>{const sc=SC();S.change('Добавить 12 кадров',()=>{sc.frames=Math.min(360,sc.frames+12);});render();}},
    {label:'Удалить ключ на текущем кадре',action:()=>{const l=L();if(!l||l.locked)return;S.change('Удалить ключ',()=>{l.keys=l.keys.filter(k=>k.frame!==ui.frame);if(!l.keys.length)l.keys=[{frame:0,objects:[],tween:'hold'}];});ui.selected.clear();render();}},
    {label:'Настроить длительность и FPS…',action:sceneSettings},
    {label:'Луковичное шелушение',checked:ui.onion,action:()=>{ui.onion=!ui.onion;render();}}
  ]);}
  function setFrame(f){if(ui.pen)finishPen();const sc=SC();ui.frame=A.frameBound(sc,f);draw();if(ui.panel==='timeline')refreshFrameHighlights();else renderBottom();}
  function layerMenu(anchor){U.dropdown(anchor,[
    {label:'Обычный слой',action:()=>addLayer('normal')},{label:'Папка слоёв',action:()=>addLayer('folder')},
    {label:'Направляющий слой',action:()=>addLayer('guide')},{label:'Маска для слоя ниже',action:()=>addLayer('mask')}
  ]);}
  function addLayer(type){const sc=SC();let n;S.change('Добавить слой',()=>{const names={normal:'Слой',folder:'Папка',guide:'Направляющие',mask:'Маска'};n=A.newLayer((names[type]||'Слой')+' '+(sc.layers.length+1),type);const i=sc.layers.findIndex(x=>x.id===ui.layerId);sc.layers.splice(Math.max(0,i),0,n);});ui.layerId=n.id;ui.selected.clear();render();}
  function layersPanel(box){
    const sc=SC(),bar=toolbar(box);bar.appendChild(small('+ Слой','Добавить слой',e=>layerMenu(e.currentTarget)));bar.appendChild(small('↑','Выше',()=>moveLayer(-1)));bar.appendChild(small('↓','Ниже',()=>moveLayer(1)));
    bar.appendChild(small('✎','Переименовать',renameLayer));bar.appendChild(small('Папка','Переместить в папку',folderMenu));bar.appendChild(small('Удалить','Удалить слой',deleteLayer));
    const list=el('div',{class:'an-layer-list'});box.appendChild(list);
    sc.layers.forEach(l=>{
      const row=el('div',{class:'an-layer-row'+(l.id===ui.layerId?' selected':'')});
      const eye=small(l.visible?'◉':'○','Видимость',e=>{e.stopPropagation();S.change('Видимость слоя',()=>l.visible=!l.visible);render();});
      const lock=small(l.locked?'🔒':'♧','Блокировка',e=>{e.stopPropagation();S.change('Блокировка слоя',()=>l.locked=!l.locked);render();});
      const name=el('button',{class:'an-layer-name',text:(l.parentId?'  ↳ ':'')+({normal:'◫',folder:'▸',guide:'⋯',mask:'◩'}[l.type]||'◫')+'  '+l.name,onclick:()=>{ui.layerId=l.id;ui.selected.clear();render();}});
      row.append(eye,lock,name,el('span',{class:'an-layer-type',text:({normal:'слой',folder:'папка',guide:'guide',mask:'mask'}[l.type]||l.type)}));list.appendChild(row);
    });
    list.appendChild(el('p',{class:'an-note',text:'Маска ограничивает видимость слоя непосредственно под ней. Направляющий слой виден только в редакторе.'}));
  }
  function moveLayer(d){const sc=SC(),i=sc.layers.findIndex(x=>x.id===ui.layerId),j=i+d;if(i<0||j<0||j>=sc.layers.length)return;S.change('Порядок слоёв',()=>{const t=sc.layers[i];sc.layers[i]=sc.layers[j];sc.layers[j]=t;});render();}
  function renameLayer(){const l=L();if(!l)return;U.modal({title:'Переименовать слой',body:'<div class="form-row"><label>Название</label><div class="form-control"><input id="anLayerName" value="'+esc(l.name)+'"></div></div>',buttons:[{label:'Отмена'},{label:'Сохранить',class:'primary',action:b=>{S.change('Имя слоя',()=>l.name=$('#anLayerName',b).value.trim()||l.name);render();}}]});}
  function folderMenu(e){const anchor=e.currentTarget,sc=SC(),l=L();if(!l)return;const folders=sc.layers.filter(q=>q.type==='folder'&&q.id!==l.id);U.dropdown(anchor,[
    {label:'Без папки',action:()=>{S.change('Переместить слой',()=>l.parentId=null);render();}},...folders.map(f=>({label:f.name,action:()=>{S.change('Переместить в папку',()=>l.parentId=f.id);render();}})),
    ...(!folders.length?[{label:'Сначала создайте папку',disabled:true}]:[])
  ]);}
  function deleteLayer(){const sc=SC(),l=L();if(!l)return;if(sc.layers.filter(q=>q.type!=='folder').length<=1&&l.type!=='folder'){U.toast('В сцене должен остаться хотя бы один слой','warn');return;}
    if(!confirm('Удалить слой «'+l.name+'» со всеми ключами?'))return;S.change('Удалить слой',()=>{sc.layers=sc.layers.filter(q=>q.id!==l.id);sc.layers.forEach(q=>{if(q.parentId===l.id)q.parentId=null;});});ui.layerId=(sc.layers.find(q=>q.type!=='folder')||sc.layers[0]).id;ui.selected.clear();render();}
  function propertiesPanel(box){
    const sc=SC(),o=activeObject(),bar=toolbar(box);
    bar.appendChild(small('Выровнять','Выравнивание',e=>alignMenu(e.currentTarget)));bar.appendChild(small('В библиотеку','Сохранить объект',saveAsset));
    bar.appendChild(small('Дублировать','Дублировать',duplicateSelected));bar.appendChild(small('Удалить','Удалить',deleteSelected));
    const body=el('div',{class:'an-props'});box.appendChild(body);
    if(!o || ui.tool==='camera'){body.appendChild(el('div',{class:'an-note',text:'Камера: перетащите вид на холсте или измените масштаб и поворот ниже.'}));
      const cam=A.cameraAt(sc,D(),ui.frame);appendProperty(body,'Камера · масштаб','cameraZoom',cam.zoom,'number',.01);
      appendProperty(body,'Камера · поворот','cameraRotation',cam.rotation,'number',1);bindProps(body);return;}
    body.appendChild(el('div',{class:'an-prop-title',text:({rect:'Прямоугольник',oval:'Овал',star:'Polystar',path:'Контур',text:'Текст',image:'Изображение',button:'Кнопка',input:'Поле ввода',mesh:'glTF-сетка'}[o.type]||o.type)+' · '+ui.selected.size+' выбрано'}));
    appendProperty(body,'X','x',Math.round(o.x),'number');appendProperty(body,'Y','y',Math.round(o.y),'number');
    appendProperty(body,'Ширина','w',Math.round(o.w),'number');appendProperty(body,'Высота','h',Math.round(o.h),'number');
    appendProperty(body,'Поворот','rotation',Math.round(o.rotation||0),'number');appendProperty(body,'Прозрачность %','opacity',Math.round((o.opacity==null?1:o.opacity)*100),'number');
    appendProperty(body,'Заливка','fill',/^#[0-9a-f]{6}$/i.test(o.fill)?o.fill:'#21d5c1','color');appendProperty(body,'Второй цвет','fill2',/^#[0-9a-f]{6}$/i.test(o.fill2)?o.fill2:'#687bff','color');
    appendProperty(body,'Обводка','stroke',/^#[0-9a-f]{6}$/i.test(o.stroke)?o.stroke:'#ffffff','color');appendProperty(body,'Толщина','strokeWidth',Math.round(o.strokeWidth||0),'number');
    if(['text','button','input'].includes(o.type)){appendProperty(body,'Текст','text',o.text||'','text');appendProperty(body,'Размер шрифта','fontSize',Math.round(o.fontSize||40),'number');}
    if(o.type==='star'){
      appendProperty(body,'Лучей / сторон','sides',o.sides||5,'number');
      const form=el('label',{class:'an-prop'},[el('span',{text:'Тип Polystar'}),el('select',{dataset:{prop:'polygon'}},[el('option',{value:'star',text:'Звезда'}),el('option',{value:'polygon',text:'Многоугольник'})])]);body.appendChild(form);$('select',form).value=o.polygon?'polygon':'star';
    }
    if(o.type==='button'){
      const label=el('label',{class:'an-prop'},[el('span',{text:'Действие кнопки'}),el('select',{dataset:{prop:'action'}},[
        el('option',{value:'toggle',text:'Пуск / пауза'}),el('option',{value:'goto',text:'Перейти к кадру'}),el('option',{value:'url',text:'Открыть ссылку'})])]);body.appendChild(label);$('select',label).value=o.action||'toggle';
      if(o.action==='goto')appendProperty(body,'Кадр (с 1)','actionFrame',(o.actionFrame||0)+1,'number');
      if(o.action==='url')appendProperty(body,'Ссылка https://','url',o.url||'','text');
    }
    body.appendChild(el('div',{class:'an-note',text:'Перемещайте объект инструментом «Выделение». Тяните боковые и угловые маркеры для изменения размера; инструмент «Сетка» деформирует объект по узлам.'}));bindProps(body);
  }
  function appendProperty(root,label,name,value,type,step){const row=el('label',{class:'an-prop'},[el('span',{text:label}),el('input',{type:type,value:String(value),step:step||'any',dataset:{prop:name}})]);root.appendChild(row);}
  function bindProps(body){$$('[data-prop]',body).forEach(n=>n.addEventListener('change',()=>{
    const name=n.dataset.prop;if(name==='cameraZoom'||name==='cameraRotation'){S.change('Свойства камеры',()=>{const c=A.ensureCamera(SC(),D(),ui.frame);if(name==='cameraZoom')c.zoom=clamp(Number(n.value)||1,.1,8);else c.rotation=Number(n.value)||0;});render();return;}
    const l=L();if(!l||l.locked)return;S.change('Свойства объекта',()=>{const k=A.ensureKey(l,ui.frame,false);k.objects.filter(o=>ui.selected.has(o.id)).forEach(o=>{
      let v=n.value;if(['x','y','w','h','rotation','opacity','strokeWidth','fontSize','sides','actionFrame'].includes(name))v=Number(v)||0;
      if(name==='opacity')v=clamp(v/100,0,1);if(name==='w'||name==='h'||name==='fontSize')v=Math.max(1,v);if(name==='sides')v=clamp(Math.round(v),3,12);if(name==='actionFrame')v=Math.max(0,Math.round(v)-1);
      if(name==='polygon')v=v==='polygon';if(o.type==='text'&&name==='w')o.textScaleX=(o.textScaleX||1)*v/Math.max(1,o.w);if(o.type==='text'&&name==='h'){const sy=v/Math.max(1,o.h);o.fontSize=(o.fontSize||o.h*.75)*sy;o.textScaleX=(o.textScaleX||1)/sy;}if(o.type==='text'&&name==='fontSize'){const factor=v/Math.max(1,o.fontSize||1);o.w*=factor;o.h*=factor;}o[name]=v;if(o.type==='text'&&name==='text')measureTextObject(o);if(name==='fill2')ui.fill2=v;
    });});render();
  }));}
  function alignMenu(anchor){const items=[['По левому краю','left'],['По центру горизонтально','center'],['По правому краю','right'],['По верхнему краю','top'],['По центру вертикально','middle'],['По нижнему краю','bottom']];U.dropdown(anchor,items.map(([label,id])=>({label,action:()=>align(id)})));}
  function align(where){const l=L(),d=D();if(!l||!ui.selected.size){U.toast('Сначала выберите объект','warn');return;}
    S.change('Выравнивание',()=>{const k=A.ensureKey(l,ui.frame,false);k.objects.filter(o=>ui.selected.has(o.id)).forEach(o=>{if(where==='left')o.x=0;if(where==='center')o.x=(d.width-o.w)/2;if(where==='right')o.x=d.width-o.w;if(where==='top')o.y=0;if(where==='middle')o.y=(d.height-o.h)/2;if(where==='bottom')o.y=d.height-o.h;});});render();}
  function deleteSelected(){const l=L();if(!l||!ui.selected.size)return;S.change('Удалить объекты',()=>{const k=A.ensureKey(l,ui.frame,false);k.objects=k.objects.filter(o=>!ui.selected.has(o.id));});ui.selected.clear();render();}
  function duplicateSelected(){const l=L();if(!l||!ui.selected.size)return;let ids=[];S.change('Дублировать объекты',()=>{const k=A.ensureKey(l,ui.frame,false);k.objects.filter(o=>ui.selected.has(o.id)).forEach(o=>{const q=A.clone(o);q.id=uid('obj');q.x+=D().width*.02;q.y+=D().height*.02;ids.push(q.id);k.objects.push(q);});});ui.selected=new Set(ids);render();}
  function saveAsset(){const objects=currentSelection();if(!objects.length){U.toast('Выберите объект','warn');return;}const name='Элемент '+(D().assets.length+1);S.change('Добавить в библиотеку',()=>D().assets.push({id:uid('asset'),name,objects:A.clone(objects)}));U.toast('Добавлено в библиотеку','success');render();}
  function libraryPanel(box){
    const bar=toolbar(box);bar.appendChild(small('+ Из выделения','Сохранить в библиотеку',saveAsset));
    bar.appendChild(small('glTF / WebGL','Импорт простой glTF/GLB модели',()=>PPE.animationExport.importGLTF()));
    const assets=D().assets||[],list=el('div',{class:'an-asset-grid'});box.appendChild(list);
    if(!assets.length)list.appendChild(el('p',{class:'an-note',text:'Выберите объект и нажмите «Из выделения». Объекты библиотеки сохраняются вместе с проектом.'}));
    assets.forEach(a=>{const card=el('div',{class:'an-asset'});card.appendChild(el('div',{class:'an-asset-icon',text:'◇'}));card.appendChild(el('strong',{text:a.name}));
      card.appendChild(el('small',{text:a.objects.length+' объект(ов)'}));card.appendChild(small('Добавить','Добавить на слой',()=>placeAsset(a.id)));card.appendChild(small('×','Удалить',()=>{S.change('Удалить из библиотеки',()=>D().assets=D().assets.filter(q=>q.id!==a.id));render();}));list.appendChild(card);});
  }
  function placeAsset(id){const asset=D().assets.find(a=>a.id===id),l=L();if(!asset||!l||l.locked)return;let ids=[];S.change('Добавить из библиотеки',()=>{const k=A.ensureKey(l,ui.frame,false);asset.objects.forEach(a=>{const o=A.clone(a);o.id=uid('obj');ids.push(o.id);k.objects.push(o);});});ui.selected=new Set(ids);render();}
  function projectPanel(box){const bar=toolbar(box);bar.appendChild(small('＋ Изображение','Импортировать изображение на сцену',importImage));bar.appendChild(small('Перепривязать','Перепривязать офлайн-медиа',()=>PPE.panels.relinkDialog()));bar.appendChild(small('Импорт медиа','Импортировать файлы проекта',()=>$('#fileInput').click()));bar.appendChild(small('+ Сцена','Добавить сцену',addScene));
    const list=el('div',{class:'an-project-list'});box.appendChild(list);list.appendChild(el('div',{class:'an-list-heading',text:'СЦЕНЫ'}));
    D().scenes.forEach(s=>list.appendChild(el('button',{class:'an-file-row'+(s.id===ui.sceneId?' selected':''),text:'▣  '+s.name+'   ·   '+s.frames+' кадров',onclick:()=>changeScene(s.id)})));
    list.appendChild(el('div',{class:'an-list-heading',text:'МЕДИА ПРОЕКТА'}));
    if(!S.project.media.length)list.appendChild(el('p',{class:'an-note',text:'В проекте пока нет медиа'}));
    S.project.media.forEach(m=>{const row=el('div',{class:'an-file-row'},[el('span',{text:(m.type==='audio'?'♫':'▣')+'  '+m.name+(m.offline?' · offline':'')})]);if(m.type==='image')row.appendChild(small('＋ на сцену','Добавить изображение на сцену',()=>createImageObject(m.id)));list.appendChild(row);});
    list.appendChild(el('p',{class:'an-note',text:'Проводник показывает файлы проекта; произвольный доступ к диску браузер не предоставляет.'}));}
  function actionsPanel(box){
    const bar=toolbar(box);bar.appendChild(small('Звук +','Добавить потоковый звук или событие',soundDialog));bar.appendChild(small('Lip-Sync','Приблизительная синхронизация по громкости',lipSync));
    bar.appendChild(small('Шаблон кода','Вставить JavaScript',e=>snippetMenu(e.currentTarget)));bar.appendChild(small('Платформы','Поддержка ActionScript / AIR / WebGL',help));
    const list=el('div',{class:'an-actions-body'});box.appendChild(list);const sc=SC();
    (sc.sounds||[]).forEach(sound=>{const m=S.findMedia(sound.mediaId);const r=el('div',{class:'an-audio-row'},[
      el('span',{text:(sound.mode==='stream'?'↝ Stream':'♪ Event')+' · '+(m?m.name:'нет медиа')+' · кадр '+(sound.frame+1)}),
      small('×','Удалить звук',()=>{S.change('Удалить звук',()=>sc.sounds=sc.sounds.filter(q=>q.id!==sound.id));render();})]);list.appendChild(r);});
    const label=el('label',{class:'an-code-label',text:'Actions · JavaScript для экспортируемого HTML'});list.appendChild(label);
    const area=el('textarea',{class:'an-code',placeholder:'Например: api.canvas.addEventListener("click", () => api.play());',spellcheck:'false'});area.value=sc.code||'';list.appendChild(area);
    area.addEventListener('change',()=>{S.change('JavaScript анимации',()=>sc.code=area.value);});
    list.appendChild(el('p',{class:'an-note',text:'Код сохраняется в проекте и выполняется только в экспортированном HTML. Не запускайте чужие скрипты. ActionScript 3 и Adobe AIR в браузере не исполняются.'}));
  }
  function snippetMenu(anchor){U.dropdown(anchor,[
    {label:'Клик: воспроизвести',action:()=>setCode('api.canvas.addEventListener("click", () => api.play());')},
    {label:'Клик: пауза / пуск',action:()=>setCode('api.canvas.addEventListener("click", () => api.toggle());')},
    {label:'Перейти к первому кадру',action:()=>setCode('api.go(0);')},
    {label:'Показать текущий кадр в консоли',action:()=>setCode('api.canvas.addEventListener("click", () => console.log(api.frame()));')}
  ]);}
  function setCode(v){S.change('Шаблон кода',()=>SC().code=v);render();}
  function changeScene(id){if(ui.pen)finishPen();pause();const sc=D().scenes.find(s=>s.id===id);if(!sc)return;ui.sceneId=id;ui.layerId=(sc.layers.find(l=>l.type!=='folder')||sc.layers[0]).id;ui.frame=0;ui.selected.clear();ui.zoom=1;ui.panX=ui.panY=ui.viewRot=0;render();}
  function addScene(){const d=D();let n;S.change('Добавить сцену',()=>{n=A.newScene('Сцена '+(d.scenes.length+1),d.width,d.height);d.scenes.push(n);});changeScene(n.id);}
  function sceneMenu(anchor){U.dropdown(anchor,[
    {label:'Добавить сцену',action:addScene},{label:'Дублировать сцену',action:duplicateScene},{label:'Имя и длительность…',action:sceneSettings},'-',
    {label:'Удалить текущую сцену',danger:true,action:deleteScene}
  ]);}
  function duplicateScene(){const d=D(),sc=SC();let n;S.change('Дублировать сцену',()=>{n=A.clone(sc);n.id=uid('scene');n.name=sc.name+' (копия)';const map=new Map();n.layers.forEach(l=>{const old=l.id;l.id=uid('alayer');map.set(old,l.id);});n.layers.forEach(l=>{if(l.parentId)l.parentId=map.get(l.parentId)||null;});d.scenes.push(n);});changeScene(n.id);}
  function deleteScene(){const d=D(),sc=SC();if(d.scenes.length<=1){U.toast('Должна остаться хотя бы одна сцена','warn');return;}const used=S.project.media.some(m=>m.type==='animation'&&m.data&&m.data.sceneId===sc.id);if(!confirm('Удалить сцену «'+sc.name+'»?'+(used?' Связанные клипы станут пустыми.':'')))return;S.change('Удалить сцену',()=>d.scenes=d.scenes.filter(s=>s.id!==sc.id));changeScene(d.scenes[0].id);}
  function sceneSettings(){const d=D(),sc=SC();U.modal({title:'Параметры сцены',body:
    '<div class="form-row"><label>Название</label><div class="form-control"><input id="anScName" value="'+esc(sc.name)+'"></div></div>'+
    '<div class="form-row"><label>Количество кадров</label><div class="form-control"><input type="number" id="anScFrames" min="1" max="360" value="'+sc.frames+'"></div></div>'+
    '<div class="form-row"><label>FPS анимации</label><div class="form-control"><input type="number" id="anScFps" min="1" max="60" value="'+d.fps+'"></div></div>'+
    '<div class="form-note">Размер сцены унаследован от проекта: '+d.width+' × '+d.height+'. Здесь меняется длительность анимации, не формат видео. Уменьшение количества кадров скрывает, но не удаляет ключи за новым концом.</div>',
    buttons:[{label:'Отмена'},{label:'Применить',class:'primary',action:b=>{S.change('Параметры сцены',()=>{sc.name=$('#anScName',b).value.trim()||sc.name;sc.frames=clamp(Math.round(Number($('#anScFrames',b).value)||60),1,360);d.fps=clamp(Number($('#anScFps',b).value)||30,1,60);});ui.frame=A.frameBound(sc,ui.frame);render();}}]});}
  function soundDialog(){const list=S.project.media.filter(m=>m.type==='audio'||m.type==='video');if(!list.length){U.toast('Сначала импортируйте аудио или видео через вкладку «Проект»','warn',4500);return;}
    U.modal({title:'Звук сцены',body:'<div class="form-row"><label>Медиа проекта</label><div class="form-control"><select id="anSoundMedia">'+list.map(m=>'<option value="'+esc(m.id)+'">'+esc(m.name)+(m.offline?' (офлайн)':'')+'</option>').join('')+'</select></div></div>'+
      '<div class="form-row"><label>Синхронизация</label><div class="form-control"><select id="anSoundMode"><option value="stream">Stream · привязан к кадрам</option><option value="event">Event · срабатывает на кадре</option></select></div></div>'+
      '<div class="form-row"><label>Начальный кадр</label><div class="form-control"><input type="number" id="anSoundFrame" min="1" max="'+SC().frames+'" value="'+(ui.frame+1)+'"></div></div>'+
      '<div class="form-note">Медиафайл нужен локально. При добавлении сцены в монтаж звук добавляется отдельным аудиоклипом; в автономный HTML звук не встраивается.</div>',
      buttons:[{label:'Отмена'},{label:'Добавить',class:'primary',action:b=>{const sc=SC();S.change('Звук сцены',()=>{sc.sounds=sc.sounds||[];sc.sounds.push({id:uid('asound'),mediaId:$('#anSoundMedia',b).value,mode:$('#anSoundMode',b).value,frame:clamp((Number($('#anSoundFrame',b).value)||1)-1,0,sc.frames-1)});});render();}}]});}
  function stopAudio(){ui.audio.forEach(x=>{try{x.pause();x.removeAttribute('src');x.load();}catch(e){}});ui.audio.clear();}
  function play(){if(ui.playing)return;if(ui.frame>=SC().frames-1)ui.frame=0;ui.playing=true;ui.playFrame=ui.frame;ui.playT=performance.now();ui.previousFrame=ui.frame-1;stopAudio();syncAudio(ui.frame,ui.previousFrame);renderBottom();requestAnimationFrame(tick);}
  function pause(){ui.playing=false;stopAudio();if(ui.open)renderBottom();}
  function togglePlay(){if(ui.playing)pause();else play();}
  function syncAudio(frame,previous){const d=D(),sc=SC();(sc.sounds||[]).forEach(s=>{const m=S.findMedia(s.mediaId);if(!m||!m.url)return;
      if(frame>=s.frame&&!ui.audio.has(s.id)&&(s.mode==='stream'||previous<s.frame)){
        const au=document.createElement('audio');au.src=m.url;au.preload='auto';if(s.mode==='stream'){try{au.currentTime=Math.max(0,(frame-s.frame)/d.fps);}catch(e){}}
        ui.audio.set(s.id,au);au.play().catch(()=>{});
      }
      const au=ui.audio.get(s.id);if(au&&s.mode==='stream'&&frame>=s.frame){const expected=(frame-s.frame)/d.fps;if(isFinite(au.duration)&&Math.abs(au.currentTime-expected)>.3)try{au.currentTime=expected;}catch(e){}}
    });}
  function tick(now){if(!ui.playing||!ui.open)return;const sc=SC(),d=D(),f=ui.playFrame+Math.floor((now-ui.playT)/1000*d.fps);
    if(f>=sc.frames){ui.frame=sc.frames-1;draw();pause();return;}
    if(f!==ui.frame){const prev=ui.frame;ui.frame=f;syncAudio(f,prev);draw();if(ui.panel==='timeline')refreshFrameHighlights();else if(ui.panel==='properties')renderBottom();}requestAnimationFrame(tick);}
  async function lipSync(){
    const l=L(),o=activeObject(),sc=SC(),d=D();if(!l||!o){U.toast('Выберите объект рта (например, овал)','warn');return;}
    const sound=(sc.sounds||[]).find(s=>{const m=S.findMedia(s.mediaId);return m&&m.file;});if(!sound){U.toast('Добавьте импортированное аудио к сцене во вкладке «Код и звук»','warn',5000);return;}
    const media=S.findMedia(sound.mediaId),ctx=PPE.media.ensureAudio();if(!ctx){U.toast('Web Audio недоступен','warn');return;}
    U.toast('Анализ амплитуды аудио…');try{
      const buf=await media.file.arrayBuffer(),audio=await ctx.decodeAudioData(buf.slice(0)),samples=audio.getChannelData(0),len=Math.min(sc.frames-sound.frame,Math.floor(audio.duration*d.fps),240);
      const amplitude=[];for(let f=0;f<len;f+=2){const a=Math.floor(f/d.fps*audio.sampleRate),b=Math.min(samples.length,Math.floor((f+2)/d.fps*audio.sampleRate));let sum=0,n=0;for(let i=a;i<b;i+=4){sum+=samples[i]*samples[i];n++;}amplitude.push({frame:sound.frame+f,rms:Math.sqrt(sum/Math.max(1,n))});}
      const max=Math.max(.015,...amplitude.map(a=>a.rms));const id=o.id,base=A.clone(o);
      S.change('Lip-Sync по амплитуде',()=>{amplitude.forEach(q=>{const k=A.ensureKey(l,q.frame,false),target=k.objects.find(v=>v.id===id);if(!target)return;const amount=clamp(q.rms/max,0,1);target.h=Math.max(2,base.h*(.15+amount*.85));target.y=base.y+(base.h-target.h)/2;k.tween='hold';});});
      U.toast('Создано '+amplitude.length+' ключей по громкости. Это не распознавание фонем.','success',5500);render();
    }catch(err){U.toast('Не удалось обработать звук: '+err.message,'error');}
  }
  function insertClip(){
    const d=D(),sc=SC(),track=S.project.tracks.find(t=>t.type==='video'&&!t.locked);if(!track){U.toast('Нужна незаблокированная видеодорожка','warn');return;}
    const start=S.playhead,dur=sc.frames/d.fps,ids=[];
    S.change('Добавить анимацию в монтаж',()=>{
      const m=PPE.media.createGenerated('animation',{sceneId:sc.id},sc.name);
      const thumb=document.createElement('canvas');thumb.width=176;thumb.height=Math.max(1,Math.round(176*d.height/d.width));const tc=thumb.getContext('2d');tc.fillStyle='#131718';tc.fillRect(0,0,thumb.width,thumb.height);tc.scale(thumb.width/d.width,thumb.height/d.height);A.drawAt(tc,d,sc,0);try{m.thumb=thumb.toDataURL('image/jpeg',.75);}catch(e){}
      const c=S.newClip(m.id,track.id,start,{generatedDuration:dur});c.name=sc.name;track.clips.push(c);ids.push(c.id);
      const at=S.project.tracks.find(t=>t.type==='audio'&&!t.locked);
      if(at)(sc.sounds||[]).forEach(sound=>{const media=S.findMedia(sound.mediaId);if(!media)return;const off=sound.frame/d.fps,available=Math.max(0,dur-off),len=Math.min(available,media.duration||available);if(len<=0)return;
        const ac=S.newClip(media.id,at.id,start+off,{outPoint:len});ac.name=media.name+' · '+sound.mode;at.clips.push(ac);ids.push(ac.id);});
      S.selection.clear();ids.forEach(id=>S.selection.add(id));
    });
    close();PPE.setMobileView('monitor','program',true);PPE.engine.seek(start);U.toast('Сцена добавлена в монтаж как связанный клип'+((sc.sounds||[]).length?' со звуком':''),'success',4500);
  }
  function exportMenu(anchor){U.dropdown(anchor,[
    {label:'SVG · текущий кадр',action:()=>PPE.animationExport.svg()},
    {label:'HTML / JavaScript Canvas',action:()=>PPE.animationExport.html()},
    {label:'GIF · анимация',action:()=>PPE.animationExport.gif()},
    {label:'Текстурный атлас · PNG + JS (до 120 кадров)',action:()=>PPE.animationExport.atlas()},
    {label:'Видео MP4 / WebM через монтаж…',action:()=>{insertClip();setTimeout(()=>$('#exportBtn').click(),100);}},'-',
    {label:'SWF / Adobe Media Encoder — ограничения',action:help}
  ]);}
  function help(){U.modal({title:'Анимация: возможности и ограничения',wide:true,body:
    '<div class="an-help"><p><b>Вертикальная оболочка</b> не изменяет разрешение проектов. Холст и видео сохраняют исходные пропорции.</p>'+
    '<p><b>Рисование.</b> Векторные объекты, кисти, карандаш, ломаная пером, фигуры, заливка/обводка, узлы, стирание, лассо, трансформация, камера, сетка и направляющие. Object сохраняет объекты отдельно; Merge локально вычитает перекрытые области других Merge-объектов. Это упрощённая модель без полного набора булевых операций Adobe Animate.</p>'+
    '<p><b>Анимация.</b> Кадры, ключи, Motion/Classic и морфинг Shape для простых векторных фигур, Onion Skin, слои, папки, направляющие, маска следующего слоя, сцены и библиотека. Warp двигает узлы контура, а «Сетка» деформирует изображения, текст и фигуры. Bone/Bind реализуют одну вращающуюся кость, не полный многосуставный IK.</p>'+
    '<p><b>Звук и код.</b> Stream/Event создают связанные аудиоклипы при добавлении в монтаж. Lip-Sync приблизительно управляет ртом по громкости, а не распознаёт фонемы. Код и кнопки работают в HTML-экспорте. Браузер не исполняет ActionScript 3 и Adobe AIR.</p>'+
    '<p><b>Форматы.</b> SVG — текущий кадр, GIF (первые 240 кадров, без прозрачности), HTML/Canvas, атлас PNG с JS-метаданными (первые 120 кадров). Простой glTF/GLB: встроенные треугольные сетки без анимаций и текстур; отдельный предпросмотр WebGL. MP4 записывается лишь если MediaRecorder браузера поддерживает его; иначе доступен WebM. SWF и Adobe Media Encoder недоступны из автономного браузерного приложения.</p>'+
    '<p>Экспорт сцены в видео: «В монтаж» → «Экспорт». Сцена остаётся связанной с проектом; изменения в ней видны в клипе. Длительность уже добавленного клипа отдельно редактируется на монтажном таймлайне.</p></div>',buttons:[{label:'Понятно',class:'primary'}]});}
  function keyboard(e){if(!ui.open)return;const tag=e.target&&e.target.tagName;if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT'||e.target.isContentEditable)return;if(!$('#modalRoot').classList.contains('hidden'))return;
    const k=e.key.toLowerCase();if((e.ctrlKey||e.metaKey)&&k==='z'){e.preventDefault();if(ui.pen)finishPen();e.shiftKey?S.redo():S.undo();return;}
    if((e.ctrlKey||e.metaKey)&&k==='s'){e.preventDefault();if(ui.pen)finishPen();S.persist(true);if(PPE.projects)PPE.projects.saveCurrent();U.download(S.exportProjectFile(),U.safeFileName(S.project.name||'project','json',true),'application/json');U.toast('Проект сохранён; медиа остаются отдельно','success');return;}
    if(k==='escape'){if(ui.pen)finishPen();else close();e.preventDefault();}
    else if(k==='enter'&&ui.pen){finishPen();e.preventDefault();}
    else if(k===' '){togglePlay();e.preventDefault();}
    else if(k==='arrowleft'){setFrame(ui.frame-1);e.preventDefault();}else if(k==='arrowright'){setFrame(ui.frame+1);e.preventDefault();}
    else if(k==='delete'||k==='backspace'){deleteSelected();e.preventDefault();}
    else if(!e.ctrlKey&&!e.metaKey){const map={v:'select',a:'subselect',b:'brush',p:'pen',n:'pencil',t:'text',h:'hand',z:'zoom',e:'eraser'};if(map[k]){setTool(map[k]);e.preventDefault();}}
  }
  function resetWarp(){const l=L(),o=activeObject();if(!l||!o||l.locked){U.toast('Выберите объект','warn');return;}
    S.change('Сброс сетки',()=>{const k=A.ensureKey(l,ui.frame,false),item=k.objects.find(q=>q.id===o.id);if(item)delete item.warp;});render();U.toast('Деформация сброшена');}
  function createImageObject(id){const m=S.findMedia(id),l=L();if(!m||m.type!=='image'){U.toast('Выберите изображение','warn');return;}
    if(!m.url){U.toast('Файл не подгрузился — откройте вкладку «Проект» и нажмите «Найти»','warn',5500);return;}
    if(!l||l.locked||!l.visible||l.type==='folder'){U.toast('Выберите видимый незаблокированный слой','warn');return;}
    const d=D(),iw=m.width||800,ih=m.height||600,k=Math.min(d.width*.65/iw,d.height*.65/ih,1),w=Math.max(2,iw*k),h=Math.max(2,ih*k);let o;
    S.change('Добавить изображение',()=>{const key=A.ensureKey(l,ui.frame,false);o=A.makeObject('image',(d.width-w)/2,(d.height-h)/2,w,h,{});o.mediaId=m.id;o.strokeWidth=0;key.objects.push(o);});
    ui.selected=new Set([o.id]);ui.tool='select';ui.panel='properties';render();U.toast('Изображение добавлено: перетащите его на холсте','success');
  }
  function importImage(){
    const input=el('input',{type:'file',accept:'image/*'});input.style.display='none';document.body.appendChild(input);
    input.addEventListener('change',async()=>{const file=input.files&&input.files[0];input.remove();if(!file)return;
      try{const added=await PPE.media.importFiles([file],{silentSource:true});if(!ui.open)return;const m=added.find(q=>q.type==='image');if(m)createImageObject(m.id);else U.toast('Выбранный файл не является изображением','warn');}catch(e){U.toast('Не удалось добавить изображение: '+e.message,'error');}
    },{once:true});input.click();
  }
  function setPanel(name){ui.panel=name;render();}
  function createMeshObject(data){const l=L();if(!l||l.locked)return;let o;S.change('Импорт glTF-сетки',()=>{const k=A.ensureKey(l,ui.frame,false);o=A.makeObject('mesh',D().width*.3,D().height*.2,D().width*.4,D().height*.6,{fill:'#539b90',stroke:'#b9f8ef',strokeWidth:2});o.vertices=data.vertices;o.indices=data.indices;k.objects.push(o);});ui.selected=new Set([o.id]);ui.panel='properties';render();}
  PPE.animationUI={init,open,close,isOpen:visible,render,draw,requestDraw,createImageObject,resetWarp,setTool,setFrame,setTween,addKey,insertFrame,addLayer,addScene,changeScene,insertClip,setPanel,createMeshObject,state:ui,tools:TOOLS};
})(window);
