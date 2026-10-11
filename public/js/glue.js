// TermDeck frontend: glue: lock two touching windows so they move and resize as one.
// One of the classic scripts in public/js/, loaded in order by index.html and sharing one global scope.
"use strict";

/* ════════════════════════════════════════════════
   GLUE — lock two touching windows so they move / resize as one (pairs only)
   ════════════════════════════════════════════════ */
const GLUE_GAP=10, GLUE_MIN_OVERLAP=40, GLUE_HOT=14;
const glueBtn=document.getElementById("glue-btn");
const GLUE_ICON={
  on:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  off:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/></svg>'};
let glueHover=null;
function winBox(s){return{l:parseFloat(s.win.style.left)||0,t:parseFloat(s.win.style.top)||0,w:s.win.offsetWidth,h:s.win.offsetHeight};}
// Facing edges within GLUE_GAP and overlapping ≥ GLUE_MIN_OVERLAP → {side: where b sits relative to a, v: vertical edge?, pos, from, to}.
function sharedEdge(a,b){
  const A=winBox(a),B=winBox(b);
  const oy0=Math.max(A.t,B.t),oy1=Math.min(A.t+A.h,B.t+B.h),ox0=Math.max(A.l,B.l),ox1=Math.min(A.l+A.w,B.l+B.w);
  if(oy1-oy0>=GLUE_MIN_OVERLAP){
    if(Math.abs(A.l+A.w-B.l)<=GLUE_GAP) return{side:"e",v:true,pos:(A.l+A.w+B.l)/2,from:oy0,to:oy1};
    if(Math.abs(B.l+B.w-A.l)<=GLUE_GAP) return{side:"w",v:true,pos:(B.l+B.w+A.l)/2,from:oy0,to:oy1};
  }
  if(ox1-ox0>=GLUE_MIN_OVERLAP){
    if(Math.abs(A.t+A.h-B.t)<=GLUE_GAP) return{side:"s",v:false,pos:(A.t+A.h+B.t)/2,from:ox0,to:ox1};
    if(Math.abs(B.t+B.h-A.t)<=GLUE_GAP) return{side:"n",v:false,pos:(B.t+B.h+A.t)/2,from:ox0,to:ox1};
  }
  return null;
}
// The live partner, or null. Glue is remembered on both sides but only acts while both windows are
// visible, unmaximized, in one project and still touching.
function gluePartner(s){
  const p=s.glue&&sessions.get(s.glue);
  if(!p||p.glue!==s.id||p.project!==s.project||p.minimized||p.maximized||s.minimized||s.maximized)return null;
  return sharedEdge(s,p)?p:null;
}
function unglue(s){const p=s.glue&&sessions.get(s.glue); if(p&&p.glue===s.id)p.glue=null; s.glue=null;}
function glueWith(a,b){unglue(a);unglue(b);a.glue=b.id;b.glue=a.id;}
function updateGlueUI(){sessions.forEach((s)=>s.win.classList.toggle("glued",!!gluePartner(s)));}
function hideGlueBtn(){glueBtn.style.display="none";glueHover=null;}
let glueTimer=0;
function showGlue(a,b,ed,autoHide){
  const mid=(ed.from+ed.to)/2, on=a.glue===b.id&&b.glue===a.id;
  glueHover=[a,b];
  glueBtn.innerHTML=on?GLUE_ICON.on:GLUE_ICON.off; glueBtn.classList.toggle("on",on);
  glueBtn.title=on?"Unlock — move windows independently":"Lock — move and resize these two together";
  Object.assign(glueBtn.style,{display:"flex",left:(ed.v?ed.pos:mid)+"px",top:(ed.v?mid:ed.pos)+"px"});
  clearTimeout(glueTimer); if(autoHide) glueTimer=setTimeout(hideGlueBtn,4000);   // touch has no pointer-leave
}
// First touching pair whose shared edge is within `hot` px of desktop point (x,y) — or, with x==null, any pair involving `only`.
function findGlue(x,y,hot,only){
  const vis=[...sessions.values()].filter((s)=>s.project===activeProject&&!s.minimized&&!s.maximized);
  for(let i=0;i<vis.length;i++)for(let j=i+1;j<vis.length;j++){
    if(only&&vis[i]!==only&&vis[j]!==only)continue;
    const ed=sharedEdge(vis[i],vis[j]); if(!ed)continue;
    if(x!=null){const across=ed.v?x:y, along=ed.v?y:x; if(Math.abs(across-ed.pos)>hot||along<ed.from||along>ed.to)continue;}
    return[vis[i],vis[j],ed];
  }
  return null;
}
const deskXY=(e)=>{const dr=desktop.getBoundingClientRect();return[e.clientX-dr.left,e.clientY-dr.top];};
desktop.addEventListener("pointermove",(e)=>{
  if(e.pointerType!=="mouse"||e.buttons||document.body.classList.contains("win-dragging")||glueBtn.contains(e.target))return;   // over the button itself: keep it up
  const f=findGlue(...deskXY(e),GLUE_HOT);
  if(f) showGlue(...f); else hideGlueBtn();
});
// Touch: no hover, so tap on a shared edge, or finish dragging a window against another, to bring the lock up.
desktop.addEventListener("pointerdown",(e)=>{
  if(e.pointerType==="mouse"||glueBtn.contains(e.target))return;
  if(e.target.closest(".win-head,.wgrip")){hideGlueBtn();return;}   // a drag/resize is starting
  const f=findGlue(...deskXY(e),GLUE_HOT*2);
  if(f) showGlue(...f,true); else hideGlueBtn();
});
function offerGlue(s,e){   // called when a touch drag/resize of `s` ends
  if(!e||e.pointerType==="mouse")return;
  const f=findGlue(null,null,0,s); if(f) showGlue(...f,true);
}
desktop.addEventListener("pointerleave",hideGlueBtn);
glueBtn.addEventListener("click",(e)=>{
  e.stopPropagation(); if(!glueHover)return;
  const[a,b]=glueHover;
  if(a.glue===b.id&&b.glue===a.id) unglue(a); else glueWith(a,b);
  glueBtn.innerHTML=a.glue===b.id?GLUE_ICON.on:GLUE_ICON.off; glueBtn.classList.toggle("on",a.glue===b.id);
  scheduleSave();
});
