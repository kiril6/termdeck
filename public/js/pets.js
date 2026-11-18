// TermDeck frontend: ambient pixel pets and the screensaver.
// One of the classic scripts in public/js/, loaded in order by index.html and sharing one global scope.
"use strict";

/* ═══ AMBIENT PIXEL PETS ═══ */
/* ascii sprites → box-shadow. '.'=empty 'X'=body 'o'=eye  (2 walk frames each) */
const PET_SPECIES={
  cat:{px:3,w:12,h:9,color:"var(--accent)",eye:"var(--bg)",kind:"cat",
    a:["..X.....X...","..XX...XX...","..XXXXXXX...",".XXXXXXXXX..",".XoXXXXoXX.X",".XXXXXXXXX..",".XXXXXXXXX..",".XXXXXXXXX..","..X..X.X.X.."],
    b:["..X.....X...","..XX...XX...","..XXXXXXX...",".XXXXXXXXX..",".XoXXXXoXX.X",".XXXXXXXXX..",".XXXXXXXXX..",".XXXXXXXXX..",".X.X..X.X..."]},
  slime:{px:3,w:9,h:6,color:"var(--muted)",eye:"var(--bg)",kind:"slime",
    a:["...XXX...","..XXXXX..",".XXXXXXX.",".XoXXXoX.",".XXXXXXX.","XXXXXXXXX"],
    b:["..XXXXX..",".XXXXXXX.","XXXXXXXXX","XoXXXXXoX","XXXXXXXXX","XXXXXXXXX"]},
  bird:{px:3,w:8,h:7,color:"var(--accent-dim)",eye:"var(--bg)",kind:"bird",
    a:["...XXX..","..XXXXX.","..XoXXXX","XXXXXXX.","XXXXXXX.",".XXXXX..","..X.X..."],
    b:["...XXX..","..XXXXX.","..XoXXXX","XXXXXXX.","XXXXXXX.",".XXXXX..",".X...X.."]},
};
function petShadow(rows,px,color,eye){
  const out=[];
  rows.forEach((row,y)=>{for(let x=0;x<row.length;x++){
    const ch=row[x]; if(ch==="."||ch===" ")continue;
    out.push(`${x*px}px ${y*px}px 0 0 ${ch==="o"?eye:color}`);
  }});
  return out.join(",");
}
const petField=document.getElementById("petfield");
const PETS_STORE="td.pets.v1";
let pets=[], petTimers=[];
const petRand=(a,b)=>a+Math.random()*(b-a);
// tri-state: "auto" (idle/away screensaver, default) · "on" (always visible) · "off" (never). legacy "1"→auto, "0"→off.
function petsMode(){let v=null; try{v=localStorage.getItem(PETS_STORE);}catch{}
  if(v==="on"||v==="off"||v==="auto")return v;
  return v==="0"?"off":"auto";}

function buildPet(spec,scale,opacity){
  const px=spec.px;
  const pet=el("div","pet"+(spec.kind==="slime"?" slime":""));
  pet.style.opacity=opacity;
  const face=el("div","pet-face"), bob=el("div","pet-bob");
  bob.style.cssText=`position:relative;width:${spec.w*px}px;height:${spec.h*px}px;transform:scale(${scale});transform-origin:bottom center;`;
  const fa=el("div","pet-frame fa"), fb=el("div","pet-frame fb");
  fa.style.setProperty("--px",px+"px"); fb.style.setProperty("--px",px+"px");
  fa.style.boxShadow=petShadow(spec.a,px,spec.color,spec.eye);
  fb.style.boxShadow=petShadow(spec.b,px,spec.color,spec.eye);
  bob.append(fa,fb); face.append(bob); pet.append(face);
  return {node:pet,face,spec,x:0,y:0,w:spec.w*px*scale,h:spec.h*px*scale};
}
function petBounds(){return {w:petField.clientWidth,h:petField.clientHeight};}
// y is the lift above the floor (≤0): pets sit on the field's bottom edge in CSS, so a height change never moves them
function placePet(p,x,y){p.x=x;p.y=y;p.node.style.transform=`translate(${x}px,${y}px)`;}
// pets ride a floor strip along the desktop bottom, above windows — always visible, never over the terminal body
function petTarget(p,w){
  return {tx:petRand(0,Math.max(0,w-p.w)), ty:-petRand(3,37)};
}
function petStep(p){
  if(!petsShown)return;
  const {w}=petBounds(); if(w<80){petTimers.push(setTimeout(()=>petStep(p),1500));return;}
  const {tx,ty}=petTarget(p,w);
  const dist=Math.hypot(tx-p.x,ty-p.y);
  const speed=p.spec.kind==="slime"?26:34; // px/s
  const dur=Math.max(1.2,dist/speed);
  p.face.style.setProperty("--dir",tx<p.x?-1:1);
  p.node.style.setProperty("--dur",dur+"s");
  p.node.classList.add("walking"); p.until=performance.now()+dur*1000;
  placePet(p,tx,ty);
  petTimers.push(setTimeout(()=>{
    p.node.classList.remove("walking");
    // occasional idle flourish (cat groom)
    if(p.spec.kind==="cat"&&Math.random()<0.35){
      p.node.classList.add("groom");
      petTimers.push(setTimeout(()=>p.node.classList.remove("groom"),petRand(900,1800)));
    }
    petTimers.push(setTimeout(()=>petStep(p),petRand(700,3200)));
  },dur*1000));
}
function stopPets(){
  petTimers.forEach(clearTimeout); petTimers=[];
  pets=[]; petField.innerHTML="";
}
function startPets(){
  stopPets();
  const roster=[
    {spec:PET_SPECIES.cat,scale:1.0,op:.7},
    {spec:PET_SPECIES.slime,scale:1.0,op:.78},
    {spec:PET_SPECIES.bird,scale:1.0,op:.8},
  ];
  const {w}=petBounds(); petFieldW=w;
  roster.forEach((r,i)=>{
    const p=buildPet(r.spec,r.scale,r.op);
    petField.append(p.node); pets.push(p);
    const spot=petTarget(p,w);
    placePet(p,spot.tx,spot.ty);
    petTimers.push(setTimeout(()=>petStep(p),petRand(300,1200)*(i+1)));
  });
}
/* ── screensaver logic: enabled by default but only shown when the user is away/idle ──
   want = enabled && (tab hidden/blurred || mouse idle), from the shared away state (matrix.js). Activity or refocus
   hides them. "auto" also stands aside while the Matrix rain background signals the agents (working, or calm for a
   waiting/approval alert); on idle they walk in front of the rain. "on" always shows. */
let petsShown=false;
function petWant(){const m=petsMode(); return m==="on" || (m==="auto"&&(away.out||away.idle)&&!mxAmbientBusy());}
function petEval(){
  const want=petWant();
  if(want&&!petsShown){petsShown=true;startPets();}
  else if(!want&&petsShown){petsShown=false;stopPets();}
}
onAmbient(petEval);
function togglePets(){                                      // cycles auto → on → off → auto
  const next={auto:"on",on:"off",off:"auto"}[petsMode()];
  try{localStorage.setItem(PETS_STORE,next);}catch{}
  petEval();
  toast(ICON.gamepad,"Pixel pets: "+next,
    {on:"Always visible",off:"Hidden",auto:"Shown when idle or the tab loses focus"}[next]);
}
// resize (incl. fullscreen/maximize) must NOT rebuild — that teleports/flickers pets. Every frame of the resize, scale
// each pet's x with the width so they keep their spread and ride the edge (no transition); a walking pet then carries
// on to its scaled target in the time its walk had left.
let petFieldW=0;
function petReflow(){
  const {w}=petBounds(), oldW=petFieldW;
  if(w<80||!oldW||w===oldW)return;
  petFieldW=w;
  const now=performance.now();
  for(const p of pets){
    const fit=x=>Math.max(0,w-p.w)*Math.min(1,Math.max(0,x/Math.max(1,oldW-p.w)));
    const walking=p.node.classList.contains("walking"), tx=fit(p.x), ty=p.y;
    const at=new DOMMatrix(getComputedStyle(p.node).transform);   // where a walking pet is right now, mid-transition
    p.node.style.transition="none"; placePet(p,fit(at.e),at.f); void p.node.offsetWidth; p.node.style.transition="";
    if(walking){p.node.style.setProperty("--dur",Math.max(.05,(p.until-now)/1000)+"s");placePet(p,tx,ty);}
  }
}
new ResizeObserver(()=>{if(petsShown)petReflow();}).observe(petField);
petEval();
