/* Векторные сцены: данные сохраняются в project.x, прежние клипы не меняются. */
(function (root) {
  'use strict';
  const PPE = root.PPE = root.PPE || {}, U = PPE.utils, S = PPE.state;
  const clamp = U.clamp, uid = U.uid;
  const clone = value => JSON.parse(JSON.stringify(value));

  function newLayer(name, type) {
    return { id: uid('alayer'), name: name || 'Слой', type: type || 'normal', visible: true, locked: false, parentId: null,
      keys: [{ frame: 0, objects: [], tween: 'hold' }] };
  }
  function newScene(name, w, h) {
    return { id: uid('scene'), name: name || 'Сцена 1', frames: 60, background: null,
      layers: [newLayer('Слой 1')], camera: [{ frame: 0, x: w / 2, y: h / 2, zoom: 1, rotation: 0 }], sounds: [], code: '' };
  }
  function newDoc() {
    const w = S.project.width, h = S.project.height;
    const s = newScene('Сцена 1', w, h);
    return { version: 1, width: w, height: h, fps: S.project.fps || 30, scenes: [s], assets: [] };
  }
  function doc() { return S.project && S.project.x && S.project.x.animation || null; }
  function ensureDoc() {
    if (!doc()) S.change('Создать анимационную сцену', () => { S.project.x = S.project.x || {}; S.project.x.animation = newDoc(); });
    return doc();
  }
  function scene(d, id) { return d && (d.scenes.find(s => s.id === id) || d.scenes[0]) || null; }
  function layer(sc, id) { return sc && (sc.layers.find(l => l.id === id) || sc.layers.find(l => l.type !== 'folder')) || null; }
  function sortedKeys(l) { return (l.keys || []).slice().sort((a,b) => a.frame-b.frame); }
  function keyAt(l, f) { return l && (l.keys || []).find(k => k.frame === Math.floor(f)) || null; }
  function frameBound(sc, f) { return clamp(Math.floor(Number(f) || 0), 0, Math.max(0, sc.frames - 1)); }
  const lerp = (a,b,t) => a + (b-a)*t;
  function colorMix(a, b, t) {
    if (!/^#[0-9a-f]{6}$/i.test(a || '') || !/^#[0-9a-f]{6}$/i.test(b || '')) return t < .5 ? a : b;
    const aa = parseInt(a.slice(1),16), bb = parseInt(b.slice(1),16);
    const ch = shift => Math.round(lerp((aa >> shift)&255,(bb >> shift)&255,t)).toString(16).padStart(2,'0');
    return '#' + ch(16) + ch(8) + ch(0);
  }
  function outline(o, count) {
    count = count || 32;
    if (o.type === 'oval') return Array.from({length:count},(_,i) => { const a=2*Math.PI*i/count; return {x:.5+.5*Math.cos(a), y:.5+.5*Math.sin(a)}; });
    if (o.type === 'star') {
      const n = Math.max(3,Math.min(12,o.sides || 5)), pts=[];
      const steps=o.polygon?n:n*2; for(let i=0;i<steps;i++){ const a=-Math.PI/2+i*2*Math.PI/steps, r=o.polygon?.5:(i%2 ? .23 : .5); pts.push({x:.5+r*Math.cos(a),y:.5+r*Math.sin(a)}); }
      return resample(pts,count,true);
    }
    if (o.type === 'path' && o.points && o.points.length > 1) return resample(o.points,count,!!o.closed);
    return resample([{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],count,true);
  }
  function resample(points, count, closed) {
    const p=points.slice(); if (closed) p.push(points[0]);
    if (p.length<2) return Array.from({length:count},()=>({x:.5,y:.5}));
    const lengths=[0]; for(let i=1;i<p.length;i++) lengths.push(lengths[i-1]+Math.hypot(p[i].x-p[i-1].x,p[i].y-p[i-1].y));
    const total=lengths[lengths.length-1] || 1, out=[];
    for(let i=0;i<count;i++) { const d=total * (i/(closed?count:Math.max(1,count-1))); let j=1; while(j<lengths.length-1 && lengths[j]<d) j++;
      const t=(d-lengths[j-1])/Math.max(1e-9,lengths[j]-lengths[j-1]); out.push({x:lerp(p[j-1].x,p[j].x,t),y:lerp(p[j-1].y,p[j].y,t)}); }
    return out;
  }
  function interpolateObject(a,b,t,kind) {
    // Никаких глубоких копий каждого контура на каждом кадре: поля только читаются.
    const out=Object.assign({},a); ['x','y','w','h','rotation','opacity','strokeWidth','fontSize','textScaleX'].forEach(k => {
      if (typeof a[k] === 'number' && typeof b[k] === 'number') out[k]=lerp(a[k],b[k],t);
    });
    out.fill=colorMix(a.fill,b.fill,t); out.stroke=colorMix(a.stroke,b.stroke,t); out.fill2=colorMix(a.fill2,b.fill2,t);
    if(a.type==='text')out.textScaleX=lerp(a.textScaleX||1,b.textScaleX||1,t);
    if (a.warp || b.warp) {
      const grid=a.warp || b.warp, cols=grid.cols, rows=grid.rows;
      const ga=a.warp && a.warp.cols===cols && a.warp.rows===rows ? a.warp : makeWarp(cols,rows);
      const gb=b.warp && b.warp.cols===cols && b.warp.rows===rows ? b.warp : makeWarp(cols,rows);
      out.warp={cols,rows,points:ga.points.map((p,i)=>({x:lerp(p.x,gb.points[i].x,t),y:lerp(p.y,gb.points[i].y,t)}))};
    }
    if (kind === 'shape' && !['image','text','button','input'].includes(a.type)) {
      const p=outline(a,32), q=outline(b,32); out.type='path'; out.closed=true;
      out.points=p.map((v,i)=>({x:lerp(v.x,q[i].x,t),y:lerp(v.y,q[i].y,t)}));
    }
    return out;
  }
  /* Кривые скорости (cubic-bezier) для переходов между ключами.
     curve = [x1,y1,x2,y2] как в CSS; solveY считает значение по x=t. */
  function bezierEase(curve, t) {
    if (!Array.isArray(curve) || curve.length !== 4) return t;
    const [x1, y1, x2, y2] = curve.map(Number);
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const sampleX = u => ((ax * u + bx) * u + cx) * u;
    const sampleY = u => ((ay * u + by) * u + cy) * u;
    const dX = u => (3 * ax * u + 2 * bx) * u + cx;
    let u = t;
    for (let i = 0; i < 8; i++) {
      const x = sampleX(u) - t;
      if (Math.abs(x) < 1e-5) return sampleY(u);
      const d = dX(u);
      if (Math.abs(d) < 1e-6) break;
      u -= x / d;
    }
    let lo = 0, hi = 1; u = t;
    for (let i = 0; i < 24; i++) {
      const x = sampleX(u);
      if (Math.abs(x - t) < 1e-5) break;
      if (x > t) hi = u; else lo = u;
      u = (lo + hi) / 2;
    }
    return sampleY(u);
  }
  function objectsAt(l, frame) {
    if (!l || l.type === 'folder') return [];
    const keys=sortedKeys(l); if (!keys.length || frame < keys[0].frame) return [];
    let previous=keys[0], next=null;
    for(let i=1;i<keys.length;i++){ if(keys[i].frame<=frame) previous=keys[i]; else {next=keys[i]; break;} }
    const kind=previous.tween || 'hold';
    if (!next || kind === 'hold' || frame === previous.frame) return previous.objects || [];
    let t=clamp((frame-previous.frame)/Math.max(1,next.frame-previous.frame),0,1);
    if(kind==='classic') t=t*t*(3-2*t);
    else if(kind==='easein') t=t*t;
    else if(kind==='easeout') t=1-(1-t)*(1-t);
    else if(kind==='curve') t=bezierEase(previous.curve||[.25,.1,.25,1],t);
    const map=new Map((next.objects||[]).map(o=>[o.id,o]));
    return (previous.objects||[]).map(a => map.has(a.id) ? interpolateObject(a,map.get(a.id),t,kind) : a);
  }
  /** Ключ для правки: единственный ключ слоя действует на весь слой,
      поэтому правка в любом кадре попадает в него, а не создаёт второй.
      force = true (кнопка «◆ ключ») — создать новый ключ принудительно. */
  function ensureKey(l, frame, blank, force) {
    frame=Math.max(0,Math.floor(frame)); let k=keyAt(l,frame);
    if (k) { if (blank) {k.objects=[];k.tween='hold';} return k; }
    const keys=l.keys||[];
    if (!blank && !force && keys.length===1) return keys[0];
    // Ключевой кадр обязательно владеет отдельной копией.
    const objs=blank ? [] : clone(objectsAt(l,frame));
    k={frame,objects:objs,tween:'hold'}; (l.keys=l.keys||[]).push(k); l.keys.sort((a,b)=>a.frame-b.frame); return k;
  }
  function editKey(l, frame) { return l ? ensureKey(l, frame, false) : null; }
  function cameraAt(sc,d,frame) {
    const keys=(sc.camera||[]).slice().sort((a,b)=>a.frame-b.frame);
    if (!keys.length) return {x:d.width/2,y:d.height/2,zoom:1,rotation:0};
    let a=keys[0],b=null;
    for(let i=1;i<keys.length;i++){if(keys[i].frame<=frame) a=keys[i]; else {b=keys[i];break;}}
    if (!b) return clone(a);
    const t=clamp((frame-a.frame)/Math.max(1,b.frame-a.frame),0,1);
    return {x:lerp(a.x,b.x,t),y:lerp(a.y,b.y,t),zoom:lerp(a.zoom||1,b.zoom||1,t),rotation:lerp(a.rotation||0,b.rotation||0,t)};
  }
  function ensureCamera(sc,d,frame) {
    sc.camera=sc.camera||[]; let k=sc.camera.find(q=>q.frame===frame);
    if (!k){ k=Object.assign({frame},cameraAt(sc,d,frame)); k.frame=frame; sc.camera.push(k);sc.camera.sort((a,b)=>a.frame-b.frame); }
    return k;
  }
  function applyCamera(c,sc,d,frame) {
    const cam=cameraAt(sc,d,frame); c.translate(d.width/2,d.height/2); c.rotate(-(cam.rotation||0)*Math.PI/180);
    c.scale(cam.zoom||1,cam.zoom||1); c.translate(-cam.x,-cam.y); return cam;
  }
  function worldFromStage(p,sc,d,frame) {
    const v=cameraAt(sc,d,frame), x=(p.x-d.width/2)/(v.zoom||1), y=(p.y-d.height/2)/(v.zoom||1), a=(v.rotation||0)*Math.PI/180;
    return {x:v.x+x*Math.cos(a)-y*Math.sin(a),y:v.y+x*Math.sin(a)+y*Math.cos(a)};
  }
  function stageFromWorld(p,sc,d,frame) {
    const v=cameraAt(sc,d,frame), x=p.x-v.x,y=p.y-v.y,a=-(v.rotation||0)*Math.PI/180;
    return {x:d.width/2+(x*Math.cos(a)-y*Math.sin(a))*(v.zoom||1),y:d.height/2+(x*Math.sin(a)+y*Math.cos(a))*(v.zoom||1)};
  }
  function objLocal(o,p) {
    const cx=o.x+o.w/2,cy=o.y+o.h/2,a=-(o.rotation||0)*Math.PI/180,dx=p.x-cx,dy=p.y-cy;
    return {x:dx*Math.cos(a)-dy*Math.sin(a)+o.w/2,y:dx*Math.sin(a)+dy*Math.cos(a)+o.h/2};
  }
  function objWorld(o,p) {
    const a=(o.rotation||0)*Math.PI/180,dx=p.x-o.w/2,dy=p.y-o.h/2;
    return {x:o.x+o.w/2+dx*Math.cos(a)-dy*Math.sin(a),y:o.y+o.h/2+dx*Math.sin(a)+dy*Math.cos(a)};
  }
  function traceObject(c,o) {
    const w=Math.max(.001,o.w),h=Math.max(.001,o.h);
    if(o.type==='oval') c.ellipse(w/2,h/2,w/2,h/2,0,0,Math.PI*2);
    else if(o.type==='star') { const n=clamp(o.sides||5,3,12),steps=o.polygon?n:n*2; for(let i=0;i<steps;i++){const a=-Math.PI/2+i*2*Math.PI/steps,r=o.polygon?.5:(i%2?.23:.5),x=w*(.5+r*Math.cos(a)),y=h*(.5+r*Math.sin(a)); if(!i)c.moveTo(x,y);else c.lineTo(x,y);}c.closePath(); }
    else if(o.type==='path') { const pts=o.points||[]; if(!pts.length)return; c.moveTo(pts[0].x*w,pts[0].y*h);
      if(o.smooth && pts.length>2){ for(let i=1;i<pts.length-1;i++) c.quadraticCurveTo(pts[i].x*w,pts[i].y*h,(pts[i].x+pts[i+1].x)*w/2,(pts[i].y+pts[i+1].y)*h/2); const p=pts[pts.length-1];c.lineTo(p.x*w,p.y*h); }
      else for(let i=1;i<pts.length;i++) c.lineTo(pts[i].x*w,pts[i].y*h);
      if(o.closed)c.closePath();
    } else c.rect(0,0,w,h);
  }
  function cutStroke(c, points, radius, w, h) {
    if(!points || !points.length)return;
    const p=points.map(v=>({x:v.x*w,y:v.y*h})),r=Math.max(.1,radius*Math.min(w,h));
    if(p.length===1){c.moveTo(p[0].x+r,p[0].y);c.arc(p[0].x,p[0].y,r,0,Math.PI*2);return;}
    const left=[],right=[];
    for(let i=0;i<p.length;i++){const a=p[Math.max(0,i-1)],b=p[Math.min(p.length-1,i+1)],dx=b.x-a.x,dy=b.y-a.y,n=Math.hypot(dx,dy)||1;left.push({x:p[i].x-dy/n*r,y:p[i].y+dx/n*r});right.push({x:p[i].x+dy/n*r,y:p[i].y-dx/n*r});}
    c.moveTo(left[0].x,left[0].y);left.slice(1).forEach(q=>c.lineTo(q.x,q.y));
    c.lineTo(right[right.length-1].x,right[right.length-1].y); for(let i=right.length-2;i>=0;i--)c.lineTo(right[i].x,right[i].y);c.closePath();
  }
  function applyCuts(c,o) {
    if(!o.cuts || !o.cuts.length) return;
    c.beginPath(); c.rect(-100000,-100000,200000,200000);
    o.cuts.forEach(cut=>{
      if(cut.kind==='polygon' && cut.points && cut.points.length){c.moveTo(cut.points[0].x*o.w,cut.points[0].y*o.h);cut.points.slice(1).forEach(p=>c.lineTo(p.x*o.w,p.y*o.h));c.closePath();}
      else cutStroke(c,cut.points,cut.radius||.04,o.w,o.h);
    });
    try{c.clip('evenodd');}catch(e){c.clip();}
  }
  function fillStyle(c,o) {
    if(o.gradient && o.fill2){const g=o.gradient,gr=c.createLinearGradient((g.x1||0)*o.w,(g.y1||0)*o.h,(g.x2==null?1:g.x2)*o.w,(g.y2==null?1:g.y2)*o.h);gr.addColorStop(0,o.fill||'#ffffff');gr.addColorStop(1,o.fill2);return gr;}
    return o.fill || 'transparent';
  }
  function drawMesh(c,o) {
    const v=o.vertices||[],idx=o.indices||[],w=o.w,h=o.h;
    function p(i){return {x:w/2+(v[i*3]||0)*w*.38,y:h/2-(v[i*3+1]||0)*h*.38};}
    c.fillStyle=o.fill||'#73a9a0';c.strokeStyle=o.stroke||'#b6eee7';c.lineWidth=Math.max(1,o.strokeWidth||1);
    const n=idx.length?idx.length:Math.floor(v.length/3);
    for(let i=0;i+2<n;i+=3){const a=p(idx.length?idx[i]:i),b=p(idx.length?idx[i+1]:i+1),d=p(idx.length?idx[i+2]:i+2); c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.lineTo(d.x,d.y);c.closePath();c.fill();c.stroke();}
  }
  /* Изображения остаются ссылками на медиа проекта. После перезапуска их
     перепривязывают так же, как клипы; объект сетки никогда не хранит bitmap. */
  const imageCache=new Map(), textureCache=new Map();
  function imageFor(o){
    const media=S.findMedia(o.mediaId);if(!media||!media.url)return null;
    const url=media.url,key=o.mediaId+'|'+url;let entry=imageCache.get(key);
    if(entry)return entry.img;
    const img=new Image();entry={img};imageCache.set(key,entry);
    while(imageCache.size>32)imageCache.delete(imageCache.keys().next().value);
    img.onload=()=>{textureCache.clear();if(PPE.animationUI&&PPE.animationUI.isOpen())PPE.animationUI.requestDraw();if(PPE.engine)PPE.engine.renderFrame(S.playhead);};
    img.onerror=()=>{entry.failed=true;if(PPE.animationUI&&PPE.animationUI.isOpen())PPE.animationUI.requestDraw();};
    img.src=url;return img;
  }
  function sceneImageIds(sc,frame){const ids=new Set();(sc.layers||[]).forEach(l=>{if(!isVisible(sc,l)||['folder','guide','mask'].includes(l.type))return;
    const groups=frame==null?(l.keys||[]).filter(k=>k.frame<sc.frames).map(k=>k.objects||[]):[objectsAt(l,frame)];groups.forEach(objects=>objects.forEach(o=>{if(o.type==='image'&&o.mediaId)ids.add(o.mediaId);}));});return ids;}
  async function preloadImages(sc,frame){
    const ids=sceneImageIds(sc,frame);let missing=[];
    await Promise.all(Array.from(ids).map(async id=>{const m=S.findMedia(id),im=imageFor({mediaId:id});if(!m||!m.url||!im){missing.push(m?m.name:id);return;}
      try{if(!im.complete){if(im.decode)await im.decode();else await new Promise((resolve,reject)=>{im.addEventListener('load',resolve,{once:true});im.addEventListener('error',reject,{once:true});});}if(!im.naturalWidth)missing.push(m.name);}catch(e){missing.push(m.name);}}));
    return missing;
  }
  function makeWarp(cols,rows){cols=clamp(Math.round(cols||4),2,8);rows=clamp(Math.round(rows||cols),2,8);const points=[];for(let y=0;y<rows;y++)for(let x=0;x<cols;x++)points.push({x:x/(cols-1),y:y/(rows-1)});return {cols,rows,points};}
  function validWarp(g){return !!(g&&g.cols>=2&&g.cols<=8&&g.rows>=2&&g.rows<=8&&Array.isArray(g.points)&&g.points.length===g.cols*g.rows&&g.points.every(p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)));}
  function hasWarp(g){if(!validWarp(g))return false;return g.points.some((p,i)=>Math.abs(p.x-(i%g.cols)/(g.cols-1))>1e-6||Math.abs(p.y-Math.floor(i/g.cols)/(g.rows-1))>1e-6);}
  function triangleMatrix(src,dst){
    const [a,b,c]=src,[u,v,w]=dst,det=a.x*(b.y-c.y)+b.x*(c.y-a.y)+c.x*(a.y-b.y);if(Math.abs(det)<1e-8)return null;
    const calc=(p,q,r)=>[(p*(b.y-c.y)+q*(c.y-a.y)+r*(a.y-b.y))/det,(p*(c.x-b.x)+q*(a.x-c.x)+r*(b.x-a.x))/det,(p*(b.x*c.y-c.x*b.y)+q*(c.x*a.y-a.x*c.y)+r*(a.x*b.y-b.x*a.y))/det];
    const x=calc(u.x,v.x,w.x),y=calc(u.y,v.y,w.y);return [x[0],y[0],x[1],y[1],x[2],y[2]];
  }
  function meshPadding(o){return o.type==='image'?0:Math.max(2,(o.strokeWidth||0)*1.25+2,o.type==='text'?(o.fontSize||0)*.2:0);}
  function meshTriangles(o,pad){
    const g=o.warp;if(!validWarp(g))return [];const result=[],w=Math.max(.001,o.w),h=Math.max(.001,o.h);pad=Math.max(0,Number(pad)||0);
    const columns=g.cols+(pad?2:0),rows=g.rows+(pad?2:0);
    function axis(i,n,len){if(!pad)return i*len/(n-1);if(i===0)return -pad;if(i===n+1)return len+pad;return (i-1)*len/(n-1);}
    function source(x,y){return {x:axis(x,g.cols,w),y:axis(y,g.rows,h)};}
    // Линейное продолжение внешних ячеек сохраняет обводку за границами рамки.
    function target(src){const gx=src.x/w*(g.cols-1),gy=src.y/h*(g.rows-1),ix=clamp(Math.floor(gx),0,g.cols-2),iy=clamp(Math.floor(gy),0,g.rows-2),tx=gx-ix,ty=gy-iy;
      const a=g.points[iy*g.cols+ix],b=g.points[iy*g.cols+ix+1],c=g.points[(iy+1)*g.cols+ix],d=g.points[(iy+1)*g.cols+ix+1];
      return {x:lerp(lerp(a.x,b.x,tx),lerp(c.x,d.x,tx),ty)*w,y:lerp(lerp(a.y,b.y,tx),lerp(c.y,d.y,tx),ty)*h};}
    for(let y=0;y<rows-1;y++)for(let x=0;x<columns-1;x++){
      const a=source(x,y),b=source(x+1,y),c=source(x,y+1),d=source(x+1,y+1);
      [[a,b,d],[a,d,c]].forEach(src=>{const dest=src.map(target),matrix=triangleMatrix(src,dest);if(matrix)result.push({src,dest,matrix});});}
    return result;
  }
  function warpedMaskPolygons(o){
    if(!hasWarp(o.warp))return [];
    const outlinePoints=o.type==='path'&&o.points&&o.points.length>2?o.points:outline(o,64);
    const poly=outlinePoints.map(p=>({x:p.x*o.w,y:p.y*o.h}));
    function cross(a,b,p){return (b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);}
    function clip(subject,a,b,sign){const out=[];if(!subject.length)return out;let last=subject[subject.length-1],v0=cross(a,b,last)*sign;
      subject.forEach(p=>{const v1=cross(a,b,p)*sign,inside=v1>=-1e-7,prev=v0>=-1e-7;if(inside!==prev){const t=v0/(v0-v1);out.push({x:last.x+(p.x-last.x)*t,y:last.y+(p.y-last.y)*t});}if(inside)out.push(p);last=p;v0=v1;});return out;}
    return meshTriangles(o,0).map(tri=>{const v=tri.src,sign=cross(v[0],v[1],v[2])>=0?1:-1;let p=poly;
      for(let i=0;i<3;i++)p=clip(p,v[i],v[(i+1)%3],sign);const [a,b,c,d,e,f]=tri.matrix;
      return p.map(q=>({x:a*q.x+c*q.y+e,y:b*q.x+d*q.y+f}));}).filter(p=>p.length>=3);
  }
  function drawLocal(c,o){
    const w=Math.max(.001,o.w||1),h=Math.max(.001,o.h||1);
    c.save();applyCuts(c,o);c.lineCap='round';c.lineJoin='round';c.lineWidth=Math.max(0,o.strokeWidth||0);c.strokeStyle=o.stroke||'#ffffff';
    if(o.type==='image'){
      const img=imageFor(o);if(img&&img.complete&&img.naturalWidth){c.drawImage(img,0,0,w,h);}
      else {c.fillStyle='#353b3a';c.fillRect(0,0,w,h);c.strokeStyle='#788783';c.lineWidth=Math.max(1,w*.004);c.strokeRect(0,0,w,h);c.fillStyle='#d3e0dd';c.font=Math.max(12,Math.min(w*.06,h*.1))+'px Arial';c.textAlign='center';c.textBaseline='middle';c.fillText(img?'Загрузка изображения…':'Нет файла',w/2,h/2,w*.9);}
      c.restore();return;
    }
    if(o.type==='mesh'){drawMesh(c,o);c.restore();return;}
    if(o.type==='text'){
      c.fillStyle=o.fill||'#ffffff';c.font=(o.bold?'bold ':'')+Math.max(1,o.fontSize||h*.75)+'px '+(o.font||'Arial');c.textAlign='left';c.textBaseline='top';
      c.scale(o.textScaleX||1,1);String(o.text||'Текст').split('\n').forEach((line,i)=>c.fillText(line,0,i*(o.fontSize||h*.75)*1.2));c.restore();return;
    }
    if(o.type==='button'||o.type==='input'){
      c.fillStyle=fillStyle(c,o);c.beginPath();if(c.roundRect)c.roundRect(0,0,w,h,Math.min(14,h*.15));else c.rect(0,0,w,h);c.fill();if(o.strokeWidth)c.stroke();
      c.fillStyle=o.textColor||'#ffffff';c.font='600 '+Math.max(10,Math.min(h*.45,o.fontSize||40))+'px Arial';c.textAlign='center';c.textBaseline='middle';c.fillText(o.text||(o.type==='button'?'Кнопка':'Введите текст'),w/2,h/2,w*.92);c.restore();return;
    }
    c.beginPath();traceObject(c,o);
    if(o.type!=='path'||o.closed){if(o.fill&&o.fill!=='transparent'){c.fillStyle=fillStyle(c,o);c.fill();}}
    if(o.strokeWidth>0&&o.stroke&&o.stroke!=='transparent'){
      if(o.type==='path'&&o.variable&&o.points&&o.points.length>1){const pts=o.points;for(let i=1;i<pts.length;i++){c.beginPath();c.moveTo(pts[i-1].x*w,pts[i-1].y*h);c.lineTo(pts[i].x*w,pts[i].y*h);c.lineWidth=Math.max(.5,o.strokeWidth*((pts[i-1].p||.65)+(pts[i].p||.65)));c.stroke();}}
      else c.stroke();
    }c.restore();
  }
  function textureFor(c,o){
    const m=o.type==='image'&&S.findMedia(o.mediaId),image=o.type==='image'?imageFor(o):null;
    const visual={};Object.keys(o).forEach(k=>{if(!['id','x','y','rotation','opacity','warp'].includes(k))visual[k]=o[k];});
    const transform=c.getTransform(),pixelScale=Math.max(.1,Math.min(2,Math.hypot(transform.a,transform.b),Math.hypot(transform.c,transform.d)));
    // При экспорте текстура соответствует разрешению кадра (Full HD целиком).
    // На маленьком предпросмотре ограничиваем её размерами экрана.
    const full=pixelScale>=.75,maxDim=full?4096:1024,maxPixels=full?8294400:600000;
    const pad=meshPadding(o),wide=o.w+2*pad,high=o.h+2*pad;
    const ratio=Math.min(1,maxDim/Math.max(wide,high),Math.sqrt(maxPixels/Math.max(1,wide*high)),pixelScale);
    const tw=Math.max(1,Math.ceil(wide*ratio)),th=Math.max(1,Math.ceil(high*ratio));
    const key=o.id+'|'+tw+'x'+th+'|'+(m&&m.url||'')+'|'+!!(image&&image.complete&&image.naturalWidth)+'|'+JSON.stringify(visual);
    let item=textureCache.get(key);if(item){textureCache.delete(key);textureCache.set(key,item);return item;}
    const tex=document.createElement('canvas');tex.width=tw;tex.height=th;const t=tex.getContext('2d');t.scale(tw/wide,th/high);t.translate(pad,pad);drawLocal(t,o);
    textureCache.set(key,tex);let pixels=Array.from(textureCache.values()).reduce((n,t)=>n+t.width*t.height,0);
    while(textureCache.size>1&&(textureCache.size>8||pixels>12000000)){const first=textureCache.keys().next().value,old=textureCache.get(first);pixels-=old.width*old.height;textureCache.delete(first);}return tex;
  }
  /* Фильтры и коррекция освещения спрайта — CSS filter, как в CapCut. */
  function spriteFilter(o) {
    const fx = o.fx || {}, li = o.light || {};
    const parts = [];
    const add = (name, v, unit) => { if (v != null && isFinite(v)) parts.push(name + '(' + Math.round(v * 100) / 100 + (unit || '') + ')'); };
    if (fx.preset === 'bw') add('grayscale', 100, '%');
    else if (fx.preset === 'sepia') add('sepia', 90, '%');
    else if (fx.preset === 'invert') add('invert', 100, '%');
    else if (fx.preset === 'vintage') { add('sepia', 62, '%'); add('contrast', 108, '%'); add('saturate', 82, '%'); add('brightness', 96, '%'); }
    else if (fx.preset === 'warm') { add('sepia', 26, '%'); add('saturate', 124, '%'); add('brightness', 104, '%'); }
    else if (fx.preset === 'cold') { add('hue-rotate', -14, 'deg'); add('saturate', 92, '%'); add('brightness', 101, '%'); }
    else if (fx.preset === 'contrast') add('contrast', 152, '%');
    else if (fx.preset === 'vivid') { add('saturate', 168, '%'); add('contrast', 112, '%'); }
    else if (fx.preset === 'blur') add('blur', 3, 'px');
    else if (fx.preset === 'noir') { add('grayscale', 100, '%'); add('contrast', 140, '%'); add('brightness', 92, '%'); }
    else if (fx.preset === 'neon') { add('saturate', 210, '%'); add('hue-rotate', 52, 'deg'); add('brightness', 108, '%'); }
    if (fx.preset === 'custom' || fx.preset === undefined) {
      add('brightness', fx.brightness, '%'); add('contrast', fx.contrast, '%'); add('saturate', fx.saturate, '%');
      add('blur', fx.blur, 'px'); add('hue-rotate', fx.hue, 'deg'); add('sepia', fx.sepia, '%'); add('grayscale', fx.gray, '%');
      add('invert', fx.invert, '%');
    }
    if (li.exposure || li.contrast || li.shadows || li.temp || li.vibrance) {
      add('brightness', 100 + (li.exposure || 0) * .5 + (li.shadows || 0) * .28, '%');
      add('contrast', 100 + (li.contrast || 0) * .6 - (li.shadows || 0) * .35, '%');
      add('saturate', 100 + (li.vibrance || 0) * .8, '%');
      if (li.temp > 0) add('sepia', (li.temp || 0) * .45, '%'); else if (li.temp < 0) add('hue-rotate', (li.temp || 0) * .18, 'deg');
    }
    return parts.length ? parts.join(' ') : '';
  }
  function cropRect(o) {
    const cr = o.crop; if (!cr) return null;
    const l = clamp(cr.l || 0, 0, .48), t = clamp(cr.t || 0, 0, .48), r = clamp(cr.r || 0, 0, .48), b = clamp(cr.b || 0, 0, .48);
    if (!l && !t && !r && !b) return null;
    return { x: l * o.w, y: t * o.h, w: Math.max(1, o.w * (1 - l - r)), h: Math.max(1, o.h * (1 - t - b)) };
  }
  function findObject(sc, frame, id) {
    if (!sc) return null;
    for (let i = 0; i < sc.layers.length; i++) {
      const l = sc.layers[i]; if (l.type === 'folder') continue;
      const hit = objectsAt(l, frame).find(o => o.id === id);
      if (hit) return hit;
    }
    return null;
  }
  function drawScaled(c, o) {
    if (o.type === 'mesh') { drawMesh(c, o); return; }
    if (o.type === 'text') {
      c.fillStyle = o.fill || '#ffffff'; c.font = (o.bold ? 'bold ' : '') + Math.max(1, o.fontSize || o.h * .75) + 'px ' + (o.font || 'Arial');
      c.textAlign = 'left'; c.textBaseline = 'top'; c.scale(o.textScaleX || 1, 1);
      String(o.text || 'Текст').split('\n').forEach((line, i) => c.fillText(line, 0, i * (o.fontSize || o.h * .75) * 1.2));
      return;
    }
    drawLocal(c, o);
  }
  function drawObject(c,o,sc,frame){
    if(!o||!isFinite(o.x)||!isFinite(o.y))return;const w=Math.max(.001,o.w||1),h=Math.max(.001,o.h||1);
    c.save();c.globalAlpha*=clamp(o.opacity==null?1:o.opacity,0,1);c.translate(o.x+w/2,o.y+h/2);c.rotate((o.rotation||0)*Math.PI/180);c.translate(-w/2,-h/2);
    const fstr=spriteFilter(o); if(fstr){ c.filter=fstr; }
    const crop=cropRect(o); if(crop){ c.beginPath(); c.rect(crop.x,crop.y,crop.w,crop.h); c.clip(); }
    if(o.type==='group'&&Array.isArray(o.children)){
      const gw=Math.max(.001,o.gw||o.w),gh=Math.max(.001,o.gh||o.h); c.save(); c.scale(w/gw,h/gh);
      o.children.forEach(ch=>drawObject(c,ch,null,0)); c.restore(); c.filter='none'; c.restore(); return;
    }
    if(hasWarp(o.warp)){
      const tex=textureFor(c,o),pad=meshPadding(o),tr=c.getTransform(),overlap=.65/Math.max(.05,Math.min(Math.hypot(tr.a,tr.b),Math.hypot(tr.c,tr.d)));
      meshTriangles(o,pad).forEach(t=>{c.save();const center={x:(t.dest[0].x+t.dest[1].x+t.dest[2].x)/3,y:(t.dest[0].y+t.dest[1].y+t.dest[2].y)/3};
        const p=t.dest.map(q=>{const dx=q.x-center.x,dy=q.y-center.y,n=Math.hypot(dx,dy)||1;return {x:q.x+overlap*dx/n,y:q.y+overlap*dy/n};});
        c.beginPath();c.moveTo(p[0].x,p[0].y);c.lineTo(p[1].x,p[1].y);c.lineTo(p[2].x,p[2].y);c.closePath();c.clip();c.transform(...t.matrix);c.drawImage(tex,-pad,-pad,w+2*pad,h+2*pad);c.restore();});
    }else drawLocal(c,o);
    c.filter='none'; c.restore();
  }
  /* Спрайт с маской: маска — другой объект сцены (o.maskBy = id). */
  function drawSprite(c,o,sc,frame){
    if(o.maskBy){
      const mask=findObject(sc,frame==null?0:frame,o.maskBy);
      if(mask){ c.save(); maskPath(c,[mask]); drawObject(c,o,sc,frame); c.restore(); return; }
    }
    drawObject(c,o,sc,frame);
  }
  function isVisible(sc,l){
    if(!l.visible)return false;let pid=l.parentId,count=0;while(pid&&count++<20){const p=sc.layers.find(q=>q.id===pid);if(!p||!p.visible)return false;pid=p.parentId;}return true;
  }
  function maskPath(c,objects){
    c.beginPath();objects.forEach(o=>{if(o.type==='text'||o.type==='mesh')return;c.save();c.translate(o.x+o.w/2,o.y+o.h/2);c.rotate((o.rotation||0)*Math.PI/180);c.translate(-o.w/2,-o.h/2);
      if(hasWarp(o.warp)){warpedMaskPolygons(o).forEach(poly=>{c.moveTo(poly[0].x,poly[0].y);poly.slice(1).forEach(p=>c.lineTo(p.x,p.y));c.closePath();});}else traceObject(c,o);c.restore();});c.clip();
  }
  function drawAt(c,d,sc,frame,opt){
    if(!d||!sc)return;opt=opt||{};frame=clamp(Number(frame)||0,0,Math.max(0,sc.frames-1));c.save();
    if(sc.background){c.fillStyle=sc.background;c.fillRect(0,0,d.width,d.height);}
    applyCamera(c,sc,d,frame);
    for(let i=sc.layers.length-1;i>=0;i--){const l=sc.layers[i];if(!isVisible(sc,l)||l.type==='folder'||l.type==='mask'||(l.type==='guide'&&!opt.guides))continue;
      c.save();if(l.type==='guide') c.globalAlpha*=.4;
      const mask=i>0?sc.layers[i-1]:null;
      if(mask&&mask.type==='mask'&&isVisible(sc,mask)) maskPath(c,objectsAt(mask,frame));
      objectsAt(l,frame).forEach(o=>drawSprite(c,o,sc,frame));c.restore();
    }
    c.restore();
  }
  function renderClip(c,data,time,pw,ph){
    const d=doc(),sc=d&&d.scenes.find(x=>x.id===(data&&data.sceneId));if(!d||!sc)return;
    c.save();c.translate(-pw/2,-ph/2);c.scale(pw/d.width,ph/d.height);drawAt(c,d,sc,Math.floor(Math.max(0,time)*d.fps));c.restore();
  }
  function makeObject(type,x,y,w,h,style){
    style=style||{};return {id:uid('obj'),type,x,y,w:Math.max(1,w),h:Math.max(1,h),rotation:0,opacity:1,
      fill:style.fill||'#20d5c2',fill2:style.fill2||'#6b75ff',stroke:style.stroke||'#ffffff',strokeWidth:style.strokeWidth==null?4:style.strokeWidth,
      text:'Текст',font:'Arial',fontSize:Math.max(18,style.fontSize||80),bold:false,sides:5,closed:type!=='path'};
  }
  PPE.animation={clone,newLayer,newScene,newDoc,doc,ensureDoc,scene,layer,sortedKeys,keyAt,frameBound,objectsAt,ensureKey,editKey,
    cameraAt,ensureCamera,applyCamera,worldFromStage,stageFromWorld,objLocal,objWorld,outline,resample,traceObject,drawObject,drawSprite,drawAt,renderClip,makeObject,isVisible,makeWarp,validWarp,hasWarp,meshTriangles,meshPadding,warpedMaskPolygons,imageFor,sceneImageIds,preloadImages,
    bezierEase,spriteFilter,cropRect,findObject,maskPath};
})(window);
