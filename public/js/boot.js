// TermDeck frontend: startup, path autocomplete for the Dir popover, the small-screen menu.
// One of the classic scripts in public/js/, loaded in order by index.html and sharing one global scope.
"use strict";

/* ════════════════════════════════════════════════
   BOOT
   ════════════════════════════════════════════════ */
document.getElementById("new").addEventListener("click",()=>createSession({cwd:curCwd()}));
tileBtn.addEventListener("click",tileAll);
document.getElementById("pal-btn").addEventListener("click",openPalette);
searchBtn.addEventListener("click",()=>sessSearchOpen?closeSessSearch():openSessSearch());
agentBtn.addEventListener("click",(e)=>{
  e.stopPropagation();
  if(agentPop.classList.contains("open")){
    agentPop.classList.remove("open");
  } else {
    openAgentPop();
  }
});
document.getElementById("sc-btn").addEventListener("click",()=>scOverlay.classList.toggle("open"));
// Right-click on the empty desktop: a launcher for the frequent actions (the palette has the rest). Rows are
// context-aware — shown only when they can work — so the menu stays short. Windows keep their own menus.
desktop.addEventListener("contextmenu",(e)=>{
  if(e.defaultPrevented||e.target.closest(".win,#glue-btn,a,button"))return;
  e.preventDefault();
  const p=projects.get(activeProject);
  const mini=minimizedIds();
  const it=[
    {label:"New terminal",key:kbd("⌘","⌥","T"),run:()=>createSession({cwd:curCwd()})},
    {label:"New agent task…",key:kbd("⌘","⌥","R"),run:newAgentTask},
    {sep:true},
    {label:"Open file…",key:kbd("⌘","⌥","O"),run:openFilePrompt},
    {label:"Open directory…",key:kbd("⌘","⇧","O"),run:()=>document.getElementById("folder").click()},
  ];
  const lay=[];
  if(tileable()) lay.push({label:"Tile windows",key:kbd("⌘","⌥","⇧","T"),run:tileAll});
  if(mini.length) lay.push({label:"Restore minimized ("+mini.length+")",run:()=>mini.forEach((id)=>restore(sessions.get(id)))});
  if(castableCount()>=2) lay.push({label:broadcastOn?"Stop broadcasting input":"Broadcast input to all",key:kbd("⌘","⌥","B"),run:()=>setBroadcast(!broadcastOn)});
  if(LIVE&&p?.base) lay.push({label:"Review agent changes…",key:kbd("⌘","⌥","D"),run:openAgentDiff},{label:"Finish agent task…",run:finishAgentTask});
  if(lay.length) it.push({sep:true},...lay);
  it.push({sep:true},
    {label:"Toggle directory tree",key:kbd("⌘","B"),run:toggleSidebar},
    {label:"Change theme…",key:kbd("⌘","⇧","P"),run:()=>openThemePop(null,themeBtn)},
    {label:document.fullscreenElement?"Exit fullscreen":"Fullscreen",run:toggleFullscreen},
    {sep:true},
    {label:"Command palette…",key:kbd("⌘","K"),run:openPalette});
  showCtxMenu(e.clientX,e.clientY,it);
});
paddBtn.addEventListener("click",()=>addProject());
paddBtn.addEventListener("keydown",(e)=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();addProject();}});

// Fullscreen row uses different KEYS per OS (⌃⌘F vs F11), not just glyphs.
document.getElementById("sc-fs").innerHTML=(MAC?["⌃","⌘","F"]:["F11"]).map(k=>"<kbd>"+k+"</kbd>").join("");

// Rewrite mac-glyph shortcut labels in the static HTML for non-mac platforms.
if(!MAC){
  const map={"⌘":"Ctrl","⌃":"Ctrl","⇧":"Shift","⌥":"Alt"};
  const rep=t=>t.replace(/[⌘⌃⇧⌥](?=\S)/g,m=>map[m]+" ").replace(/[⌘⌃⇧⌥]/g,m=>map[m]);
  document.querySelectorAll("#pal-btn,.ph-icon,.sc-keys kbd,.hint b,.kbd-inline").forEach(el=>{
    if(/[⌘⌃⇧⌥]/.test(el.textContent)) el.textContent=rep(el.textContent);
  });
  document.querySelectorAll("[title]").forEach(el=>{        // tooltips too
    if(/[⌘⌃⇧⌥]/.test(el.title)) el.title=rep(el.title);
  });
}

const folderBtn=document.getElementById("folder");
folderBtn.addEventListener("click",(e)=>{
  e.stopPropagation(); cwdPop.classList.toggle("open");
  if(cwdPop.classList.contains("open")){
    closeModals("cwd");
    const r=folderBtn.getBoundingClientRect();
    cwdPop.style.top=(r.bottom+6)+"px"; cwdPop.style.left=Math.max(12,r.right-320)+"px";
    cwdInput.value=curCwd(); syncCwdClear(); cwdInput.focus(); cwdInput.select(); // select-on-open: keeps memory, one keystroke overwrites
    acUpdate(); loadShells();
  } else acClose();
});
const cwdClear=document.getElementById("cwd-clear");
function syncCwdClear(){cwdInput.parentElement.classList.toggle("has-val",!!cwdInput.value);}
cwdInput.addEventListener("input",syncCwdClear);
cwdClear.addEventListener("click",()=>{cwdInput.value="";syncCwdClear();acUpdate();cwdInput.focus();});

// ── path autocomplete + live validity for the Dir popover (uses /api/ls) ──
const cwdAc=document.getElementById("cwd-ac");
let acItems=[], acSel=-1, acTimer=null, acSeq=0;
function acClose(){cwdAc.classList.remove("open");cwdAc.innerHTML="";acItems=[];acSel=-1;}
function acSplit(v){ // typed value → { parent dir to list, trailing fragment to match }
  if(!v||v==="~") return {parent:v||"~",frag:""};
  if(v.endsWith("/")) return {parent:v,frag:""};
  const i=v.lastIndexOf("/");
  if(i<0) return {parent:"~",frag:v};              // bare word → complete under home
  return {parent:v.slice(0,i)||"/",frag:v.slice(i+1)};
}
async function acUpdate(){
  if(!LIVE) return;
  const v=cwdInput.value.trim(), wrap=cwdInput.parentElement;
  if(!v){wrap.classList.remove("ok","bad");acClose();return;}
  const {parent,frag}=acSplit(v), seq=++acSeq;
  let d; try{ d=await apiLs(parent); }catch{ if(seq===acSeq){wrap.classList.remove("ok");wrap.classList.add("bad");acClose();} return; }
  if(seq!==acSeq) return;                            // a newer keystroke already fired
  const dirs=d.entries.filter((e)=>e.dir), fl=frag.toLowerCase();
  wrap.classList.remove("bad");
  wrap.classList.toggle("ok", frag===""||dirs.some((e)=>e.name===frag)); // typed path is itself a real dir
  cwdAc.innerHTML="";acItems=[];acSel=-1;
  dirs.filter((e)=>e.name.toLowerCase().startsWith(fl)).slice(0,10).forEach((e)=>{
    const full=joinPath(d.dir,e.name), it=el("div","ac-item"); it.dataset.full=full;
    it.append(Object.assign(el("span","ac-ic"),{textContent:"📁"}),Object.assign(el("span","ac-nm"),{textContent:e.name}));
    it.addEventListener("mousedown",(ev)=>{ev.preventDefault();acPick(full);});
    cwdAc.append(it);acItems.push(it);
  });
  cwdAc.classList.toggle("open",acItems.length>0);
}
function acPick(full){cwdInput.value=full+"/";syncCwdClear();cwdInput.focus();acUpdate();}
function acMove(d){if(!acItems.length)return;acSel=(acSel+d+acItems.length)%acItems.length;acItems.forEach((it,i)=>it.classList.toggle("sel",i===acSel));acItems[acSel].scrollIntoView({block:"nearest"});}
cwdInput.addEventListener("input",()=>{clearTimeout(acTimer);acTimer=setTimeout(acUpdate,160);});
const cwdCmd=document.getElementById("cwd-cmd");
// Shell picker: options come from the server allowlist (/api/shells); hidden when there's no backend or only one shell.
const cwdShell=document.getElementById("cwd-shell");
let shellsLoaded=false;
async function loadShells(){
  if(!LIVE||shellsLoaded) return;
  try{
    const shells=await getShells(); if(!shells.length) return;
    shellsLoaded=true;
    cwdShell.replaceChildren(new Option("Default ("+shells[0].name+")",""),...shells.map((x)=>new Option(x.name+"  "+x.path,x.path)));
    document.getElementById("cwd-shell-wrap").style.display=shells.length>1?"":"none";
  }catch{}
}
// validate a typed path before spawning — else the server silently drops a bad cwd to $HOME (server.js safeDir)
async function badDir(p){ if(!LIVE||!p) return false; try{ return !(await fetch("/api/ls?dir="+encodeURIComponent(p))).ok; }catch{ return false; } }
function popErr(p){ toast(ICON.warn,"No such folder",p); cwdPop.classList.add("open"); cwdInput.focus(); cwdInput.select(); }
async function spawnFromPopover(){const p=cwdInput.value.trim();const c=cwdCmd.value.trim();
  if(await badDir(p)){popErr(p);return;}
  setCwd(p);cwdPop.classList.remove("open");acClose();
  const proj=projects.get(activeProject);
  const firstTerm=proj && ![...sessions.values()].some((x)=>x.project===activeProject);
  if(p&&firstTerm&&/^project \d+$/.test(proj.name||"")){ // first shell into a fresh project → name it after the folder, like "New project"
    proj.name=p.replace(/[\\/]+$/,"").split(/[\\/]/).pop()||proj.name; proj.nameEl.textContent=proj.name;
  }
  createSession({cwd:p,cmd:c||undefined,shell:cwdShell.value||undefined});cwdCmd.value="";scheduleSave();}
async function spawnAsProject(){
  const p=cwdInput.value.trim();const c=cwdCmd.value.trim();
  if(!p){toast(ICON.warn,"Need a path","“New project” needs a directory"); return;}
  if(await badDir(p)){popErr(p);return;}
  cwdPop.classList.remove("open");acClose();
  const base=p.replace(/[\\/]+$/,"").split(/[\\/]/).pop()||p;
  const proj=addProject(base); if(!proj) return;   // addProject switches to it; null if at limit
  setCwd(p);   // remember path on the NEW project (now active), not the one we came from
  createSession({cwd:p,project:proj.id,cmd:c||undefined,shell:cwdShell.value||undefined}); cwdCmd.value="";  // tree follows focused cwd, no extra work
  scheduleSave();
}
document.getElementById("cwd-go").addEventListener("click",spawnFromPopover);
document.getElementById("cwd-proj").addEventListener("click",spawnAsProject);
cwdInput.addEventListener("keydown",(e)=>{
  const open=cwdAc.classList.contains("open");
  if(open&&e.key==="ArrowDown"){e.preventDefault();acMove(1);return;}
  if(open&&e.key==="ArrowUp"){e.preventDefault();acMove(-1);return;}
  if(open&&e.key==="Tab"){e.preventDefault();acPick((acItems[acSel<0?0:acSel]).dataset.full);return;}
  if(e.key==="Enter"){if(open&&acSel>=0){e.preventDefault();acPick(acItems[acSel].dataset.full);return;} spawnFromPopover();return;}
  if(e.key==="Escape"){if(open){acClose();return;} cwdPop.classList.remove("open");}
});
cwdCmd.addEventListener("keydown",(e)=>{if(e.key==="Enter")spawnFromPopover();if(e.key==="Escape")cwdPop.classList.remove("open");});

// ── small-screen overflow menu ──
const menuBtn=document.getElementById("menu-btn");
const barActions=document.getElementById("bar-actions");
menuBtn.addEventListener("click",(e)=>{e.stopPropagation();barActions.classList.toggle("open");});
// direct-action buttons bubble here → close the menu; popover buttons (Dir/Theme) stopPropagation, so the menu stays open for positioning
barActions.addEventListener("click",(e)=>{if(e.target.closest("button")) barActions.classList.remove("open");});

tileBtn.title="Tile windows ("+kbd("⌘","⌥","⇧","T")+")";
folderBtn.title="Open directory ("+kbd("⌘","⇧","O")+")";
themeBtn.title="Theme ("+kbd("⌘","⇧","P")+")";
paddBtn.title="New project ("+kbd("⌘","⇧","M")+")";
document.getElementById("sb-btn").title="Toggle sidebar ("+kbd("⌘","B")+")";
searchBtn.title="Search terminals ("+kbd("⌘","F")+")";
document.getElementById("pal-btn").title="Command palette ("+kbd("⌘","K")+")";
document.getElementById("new").title="New terminal ("+kbd("⌘","⌥","T")+")";
document.getElementById("hint-newkbd").textContent=kbd("⌘","⌥","T");
document.getElementById("sc-btn").title="Help & keyboard shortcuts (?)";
// Show app version in help modal (from backend package.json). Silent in demo/no-backend.
const wnBody=document.getElementById("wn-body"), wnBox=document.getElementById("sc-whatsnew"), updRes=document.getElementById("upd-res");
let wnLoaded=false;
function loadWhatsNew(){   // bundled CHANGELOG.md, served locally — works offline; rendered by the escaping markdown renderer
  if(wnLoaded) return; wnLoaded=true;
  fetch("/api/changelog").then(r=>r.ok?r.text():Promise.reject()).then(t=>{wnBody.innerHTML=mdToHtml(t);}).catch(()=>{wnBody.textContent="Changelog unavailable."; wnLoaded=false;});
}
wnBox.addEventListener("toggle",()=>{if(wnBox.open) loadWhatsNew();});
function openWhatsNew(){openShortcuts(); wnBox.open=true; loadWhatsNew(); wnBox.scrollIntoView({block:"nearest"});}
document.getElementById("upd-btn").addEventListener("click",async()=>{
  updRes.textContent="Checking\u2026";
  try{
    const r=await fetch("/api/update-check"); if(!r.ok) throw 0; const d=await r.json();
    updRes.textContent=d.updateAvailable?"v"+d.latest+" is available \u2014 run: npx @kiril6/termdeck@latest":"You\u2019re up to date (v"+d.current+").";
  }catch{updRes.textContent="Couldn\u2019t reach npm (offline?).";}
});
// Version (Help + footer), changelog and the once-per-version "updated" toast. Silent in demo/no-backend.
if(LIVE) fetch("/api/version").then(r=>r.ok?r.json():null).then(d=>{
  if(!d||!d.version) return;
  document.getElementById("app-ver").textContent="v"+d.version+" \u00b7 ";
  document.getElementById("copyr-ver").textContent=" \u00b7 v"+d.version;
  document.getElementById("sc-upd").hidden=false; wnBox.hidden=false;
  let seen=null; try{seen=localStorage.getItem("td.seenVersion.v1");}catch{}
  try{localStorage.setItem("td.seenVersion.v1",d.version);}catch{}
  if(seen&&seen!==d.version) toast(ICON.check,"Updated to v"+d.version,"Click to see what\u2019s new",9000,openWhatsNew);   // first visit (no stored version) stays quiet — the tour covers it
}).catch(()=>{});
themeBtn.addEventListener("click",(e)=>{e.stopPropagation();openThemePop(null,themeBtn);});
function themeFilter(){const q=themeSearch.value.trim();themeClear.style.display=q?"":"none";renderThemeGrid(q);}
themeSearch.addEventListener("input",themeFilter);
themeSearch.addEventListener("keydown",(e)=>{
  if(e.key==="Escape"){e.stopPropagation();themePop.classList.remove("open");return;}
  e.stopPropagation();
});
themeClear.addEventListener("click",()=>{themeSearch.value="";themeFilter();themeSearch.focus();});
themeReset.addEventListener("click",()=>{if(themeTargetSession)setSessionTheme(themeTargetSession,null);});

document.addEventListener("mousedown",(e)=>{
  if(barActions.classList.contains("open")&&!barActions.contains(e.target)&&e.target!==menuBtn) barActions.classList.remove("open");
  if(cwdPop.classList.contains("open")&&!cwdPop.contains(e.target)&&e.target!==folderBtn) cwdPop.classList.remove("open");
  if(movePop.classList.contains("open")&&!movePop.contains(e.target)&&!(moveTargetSession&&e.target===moveTargetSession.cmove)) movePop.classList.remove("open");
  if(themePop.classList.contains("open")&&!themePop.contains(e.target)&&e.target!==themeBtn&&!e.target.closest('[title="Terminal theme\u2026"]')) themePop.classList.remove("open");
  if(agentPop&&agentPop.classList.contains("open")&&!agentPop.contains(e.target)&&e.target!==agentBtn&&!agentBtn.contains(e.target)) agentPop.classList.remove("open");
});

window.addEventListener("resize",()=>{sessions.forEach((s)=>refitActive(s));updateDockEdges();updateProjEdges();});
window.addEventListener("beforeunload",(e)=>{
  saveState();
  // Warn before losing running shells. This is the ONLY exit that can't use an in-app modal —
  // the browser tears the page down and forbids custom UI, so we trigger its native prompt.
  if(!selfReload && instanceActive && [...sessions.values()].some((s)=>liveTabs(s))){
    e.preventDefault(); e.returnValue="";
  }
});

/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
   SINGLE-INSTANCE GUARD
   Two dashboard tabs on the same origin share localStorage (clobber each other's
   layout) and bind the same PTY ids (steal each other's live shells). A timestamped
   localStorage lock elects one active tab; extra tabs go passive behind an overlay.
   \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */
const LOCK_STORE="td.lock.v1", LOCK_TTL=5000;
// Stable per-tab id: sessionStorage survives reload (so a takeover's claim still matches after we reload) but is per-tab.
const myTab=(()=>{try{let v=sessionStorage.getItem("td.tabid");if(!v){v=newId("tab");sessionStorage.setItem("td.tabid",v);}return v;}catch{return newId("tab");}})();
function readLock(){try{const l=JSON.parse(localStorage.getItem(LOCK_STORE)||"null");return l&&(Date.now()-l.t)<LOCK_TTL?l:null;}catch{return null;}}
function claimLock(){try{localStorage.setItem(LOCK_STORE,JSON.stringify({id:myTab,t:Date.now()}));}catch{}}
function showDupOverlay(){
  const o=el("div"); o.style.cssText="position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(10,12,16,.86);backdrop-filter:blur(4px);text-align:center;padding:24px";
  const card=el("div"); card.style.cssText="max-width:420px;background:#161a22;border:1px solid #2a3040;border-radius:14px;padding:28px 26px;color:#dfe6f0;font:14px/1.55 system-ui,sans-serif";
  card.innerHTML='<div style="font-size:32px;margin-bottom:10px">\ud83d\udda5\ufe0f</div><div style="font-size:17px;font-weight:600;margin-bottom:8px">Already open in another tab</div><div style="opacity:.75;margin-bottom:20px">Running two dashboards fights over your saved layout and live shells. Use one tab.</div>';
  const btn=el("button"); btn.textContent="Use this tab instead";
  btn.style.cssText="background:#4fd6be;color:#08120f;border:0;border-radius:9px;padding:10px 18px;font-weight:600;cursor:pointer";
  btn.addEventListener("click",()=>{claimLock();selfReload=true;location.reload();});   // steal lock, restart clean as the active tab
  card.append(btn); o.append(card); asDialog(o,"Already open in another tab"); document.body.append(o);
}
const held=readLock();
if(held && held.id!==myTab){
  instanceActive=false;
  showDupOverlay();
}else{
  claimLock();
  // heartbeat; reload only if another tab took over. An expired lock (this tab stalled past LOCK_TTL: a busy main thread, a throttled background tab) is just reclaimed.
  setInterval(()=>{const l=readLock(); if(l&&l.id!==myTab){selfReload=true;location.reload();} else claimLock();},2000);
  updateConn();
  if(!restoreState()){addProject("default",null,true);switchProject(projectOrder[0]);createSession();}
  else{toast('<span class="led live"></span>',"Restored","Layout loaded from last session",3500);}
  updateDockEdges(); updateProjEdges(); updateAgentOverview(); updateUsageViews();
  // #84: a notification link (#t=<terminal id>) jumps to that terminal; unknown id = no-op.
  const jumpToHash=()=>{const m=/^#t=(.+)$/.exec(location.hash);if(!m)return;const id=decodeURIComponent(m[1]);  // server id = <window id>-<tab id>
    for(const s of sessions.values()){const tab=s.tabs.find((t)=>s.id+"-"+t.id===id);if(tab){revealWindow(s);switchTab(s,tab.id);return;}}};
  jumpToHash(); addEventListener("hashchange",jumpToHash);
}
