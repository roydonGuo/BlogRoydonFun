(() => {
  const data = window.MINDMAP_DATA;
  const palette = ['#2445EB','#6D5CE7','#1687D9','#D97706','#DB4B72','#0F8B8D','#4F63D8','#64748B'];
  const byId = new Map(), parent = new Map(), descendants = new Map();
  function index(node, p = null, branch = 0) {
    node._branch = branch; byId.set(node.id, node); if (p) parent.set(node.id, p.id);
    let total = 0; (node.children || []).forEach((c, i) => { index(c, node, p ? branch : i); total += 1 + descendants.get(c.id); });
    descendants.set(node.id, total);
  }
  index(data);

  const expanded = new Set([data.id, ...(data.children || []).map(n => n.id)]);
  const viewport = document.querySelector('#viewport'), canvas = document.querySelector('#canvas');
  const nodesLayer = document.querySelector('#nodes'), links = document.querySelector('#links');
  const inspector = document.querySelector('#inspector'), searchInput = document.querySelector('#searchInput'), searchPanel = document.querySelector('#searchPanel');
  let selected = null, scale = 1, panX = innerWidth / 2, panY = innerHeight / 2 + 20, dragging = false, dragStart;
  const W = innerWidth < 760 ? 260 : 320, ROOT_W = 180, GAP_X = 105, GAP_Y = 16;
  const heightCache = new Map();
  let savedWidths = {};
  try { savedWidths = JSON.parse(localStorage.getItem('mindmap-node-widths') || '{}'); } catch (_) {}
  const nodeWidths = new Map(Object.entries(savedWidths).map(([id, width]) => [id, Number(width)]));
  const nodeWidth = n => n.id === data.id ? ROOT_W : Math.max(220, Math.min(760, nodeWidths.get(n.id) || W));

  const esc = s => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const children = n => n.children || [];
  function imageMarkup(n) {
    if (!n.image) return '';
    const ratio = n.image.width > 0 && n.image.height > 0 ? n.image.height / n.image.width : .6;
    const height = Math.min(300, Math.max(90, Math.round((nodeWidth(n) - 50) * ratio)));
    return `<img class="node-image" src="${esc(n.image.src)}" alt="${esc(n.title.split('\n')[0])} 配图" loading="lazy" style="height:${height}px">`;
  }
  const bodyMarkup = n => `<span class="node-body"><span class="node-title">${esc(n.title)}</span>${imageMarkup(n)}</span>`;
  function cardHeight(n) {
    if (n.id === data.id) return 76;
    if (heightCache.has(n.id)) return heightCache.get(n.id);
    const probe = document.createElement('div');
    const isBranch = parent.get(n.id) === data.id;
    probe.className = `node ${isBranch ? 'branch' : ''}`;
    probe.style.cssText = `position:fixed;left:-10000px;top:0;width:${nodeWidth(n)}px;height:auto;min-height:50px;visibility:hidden;--accent:#175c46`;
    probe.innerHTML = `${bodyMarkup(n)}${children(n).length ? `<span class="node-count">${descendants.get(n.id)}</span>` : ''}`;
    document.body.appendChild(probe);
    const height = Math.ceil(probe.getBoundingClientRect().height);
    probe.remove();
    heightCache.set(n.id, height);
    return height;
  }
  function visibleTree(node, side) {
    const kids = expanded.has(node.id) ? children(node) : [];
    return { node, side, kids: kids.map(c => visibleTree(c, side)) };
  }
  function measure(t) { t.h = Math.max(cardHeight(t.node), t.kids.reduce((s, c) => s + measure(c), 0) + Math.max(0, t.kids.length - 1) * GAP_Y); return t.h; }
  function position(t, depth, top, side, out, parentLayout = null) {
    const h = cardHeight(t.node), center = top + t.h / 2, width = nodeWidth(t.node);
    t.x = parentLayout
      ? (side > 0 ? parentLayout.x + parentLayout.w + GAP_X : parentLayout.x - GAP_X - width)
      : (side > 0 ? 100 : -100 - width);
    t.y = center - h / 2; t.w = width; t.cardH = h; out.push(t);
    let cy = top; t.kids.forEach(k => { position(k, depth + 1, cy, side, out, t); cy += k.h + GAP_Y; });
  }
  function render() {
    nodesLayer.innerHTML = ''; links.innerHTML = '';
    const leftRoots = [], rightRoots = [];
    data.children.forEach((n, i) => (i % 2 ? leftRoots : rightRoots).push(visibleTree(n, i % 2 ? -1 : 1)));
    [...leftRoots, ...rightRoots].forEach(measure);
    const total = arr => arr.reduce((s,t)=>s+t.h,0) + Math.max(0,arr.length-1)*GAP_Y;
    const placed = [], layoutSide = (arr, side) => { let y = -total(arr)/2; arr.forEach(t => { position(t,0,y,side,placed); y += t.h+GAP_Y; }); };
    layoutSide(leftRoots,-1); layoutSide(rightRoots,1);
    placed.push({node:data,x:-ROOT_W/2,y:-38,w:ROOT_W,cardH:76,side:0,kids:[]});

    const ns='http://www.w3.org/2000/svg';
    placed.forEach(t => {
      if (t.node.id !== data.id) {
        const pid=parent.get(t.node.id), p=placed.find(x=>x.node.id===pid);
        const sx=p ? (t.side>0?p.x+p.w:p.x) : (t.side>0?ROOT_W/2:-ROOT_W/2), sy=p?p.y+p.cardH/2:0;
        const ex=t.side>0?t.x:t.x+t.w, ey=t.y+t.cardH/2, bend=(sx+ex)/2;
        const path=document.createElementNS(ns,'path'); path.setAttribute('d',`M${sx} ${sy} C${bend} ${sy},${bend} ${ey},${ex} ${ey}`); path.setAttribute('stroke',palette[t.node._branch%palette.length]); links.appendChild(path);
      }
      const el=document.createElement('div'), hasKids=children(t.node).length>0, accent=palette[t.node._branch%palette.length];
      el.className=`node ${t.node.id===data.id?'root':parent.get(t.node.id)===data.id?'branch':''} ${t.side>0?'side-right':'side-left'} ${t.node.image?'has-image':''} ${selected===t.node.id?'selected':''}`;
      el.style.cssText=`left:${t.x}px;top:${t.y}px;width:${t.w}px;min-height:${t.cardH}px;--accent:${accent}`;
      el.dataset.id=t.node.id; el.title=t.node.title;
      el.innerHTML=`${bodyMarkup(t.node)}${hasKids?`<span class="node-count">${descendants.get(t.node.id)}</span><span class="node-toggle">${expanded.has(t.node.id)?'−':'+'}</span>`:''}${t.node.id!==data.id?'<span class="resize-handle" title="拖拽调整节点宽度"></span>':''}`;
      const handle = el.querySelector('.resize-handle');
      if (handle) {
        handle.addEventListener('pointerdown', e => {
          e.stopPropagation(); e.preventDefault();
          resizeState = { id: t.node.id, side: t.side, startX: e.clientX, startWidth: t.w };
          document.body.classList.add('resizing');
        });
        handle.addEventListener('click', e => e.stopPropagation());
      }
      el.addEventListener('click',e=>{e.stopPropagation(); selected=t.node.id; if(hasKids){expanded.has(t.node.id)?expanded.delete(t.node.id):expanded.add(t.node.id); render();} showDetails(t.node);});
      nodesLayer.appendChild(el);
    });
    updateTransform();
  }

  function pathFor(node) { const arr=[node.title.split('\n')[0]]; let id=node.id; while(parent.has(id)){id=parent.get(id);arr.unshift(byId.get(id).title.split('\n')[0]);} return arr; }
  function showDetails(node){ selected=node.id; document.querySelector('#detailTitle').textContent=node.title.split('\n')[0]||'未命名主题'; document.querySelector('#detailContent').textContent=node.title; document.querySelector('#breadcrumb').textContent=pathFor(node).join('  ›  '); const img=document.querySelector('#detailImage'); if(node.image){img.src=node.image.src;img.hidden=false}else{img.hidden=true;img.removeAttribute('src')} inspector.classList.add('open');inspector.setAttribute('aria-hidden','false'); document.querySelectorAll('.node').forEach(e=>e.classList.toggle('selected',e.dataset.id===node.id));}
  function reveal(id, center=true){ let p=id; while(parent.has(p)){p=parent.get(p);expanded.add(p)} render(); showDetails(byId.get(id)); if(center)setTimeout(()=>centerNode(id),30); }
  function centerNode(id){const el=document.querySelector(`[data-id="${CSS.escape(id)}"]`);if(!el)return; const x=parseFloat(el.style.left)+el.offsetWidth/2,y=parseFloat(el.style.top)+el.offsetHeight/2; panX=innerWidth/2-x*scale;panY=innerHeight/2-y*scale;updateTransform();}
  function updateTransform(){canvas.style.transform=`translate(${panX}px,${panY}px) scale(${scale})`;document.querySelector('#zoomValue').textContent=Math.round(scale*100)+'%'}
  function zoomTo(next,cx=innerWidth/2,cy=innerHeight/2){next=Math.max(.25,Math.min(2,next));const wx=(cx-panX)/scale,wy=(cy-panY)/scale;panX=cx-wx*next;panY=cy-wy*next;scale=next;updateTransform()}
  function fit(){const els=[...document.querySelectorAll('.node')];if(!els.length)return;let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;els.forEach(e=>{let x=parseFloat(e.style.left),y=parseFloat(e.style.top);minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x+e.offsetWidth);maxY=Math.max(maxY,y+e.offsetHeight)});scale=Math.max(.25,Math.min(1,(innerWidth-90)/(maxX-minX),(innerHeight-150)/(maxY-minY)));panX=(innerWidth-(minX+maxX)*scale)/2;panY=(innerHeight-(minY+maxY)*scale)/2+25;updateTransform()}

  viewport.addEventListener('pointerdown',e=>{if(e.target.closest('.node'))return;dragging=true;viewport.classList.add('dragging');dragStart={x:e.clientX-panX,y:e.clientY-panY};viewport.setPointerCapture(e.pointerId)});
  viewport.addEventListener('pointermove',e=>{if(!dragging)return;panX=e.clientX-dragStart.x;panY=e.clientY-dragStart.y;updateTransform()});
  viewport.addEventListener('pointerup',()=>{dragging=false;viewport.classList.remove('dragging')});
  viewport.addEventListener('wheel',e=>{e.preventDefault();zoomTo(scale*(e.deltaY>0?.9:1.1),e.clientX,e.clientY)},{passive:false});
  let resizeState = null, resizeFrame = 0;
  window.addEventListener('pointermove', e => {
    if (!resizeState) return;
    const screenDelta = e.clientX - resizeState.startX;
    const canvasDelta = screenDelta / scale;
    const next = Math.round(Math.max(220, Math.min(760, resizeState.startWidth + (resizeState.side > 0 ? canvasDelta : -canvasDelta))));
    nodeWidths.set(resizeState.id, next);
    heightCache.delete(resizeState.id);
    if (!resizeFrame) resizeFrame = requestAnimationFrame(() => { resizeFrame = 0; render(); });
  });
  window.addEventListener('pointerup', () => {
    if (!resizeState) return;
    resizeState = null; document.body.classList.remove('resizing');
    localStorage.setItem('mindmap-node-widths', JSON.stringify(Object.fromEntries(nodeWidths)));
  });
  document.querySelector('#zoomIn').onclick=()=>zoomTo(scale*1.2);document.querySelector('#zoomOut').onclick=()=>zoomTo(scale/1.2);document.querySelector('#fitView').onclick=fit;
  document.querySelector('#closeInspector').onclick=()=>{inspector.classList.remove('open');inspector.setAttribute('aria-hidden','true')};
  document.querySelector('#focusNode').onclick=()=>selected&&reveal(selected);
  searchInput.addEventListener('input',()=>{const q=searchInput.value.trim().toLowerCase();if(!q){searchPanel.hidden=true;return}const found=[...byId.values()].filter(n=>n.title.toLowerCase().includes(q)).slice(0,30);searchPanel.innerHTML=found.map(n=>{const short=esc(n.title.split('\n')[0]);return `<div class="result" data-result="${n.id}"><div class="result-title">${short}</div><div class="result-path">${esc(pathFor(n).slice(0,-1).join(' › '))}</div></div>`}).join('')+(found.length===30?'<div class="result-more">仅显示前 30 项，请输入更多关键词</div>':'');searchPanel.hidden=!found.length;});
  searchPanel.addEventListener('click',e=>{const r=e.target.closest('.result');if(r){searchPanel.hidden=true;searchInput.blur();reveal(r.dataset.result)}});
  window.addEventListener('message',event=>{if(event.origin!==window.location.origin||event.source!==window.parent||event.data?.source!=='mind-map-gallery')return;if(event.data.type==='fit')fit();if(event.data.type==='search'){searchInput.value=String(event.data.value||'');searchInput.dispatchEvent(new Event('input'))}if(event.data.type==='theme')document.documentElement.dataset.theme=event.data.value==='dark'?'dark':'light'});
  document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();window.parent.postMessage({source:'mind-map-viewer',type:'focus-search'},window.location.origin)}if(e.key==='Escape'){searchPanel.hidden=true;inspector.classList.remove('open')}});
  window.addEventListener('resize',()=>{if(!dragging)updateTransform()});
  render(); setTimeout(fit,50);
})();
