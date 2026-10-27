// TermDeck frontend: Matrix rain (focus veil, desktop background), the privacy shield, and the shared away/idle state.
// One of the classic scripts in public/js/, loaded in order by index.html and sharing one global scope.
"use strict";

/* ════════════════════════════════════════════════
   AWAY / IDLE — one detector for the pets (45s) and the walk-away shield (minutes)
   ════════════════════════════════════════════════ */
const AWAY_IDLE_MS=45000;
const away={out:document.hidden,idle:false,lastAct:Date.now()};   // out = tab hidden or window blurred
const ambientSubs=[];
function onAmbient(fn){ambientSubs.push(fn);}   // away/idle or the agents' overall state changed
function ambientEmit(){ambientSubs.forEach((f)=>f());}
function awayActivity(){away.lastAct=Date.now(); if(away.idle){away.idle=false;ambientEmit();}}
["mousemove","mousedown","keydown","wheel","touchstart"].forEach((ev)=>window.addEventListener(ev,awayActivity,{passive:true}));
document.addEventListener("visibilitychange",()=>{away.out=document.hidden; if(!document.hidden){awayActivity(); mxKick();} ambientEmit();});
window.addEventListener("blur",()=>{away.out=true;ambientEmit();});
window.addEventListener("focus",()=>{away.out=false;awayActivity();ambientEmit();});
setInterval(()=>{
  const idle=Date.now()-away.lastAct>AWAY_IDLE_MS; if(idle!==away.idle){away.idle=idle;ambientEmit();}
  if(mx.away&&!mx.shield&&Date.now()-away.lastAct>=mx.away*60000) setShield(true,"away");   // walk-away: focus loss alone never shields
},2000);

/* ════════════════════════════════════════════════
   SETTINGS (td.matrix.v1) — background and veil are opt-in; the shield is manual
   ════════════════════════════════════════════════ */
const MX_STORE="td.matrix.v1";
const MX_WORK=["behind","blur","rain","solid"], MX_SHIELD=["solid","blur","rain"], MX_AWAY=[0,2,5,10];
const MX_DEF={bg:false,veil:"off",veilStyle:"blur",shieldStyle:"solid",titles:false,away:0,shield:false,awayShield:false,asked:false};
function mxLoad(){
  let v={}; try{v=JSON.parse(localStorage.getItem(MX_STORE)||"{}")||{};}catch{}
  const o={...MX_DEF}; for(const k in MX_DEF) if(typeof v[k]===typeof MX_DEF[k]) o[k]=v[k];
  if(o.veil!=="agents") o.veil="off";
  if(!MX_WORK.includes(o.veilStyle)) o.veilStyle="blur";
  if(!MX_SHIELD.includes(o.shieldStyle)) o.shieldStyle="solid";
  if(!MX_AWAY.includes(o.away)) o.away=0;
  return o;
}
let mx=mxLoad();
function mxSave(){try{localStorage.setItem(MX_STORE,JSON.stringify(mx));}catch{}}
if(new URLSearchParams(location.search).has("shield")&&!mx.shield){mx.shield=true; mxSave();}   // a "streaming" bookmark opens covered

/* ════════════════════════════════════════════════
   RAIN ENGINE — 2D canvas only (xterm already spends the WebGL context budget), one shared rAF loop,
   DPR 1, a glyph atlas, fps caps, round-robin pane draws, and a one-way step-down when frames run slow
   ════════════════════════════════════════════════ */
const MX_KATA="アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789";
const MX_SAFE="0123456789<>=+-*:;#$%&@";
const MX_CELL=16, MX_COLW=18, MX_PER_TICK=4, MX_LIVE_MAX=4;
const MX_SPEED={idle:4,working:10,calm:3}, MX_BRIGHT={idle:.7,working:1,calm:.45};   // background fall speed, rows/s
const MX_TARGET={bg:1.25,veil:2.2,shield:2.5,behind:1.4};   // contrast of the trail colour against what it sits on: same calm level on every theme
const MX_REDUCED=matchMedia("(prefers-reduced-motion: reduce)");
const mxRains=new Set(), mxOf=new WeakMap();
let mxRaf=0, mxIdleT=0, mxSlow=0, mxLevel=0, mxAtlas=null, mxGlyphs=null, mxCol=null, mxState="idle", mxBg=null;
const mxRO=new ResizeObserver((es)=>es.forEach((e)=>{const r=mxOf.get(e.target); if(r) mxResize(r);}));

function mxPrng(a){return ()=>{a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296;};}
// Some Linux setups have no katakana font: compare against a code point no font has, and fall back to digits/symbols.
function mxHasKata(){
  const c=el("canvas"); c.width=c.height=20; const g=c.getContext("2d",{willReadFrequently:true});
  const px=(ch)=>{g.clearRect(0,0,20,20); g.font="16px ui-monospace,Menlo,monospace"; g.fillText(ch,2,16); return g.getImageData(0,0,20,20).data.join(",");};
  const k=px("ア"); return /[1-9]/.test(k)&&k!==px("\u{10FFFD}");
}
const mxHex=(v)=>/^#[0-9a-f]{6}$/i.test(v);
const mxMix=(a,b,t)=>"#"+[1,3,5].map((i)=>Math.round(parseInt(a.slice(i,i+2),16)*t+parseInt(b.slice(i,i+2),16)*(1-t)).toString(16).padStart(2,"0")).join("");
function mxAlpha(kind){
  const on=kind==="shield"?mxCol.panel:kind==="behind"?THEMES[defaultThemeId].xterm.background:mxCol.bg;   // shortcut: a window with its own theme keeps the global theme's opacity
  if(!mxHex(mxCol.accent)||!mxHex(on)) return .3;
  let a=.05; while(a<1&&contrast(mxMix(mxCol.accent,on,a),on)<MX_TARGET[kind]) a+=.05;
  if(kind==="behind"){   // under text: back off until the text keeps 90% of its own contrast (AA at most), e.g. Solarized Light
    const fg=THEMES[defaultThemeId].xterm.foreground, floor=Math.min(4.5,contrast(fg,on)*.9);
    if(mxHex(fg)) while(a>.05&&contrast(fg,mxMix(mxCol.accent,on,a))<floor) a-=.05;
  }
  return +Math.min(1,a).toFixed(2);
}
function mxNoRain(){return defaultThemeId==="highContrast";}   // accessibility theme: no motion, no noise
function mxTheme(){
  const cs=getComputedStyle(document.documentElement), v=(k)=>cs.getPropertyValue(k).trim();
  mxCol={accent:v("--accent"),head:v("--text"),bg:v("--bg"),panel:v("--panel")};
  mxAtlas=null;
  mxRains.forEach((r)=>{mxPaint(r); if(r.static) mxStatic(r);});
  mxShieldSync(); mxVeilRestyle(); mxBgSync();
}
function mxAtlasGet(){
  if(mxAtlas) return mxAtlas;
  const G=mxGlyphs||(mxGlyphs=mxHasKata()?MX_KATA:MX_SAFE);
  const c=el("canvas"); c.width=G.length*MX_CELL; c.height=MX_CELL*2;
  const g=c.getContext("2d"); g.font=(MX_CELL-3)+"px ui-monospace,Menlo,Consolas,monospace"; g.textAlign="center"; g.textBaseline="top";
  [mxCol.accent,mxCol.head].forEach((col,row)=>{g.fillStyle=col; for(let i=0;i<G.length;i++) g.fillText(G[i],i*MX_CELL+MX_CELL/2,row*MX_CELL+1);});
  return (mxAtlas=c);
}
function mxRain(cv,kind){
  const seed=(Math.random()*2147483647)|0;
  const r={cv,kind,seed,rnd:mxPrng(seed),g:cv.getContext("2d"),w:0,h:0,drops:[],speed:[],prev:[],last:0,draws:0,static:false,paused:false,alpha:1};
  cv.setAttribute("aria-hidden","true"); cv.dataset.seed=seed;
  mxRains.add(r); mxOf.set(cv,r); mxRO.observe(cv); mxPaint(r);
  const live=[...mxRains].filter((x)=>x.kind!=="bg"&&!x.static).length;
  if(MX_REDUCED.matches||mxLevel>=2||(kind!=="bg"&&live>MX_LIVE_MAX)) r.static=true;   // extra panes get a still frame
  mxResize(r); mxKick();
  return r;
}
function mxPaint(r){r.alpha=mxAlpha(r.kind); r.cv.dataset.alpha=r.alpha; r.cv.dataset.head=mxCol.head; if(r.kind!=="bg") r.cv.style.opacity=r.alpha;}
function mxDrop(r){mxRains.delete(r); mxRO.unobserve(r.cv);}
function mxResize(r){
  const w=r.cv.clientWidth, h=r.cv.clientHeight; if(!w||!h||(w===r.w&&h===r.h)) return;
  // A resize (maximize, dragging an edge) keeps the rain where it is: setting the size clears the canvas, so copy the
  // old frame back, keep the columns that still fit and add new ones spread over the height — no restart from the top.
  const old=r.w&&r.h?Object.assign(document.createElement("canvas"),{width:r.w,height:r.h}):null;
  if(old) old.getContext("2d").drawImage(r.cv,0,0);
  r.w=r.cv.width=w; r.h=r.cv.height=h;   // DPR 1 on purpose: 4x fewer pixels on Retina, and rain reads fine soft
  if(old) r.g.drawImage(old,0,0);
  const n=Math.ceil(w/MX_COLW), rows=Math.ceil(h/MX_CELL), had=r.drops.length;
  r.drops.length=r.speed.length=r.prev.length=Math.min(had,n);
  // Heads a shorter canvas cut off would all restart from the top together: spread them like new columns instead.
  for(let i=0;i<r.drops.length;i++) if(r.drops[i]>rows){r.drops[i]=r.rnd()*rows; r.prev[i]=-1;}
  for(let i=had;i<n;i++){
    r.drops[i]=had?r.rnd()*rows:-r.rnd()*rows; r.prev[i]=-1;
    r.speed[i]=.6+r.rnd()*.4;   // each column its own pace (same range on every pane), so they don't step in unison
  }
  if(r.static) mxStatic(r);
}
// How fast the rain falls, in character rows per second; the frame rate only decides how smoothly that shows.
function mxCps(r){return r.kind==="bg"?MX_SPEED[mxState]:r.kind==="behind"?7:14;}
// Time-based: a draw moves each column by its speed × the time since this canvas last drew, so a skipped frame (round-robin,
// a busy tab) never slows the rain down, and the trail fades at a rate tied to the speed so its length stays the same.
function mxDraw(r,dt){
  const g=r.g, A=mxAtlasGet(), G=mxGlyphs.length, rows=Math.ceil(r.h/MX_CELL), cps=mxCps(r);
  g.globalCompositeOperation="destination-out";   // fade toward transparent: the theme's own background shows through (true black on AMOLED)
  g.fillStyle="rgba(0,0,0,"+(1-Math.exp(-dt*cps*(r.kind==="veil"||r.kind==="shield"?.2:.15))).toFixed(3)+")"; g.fillRect(0,0,r.w,r.h);
  g.globalCompositeOperation="source-over";
  const headRow=r.kind==="behind"?0:MX_CELL;   // behind text: no bright head, it would sit under letters
  for(let i=0;i<r.drops.length;i++){
    const x=i*MX_COLW, y0=r.drops[i], y1=y0+cps*r.speed[i]*dt;
    for(let c=Math.floor(y0)+1;c<=Math.floor(y1);c++){   // usually 0 or 1 new row per frame
      if(r.prev[i]>=0&&c>0){g.clearRect(x,(c-1)*MX_CELL,MX_CELL,MX_CELL); g.drawImage(A,r.prev[i]*MX_CELL,0,MX_CELL,MX_CELL,x,(c-1)*MX_CELL,MX_CELL,MX_CELL);}   // last head becomes trail
      if(c>=0&&c<=rows){const gi=(r.rnd()*G)|0; g.drawImage(A,gi*MX_CELL,headRow,MX_CELL,MX_CELL,x,c*MX_CELL,MX_CELL,MX_CELL); r.prev[i]=gi;}
    }
    r.drops[i]=y1>rows+2&&r.rnd()<dt*1.5?-r.rnd()*20:y1;   // off the bottom: restart after a random pause
  }
  r.draws++;
}
function mxStatic(r){r.static=true; if(!r.w) return; r.g.clearRect(0,0,r.w,r.h); for(let i=0;i<60;i++) mxDraw(r,1/15);}
function mxFps(r){
  const f=r.kind==="bg"?15:r.kind==="behind"?24:30;   // same when the window is out of focus: a hidden tab already draws nothing
  return mxLevel>=1?f/2:f;
}
function mxKick(){
  clearTimeout(mxIdleT); mxIdleT=0;
  if(!mxRaf&&!document.hidden&&[...mxRains].some((r)=>!r.static&&!r.paused)) mxRaf=requestAnimationFrame(mxLoop);
}
function mxLoop(now){
  mxRaf=0; if(document.hidden) return;
  const t0=performance.now(), due=[]; let visible=false, waiting=false;
  for(const r of mxRains){
    if(!r.cv.isConnected){mxDrop(r); continue;}
    if(r.static||r.paused) continue;
    waiting=true;
    if(r.cv.offsetParent===null) continue;   // minimized, other project, inactive tab: 0 draws
    visible=true;
    if(now-r.last>=1000/mxFps(r)) due.push(r);
  }
  due.sort((a,b)=>a.last-b.last);
  let panes=0;
  for(const r of due){
    if(r.kind!=="bg"){if(panes>=MX_PER_TICK) continue; panes++;}   // flat cost per frame however many panes rain
    const dt=r.last?Math.min(.25,(now-r.last)/1000):1/mxFps(r); r.last=now; mxDraw(r,dt);
  }
  if(due.length){
    if(performance.now()-t0>3){if(++mxSlow>=40){mxSlow=0; mxDegrade();}}
    else mxSlow=Math.max(0,mxSlow-1);
  }
  if(visible) mxRaf=requestAnimationFrame(mxLoop);
  else if(waiting) mxIdleT=setTimeout(mxKick,500);   // nothing on screen: re-check twice a second instead of every frame
}
// One step down per ~2s of slow frames: half fps, then still frames, then no rain (solid veils/shield). Never steps back up this session.
function mxDegrade(){
  if(mxLevel>=3) return;
  mxLevel++; document.documentElement.dataset.mxLevel=mxLevel;
  if(mxLevel>=2){mxRains.forEach((r)=>{if(!r.static) mxStatic(r);}); mxVeilRestyle();}   // rain behind text stops at this step
  if(mxLevel>=3){mxShieldSync(); mxVeilRestyle(); mxBgSync();}
}
MX_REDUCED.addEventListener("change",()=>{if(MX_REDUCED.matches) mxRains.forEach((r)=>mxStatic(r));});
window.mxStats=()=>{return [...mxRains].map((r)=>({kind:r.kind,seed:r.seed,draws:r.draws,static:r.static,paused:r.paused,alpha:r.alpha}));};   // read-only, for the browser tests (a window property, not an app global)

/* ════════════════════════════════════════════════
   PRIVACY SHIELD — a visual cover, not security: the text stays in the DOM, the clipboard, search and the buffer
   ════════════════════════════════════════════════ */
const shieldInd=document.getElementById("shield-ind"), privBtn=document.getElementById("privacy-btn");
shieldInd.innerHTML=ICON.shield;
shieldInd.addEventListener("click",()=>setShield(false));
// Top bar: one click hides or shows every terminal; the caret holds the narrower choices.
privBtn.addEventListener("click",toggleShield);
document.getElementById("privacy-caret").addEventListener("click",(e)=>{
  const r=e.currentTarget.getBoundingClientRect(), [s,t]=mxFocused(), p=projects.get(activeProject);
  showCtxMenu(r.left,r.bottom+6,[
    {icon:ICON.shield,label:mx.shield?"Show all terminals":"Hide all terminals",key:kbd("⌘","⌥","X"),run:toggleShield},
    {label:p?.shield?"Show this project\u2019s terminals":"Hide this project\u2019s terminals",run:()=>toggleProjectShield(activeProject)},
    {label:t&&tabShielded(s,t)?"Show the focused tab":"Hide the focused tab",disabled:!t,run:()=>toggleTabShield(s,t)},
    {label:"Cover the focused tab for now",disabled:!t||tabShielded(s,t),run:()=>mxVeilNow(s,t)},
    {sep:true},
    {label:"Privacy & effects\u2026",run:openPrivacySettings},
  ]);
});
// t.through lets one tab show while the global or project shield covers the rest. Never saved, and dropped whenever a
// wider shield turns on or off, so the next ⌘⌥X (or walk-away) always hides everything again.
const wideShielded=(s)=>mx.shield||!!projects.get(s.project)?.shield;
function tabShielded(s,t){return !!t.shield||(wideShielded(s)&&!t.through);}
function mxDropThrough(pid){sessions.forEach((s)=>{if(pid==null||s.project===pid) s.tabs.forEach((t)=>{t.through=false;});});}
function mxNoticeToast(title,msg){const t=toast(ICON.shield,title,msg,4000); t.classList.add("t-safe"); return t;}   // our own toasts stay readable under the shield
function mxShieldSync(){
  const root=document.documentElement;
  root.classList.toggle("td-shield",mx.shield);
  root.classList.toggle("td-shield-titles",mx.shield&&mx.titles);
  root.dataset.shieldStyle=mxShieldStyle();
  shieldInd.hidden=!mx.shield;
  privBtn.classList.toggle("active",mx.shield); privBtn.setAttribute("aria-pressed",String(mx.shield));
  privBtn.title=(mx.shield?"Privacy shield is on \u2014 show all terminals":"Hide all terminals")+" ("+kbd("⌘","⌥","X")+")";
  privBtn.setAttribute("aria-label",mx.shield?"Privacy shield is on, show all terminals":"Privacy shield: hide all terminals"); privBtn.dataset.label=mx.shield?"Privacy: on":"Privacy";
  sessions.forEach((s)=>{
    s.tabs.forEach((t)=>{
      const on=tabShielded(s,t);
      t.pane.classList.toggle("mx-lock",on);
      t.pane.classList.toggle("mx-through",!on&&wideShielded(s));
      const rain=on&&mxShieldStyle()==="rain";
      if(rain&&!t.srain){const cv=el("canvas","mx-srain"); t.pane.append(cv); t.srain=mxRain(cv,"shield");}
      else if(!rain&&t.srain){t.srain.cv.remove(); mxDrop(t.srain); t.srain=null;}
      if(on&&t.mx?.on) mxVeilHide(t);   // the shield covers it already
    });
    mxShieldBtn(s);
  });
}
function mxShieldBtn(s){
  const a=activeTab(s); if(!s.bShield||!a) return;
  const on=tabShielded(s,a);
  s.bShield.classList.toggle("on",on); s.bShield.setAttribute("aria-pressed",on);
  s.bShield.title=a.shield?"Show this tab again":on?"Hidden by the privacy shield \u2014 click to show just this tab":wideShielded(s)?"Shown while the privacy shield covers the rest \u2014 click to hide it":"Hide this tab (privacy shield)";
}
function mxShieldStyle(){const st=mx.shieldStyle; return st==="rain"&&(mxNoRain()||mxLevel>=3)?"solid":st;}
function setShield(on,why){
  if(mx.shield===on) return;
  mx.shield=on; mx.awayShield=on&&why==="away"; mxDropThrough(); mxSave(); mxShieldSync(); matrixSync(getAgentQueue());
  if(why!=="away") mxNoticeToast(on?"Privacy shield on":"Privacy shield off",on?"Terminals and file views are covered — "+kbd("⌘","⌥","X")+" turns it off":"Terminals are visible again");
}
function toggleShield(){setShield(!mx.shield);}
function toggleTabShield(s,t){
  if(!s||!t) return;
  if(!t.shield&&wideShielded(s)){   // the global or project shield covers it: let just this tab through, or put it back under
    t.through=!t.through; mxShieldSync();
    const by=mx.shield?"the privacy shield":"the \u201c"+(projects.get(s.project)?.name||"project")+"\u201d shield";
    mxNoticeToast(t.through?"Showing this tab":"Tab hidden again","\u201c"+s.name+"\u201d"+(t.through?" is visible; "+by+" still covers the rest":" is back under "+by));
    return;
  }
  t.shield=!t.shield; t.through=false; scheduleSave(); mxShieldSync();
  mxNoticeToast(t.shield?"Tab shielded":"Tab unshielded","\u201c"+s.name+"\u201d"+(t.shield?" stays covered until you unlock it":" is visible again"+(tabShielded(s,t)?" when the shield is off":"")));
}
function toggleProjectShield(pid){
  const p=projects.get(pid); if(!p) return;
  p.shield=!p.shield; mxDropThrough(pid); scheduleSave(); mxShieldSync();
  mxNoticeToast(p.shield?"Project always shielded":"Project shield off","Every terminal in “"+p.name+"”"+(p.shield?" opens covered":" is visible again"));
}
// A walk-away shield ends on a click (mouse movement alone is not enough); a manual one only by ⌘⌥X or the header indicator.
window.addEventListener("pointerdown",()=>{if(mx.shield&&mx.awayShield) setShield(false);},true);
// Hold ⌥ (alone) to peek; long-press on touch. Any other key ends the peek, so ⌥+arrow word jumps don't flash the screen.
let mxPeekT=0;
function mxPeek(on){clearTimeout(mxPeekT); document.documentElement.classList.toggle("mx-peek",on);}
document.addEventListener("keydown",(e)=>{
  if(e.key==="Alt"&&!e.repeat&&!e.getModifierState?.("AltGraph")&&document.querySelector(".mx-lock")){clearTimeout(mxPeekT); mxPeekT=setTimeout(()=>mxPeek(true),250);}
  else if(e.key!=="Alt") mxPeek(false);
},true);
document.addEventListener("keyup",(e)=>{
  if(e.key!=="Alt") return;
  if(document.documentElement.classList.contains("mx-peek")) e.preventDefault();   // Windows/Linux: a released lone Alt would focus the browser's menu
  mxPeek(false);
},true);
window.addEventListener("blur",()=>mxPeek(false));
desktop.addEventListener("pointerdown",(e)=>{if(e.pointerType==="touch"&&e.target.closest(".mx-lock")) mxPeekT=setTimeout(()=>mxPeek(true),500);});
["pointerup","pointercancel"].forEach((ev)=>desktop.addEventListener(ev,()=>mxPeek(false)));
// OSC 7777 ; shield BEL — a script can cover its own pane before printing secrets. It can only turn the shield ON:
// anything printed (a `cat`'d file included) must never be able to uncover you.
const MX_OSC=7777;
function mxOsc(s,tab,data){
  const now=Date.now();
  if(data.trim()!=="shield") return true;
  if(now-(tab.replayAt||0)<1500||now-(tab.oscAt||0)<1000) return true;   // shortcut: a time window, not exact replay tracking — a buffer replayed on reattach re-sends old sequences
  tab.oscAt=now;
  if(!tab.shield){tab.shield=true; scheduleSave(); mxShieldSync(); mxNoticeToast("Tab shielded","“"+s.name+"” asked to hide its output");}
  return true;
}

/* ════════════════════════════════════════════════
   WORKING EFFECT (focus veil) — what a working agent's pane shows: rain behind the text (you keep working in it),
   or a cover (blur, rain, solid) so you stop watching tokens scroll
   ════════════════════════════════════════════════ */
const MX_SHOW_DELAY=3000, MX_MIN_ON=1500, MX_COOL=2000;
const mxWorking=(t)=>t.agent&&!t.exited&&!t.closedByUser&&!t.waiting&&!t.approval;   // same rule as the agent queue's "working"
const mxSessOf=(t)=>[...sessions.values()].find((s)=>s.tabs.includes(t));
// "none": rain behind the text where no rain may run (High Contrast, the last step-down) — nothing to show.
// Is the working effect on for this tab, and which one? A window can opt in or out on its own (theme menu); opting in
// while the app-wide effect is off means rain behind the text — the one effect you can keep working in.
const mxFxOn=(s,t)=>!t.noVeil&&(s.fx===true||(s.fx!==false&&mx.veil==="agents"));
function mxVeilStyle(t){
  const s=mxSessOf(t);
  let st=s&&s.fx===true&&mx.veil!=="agents"?"behind":mx.veilStyle;
  if(st==="behind"&&t.mx?.manual) st="blur";   // "Cover this tab now" always covers
  if(st==="behind") return mxNoRain()||mxLevel>=2?"none":st;
  return mxLevel>=3||(st==="rain"&&mxNoRain())?"solid":st;
}
const mxCovers=(t)=>t.pane.classList.contains("mx-veiled")&&!t.pane.classList.contains("mx-veil-behind")&&!t.pane.classList.contains("mx-veil-none");
function mxVeilEval(s,t){
  if(!t.pane.isConnected) return;
  const m=t.mx||(t.mx={on:false,timer:0,since:0,shownAt:0,cool:0,dismissed:false,manual:false,el:null});
  const working=mxWorking(t), now=Date.now();
  if(working&&!m.since) m.since=now;
  if(!working){m.since=0; m.dismissed=false;}   // a new run starts fresh
  const want=!tabShielded(s,t)&&(m.manual||(working&&mxFxOn(s,t)&&!m.dismissed));
  clearTimeout(m.timer); m.timer=0;
  if(want&&!m.on){
    const at=m.manual?now:Math.max(m.since+MX_SHOW_DELAY,m.cool);
    if(at<=now) mxVeilShow(s,t); else m.timer=setTimeout(()=>mxVeilEval(s,t),at-now);
  }else if(!want&&m.on){
    const at=t.approval||tabShielded(s,t)?now:m.shownAt+MX_MIN_ON;   // an approval prompt is never kept covered
    if(at<=now) mxVeilHide(t); else m.timer=setTimeout(()=>mxVeilEval(s,t),at-now);
  }
}
function mxVeilShow(s,t){
  const m=t.mx; m.on=true; m.shownAt=Date.now();
  m.el=el("div","mx-veil"); t.pane.append(m.el);
  mxVeilRestyleOne(s,t); mxVeilTick(); mxTimerEnsure();
}
function mxVeilHide(t){
  const m=t.mx; if(!m||!m.on) return;
  clearTimeout(m.timer); m.timer=0; m.on=false; m.cool=Date.now()+MX_COOL;
  if(m.rain){mxDrop(m.rain); m.rain=null;}
  m.el?.remove(); m.el=null; m.time=null;
  t.pane.classList.remove("mx-veiled","mx-veil-blur","mx-veil-rain","mx-veil-solid","mx-veil-behind","mx-veil-none");
  mxTermClear(t,false);
}
// Rain behind the text: the terminal's own background goes transparent (xterm's allowTransparency, which the WebGL
// renderer honours) so the pane's background and the rain under it show through. Only on tabs that use it.
function mxTermClear(t,on){
  if(!on&&!t.mxClear) return;
  const s=mxSessOf(t); if(!s) return;
  const base=THEMES[s.themeId||defaultThemeId].xterm;
  t.mxClear=on;
  // The theme's own colour at alpha 0, not #00000000: the WebGL renderer fills dim (SGR 2) cells with the background's
  // RGB and ignores its alpha, so a black one draws black boxes behind dim text on light themes.
  try{t.term.options.allowTransparency=on; t.term.options.theme=on?{...base,background:base.background.slice(0,7)+"00"}:base;}catch{}
}
function mxVeilRestyleOne(s,t){
  const m=t.mx, st=mxVeilStyle(t), cover=st==="blur"||st==="rain"||st==="solid";
  t.pane.classList.remove("mx-veil-blur","mx-veil-rain","mx-veil-solid","mx-veil-behind","mx-veil-none"); t.pane.classList.add("mx-veiled","mx-veil-"+st);
  const kind=st==="rain"?"veil":st==="behind"?"behind":null;
  if(m.rain&&m.rain.kind!==kind){m.rain.cv.remove(); mxDrop(m.rain); m.rain=null;}
  if(kind&&!m.rain){const cv=el("canvas"); m.el.prepend(cv); m.rain=mxRain(cv,kind);}
  mxTermClear(t,st==="behind");
  const pill=m.el.querySelector(".mx-pill");
  if(cover&&!pill){   // name + elapsed only: no command or file text on top of a cover
    const p=el("div","mx-pill"), nm=el("span","mx-pill-name"), tm=el("span","mx-pill-time"), off=el("button","mx-pill-off");
    nm.textContent=(s.name||"session")+" \u00b7 "+(t.name||"tab");
    off.type="button"; off.innerHTML=ICON.eyeOff; off.title="Turn off the working effect for this tab"; off.setAttribute("aria-label",off.title);
    off.addEventListener("click",(e)=>{e.stopPropagation(); t.noVeil=true; scheduleSave(); m.manual=false; mxVeilHide(t);});
    p.append(nm,tm,off); m.el.append(p); m.time=tm;
  }else if(!cover&&pill){pill.remove(); m.time=null;}
}
function mxVeilRestyle(){sessions.forEach((s)=>s.tabs.forEach((t)=>{if(t.mx?.on) mxVeilRestyleOne(s,t);}));}
function mxVeilTick(){
  const now=Date.now();
  sessions.forEach((s)=>s.tabs.forEach((t)=>{
    if(!t.mx?.on||!t.mx.time) return;
    const sec=Math.floor((now-(t.mx.since||t.mx.shownAt))/1000);
    t.mx.time.textContent=Math.floor(sec/60)+":"+pad(sec%60);
  }));
}
function mxVeilNow(s,t){
  if(!s||!t){toast(ICON.warn,"No focused terminal","Click a terminal first",2500); return;}
  if(tabShielded(s,t)){mxNoticeToast("Already hidden","This tab is under the privacy shield"); return;}
  const m=t.mx||(mxVeilEval(s,t),t.mx); m.manual=true;
  if(m.on) mxVeilRestyleOne(s,t); else mxVeilEval(s,t);   // already showing rain behind the text: switch it to a cover
}
function toggleNoVeil(s,t){t.noVeil=!t.noVeil; scheduleSave(); mxVeilEval(s,t);}
// A cover ends on any key (not a lone modifier) or click on the pane, for this run; the key still reaches the terminal
// (Esc interrupts). Rain behind the text never needs dismissing: you are meant to keep working there.
function mxWireTab(s,t){
  const end=()=>{
    const m=t.mx; if(!m?.on||!mxCovers(t)) return;
    const back=m.manual&&mxFxOn(s,t)&&mxWorking(t)&&(mx.veil!=="agents"||mx.veilStyle==="behind");   // a manual cover over rain-behind-text goes back to the rain, not to nothing
    m.manual=false; if(!back) m.dismissed=true;
    if(back) mxVeilRestyleOne(s,t); else mxVeilHide(t);
  };
  t.pane.addEventListener("keydown",(e)=>{if(!["Shift","Meta","Control","Alt"].includes(e.key)) end();},true);
  t.pane.addEventListener("mousedown",(e)=>{if(!e.target.closest(".mx-pill")) end();},true);
  t.term.parser.registerOscHandler(MX_OSC,(d)=>mxOsc(s,t,d));
}
let mxTimer=0;
function mxTimerEnsure(){
  const need=mx.bg||[...sessions.values()].some((s)=>s.tabs.some((t)=>t.mx?.on));
  if(need&&!mxTimer) mxTimer=setInterval(()=>{mxVeilTick(); mxBgSync(); if(!mx.bg&&![...sessions.values()].some((s)=>s.tabs.some((t)=>t.mx?.on))){clearInterval(mxTimer); mxTimer=0;}},1000);
}

/* ════════════════════════════════════════════════
   BACKGROUND RAIN — behind the windows, follows the agents: idle drifts, working speeds up, waiting/approval calms
   down so the alerts stand out. It keeps falling while the pets are out (they walk in front of it).
   ════════════════════════════════════════════════ */
function mxCovered(){
  const d=desktop.getBoundingClientRect(); if(!d.width||!d.height) return true;
  const rs=[];
  for(const s of sessions.values()){
    if(s.project!==activeProject||s.minimized) continue;
    if(s.maximized) return true;
    rs.push(s.win.getBoundingClientRect());
  }
  let free=0;   // 8×6 sample points: overlapping windows are not counted twice, and it costs a few dozen comparisons a second
  for(let i=0;i<8;i++) for(let j=0;j<6;j++){
    const x=d.left+d.width*(i+.5)/8, y=d.top+d.height*(j+.5)/6;
    if(!rs.some((r)=>x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom)) free++;
  }
  return free<3;   // under ~6% of the desktop left to see
}
function mxAmbientBusy(){return mx.bg&&!mxNoRain()&&mxState!=="idle";}   // "auto" pets stay away while the rain signals agents (or it's calm for an alert)
function mxBgSync(){
  const want=mx.bg&&!mxNoRain()&&mxLevel<3&&!mxCovered();
  if(want&&!mxBg){const cv=el("canvas","mx-bg"); desktop.prepend(cv); mxBg=mxRain(cv,"bg");}
  if(!mxBg) return;
  if(!mx.bg){const b=mxBg; mxBg=null; b.cv.style.opacity="0"; mxDrop(b); setTimeout(()=>b.cv.remove(),600); return;}   // off = canvas gone, zero cost
  mxBg.paused=!want; mxBg.cv.dataset.speed=mxState;
  mxBg.cv.style.opacity=want?String(+(mxBg.alpha*MX_BRIGHT[mxState]).toFixed(2)):"0";
  if(want) mxKick();
}
function setBg(on){mx.bg=on; mxSave(); mxBgSync(); mxTimerEnsure(); ambientEmit(); mxNoticeToast("Matrix rain "+(on?"on":"off"),on?"Falling characters behind your windows":"Background is plain again");}

// Called by updateAgentOverview() on every agent state change.
function matrixSync(queue){
  const st=queue.some((x)=>x.state!=="working")?"calm":queue.length?"working":"idle";
  const changed=st!==mxState; mxState=st;
  sessions.forEach((s)=>s.tabs.forEach((t)=>mxVeilEval(s,t)));
  mxBgSync();
  if(changed) ambientEmit();
}

/* ════════════════════════════════════════════════
   COMMANDS — palette (Privacy category), menus, ⌘⌥X (keyboard.js)
   ════════════════════════════════════════════════ */
const mxFocused=()=>{const s=focusedId&&sessions.get(focusedId); return s?[s,activeTab(s)]:[null,null];};
// One dialog in plain words instead of a row of cycling toggles; the things you flip often stay one command away.
const MX_WORK_TXT={off:"Nothing \u2014 as usual",behind:"Matrix rain behind the text",blur:"Blur it (hover to peek)",rain:"Cover it with Matrix rain",solid:"Cover it with a plain panel"};
const MX_SHIELD_TXT={solid:"A plain panel",blur:"A strong blur",rain:"Matrix rain"};
const mxWorkNow=()=>mx.veil==="agents"?mx.veilStyle:"off";
function mxSummary(){
  return "While working: "+{off:"nothing",behind:"rain behind text",blur:"blur",rain:"rain cover",solid:"panel"}[mxWorkNow()]
    +" \u00b7 Background: "+(mx.bg?"rain":"plain")+" \u00b7 Shield: "+MX_SHIELD_TXT[mx.shieldStyle].toLowerCase()+(mx.away?" \u00b7 away "+mx.away+" min":"");
}
async function openPrivacySettings(){
  const opts=(o)=>Object.entries(o).map(([value,label])=>({value,label}));
  const v=await inputModal("Privacy & effects",[
    {type:"note",label:"Rain behind the text keeps the terminal readable and usable. A cover hides it until you press a key or click. Turn the privacy shield on or off any time with "+kbd("⌘","⌥","X")+"."},
    {key:"work",label:"While an agent is working, its window shows",type:"select",options:opts(MX_WORK_TXT),value:mxWorkNow()},
    {key:"bg",label:"Behind the windows",type:"select",options:opts({off:"A plain background",on:"Matrix rain \u2014 faster while agents work"}),value:mx.bg?"on":"off"},
    {key:"shieldStyle",label:"The privacy shield looks like",type:"select",options:opts(MX_SHIELD_TXT),value:mx.shieldStyle},
    {key:"titles",label:"The privacy shield hides",type:"select",options:opts({off:"Terminal and file contents",on:"Contents, names, folders and commands"}),value:mx.titles?"on":"off"},
    {key:"away",label:"Turn the privacy shield on when I walk away",type:"select",options:MX_AWAY.map((n)=>({value:String(n),label:n?"After "+n+" minutes idle":"Never"})),value:String(mx.away)},
  ],"Save");
  if(!v) return;
  mx.veil=v.work==="off"?"off":"agents"; if(MX_WORK.includes(v.work)) mx.veilStyle=v.work;
  if(MX_SHIELD.includes(v.shieldStyle)) mx.shieldStyle=v.shieldStyle;
  mx.titles=v.titles==="on"; mx.away=MX_AWAY.includes(+v.away)?+v.away:0;
  mx.bg=v.bg==="on";
  mxSave(); mxShieldSync(); mxVeilRestyle(); matrixSync(getAgentQueue()); mxBgSync(); mxTimerEnsure(); ambientEmit();
  mxNoticeToast("Privacy & effects saved",mxSummary());
}
PAL_CATS.splice(PAL_CATS.indexOf("Help"),0,"Privacy");
[
  {icon:ICON.shield,label:"Privacy shield",kbd:"\u2318\u2325X",keys:"screen share sharing stream streaming presentation demo hide secrets cover",get sub(){return (mx.shield?"On":"Off")+" \u2014 hide terminals and file views while you share your screen or stream";},run:toggleShield},
  {icon:ICON.shield,label:"Shield this tab",get sub(){const [sc,t]=mxFocused(); if(!t) return "Hide or show only the focused tab (also: the shield icon in its header)";
    const wide=!t.shield&&wideShielded(sc);
    return tabShielded(sc,t)?(wide?"On \u2014 hidden by the "+(mx.shield?"privacy":"project")+" shield; run to show just this tab":"On \u2014 this tab stays hidden")
      :(wide?"Off \u2014 shown while the shield covers the rest; run to hide it again":"Off \u2014 keep only the focused tab hidden (also: the shield icon in its header)");},run:()=>{const [s,t]=mxFocused(); s?toggleTabShield(s,t):toast(ICON.warn,"No focused terminal","Click a terminal first",2500);}},
  {icon:ICON.shield,label:"Shield this project",get sub(){return (projects.get(activeProject)?.shield?"On":"Off")+" \u2014 every terminal in this project opens hidden";},run:()=>toggleProjectShield(activeProject)},
  {icon:ICON.rain,label:"Matrix rain background",keys:"animation wallpaper effect",get sub(){return (mx.bg?"On":"Off")+" \u2014 falling characters behind the windows, faster while agents work";},run:()=>setBg(!mx.bg)},
  {icon:ICON.eyeOff,label:"Cover this tab now",keys:"hide veil focus",sub:"Cover the focused tab until you press a key or click \u2014 e.g. during a long build",run:()=>{const [s,t]=mxFocused(); mxVeilNow(s,t);}},
  {icon:ICON.rain,label:"Privacy & effects\u2026",keys:"settings matrix rain blur cover veil focus working agent animation walk away idle",get sub(){return mxSummary();},run:openPrivacySettings},
].forEach((c)=>{c.cat="Privacy"; PAL_CMDS.push(c);});

// Effects at the top of the theme menu: it's where people go to change how things look. App-wide in the top bar's
// menu; in a window's own menu, one switch for that window (overrides the default either way, "Use default" clears it).
function mxSwitch(label,on,run){
  const b=el("button","tfx"); b.type="button"; b.setAttribute("role","switch"); b.setAttribute("aria-checked",String(on));
  const t=el("span","tfx-label"); t.textContent=label; b.append(t,el("span","tfx-knob"));
  b.addEventListener("click",run); return b;
}
function mxRenderThemeFx(sc){
  const box=document.getElementById("theme-fx"); if(!box) return;
  box.replaceChildren();
  const rerender=()=>mxRenderThemeFx(sc);
  if(sc){
    const on=sc.fx===true||(sc.fx!==false&&mx.veil==="agents");
    box.append(mxSwitch("Matrix rain behind the text while an agent works",on,()=>{
      sc.fx=!on; scheduleSave(); sc.tabs.forEach((t)=>{if(t.mx?.on) mxVeilRestyleOne(sc,t); mxVeilEval(sc,t);}); rerender();
    }));
    const note=el("div","tfx-note");
    note.append(sc.fx===null||sc.fx===undefined?"This window follows the default. ":"This window only. ");
    if(typeof sc.fx==="boolean"){const a=el("button","tfx-link"); a.type="button"; a.textContent="Use default"; a.addEventListener("click",()=>{sc.fx=null; scheduleSave(); sc.tabs.forEach((t)=>{if(t.mx?.on) mxVeilRestyleOne(sc,t); mxVeilEval(sc,t);}); rerender();}); note.append(a);}
    box.append(note);
  }else{
    box.append(
      mxSwitch("Matrix rain behind the windows",mx.bg,()=>{setBg(!mx.bg); rerender();}),
      mxSwitch("Matrix rain behind the text while an agent works",mx.veil==="agents"&&mx.veilStyle==="behind",()=>{
        const on=mx.veil==="agents"&&mx.veilStyle==="behind";
        mx.veil=on?"off":"agents"; if(!on) mx.veilStyle="behind"; mxSave(); mxVeilRestyle(); matrixSync(getAgentQueue()); rerender();
      }));
  }
  const more=el("button","tfx-link tfx-more"); more.type="button"; more.textContent="More privacy & effects\u2026";
  more.addEventListener("click",()=>{themePop.classList.remove("open"); openPrivacySettings();});
  box.append(more);
}

function mxPaneMenu(s,t){
  const it=[{sep:true},
    {label:tabShielded(s,t)?"Unshield this tab":"Shield this tab",run:()=>toggleTabShield(s,t)},
    {label:"Cover this tab now",disabled:tabShielded(s,t),run:()=>mxVeilNow(s,t)}];
  if(mxFxOn(s,t)||t.noVeil) it.push({label:t.noVeil?"Turn on the working effect for this tab":"Turn off the working effect for this tab",run:()=>toggleNoVeil(s,t)});
  return it;
}
function mxDesktopMenu(){
  return [{sep:true},
    {label:mx.shield?"Turn off privacy shield":"Privacy shield",key:kbd("⌘","⌥","X"),run:toggleShield},
    {label:mx.bg?"Turn off Matrix rain background":"Matrix rain background",run:()=>setBg(!mx.bg)},
    {label:"Privacy & effects\u2026",run:openPrivacySettings}];
}
// Picking the Matrix theme offers the rain once; it is never switched on by itself.
function mxThemePicked(id){
  mxTheme();
  if(id!=="matrix"||mx.bg||mx.asked) return;
  mx.asked=true; mxSave();
  toast(ICON.rain,"Turn on Matrix rain?","Falling characters behind your windows — click to turn it on",10000,()=>setBg(true)).classList.add("t-safe");
}
// Another browser tab changed the settings (e.g. turned the shield on): follow it.
window.addEventListener("storage",(e)=>{if(e.key!==MX_STORE) return; mx=mxLoad(); mxShieldSync(); mxVeilRestyle(); matrixSync(getAgentQueue()); mxTimerEnsure();});

mxTheme();
mxTimerEnsure();
