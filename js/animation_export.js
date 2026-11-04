/* Локальный экспорт анимации и ограниченный импорт встроенной glTF-сетки. */
(function(root){
  'use strict';
  const PPE=root.PPE=root.PPE||{}, U=PPE.utils, S=PPE.state, A=PPE.animation;
  const {$,el,clamp,escapeHtml:esc}=U;
  function context(){const d=A.doc(),ui=PPE.animationUI.state,sc=A.scene(d,ui.sceneId);return {d,sc,frame:ui.frame};}
  const n=v=>String(Math.round((Number(v)||0)*1000)/1000);
  function svgPath(o){
    const w=Math.max(1,o.w),h=Math.max(1,o.h);
    if(o.type==='oval')return '<ellipse cx="'+n(w/2)+'" cy="'+n(h/2)+'" rx="'+n(w/2)+'" ry="'+n(h/2)+'"/>';
    if(o.type==='star'){const pts=A.outline(o,Math.max(6,(o.sides||5)*2));return '<polygon points="'+pts.map(p=>n(p.x*w)+','+n(p.y*h)).join(' ')+'"/>';}
    if(o.type==='path'){
      const pts=o.points||[];if(!pts.length)return '';
      return '<path d="M '+pts.map(p=>n(p.x*w)+' '+n(p.y*h)).join(' L ')+(o.closed?' Z':'')+'"/>';
    }
    return '<rect x="0" y="0" width="'+n(w)+'" height="'+n(h)+'"'+(['button','input'].includes(o.type)?' rx="'+n(Math.min(14,h*.15))+'"':'')+'/>';
  }
  function transform(o){return 'translate('+n(o.x+o.w/2)+' '+n(o.y+o.h/2)+') rotate('+n(o.rotation||0)+') translate('+n(-o.w/2)+' '+n(-o.h/2)+')';}
  function cutMarkup(cut,o){
    const pts=cut.points||[];if(!pts.length)return '';
    if(cut.kind==='polygon')return '<polygon fill="black" points="'+pts.map(p=>n(p.x*o.w)+','+n(p.y*o.h)).join(' ')+'"/>';
    return '<path d="M '+pts.map(p=>n(p.x*o.w)+' '+n(p.y*o.h)).join(' L ')+'" fill="none" stroke="black" stroke-linecap="round" stroke-linejoin="round" stroke-width="'+n((cut.radius||.04)*Math.min(o.w,o.h)*2)+'"/>';
  }
  function svgObject(o,defs,id,assets){
    const w=Math.max(1,o.w||1),h=Math.max(1,o.h||1),opacity=clamp(o.opacity==null?1:o.opacity,0,1);let fill=o.fill||'none';if(fill==='transparent')fill='none';
    if(o.gradient&&o.fill2){const g=o.gradient,gid='grad'+id;defs.push('<linearGradient id="'+gid+'" gradientUnits="userSpaceOnUse" x1="'+n((g.x1||0)*w)+'" y1="'+n((g.y1||0)*h)+'" x2="'+n((g.x2==null?1:g.x2)*w)+'" y2="'+n((g.y2==null?1:g.y2)*h)+'"><stop stop-color="'+esc(o.fill||'#fff')+'"/><stop offset="1" stop-color="'+esc(o.fill2)+'"/></linearGradient>');fill='url(#'+gid+')';}
    let mask='';if(o.cuts&&o.cuts.length){const mid='mask'+id;defs.push('<mask id="'+mid+'" maskUnits="userSpaceOnUse" x="-10000" y="-10000" width="20000" height="20000"><rect x="-10000" y="-10000" width="20000" height="20000" fill="white"/>'+o.cuts.map(c=>cutMarkup(c,o)).join('')+'</mask>');mask=' mask="url(#'+mid+')"';}
    const stroke=o.strokeWidth>0?esc(o.stroke||'none'):'none',attr='fill="'+esc(fill)+'" stroke="'+stroke+'" stroke-width="'+n(o.strokeWidth||0)+'" stroke-linecap="round" stroke-linejoin="round"';
    let shape='';
    if(o.type==='text'){
      const size=o.fontSize||h*.75;shape='<g transform="scale('+n(o.textScaleX||1)+' 1)"><text fill="'+esc(o.fill||'#fff')+'" font-family="'+esc(o.font||'Arial')+'" font-size="'+n(size)+'"'+(o.bold?' font-weight="bold"':'')+'>'+String(o.text||'Текст').split('\n').map((line,i)=>'<tspan x="0" y="'+n(size*(.9+i*1.2))+'">'+esc(line)+'</tspan>').join('')+'</text></g>';
    }else if(o.type==='image'){
      const media=S.findMedia(o.mediaId),source=assets&&assets[o.mediaId]||(media&&media.url)||'';shape=source?'<image width="'+n(w)+'" height="'+n(h)+'" preserveAspectRatio="none" href="'+esc(source)+'"/>':'<rect width="'+n(w)+'" height="'+n(h)+'" fill="#555"/>';
    }else if(o.type==='mesh'){
      const v=o.vertices||[],indices=o.indices||[],count=indices.length||Math.floor(v.length/3),p=i=>n(w/2+(v[i*3]||0)*w*.38)+','+n(h/2-(v[i*3+1]||0)*h*.38);for(let i=0;i+2<count;i+=3)shape+='<polygon points="'+p(indices.length?indices[i]:i)+' '+p(indices.length?indices[i+1]:i+1)+' '+p(indices.length?indices[i+2]:i+2)+'" '+attr+'/>';
    }else{
      shape='<g '+attr+'>'+svgPath(o)+'</g>';
      if(o.type==='button'||o.type==='input')shape+='<text x="'+n(w/2)+'" y="'+n(h/2)+'" text-anchor="middle" dominant-baseline="middle" fill="'+esc(o.textColor||'#fff')+'" font-family="Arial" font-weight="600" font-size="'+n(Math.max(10,Math.min(h*.45,o.fontSize||40)))+'">'+esc(o.text||'')+'</text>';
    }
    if(A.hasWarp(o.warp)){
      const base='warpbase'+id;defs.push('<g id="'+base+'"'+mask+'>'+shape+'</g>');
      const warped=A.meshTriangles(o,A.meshPadding(o)).map((tri,j)=>{const clip='warpclip'+id+'_'+j,pts=tri.dest.map(p=>n(p.x)+','+n(p.y)).join(' ');defs.push('<clipPath id="'+clip+'" clipPathUnits="userSpaceOnUse"><polygon points="'+pts+'"/></clipPath>');return '<g clip-path="url(#'+clip+')"><use href="#'+base+'" transform="matrix('+tri.matrix.map(n).join(' ')+')"/></g>';}).join('');
      return '<g transform="'+transform(o)+'" opacity="'+n(opacity)+'">'+warped+'</g>';
    }
    return '<g transform="'+transform(o)+'" opacity="'+n(opacity)+'"'+mask+'>'+shape+'</g>';
  }
  function toSVG(d,sc,frame,assets){
    const defs=[],contents=[];let id=0;
    const cam=A.cameraAt(sc,d,frame);
    for(let i=sc.layers.length-1;i>=0;i--){const layer=sc.layers[i];if(!A.isVisible(sc,layer)||['folder','mask','guide'].includes(layer.type))continue;
      let mask='';const m=i>0?sc.layers[i-1]:null;
      if(m&&m.type==='mask'&&A.isVisible(sc,m)){const cid='clip'+(++id);const shapes=A.objectsAt(m,frame).map(o=>{const shape=A.hasWarp(o.warp)?A.warpedMaskPolygons(o).map(poly=>'<polygon points="'+poly.map(p=>n(p.x)+','+n(p.y)).join(' ')+'"/>').join(''):svgPath(o);return '<g transform="'+transform(o)+'">'+shape+'</g>';}).join('');defs.push('<clipPath id="'+cid+'" clipPathUnits="userSpaceOnUse">'+shapes+'</clipPath>');mask=' clip-path="url(#'+cid+')"';}
      contents.push('<g'+mask+'>'+A.objectsAt(layer,frame).map(o=>svgObject(o,defs,++id,assets)).join('')+'</g>');
    }
    const bg=sc.background?'<rect width="100%" height="100%" fill="'+esc(sc.background)+'"/>':'';
    const tr='translate('+n(d.width/2)+' '+n(d.height/2)+') rotate('+n(-(cam.rotation||0))+') scale('+n(cam.zoom||1)+') translate('+n(-cam.x)+' '+n(-cam.y)+')';
    return '<svg xmlns="http://www.w3.org/2000/svg" width="'+d.width+'" height="'+d.height+'" viewBox="0 0 '+d.width+' '+d.height+'"><defs>'+defs.join('')+'</defs>'+bg+'<g transform="'+tr+'">'+contents.join('')+'</g></svg>';
  }
  async function requireImages(sc,frame){const missing=await A.preloadImages(sc,frame);if(missing.length)throw new Error('Перепривяжите изображения: '+missing.slice(0,4).join(', '));}
  async function embeddedAssets(sc,frame){
    await requireImages(sc,frame);const ids=A.sceneImageIds(sc,frame),out={};
    await Promise.all(Array.from(ids).map(async id=>{const m=S.findMedia(id);let blob=m&&m.file;
      if(!blob&&m&&m.url){try{blob=await (await fetch(m.url)).blob();}catch(e){}}
      if(blob){out[id]=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error('Ошибка чтения '+m.name));r.readAsDataURL(blob);});}
      else{const img=A.imageFor({mediaId:id});if(!img||!img.naturalWidth)throw new Error('Не прочитано изображение: '+(m?m.name:id));const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;c.getContext('2d').drawImage(img,0,0);out[id]=c.toDataURL('image/png');}
    }));return out;
  }
  async function svg(){const {d,sc,frame}=context();try{const assets=await embeddedAssets(sc,frame),source=toSVG(d,sc,frame,assets);U.download(source,U.safeFileName(sc.name+'_frame_'+(frame+1),'svg'),'image/svg+xml');U.toast('SVG: сохранён текущий кадр','success');return source;}catch(e){U.toast('SVG: '+e.message,'error',6500);return null;}}
  function interactiveItems(d,sc,frame){const cam=A.cameraAt(sc,d,frame),out=[];sc.layers.forEach(l=>{if(!A.isVisible(sc,l)||['guide','mask','folder'].includes(l.type))return;
    A.objectsAt(l,frame).forEach(o=>{if(o.type!=='button'&&o.type!=='input')return;const pos=A.stageFromWorld({x:o.x,y:o.y},sc,d,frame);out.push({id:o.id,type:o.type,x:pos.x,y:pos.y,w:o.w*(cam.zoom||1),h:o.h*(cam.zoom||1),text:o.text,action:o.action,actionFrame:o.actionFrame,url:o.url});});});return out;}
  async function html(){
    const {d,sc}=context();U.toast('Подготавливаю HTML / Canvas…');const frames=[],items=[];let assets;try{assets=await embeddedAssets(sc);}catch(e){U.toast('HTML: '+e.message,'error',6500);return null;}
    const placeholders={};Object.keys(assets).forEach(id=>placeholders[id]='__FF_IMAGE_'+id+'__');
    for(let f=0;f<sc.frames;f++){frames.push(toSVG(d,sc,f,placeholders));items.push(interactiveItems(d,sc,f));if(f%20===19)await new Promise(r=>setTimeout(r,0));}
    const payload=JSON.stringify({width:d.width,height:d.height,fps:d.fps,frames,items,assets,code:sc.code||''}).replace(/</g,'\\u003c');
    const script=`
(function(){'use strict';
 const data=${payload}, canvas=document.getElementById('stage'), ctx=canvas.getContext('2d'),overlay=document.getElementById('fields');
 let index=0,playing=true,last=performance.now(),inputs=new Map(),images=new Map();
 function imageAt(i){if(images.has(i))return images.get(i);const pic=new Image();images.set(i,pic);pic.onload=()=>{if(index===i)paint();};pic.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(data.frames[i].replace(/__FF_IMAGE_([a-zA-Z0-9_-]+)__/g,(all,id)=>data.assets[id]||''));while(images.size>6){let oldest=images.keys().next().value;if(oldest===index||oldest===i){const tmp=images.get(oldest);images.delete(oldest);images.set(oldest,tmp);}else images.delete(oldest);}return pic;}
 function displayFields(){const now=data.items[index].filter(o=>o.type==='input'),ids=new Set(now.map(o=>o.id));
   inputs.forEach((field,id)=>{if(!ids.has(id)){field.remove();inputs.delete(id);}});
   now.forEach(o=>{let field=inputs.get(o.id);if(!field){field=document.createElement('input');field.placeholder=o.text||'Текст';field.setAttribute('aria-label',o.text||'Поле ввода');overlay.appendChild(field);inputs.set(o.id,field);}
     field.style.left=(o.x/data.width*100)+'%';field.style.top=(o.y/data.height*100)+'%';field.style.width=(o.w/data.width*100)+'%';field.style.height=(o.h/data.height*100)+'%';});}
 function paint(){const img=imageAt(index);if(img.complete&&img.naturalWidth){ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);}displayFields();imageAt((index+1)%data.frames.length);}
 const api={canvas,play(){playing=true;last=performance.now();},pause(){playing=false;},toggle(){playing=!playing;last=performance.now();},go(f){index=Math.max(0,Math.min(data.frames.length-1,Math.floor(Number(f)||0)));paint();},frame(){return index;}};
 canvas.addEventListener('click',e=>{const r=canvas.getBoundingClientRect(),x=(e.clientX-r.left)*data.width/r.width,y=(e.clientY-r.top)*data.height/r.height;
   const items=data.items[index];for(let i=0;i<items.length;i++){const o=items[i];if(o.type!=='button'||x<o.x||x>o.x+o.w||y<o.y||y>o.y+o.h)continue;
   if(o.action==='goto')api.go(o.actionFrame||0);else if(o.action==='url'){try{const u=new URL(o.url);if(u.protocol==='https:'||u.protocol==='http:')window.open(u.href,'_blank','noopener');}catch(_){}}else api.toggle();break;}});
 try{if(data.code)new Function('api',data.code)(api);}catch(e){console.warn('Actions:',e);}
 function loop(now){if(playing&&now-last>=1000/data.fps){const steps=Math.floor((now-last)*data.fps/1000);index=(index+steps)%data.frames.length;last+=steps*1000/data.fps;}paint();requestAnimationFrame(loop);}paint();requestAnimationFrame(loop);
})();`;
    const result='<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>'+esc(sc.name)+'</title>'+
      '<style>html,body{margin:0;width:100%;height:100%;background:#111;display:grid;place-items:center}#wrapper{position:relative;width:min(100vw,calc(100vh * '+(d.width/d.height)+'));aspect-ratio:'+d.width+'/'+d.height+'}canvas{display:block;width:100%;height:100%;background:transparent}#fields{position:absolute;inset:0;pointer-events:none}#fields input{position:absolute;box-sizing:border-box;pointer-events:auto;font:inherit;background:#ffffffde;color:#111;border:1px solid #888;border-radius:4px}</style></head><body><div id="wrapper"><canvas id="stage" width="'+d.width+'" height="'+d.height+'"></canvas><div id="fields"></div></div>'+'<scr'+'ipt>'+script+'<\/scr'+'ipt></body></html>';
    U.download(result,U.safeFileName(sc.name,'html'),'text/html;charset=utf-8');U.toast('HTML / JavaScript Canvas сохранён; аудио в него не встроено','success',5500);return result;
  }
  function bytes(s){return Uint8Array.from(Array.from(s).map(ch=>ch.charCodeAt(0)));}
  function little(v){return [v&255,(v>>8)&255];}
  function gifHeader(w,h){const a=[...bytes('GIF89a'),...little(w),...little(h),0xf7,0,0];for(let i=0;i<256;i++)a.push(Math.round(((i>>5)&7)*255/7),Math.round(((i>>2)&7)*255/7),Math.round((i&3)*255/3));
    a.push(0x21,0xff,0x0b,...bytes('NETSCAPE2.0'),3,1,0,0,0);return Uint8Array.from(a);}
  /* Valid GIF LZW, deliberately resets before code growth: robust without a library. */
  function gifFrame(imageData,w,h,delay){
    const src=imageData.data,num=w*h,totalCodes=num+Math.ceil(num/200)+4,raw=new Uint8Array(Math.ceil(totalCodes*9/8)+4);let at=0,bits=0,acc=0;
    function emit(code){acc|=code<<bits;bits+=9;while(bits>=8){raw[at++]=acc&255;acc>>>=8;bits-=8;}}
    emit(256);let count=0;
    for(let i=0;i<src.length;i+=4){if(count===200){emit(256);count=0;}emit((src[i]&0xe0)|((src[i+1]&0xe0)>>3)|(src[i+2]>>6));count++;}
    emit(257);if(bits>0)raw[at++]=acc&255;
    const prefix=Uint8Array.from([0x21,0xf9,4,4,...little(delay),0,0,0x2c,0,0,0,0,...little(w),...little(h),0,8]);
    const packed=new Uint8Array(at+Math.ceil(at/255)+1);let p=0;for(let i=0;i<at;i+=255){const size=Math.min(255,at-i);packed[p++]=size;packed.set(raw.subarray(i,i+size),p);p+=size;}packed[p++]=0;
    return [prefix,packed.subarray(0,p)];
  }
  async function makeGif(d,sc,progress){
    await requireImages(sc);const scale=Math.min(1,480/d.width,480/d.height),w=Math.max(1,Math.round(d.width*scale)),h=Math.max(1,Math.round(d.height*scale)),count=Math.min(sc.frames,240);
    const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d',{willReadFrequently:true}),parts=[gifHeader(w,h)];
    for(let f=0;f<count;f++){
      x.setTransform(1,0,0,1,0,0);x.fillStyle='#111111';x.fillRect(0,0,w,h);x.setTransform(w/d.width,0,0,h/d.height,0,0);A.drawAt(x,d,sc,f);
      const image=x.getImageData(0,0,w,h);const delay=Math.max(1,Math.round((f+1)*100/d.fps)-Math.round(f*100/d.fps));parts.push(...gifFrame(image,w,h,delay));if(progress)progress(f+1,count);if(f%4===3)await new Promise(r=>setTimeout(r,0));
    }
    parts.push(Uint8Array.of(0x3b));return new Blob(parts,{type:'image/gif'});
  }
  async function gif(){const {d,sc}=context();U.toast('Создаю GIF: до 240 кадров, без прозрачности…',null,5000);try{const blob=await makeGif(d,sc);U.download(blob,U.safeFileName(sc.name,'gif'));U.toast('GIF готов: '+Math.min(sc.frames,240)+' кадров','success',4500);return blob;}catch(e){U.toast('Не удалось создать GIF: '+e.message,'error');}}
  async function atlas(){
    const {d,sc}=context();try{await requireImages(sc);}catch(e){U.toast('Атлас: '+e.message,'error',6500);return null;}const count=Math.min(sc.frames,120),scale=Math.min(1,192/d.width,192/d.height),fw=Math.max(1,Math.round(d.width*scale)),fh=Math.max(1,Math.round(d.height*scale));
    let cols=Math.ceil(Math.sqrt(count*fh/fw));cols=clamp(cols,1,count);let rows=Math.ceil(count/cols);
    if(cols*fw>4096||rows*fh>4096){U.toast('Атлас слишком большой','error');return;}
    const c=document.createElement('canvas');c.width=cols*fw;c.height=rows*fh;const x=c.getContext('2d');const frames=[];
    for(let i=0;i<count;i++){const px=(i%cols)*fw,py=Math.floor(i/cols)*fh;x.save();x.translate(px,py);x.scale(fw/d.width,fh/d.height);A.drawAt(x,d,sc,i);x.restore();frames.push({frame:i,x:px,y:py,width:fw,height:fh});if(i%10===9)await new Promise(r=>setTimeout(r,0));}
    const filename=U.safeFileName(sc.name+'_atlas','png'),meta={image:filename,width:c.width,height:c.height,fps:d.fps,frames};
    c.toBlob(blob=>{if(!blob){U.toast('Не удалось создать атлас','error');return;}U.download(blob,filename);setTimeout(()=>U.download('const FRAMEFORGE_ATLAS = '+JSON.stringify(meta,null,2)+';\n',U.safeFileName(sc.name+'_atlas','js'),'text/javascript'),200);U.toast('Атлас PNG и файл метаданных JS готовы','success',5000);},'image/png');return {canvas:c,meta};
  }
  function decodeDataURI(uri){const m=/^data:.*?;base64,(.*)$/i.exec(uri||'');if(!m)throw new Error('Для glTF нужны встроенные base64-буферы или GLB');const bin=atob(m[1]),arr=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);return arr.buffer;}
  function parseGLTF(data,name){
    const view=new DataView(data);let json,bin=null;
    if(data.byteLength>=12&&view.getUint32(0,true)===0x46546c67){
      if(view.getUint32(4,true)!==2)throw new Error('Поддерживается только GLB версии 2');let off=12;
      while(off+8<=data.byteLength){const len=view.getUint32(off,true),type=view.getUint32(off+4,true);off+=8;if(off+len>data.byteLength)throw new Error('Повреждённый GLB');
        if(type===0x4e4f534a)json=JSON.parse(new TextDecoder().decode(new Uint8Array(data,off,len)).replace(/\u0000+$/,''));else if(type===0x004e4942)bin=data.slice(off,off+len);off+=len;}
    }else json=JSON.parse(new TextDecoder().decode(data));
    if(!json||!json.asset||String(json.asset.version||'').split('.')[0]!=='2')throw new Error('Поддерживается glTF 2.0');
    const prim=json.meshes&&json.meshes[0]&&json.meshes[0].primitives&&json.meshes[0].primitives[0];
    if(!prim||!prim.attributes||prim.attributes.POSITION==null)throw new Error('В первой сетке нет вершин POSITION');
    if(prim.mode!=null&&prim.mode!==4)throw new Error('Поддерживаются только треугольники (TRIANGLES)');
    const buffers=(json.buffers||[]).map((b,i)=>b.uri?decodeDataURI(b.uri):(i===0&&bin?bin:null));
    if(buffers.some(b=>!b))throw new Error('Внешние .bin файлы не поддерживаются: используйте GLB или встроенный glTF');
    function readAccessor(index){
      const a=json.accessors&&json.accessors[index];if(!a||a.sparse||a.bufferView==null)throw new Error('Разреженные accessor не поддерживаются');
      const bv=json.bufferViews[a.bufferView],buf=buffers[bv.buffer];if(!bv||!buf)throw new Error('Нет буфера геометрии');
      const components=({SCALAR:1,VEC2:2,VEC3:3,VEC4:4})[a.type];const size=({5120:1,5121:1,5122:2,5123:2,5125:4,5126:4})[a.componentType];
      if(!components||!size||a.count>15000)throw new Error('Неподдерживаемый формат или слишком большая сетка');
      const stride=bv.byteStride||size*components,start=(bv.byteOffset||0)+(a.byteOffset||0),dv=new DataView(buf),out=[];
      const getter=({5120:'getInt8',5121:'getUint8',5122:'getInt16',5123:'getUint16',5125:'getUint32',5126:'getFloat32'})[a.componentType];
      if(start+(a.count-1)*stride+components*size>dv.byteLength)throw new Error('Буфер выходит за границы файла');
      for(let i=0;i<a.count;i++)for(let j=0;j<components;j++){const value=dv[getter](start+i*stride+j*size,true);if(!Number.isFinite(value))throw new Error('Некорректная координата');out.push(value);}return {values:out,count:a.count,components};
    }
    const pos=readAccessor(prim.attributes.POSITION);if(pos.components!==3||pos.count>5000)throw new Error('Поддерживается VEC3 до 5000 вершин');
    let inds=prim.indices==null?Array.from({length:pos.count},(_,i)=>i):readAccessor(prim.indices).values;
    if(inds.length>18000||inds.some(i=>!Number.isInteger(i)||i<0||i>=pos.count))throw new Error('Слишком много треугольников или неверные индексы');
    inds=inds.slice(0,Math.floor(inds.length/3)*3);
    const v=pos.values,min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<v.length;i++) {const j=i%3;min[j]=Math.min(min[j],v[i]);max[j]=Math.max(max[j],v[i]);}
    const center=min.map((a,i)=>(a+max[i])/2),extent=Math.max(max[0]-min[0],max[1]-min[1],max[2]-min[2],.0001);
    const vertices=v.map((a,i)=>(a-center[i%3])*2/extent);
    return {name:name||'glTF',vertices,indices:inds,vertexCount:pos.count,triangles:inds.length/3};
  }
  function showWebGL(canvas,mesh){
    const gl=canvas.getContext('webgl',{alpha:true,antialias:true});if(!gl)return false;
    function shader(type,src){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;}
    const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,'attribute vec3 pos; varying float shade; void main(){float a=0.48; vec3 p=vec3(pos.x*cos(a)+pos.z*sin(a),pos.y,-pos.x*sin(a)+pos.z*cos(a)); gl_Position=vec4(p.xy*0.75, p.z*0.2,1.0);shade=0.7+p.z*0.15;}'));
    gl.attachShader(program,shader(gl.FRAGMENT_SHADER,'precision mediump float; varying float shade; void main(){gl_FragColor=vec4(0.25*shade,0.9*shade,0.78*shade,1.0);}'));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));gl.useProgram(program);
    const flat=[];mesh.indices.forEach(i=>flat.push(mesh.vertices[i*3],mesh.vertices[i*3+1],mesh.vertices[i*3+2]));const buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(flat),gl.STATIC_DRAW);
    const a=gl.getAttribLocation(program,'pos');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,3,gl.FLOAT,false,0,0);gl.viewport(0,0,canvas.width,canvas.height);gl.clearColor(.06,.08,.08,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.enable(gl.DEPTH_TEST);gl.drawArrays(gl.TRIANGLES,0,flat.length/3);return true;
  }
  function importGLTF(){
    const input=el('input',{type:'file',accept:'.gltf,.glb,model/gltf+json,model/gltf-binary'});input.style.display='none';document.body.appendChild(input);
    input.addEventListener('change',async()=>{const file=input.files&&input.files[0];input.remove();if(!file)return;
      try{if(file.size>10*1024*1024)throw new Error('Максимум 10 МБ');const mesh=parseGLTF(await file.arrayBuffer(),file.name);
        const body=el('div',{},[el('p',{class:'an-note',text:mesh.name+' · '+mesh.vertexCount+' вершин · '+mesh.triangles+' треугольников'}),
          el('canvas',{id:'anWebGL',width:300,height:220,style:{display:'block',maxWidth:'100%',height:'auto',margin:'10px auto',background:'#101414',borderRadius:'8px'}}),
          el('p',{class:'an-note',text:'Импортируется только первая сетка с треугольниками. Текстуры, материалы, скелет, анимация и внешние .bin файлы не поддерживаются. В сцене используется простая 2D-проекция.'})]);
        U.modal({title:'Предпросмотр glTF / WebGL',body,buttons:[{label:'Отмена'},{label:'Добавить в сцену',class:'primary',action:()=>PPE.animationUI.createMeshObject(mesh)}],onOpen:b=>{try{if(!showWebGL($('#anWebGL',b),mesh))U.toast('WebGL недоступен: можно добавить 2D-проекцию','warn');}catch(e){U.toast('WebGL: '+e.message,'warn');}}});
      }catch(err){U.toast('Не удалось импортировать glTF: '+err.message,'error',6000);}
    },{once:true});input.click();
  }
  PPE.animationExport={svg,html,gif,atlas,toSVG,makeGif,parseGLTF,showWebGL,importGLTF,gifFrame};
})(window);
