// TermDeck frontend: window focus and drag, tiling, snap + align, dock, move and theme popovers.
// One of the classic scripts in public/js/, loaded in order by index.html and sharing one global scope.
"use strict";

/* ════════════════════════════════════════════════
   WINDOW BEHAVIOUR
   ════════════════════════════════════════════════ */
function wireWindow(s){
  const{win,head}=s;
  win.addEventListener("pointerdown",()=>focusWindow(s));
  head.addEventListener("pointerdown",(e)=>{
    if(e.pointerType==="mouse"&&e.button!==0)return;   // ignore right/middle click
    // drag from grip, empty header, or empty tab-track — but not tabs/controls themselves
    if(e.target.closest(".win-ctrls,.wtab,.wtab-add,.wtabs-edge"))return;
    focusWindow(s);
    head.classList.add("wh-drag");
    document.body.classList.add("win-dragging");   // force grabbing cursor everywhere during the drag
    const r=win.getBoundingClientRect(),dr=desktop.getBoundingClientRect();
    let offX=e.clientX-r.left,offY=e.clientY-r.top,snapZone=null;
    const gp=gluePartner(s), s0x=r.left-dr.left, s0y=r.top-dr.top, sw=r.width;   // glued partner rides along
    const p0x=gp?parseFloat(gp.win.style.left)||0:0, p0y=gp?parseFloat(gp.win.style.top)||0:0, pw=gp?gp.win.offsetWidth:0;
    const mv=(ev)=>{
      if(s.maximized){unmaxKeeping(s);offX=Math.min(offX,parseFloat(win.style.width)-40);offY=17;}
      let x=clamp(ev.clientX-dr.left-offX,-parseFloat(win.style.width)+80,dr.width-80);
      let y=clamp(ev.clientY-dr.top-offY,0,dr.height-34);
      snapZone=gp?null:computeSnap(ev.clientX-dr.left,ev.clientY-dr.top,dr);   // glued pairs don't screen-snap
      if(snapZone) hideGuides();
      else{const al=computeAlign(s,x,y,win.offsetWidth,win.offsetHeight,dr);x=al.x;y=al.y;showGuides(al.guides);}
      if(gp){   // same delta for both, clamped so neither leaves the desktop
        const dx=clamp(x-s0x,Math.max(-sw+80-s0x,-pw+80-p0x),Math.min(dr.width-80-s0x,dr.width-80-p0x));
        const dy=clamp(y-s0y,Math.max(-s0y,-p0y),Math.min(dr.height-34-s0y,dr.height-34-p0y));
        x=s0x+dx; y=s0y+dy; gp.win.style.left=(p0x+dx)+"px"; gp.win.style.top=(p0y+dy)+"px";
      }
      win.style.left=x+"px"; win.style.top=y+"px"; showSnap(snapZone);
    };
    const up=(ev)=>{
      document.removeEventListener("pointermove",mv); document.removeEventListener("pointerup",up);
      head.classList.remove("wh-drag");
      document.body.classList.remove("win-dragging");
      hideSnap(); hideGuides();
      if(snapZone) applyRect(s,snapZone.full?null:snapZone,snapZone.full);
      scheduleSave(); offerGlue(s,ev);
    };
    document.addEventListener("pointermove",mv); document.addEventListener("pointerup",up);
  });
  win.querySelectorAll(".wgrip").forEach((g)=>g.addEventListener("pointerdown",(e)=>startResize(s,g.dataset.dir,e)));

  // window controls
  const [bRestart,bTheme,bMin,bMax,bClose]=s.head.querySelectorAll(".win-ctrls .wbtn");
  bRestart.addEventListener("click",(e)=>{e.stopPropagation(); restartSession(s);});
  bTheme.addEventListener("click",(e)=>{e.stopPropagation(); openThemePop(s,bTheme);});
  bMin.addEventListener("click",(e)=>{e.stopPropagation(); minimize(s);});
  bMax.addEventListener("click",(e)=>{e.stopPropagation(); toggleMax(s);});
  bClose.addEventListener("click",(e)=>{e.stopPropagation(); requestCloseSession(s);});

  s.wtabAdd.addEventListener("click",(e)=>{e.stopPropagation(); addTab(s);});
}

function minimize(s){s.minimized=true;s.win.style.display="none";syncWebgl();s.chip.classList.add("mini");s.chip.title="Click to show";if(focusedId===s.id)focusedId=null;syncTileBtn();scheduleSave();}
function restore(s){s.minimized=false;s.win.style.display="";syncWebgl();s.chip.classList.remove("mini");s.chip.title="Double-click to hide";focusWindow(s);refitActive(s);syncTileBtn();scheduleSave();}
function toggleMax(s){
  if(s.maximized){const p=s.prevRect||{left:"80px",top:"60px",width:"580px",height:"380px"};Object.assign(s.win.style,p);s.win.classList.remove("max");s.maximized=false;}
  else{const st=s.win.style;s.prevRect={left:st.left,top:st.top,width:st.width,height:st.height};Object.assign(s.win.style,{left:"0px",top:"0px",width:"100%",height:"100%"});s.win.classList.add("max");s.maximized=true;focusWindow(s);}
  requestAnimationFrame(()=>refitActive(s)); scheduleSave();
}
function unmaxKeeping(s){const p=s.prevRect||{width:"580px",height:"380px"};s.win.classList.remove("max");s.maximized=false;s.win.style.width=p.width;s.win.style.height=p.height;refitActive(s);}
// Focus a terminal on the next tick — unless focus moved somewhere else meanwhile (the palette or a dialog opened, a
// tab name went into rename): a late timer must never pull keystrokes back into a shell. Seen when ⌘K follows page
// load closely: the queued timer fired after the palette opened, closed it, and Enter went to the shell.
function focusTermSoon(t){
  const before=document.activeElement;
  setTimeout(()=>{
    const ae=document.activeElement;
    if(ae&&ae!==before&&ae!==document.body&&!ae.classList.contains("xterm-helper-textarea")) return;
    try{t.term.focus();}catch{}
  },0);
}
function focusWindow(s){
  const wasFocused=focusedId===s.id;
  if(focusedId&&sessions.has(focusedId)){sessions.get(focusedId).win.classList.remove("focused");sessions.get(focusedId).chip.classList.remove("active");}
  focusedId=s.id;s.win.style.zIndex=++zTop;s.win.classList.add("focused");s.chip.classList.add("active"); touchTab(activeTab(s));
  if(!s.minimized){const t=activeTab(s); if(t){clearTabAttn(s,t); focusTermSoon(t);}}
  if(sidebarOpen&&!wasFocused) followTree();   // re-clicking the focused window leaves the tree alone
  if(sessSearchOpen&&ssInput.value) closeSessSearch();   // picked a match → drop the filter
}

function refitActive(s){
  if(s.minimized||s.project!==activeProject)return;
  updTabEdges(s.wtabsTrack);   // window width changed → tab strip overflow may too
  const t=activeTab(s); if(!t)return;
  try{t.fit.fit(); if(t.conn?.resize) t.conn.resize(t.term.cols,t.term.rows);}catch{}
}
function refitTab(s,tab){
  if(s.minimized||s.project!==activeProject||s.activeTabId!==tab.id)return;
  try{tab.fit.fit(); if(tab.conn?.resize) tab.conn.resize(tab.term.cols,tab.term.rows);}catch{}
}
// FitAddon quantises rows to whole cells, so an arbitrary window height leaves a
// sub-row strip of empty terminal below the last line, before the footer. Trim the
// window by exactly that leftover so the footer sits flush against the last row.
function snapWinHeight(s){
  if(s.minimized||s.maximized||s.project!==activeProject)return;
  const t=activeTab(s); const el=t&&t.term&&t.term.element; if(!el)return;
  const vp=el.querySelector(".xterm-viewport"), sc=el.querySelector(".xterm-screen");
  if(!vp||!sc)return;
  const rem=vp.clientHeight-sc.clientHeight;
  if(rem>0&&rem<40){ s.win.style.height=(s.win.offsetHeight-rem)+"px"; refitActive(s); }
}
// Drag-resize from any edge/corner. `dirs` is a subset of "nsew" (e.g. "se","w","ne").
// Left/top move only for the w/n edges so the opposite edge stays anchored.
function startResize(s,dirs,e){
  e.stopPropagation(); e.preventDefault(); focusWindow(s); if(s.maximized)return;
  const win=s.win, MINW=WIN_MINW, MINH=WIN_MINH;
  const x0=parseFloat(win.style.left)||0, y0=parseFloat(win.style.top)||0, w0=win.offsetWidth, h0=win.offsetHeight;
  const dr=desktop.getBoundingClientRect();   // clamp so no edge leaves the desktop bounds
  const sx=e.clientX, sy=e.clientY;
  // Glued partner: dragging the shared edge grows this window and shrinks the partner by the same amount.
  const gp=gluePartner(s), side=gp&&sharedEdge(s,gp).side;
  const px0=gp?parseFloat(gp.win.style.left)||0:0, py0=gp?parseFloat(gp.win.style.top)||0:0, pw0=gp?gp.win.offsetWidth:0, ph0=gp?gp.win.offsetHeight:0;
  const mv=(ev)=>{
    const dx=ev.clientX-sx, dy=ev.clientY-sy;
    let nx=x0, ny=y0, nw=w0, nh=h0;
    if(dirs.indexOf("e")>=0) nw=Math.max(MINW,Math.min(w0+dx, dr.width-x0));       // right edge ≤ desktop right
    if(dirs.indexOf("s")>=0) nh=Math.max(MINH,Math.min(h0+dy, dr.height-y0));      // bottom edge ≤ desktop bottom
    if(dirs.indexOf("w")>=0){ nw=Math.max(MINW,Math.min(w0-dx, x0+w0)); nx=x0+(w0-nw); }   // left edge ≥ 0
    if(dirs.indexOf("n")>=0){ nh=Math.max(MINH,Math.min(h0-dy, y0+h0)); ny=y0+(h0-nh); }   // top edge ≥ 0
    const a=resizeAlign(s,dirs,nx,ny,nw,nh);   // snap dragged edge to neighbour windows
    if(a.w>=MINW){ nx=a.x; nw=a.w; }
    if(a.h>=MINH){ ny=a.y; nh=a.h; }
    if(gp){
      const P={left:px0,top:py0,width:pw0,height:ph0};
      if(side==="e"&&dirs.indexOf("e")>=0){nw=Math.min(nw,w0+pw0-MINW); P.left=px0+nw-w0; P.width=pw0-(nw-w0);}
      else if(side==="w"&&dirs.indexOf("w")>=0){nx=Math.max(nx,x0-(pw0-MINW)); nw=x0+w0-nx; P.width=pw0+(nx-x0);}
      else if(side==="s"&&dirs.indexOf("s")>=0){nh=Math.min(nh,h0+ph0-MINH); P.top=py0+nh-h0; P.height=ph0-(nh-h0);}
      else if(side==="n"&&dirs.indexOf("n")>=0){ny=Math.max(ny,y0-(ph0-MINH)); nh=y0+h0-ny; P.height=ph0+(ny-y0);}
      for(const k in P) gp.win.style[k]=P[k]+"px";
      refitActive(gp);
    }
    win.style.left=nx+"px"; win.style.top=ny+"px"; win.style.width=nw+"px"; win.style.height=nh+"px";
    refitActive(s);
    if(a.guides.length) showGuides(a.guides); else hideGuides();
  };
  const up=(ev)=>{document.removeEventListener("pointermove",mv); document.removeEventListener("pointerup",up); hideGuides(); refitActive(s); snapWinHeight(s); if(gp){refitActive(gp); if(!sharedEdge(s,gp)) unglue(s);} scheduleSave(); offerGlue(s,ev);};
  document.addEventListener("pointermove",mv); document.addEventListener("pointerup",up);
}
const WIN_MINW=320, WIN_MINH=200;
// Keyboard move / resize (palette → "Move or resize window"): arrows move the focused window, Shift+arrows resize it,
// 10 px a step (1 px with Alt/⌥); Enter keeps it, Esc puts it back, a click elsewhere keeps it. Same bounds as dragging;
// a glued partner moves along, and a resize that breaks their shared edge unglues them, as a drag does.
function keyboardMoveWindow(s){
  if(!s||s.minimized) return;
  if(s.maximized) toggleMax(s);
  const win=s.win, gp=gluePartner(s);
  const rectOf=(w)=>w&&{left:w.win.style.left,top:w.win.style.top,width:w.win.style.width,height:w.win.style.height};
  const was=[rectOf(s),rectOf(gp)];
  const num=(w,k)=>parseFloat(w.win.style[k])||0;
  win.classList.add("kbd-move"); focusWindow(s);
  toast(ICON.move,"Move or resize “"+s.name+"”","Arrows move · Shift+arrows resize · Enter done · Esc cancel",6000);
  const finish=(keep)=>{
    document.removeEventListener("keydown",onKey,true); document.removeEventListener("pointerdown",onPointer,true);
    win.classList.remove("kbd-move"); hideGuides();
    if(!keep){Object.assign(win.style,was[0]); if(gp) Object.assign(gp.win.style,was[1]);}
    refitActive(s); snapWinHeight(s); if(gp){refitActive(gp); if(!sharedEdge(s,gp)) unglue(s);}
    scheduleSave(); focusWindow(s);
  };
  const onPointer=()=>finish(true);
  const onKey=(e)=>{
    e.preventDefault(); e.stopPropagation();   // a mode: no key reaches the terminal or the app's shortcuts until it ends
    if(e.key==="Enter"){finish(true); return;}
    if(e.key==="Escape"){finish(false); return;}
    const d={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key]; if(!d) return;
    const step=e.altKey?1:10, dx=d[0]*step, dy=d[1]*step, dr=desktop.getBoundingClientRect();
    const x=num(s,"left"), y=num(s,"top"), w=win.offsetWidth, h=win.offsetHeight;
    if(e.shiftKey){   // right/bottom edge: grow or shrink, never past the desktop
      win.style.width=clamp(w+dx,WIN_MINW,Math.max(WIN_MINW,dr.width-x))+"px";
      win.style.height=clamp(h+dy,WIN_MINH,Math.max(WIN_MINH,dr.height-y))+"px";
      refitActive(s);
    }else{   // the drag's bounds: 80 px stays on screen, the header never goes above the top
      const ex=gp?[s,gp]:[s];
      const mx=ex.reduce((m,o)=>[Math.max(m[0],-o.win.offsetWidth+80-num(o,"left")),Math.min(m[1],dr.width-80-num(o,"left"))],[-Infinity,Infinity]);
      const my=ex.reduce((m,o)=>[Math.max(m[0],-num(o,"top")),Math.min(m[1],dr.height-34-num(o,"top"))],[-Infinity,Infinity]);
      const ddx=clamp(dx,mx[0],mx[1]), ddy=clamp(dy,my[0],my[1]);
      ex.forEach((o)=>{o.win.style.left=(num(o,"left")+ddx)+"px"; o.win.style.top=(num(o,"top")+ddy)+"px";});
    }
  };
  document.addEventListener("keydown",onKey,true); document.addEventListener("pointerdown",onPointer,true);
}
// Per-terminal font zoom (⌘+/⌘-/⌘0). dir>0 in, <0 out, 0 reset.
function zoomTab(s,tab,dir){
  tab.term.options.fontSize = dir===0 ? getFont().size : clamp((tab.term.options.fontSize||13)+dir,8,28);
  refitTab(s,tab);
}

/* ════════════════════════════════════════════════
   TILING
   ════════════════════════════════════════════════ */
const tileBtn=document.getElementById("tile");
const bcastBtn=document.getElementById("bcast");
// Shells a cast would actually reach: live, non-log tabs in the active project.
// Cast needs ≥2 (a lone shell would only mirror to itself = no-op), so the button
// gates on this and an armed cast auto-disarms when the count drops below 2.
function castableCount(){let n=0;sessions.forEach((s)=>{if(s.project!==activeProject||s.isLog)return;s.tabs.forEach((t)=>{if(castable(t)&&t.conn?.send)n++;});});return n;}
function syncCastBtn(){
  const ok=castableCount()>=2;
  bcastBtn.disabled=!ok;
  if(!ok&&broadcastOn) setBroadcast(false);
}
function setBroadcast(on){
  if(on&&castableCount()<2) return; // nothing to cast to — ignore
  broadcastOn=on;
  bcastBtn.classList.toggle("active",on);
  document.getElementById("cast-label").textContent=on?"Cast ON":"Cast";
  toast(on?ICON.cast:ICON.castOff,on?"Broadcast ON":"Broadcast off",
    on?"Keystrokes now go to ALL live shells":"Input goes to the focused terminal only",2600);
}
bcastBtn.addEventListener("click",()=>setBroadcast(!broadcastOn));
function tileable(){return order.some((id)=>{const s=sessions.get(id);return s&&s.project===activeProject&&!s.minimized;});}
function syncTileBtn(){tileBtn.disabled=!tileable();}
function tileGrid(cols,rows,label){
  let vis=order.map((id)=>sessions.get(id)).filter((s)=>s&&s.project===activeProject&&!s.minimized);
  if(!vis.length)return;
  const n=cols*rows;
  if(vis.length>n){                       // more windows than cells: keep the focused one, minimize the rest
    const f=vis.indexOf(sessions.get(focusedId));
    if(f>=n)[vis[0],vis[f]]=[vis[f],vis[0]];
    vis.slice(n).forEach(minimize); vis=vis.slice(0,n);
  }
  const dr=desktop.getBoundingClientRect();
  const gap=8,cw=(dr.width-gap*(cols+1))/cols,ch=(dr.height-gap*(rows+1))/rows;
  vis.forEach((s,i)=>{const c=i%cols,r=Math.floor(i/cols);s.maximized=false;s.win.classList.remove("max");Object.assign(s.win.style,{left:(gap+c*(cw+gap))+"px",top:(gap+r*(ch+gap))+"px",width:cw+"px",height:ch+"px"});refitActive(s);});
  scheduleSave(); toast(ICON.grid,label||"Tiled",vis.length+" windows arranged",2500);
}
function tileAll(){
  const k=order.filter((id)=>{const s=sessions.get(id);return s&&s.project===activeProject&&!s.minimized;}).length;
  const cols=Math.ceil(Math.sqrt(k));tileGrid(cols,Math.ceil(k/cols));
}
const LAYOUT_PRESETS=[[1,1],[2,1],[1,2],[2,2],[3,2]];   // [columns, rows]
// c×r preview icon for the Layout menu — the preset drawn as its own grid.
function gridIcon(c,r){
  const g=1.5,w=(18-g*(c-1))/c,h=(18-g*(r-1))/r;let o="";
  for(let y=0;y<r;y++)for(let x=0;x<c;x++)o+='<rect x="'+(3+x*(w+g)).toFixed(2)+'" y="'+(3+y*(h+g)).toFixed(2)+'" width="'+w.toFixed(2)+'" height="'+h.toFixed(2)+'" rx="1"/>';
  return '<svg viewBox="0 0 24 24" aria-hidden="true">'+o+'</svg>';
}
function minimizedIds(){return order.filter((id)=>{const s=sessions.get(id);return s&&s.project===activeProject&&s.minimized;});}
function toggleFullscreen(){if(document.fullscreenElement)document.exitFullscreen();else document.documentElement.requestFullscreen().catch(()=>{});}
// Layout ▾: everything that arranges windows, in one menu next to Tile.
document.getElementById("layout-caret").addEventListener("click",(e)=>{
  const r=e.currentTarget.getBoundingClientRect(), mini=minimizedIds(), ok=tileable();
  showCtxMenu(r.left,r.bottom+6,[
    {icon:ICON.grid,label:"Tile windows",key:kbd("\u2318","\u2325","\u21e7","T"),disabled:!ok,run:tileAll},
    {sep:true},
    ...LAYOUT_PRESETS.map(([c,rw])=>({icon:gridIcon(c,rw),label:c+"\u00d7"+rw,disabled:!ok,run:()=>tileGrid(c,rw,"Layout "+c+"\u00d7"+rw)})),
    {sep:true},
    {label:"Restore minimized"+(mini.length?" ("+mini.length+")":""),disabled:!mini.length,run:()=>mini.forEach((id)=>restore(sessions.get(id)))},
    {label:document.fullscreenElement?"Exit fullscreen":"Fullscreen",key:MAC?"\u2303\u2318F":"F11",run:toggleFullscreen},
  ]);
});

/* ════════════════════════════════════════════════
   SNAP + ALIGN
   ════════════════════════════════════════════════ */
const EDGE=40,ATHRESH=8;
function computeSnap(x,y,dr){
  const W=dr.width,H=dr.height,g=8,hw=(W-g*3)/2,hh=(H-g*3)/2,rx=g*2+hw,by=g*2+hh;
  const L=x<EDGE,R=x>W-EDGE,T=y<EDGE,B=y>H-EDGE;
  if(T&&!L&&!R) return{full:true};
  if(L&&T) return{left:g+"px",top:g+"px",width:hw+"px",height:hh+"px"};
  if(R&&T) return{left:rx+"px",top:g+"px",width:hw+"px",height:hh+"px"};
  if(L&&B) return{left:g+"px",top:by+"px",width:hw+"px",height:hh+"px"};
  if(R&&B) return{left:rx+"px",top:by+"px",width:hw+"px",height:hh+"px"};
  if(L) return{left:g+"px",top:g+"px",width:hw+"px",height:(H-g*2)+"px"};
  if(R) return{left:rx+"px",top:g+"px",width:hw+"px",height:(H-g*2)+"px"};
  if(B) return{left:g+"px",top:by+"px",width:(W-g*2)+"px",height:hh+"px"};
  return null;
}
function showSnap(z){
  if(!z){snapEl.style.display="none";return;}
  const dr=desktop.getBoundingClientRect();
  const r=z.full?{left:"0px",top:"0px",width:dr.width+"px",height:dr.height+"px"}:z;
  Object.assign(snapEl.style,{display:"block",left:r.left,top:r.top,width:r.width,height:r.height});
}
function hideSnap(){snapEl.style.display="none";}
function computeAlign(drag,x,y,w,h,dr){
  const gp=gluePartner(drag);
  const others=order.map((id)=>sessions.get(id)).filter((o)=>o&&o!==drag&&o!==gp&&!o.minimized&&!o.maximized&&o.project===activeProject);
  let sx=null,sy=null;const guides=[];
  const dX=[x,x+w/2,x+w],dY=[y,y+h/2,y+h];
  for(const o of others){
    const ol=parseFloat(o.win.style.left)||0,ot=parseFloat(o.win.style.top)||0,ow=o.win.offsetWidth,oh=o.win.offsetHeight;
    const oX=[ol,ol+ow/2,ol+ow],oY=[ot,ot+oh/2,ot+oh];
    if(sx===null) for(let i=0;i<3;i++) for(let j=0;j<3;j++) if(Math.abs(dX[i]-oX[j])<=ATHRESH){sx=x+(oX[j]-dX[i]);guides.push({type:"v",pos:oX[j],from:Math.min(ot,y)-12,to:Math.max(ot+oh,y+h)+12});break;}
    if(sy===null) for(let i=0;i<3;i++) for(let j=0;j<3;j++) if(Math.abs(dY[i]-oY[j])<=ATHRESH){sy=y+(oY[j]-dY[i]);guides.push({type:"h",pos:oY[j],from:Math.min(ol,x)-12,to:Math.max(ol+ow,x+w)+12});break;}
  }
  return{x:sx!==null?clamp(sx,-w+80,dr.width-80):x,y:sy!==null?clamp(sy,0,dr.height-34):y,guides};
}
// Resize-time alignment: snap the dragged edge(s) to other windows' left/right/top/bottom
// edges (within ATHRESH), adjusting size — the resize counterpart of computeAlign.
function resizeAlign(drag,dirs,x,y,w,h){
  const gp=gluePartner(drag);
  const others=order.map((id)=>sessions.get(id)).filter((o)=>o&&o!==drag&&o!==gp&&!o.minimized&&!o.maximized&&o.project===activeProject);
  const xL=[],yL=[];
  for(const o of others){const ol=parseFloat(o.win.style.left)||0,ot=parseFloat(o.win.style.top)||0,ow=o.win.offsetWidth,oh=o.win.offsetHeight;xL.push(ol,ol+ow);yL.push(ot,ot+oh);}
  const near=(v,lines)=>{for(const L of lines) if(Math.abs(v-L)<=ATHRESH) return L; return null;};
  let nx=x,ny=y,nw=w,nh=h;const guides=[];
  if(dirs.indexOf("e")>=0){const L=near(x+w,xL);if(L!==null){nw=L-x;guides.push({type:"v",pos:L,from:y-12,to:y+h+12});}}
  if(dirs.indexOf("w")>=0){const L=near(x,xL);if(L!==null){nx=L;nw=x+w-L;guides.push({type:"v",pos:L,from:y-12,to:y+h+12});}}
  if(dirs.indexOf("s")>=0){const L=near(y+h,yL);if(L!==null){nh=L-y;guides.push({type:"h",pos:L,from:x-12,to:x+w+12});}}
  if(dirs.indexOf("n")>=0){const L=near(y,yL);if(L!==null){ny=L;nh=y+h-L;guides.push({type:"h",pos:L,from:x-12,to:x+w+12});}}
  return{x:nx,y:ny,w:nw,h:nh,guides};
}
function showGuides(g){
  const v=g.find((x)=>x.type==="v"),h=g.find((x)=>x.type==="h");
  if(v) Object.assign(guideV.style,{display:"block",left:v.pos+"px",top:v.from+"px",height:(v.to-v.from)+"px"}); else guideV.style.display="none";
  if(h) Object.assign(guideH.style,{display:"block",top:h.pos+"px",left:h.from+"px",width:(h.to-h.from)+"px"}); else guideH.style.display="none";
}
function hideGuides(){guideV.style.display="none";guideH.style.display="none";}
function applyRect(s,rect,full){
  if(full){const st=s.win.style;if(!s.maximized)s.prevRect={left:st.left,top:st.top,width:st.width,height:st.height};Object.assign(s.win.style,{left:"0px",top:"0px",width:"100%",height:"100%"});s.win.classList.add("max");s.maximized=true;}
  else{s.maximized=false;s.win.classList.remove("max");Object.assign(s.win.style,rect);}
  requestAnimationFrame(()=>refitActive(s));
}

/* ════════════════════════════════════════════════
   DOCK
   ════════════════════════════════════════════════ */
function wireChip(s){
  let moved=false;
  s.chip.addEventListener("click",()=>{if(moved)return;if(s.minimized)restore(s);else focusWindow(s);});
  s.chip.addEventListener("dblclick",()=>{if(!s.minimized)minimize(s);});
  s.cmove.addEventListener("click",(e)=>{e.stopPropagation();openMovePop(s,s.cmove);});

  s.chip.addEventListener("pointerdown",(e)=>{
    if(e.pointerType==="mouse"&&e.button!==0)return;
    if(e.target.closest(".cmove"))return;
    moved=false;
    let dragging=false;
    const startX=e.clientX, startY=e.clientY;
    // Touch: drag only after a ~250ms hold; moving sooner = a scroll swipe, left to the browser.
    const isTouch=e.pointerType==="touch";
    let armed=!isTouch, holdTimer=null;
    if(isTouch) holdTimer=setTimeout(()=>{armed=true;s.chip.classList.add("dragging");},250);
    const blockScroll=(ev)=>{if(armed)ev.preventDefault();};   // armed → finger drags the chip, not the dock

    const mv=(ev)=>{
      if(!dragging){
        const dist=Math.hypot(ev.clientX-startX,ev.clientY-startY);
        if(!armed){if(dist>8)clearTimeout(holdTimer);return;}
        if(dist<4)return;
        dragging=true;
        moved=true;
        s.chip.classList.add("dragging");
      }
      const otherChips=[...dockTrack.querySelectorAll(".chip")].filter((c)=>c!==s.chip&&c.style.display!=="none");
      if(!otherChips.length)return;
      const firstR=otherChips[0].getBoundingClientRect();
      const lastR=otherChips[otherChips.length-1].getBoundingClientRect();
      if(ev.clientX<firstR.left){
        dock.querySelectorAll(".chip").forEach((c)=>c.classList.remove("drag-over"));
        dockTrack.insertBefore(s.chip,otherChips[0]);
      }else if(ev.clientX>lastR.right){
        dock.querySelectorAll(".chip").forEach((c)=>c.classList.remove("drag-over"));
        dockTrack.appendChild(s.chip);
      }else{
        for(const other of otherChips){
          const r=other.getBoundingClientRect();
          if(ev.clientX>=r.left-4&&ev.clientX<=r.right+4){
            dock.querySelectorAll(".chip").forEach((c)=>c.classList.remove("drag-over"));
            other.classList.add("drag-over");
            dockTrack.insertBefore(s.chip,ev.clientX<r.left+r.width/2?other:other.nextSibling);
            break;
          }
        }
      }
    };

    const up=()=>{
      clearTimeout(holdTimer);
      document.removeEventListener("touchmove",blockScroll);
      document.removeEventListener("pointermove",mv);
      document.removeEventListener("pointerup",up);
      document.removeEventListener("pointercancel",up);
      s.chip.classList.remove("dragging");
      if(dragging){
        dock.querySelectorAll(".chip").forEach((c)=>c.classList.remove("drag-over"));
        syncOrder();
        scheduleSave();
        setTimeout(()=>{moved=false;},50);
      }
    };

    document.addEventListener("touchmove",blockScroll,{passive:false});
    document.addEventListener("pointermove",mv);
    document.addEventListener("pointerup",up);
    document.addEventListener("pointercancel",up);
  });
}
function syncOrder(){order=[...dock.querySelectorAll(".chip")].map((c)=>{for(const[id,s]of sessions)if(s.chip===c)return id;}).filter(Boolean);}
// Show edge fades/arrows when chips overflow the visible track.
function updateDockEdges(){
  const max=dockTrack.scrollWidth-dockTrack.clientWidth;
  dockScroll.classList.toggle("can-left",dockTrack.scrollLeft>1);
  dockScroll.classList.toggle("can-right",dockTrack.scrollLeft<max-1);
}
dockTrack.addEventListener("scroll",updateDockEdges);
document.getElementById("dock-edge-l").addEventListener("click",()=>dockTrack.scrollBy({left:-dockTrack.clientWidth*0.8,behavior:"smooth"}));
document.getElementById("dock-edge-r").addEventListener("click",()=>dockTrack.scrollBy({left:dockTrack.clientWidth*0.8,behavior:"smooth"}));

// project-tab overflow: scroll ptabs, keep the + button in view
function updateProjEdges(){
  const max=projTrack.scrollWidth-projTrack.clientWidth;
  projScroll.classList.toggle("can-left",projTrack.scrollLeft>1);
  projScroll.classList.toggle("can-right",projTrack.scrollLeft<max-1);
}
projTrack.addEventListener("scroll",updateProjEdges);
projTrack.addEventListener("wheel",(e)=>{if(e.deltaY){projTrack.scrollLeft+=e.deltaY;e.preventDefault();}},{passive:false});
document.getElementById("proj-edge-l").addEventListener("click",()=>projTrack.scrollBy({left:-projTrack.clientWidth*0.7,behavior:"smooth"}));
document.getElementById("proj-edge-r").addEventListener("click",()=>projTrack.scrollBy({left:projTrack.clientWidth*0.7,behavior:"smooth"}));
projectsBar.addEventListener("dblclick",(e)=>{if(e.target===projectsBar||e.target===projScroll||e.target===projTrack)addProject();});  // dbl-click empty area → new project

/* ════════════════════════════════════════════════
   MOVE POPOVER
   ════════════════════════════════════════════════ */
// moving a window needs somewhere to go: dim the dock's move buttons while there is only one project
function syncMoveBtns(){
  const one=projectOrder.length<2;
  projects.forEach((p)=>{if(p.delEl){p.delEl.disabled=one; p.delEl.title=one?"Can't delete the only project":"Delete project";}});   // the last project can't be deleted (deleteProject refuses) → show it
  sessions.forEach((s)=>{s.cmove.disabled=one; s.cmove.title=one?"Move to project\u2026 (add another project first)":"Move to project\u2026";});
}
function openMovePop(s,anchor){
  closeModals("move");
  moveTargetSession=s; moveList.innerHTML="";
  projectOrder.forEach((pid)=>{
    const p=projects.get(pid);
    const item=el("div","pitem"+(pid===s.project?" current":""));
    const lbl=el("span");lbl.textContent=p.name;
    const cnt=el("span","pcount");cnt.textContent=pid===s.project?"current":"move here";
    item.append(lbl,cnt);
    item.addEventListener("click",()=>{moveSessionToProject(s,pid);movePop.classList.remove("open");});
    moveList.append(item);
  });
  const r=anchor.getBoundingClientRect();
  movePop.style.left=Math.max(12,Math.min(window.innerWidth-252,r.left-120))+"px";
  movePop.style.top=Math.max(52,r.top-260)+"px";
  movePop.classList.add("open");
}

/* ════════════════════════════════════════════════
   THEME POPOVER
   ════════════════════════════════════════════════ */
function setGlobalTheme(id){
  if(!THEMES[id])return;
  defaultThemeId=id;
  try{localStorage.setItem(THEME_STORE,id);}catch{}
  applyUITheme(id);
  sessions.forEach((s)=>{if(!s.themeId) s.tabs.forEach((t)=>{try{t.term.options.theme=THEMES[id].xterm;t.pane.style.background=THEMES[id].xterm.background;}catch{}});});
  renderThemeGrid(themeSearch.value.trim());
}
function setSessionTheme(s,id){
  s.themeId=id;
  s.tabs.forEach((t)=>{const th=THEMES[id||defaultThemeId].xterm;try{t.term.options.theme=th;t.pane.style.background=th.background;}catch{}});
  scheduleSave(); renderThemeGrid(themeSearch.value.trim());
}
function renderThemeGrid(filter){
  filter=(filter||"").toLowerCase(); themeGrid.innerHTML="";
  const sc=themeTargetSession;
  const aid=sc?(sc.themeId||defaultThemeId):defaultThemeId;
  if(sc){themeLbl.textContent="Theme: \u201c"+sc.name+"\u201d"; themeHint.textContent=sc.themeId?"Overriding dashboard default.":"Following dashboard default.";}
  else{themeLbl.textContent="Dashboard theme"; themeHint.textContent="Reskins the entire UI + all windows without a per-window override.";}
  THEME_ORDER.forEach((id)=>{
    const t=THEMES[id]; if(!t)return;
    if(filter&&!t.name.toLowerCase().includes(filter))return;
    const card=el("button","tcard"+(id===aid?" current":"")); card.type="button"; card.setAttribute("aria-pressed",String(id===aid));
    const nm=el("div","tname");const nt=el("span");nt.textContent=t.name;const chk=el("span","tcheck");chk.textContent="\u2713";nm.append(nt,chk);
    const sw=el("div","tswatch");sw.style.background=t.dots[0];t.dots.slice(1).forEach((c)=>{const d=el("span","tdot");d.style.background=c;sw.append(d);});
    card.append(nm,sw);
    card.addEventListener("click",()=>{if(sc)setSessionTheme(sc,id);else setGlobalTheme(id);});
    themeGrid.append(card);
  });
  themeReset.style.display=(sc&&sc.themeId)?"":"none";
}
function openThemePop(scoped,anchor){
  closeModals("theme");
  themeTargetSession=scoped||null; themeSearch.value=""; themeClear.style.display="none"; renderThemeGrid("");
  const r=anchor.getBoundingClientRect();
  themePop.style.left=Math.max(12,Math.min(window.innerWidth-352,r.right-340))+"px";
  themePop.style.top=Math.max(52,Math.min(window.innerHeight-400,r.bottom+6))+"px";
  themePop.classList.add("open");
  setTimeout(()=>themeSearch.focus(),50);
}
