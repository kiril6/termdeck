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
function placePet(p,x,y){p.x=x;p.y=y;p.node.style.transform=`translate(${x}px,${y}px)`;}
// pets ride a floor strip along the desktop bottom, above windows — always visible, never over the terminal body
function petTarget(p,w,h){
  const floor=h-p.h-3;
  return {tx:petRand(0,Math.max(0,w-p.w)), ty:petRand(Math.max(0,floor-34),floor)};
}
function petStep(p){
  if(!petsShown)return;
  const {w,h}=petBounds(); if(w<80){petTimers.push(setTimeout(()=>petStep(p),1500));return;}
  const {tx,ty}=petTarget(p,w,h);
  const dist=Math.hypot(tx-p.x,ty-p.y);
  const speed=p.spec.kind==="slime"?26:34; // px/s
  const dur=Math.max(1.2,dist/speed);
  p.face.style.setProperty("--dir",tx<p.x?-1:1);
  p.node.style.setProperty("--dur",dur+"s");
  p.node.classList.add("walking");
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
  const {w,h}=petBounds();
  roster.forEach((r,i)=>{
    const p=buildPet(r.spec,r.scale,r.op);
    petField.append(p.node); pets.push(p);
    const spot=petTarget(p,w,h);
    placePet(p,spot.tx,spot.ty);
    petTimers.push(setTimeout(()=>petStep(p),petRand(300,1200)*(i+1)));
  });
}
/* ── screensaver logic: enabled by default but only shown when the user is away/idle ──
   want = enabled && (tab hidden/blurred || mouse idle). Activity or refocus hides them. */
const PET_IDLE_MS=45000;
let petsShown=false, petAway=false, petIdle=false, petLastAct=Date.now();
function petWant(){const m=petsMode(); return m==="on" || (m==="auto"&&(petAway||petIdle));}
function petEval(){
  const want=petWant();
  if(want&&!petsShown){petsShown=true;startPets();}
  else if(!want&&petsShown){petsShown=false;stopPets();}
}
function petActivity(){petLastAct=Date.now(); if(petIdle){petIdle=false;petEval();}}
["mousemove","mousedown","keydown","wheel","touchstart"].forEach(ev=>
  window.addEventListener(ev,petActivity,{passive:true}));
document.addEventListener("visibilitychange",()=>{petAway=document.hidden; if(!document.hidden)petActivity(); petEval();});
window.addEventListener("blur",()=>{petAway=true;petEval();});
window.addEventListener("focus",()=>{petAway=false;petActivity();petEval();});
setInterval(()=>{const idle=Date.now()-petLastAct>PET_IDLE_MS; if(idle!==petIdle){petIdle=idle;petEval();}},2000);
function togglePets(){                                      // cycles auto → on → off → auto
  const next={auto:"on",on:"off",off:"auto"}[petsMode()];
  try{localStorage.setItem(PETS_STORE,next);}catch{}
  petEval();
  toast(ICON.gamepad,"Pixel pets: "+next,
    {on:"Always visible",off:"Hidden",auto:"Shown when idle or the tab loses focus"}[next]);
}
// resize (incl. fullscreen) must NOT rebuild — that teleports/flickers pets. Glide them into new bounds instead.
function petReflow(){
  const {w,h}=petBounds(); if(w<80)return;
  pets.forEach(p=>{
    const floor=h-p.h-3;
    const x=Math.min(Math.max(0,p.x),Math.max(0,w-p.w));
    const y=Math.min(Math.max(floor-34,p.y),floor);
    if(x!==p.x||y!==p.y){p.node.style.setProperty("--dur","0.6s");placePet(p,x,y);}
  });
}
let petResizeT;
window.addEventListener("resize",()=>{clearTimeout(petResizeT);petResizeT=setTimeout(()=>{if(petsShown)petReflow();},200);});
petAway=document.hidden; petEval();
