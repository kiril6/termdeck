// TermDeck frontend: projects, windows and tabs, find-in-terminal, the WebGL budget.
// One of the classic scripts in public/js/, loaded in order by index.html and sharing one global scope.
"use strict";

/* ════════════════════════════════════════════════
   PROJECTS
   ════════════════════════════════════════════════ */
function addProject(name,id,silent){
  if(!silent && projectOrder.length>=MAX_PROJECTS){toast(ICON.warn,"Limit reached","Max "+MAX_PROJECTS+" projects"); return null;}
  const pid=id||newId("p");
  // auto-name from highest existing "project N", not count — avoids dup names after deletes
  const maxN=projectOrder.reduce((m,pid)=>{const mt=/^project (\d+)$/.exec(projects.get(pid)?.name||"");return mt?Math.max(m,+mt[1]):m;},0);
  const p={id:pid,name:name||("project "+(maxN+1))};
  projects.set(pid,p); projectOrder.push(pid);
  renderProjectTab(p); syncMoveBtns();
  if(!silent){switchProject(pid); scheduleSave();}
  return p;
}
function renderProjectTab(p){
  const tab=el("div","ptab"); tab.dataset.id=p.id;
  const dot=el("span","pdot");
  const nm=el("span","pname"); nm.textContent=p.name; nm.setAttribute("spellcheck","false"); nm.title="Double-click to rename";
  const cnt=el("span","pn"); cnt.textContent="0";
  const del=el("button","pdel"); del.innerHTML=ICON.x; del.title="Delete project";
  tab.append(dot,nm,cnt,del);
  projTrack.append(tab); updateProjEdges();
  tab.addEventListener("click",(e)=>{if(e.target===del||nm.isContentEditable)return; switchProject(p.id);});
  nm.addEventListener("dblclick",(e)=>{e.stopPropagation(); nm.contentEditable="true"; nm.focus(); document.getSelection().selectAllChildren(nm);});
  const commit=()=>{nm.contentEditable="false"; p.name=nm.textContent.trim()||p.name; nm.textContent=p.name; updateAgentOverview(); scheduleSave();};
  nm.addEventListener("blur",commit);
  nm.addEventListener("keydown",(e)=>{if(e.key==="Enter"){e.preventDefault();nm.blur();} if(e.key==="Escape"){nm.textContent=p.name;nm.blur();} e.stopPropagation();});
  del.addEventListener("click",(e)=>{e.stopPropagation(); deleteProject(p.id);});
  p.tab=tab; p.nameEl=nm; p.countEl=cnt; p.dot=dot; p.delEl=del;
  updateProjectAttention(p.id);
}
async function deleteProject(pid){
  if(projectOrder.length<=1)return;
  const inP=[...sessions.values()].filter((s)=>s.project===pid);
  if(inP.length&&!(await confirmModal(inP.length+" session"+(inP.length>1?"s":"")+" will be closed. Delete this project?","Delete",true)))return;
  inP.forEach((s)=>closeSession(s,true));
  const p=projects.get(pid); if(p?.tab) p.tab.remove();
  projects.delete(pid); projectOrder=projectOrder.filter((x)=>x!==pid); updateProjEdges(); syncMoveBtns();
  if(activeProject===pid) switchProject(projectOrder[0]);
  scheduleSave();
}
// One clock for every window's uptime footer: one style/layout pass a second instead of one per window, and none for
// windows nobody can see (minimized, another project) or while the browser tab is hidden. Catches up when they show.
function tickUptimes(){
  if(document.hidden) return;
  const now=Date.now();
  sessions.forEach((s)=>{
    if(s.minimized||s.project!==activeProject||s.status==="pending") return;
    const sec=Math.floor((now-s.startedAt)/1000), h=Math.floor(sec/3600), m=Math.floor((sec%3600)/60);
    const txt=h?h+"h "+pad(m)+"m":pad(m)+":"+pad(sec%60);
    if(s.uptimeEl.textContent!==txt) s.uptimeEl.textContent=txt;
  });
}
setInterval(tickUptimes,1000);
document.addEventListener("visibilitychange",tickUptimes);
function switchProject(pid){
  if(!projects.has(pid)) pid=projectOrder[0];
  if(broadcastOn) setBroadcast(false); // disarm Cast on context switch — never carry a destructive mode across projects
  treeRoot=null; // drop breadcrumb override so tree re-roots to the new project
  activeProject=pid;
  projects.forEach((p)=>p.tab.classList.toggle("active",p.id===pid));
  const ap=projects.get(pid); if(ap?.tab) ap.tab.scrollIntoView({inline:"nearest",block:"nearest"});
  updateProjEdges();
  let any=false;
  sessions.forEach((s)=>{
    const b=s.project===pid;
    s.win.style.display=b&&!s.minimized?"":"none";
    s.chip.style.display=b?"":"none";
    if(b&&!s.minimized) any=true;
  });
  hint.style.display=any?"none":"";
  syncWebgl(); syncTileBtn(); syncCastBtn(); updateDockEdges(); updateProjEdges();
  updateProjCounts(); scheduleSave();
  if(sidebarOpen) refreshTree();
}
function updateProjCounts(){
  const c=new Map();
  sessions.forEach((s)=>c.set(s.project,(c.get(s.project)||0)+1));
  projects.forEach((p)=>{p.countEl.textContent=String(c.get(p.id)||0);});
}
function updateProjectAttention(pid){
  if(!pid){projects.forEach((_,id)=>updateProjectAttention(id)); return;}
  const p=projects.get(pid); if(!p?.tab)return;
  let hasWait=false, hasAppr=false;
  for(const sess of sessions.values()){
    if(sess.project!==pid)continue;
    for(const t of sess.tabs){
      if(t.approval){hasAppr=true; break;}
      if(t.waiting) hasWait=true;
    }
    if(hasAppr) break;
  }
  p.tab.classList.toggle("approval",hasAppr);
  p.tab.classList.toggle("waiting",!hasAppr&&hasWait);
  const ov=overlapByProject.get(pid);
  p.tab.classList.toggle("conflict",!!ov);
  p.tab.title=ov?"\u26a0 "+overlapText(ov):"";
}
function moveSessionToProject(s,pid){
  if(!projects.has(pid)||s.project===pid)return;
  if([...sessions.values()].filter((x)=>x.project===pid).length>=MAX_TERMS){toast(ICON.warn,"Limit reached","Max "+MAX_TERMS+" terminals per project"); return;}
  const oldPid=s.project;
  s.project=pid;
  const b=pid===activeProject;
  s.win.style.display=b&&!s.minimized?"":"none";
  s.chip.style.display=b?"":"none";
  syncWebgl();
  if(b){hint.style.display="none"; focusWindow(s);}
  else if(focusedId===s.id) focusedId=null;
  updateProjCounts(); updateProjectAttention(oldPid); updateProjectAttention(pid); updateAgentOverview(); scheduleSave();
  toast(ICON.moveTo,"Moved","\""+s.name+"\" → "+projects.get(pid).name,4000,
    ()=>{if(s.project!==activeProject)switchProject(s.project);revealWindow(s);});
}

/* ════════════════════════════════════════════════
   SESSION + TABS
   ════════════════════════════════════════════════ */
function createSession(desc, isLog){
  desc=desc||{};
  if(typeof desc.isLog==="boolean") isLog=desc.isLog;
  const id=desc.id||newId("s");
  const project=desc.project&&projects.has(desc.project)?desc.project:activeProject;
  if(!desc.width && [...sessions.values()].filter((x)=>x.project===project).length>=MAX_TERMS){toast(ICON.warn,"Limit reached","Max "+MAX_TERMS+" terminals per project"); return null;}
  const name=desc.name||((isLog?"log":"session")+" "+(++nameSeq));

  const win=el("div","win"); win.style.zIndex=++zTop;

  // head
  const head=el("div","win-head");
  const grip=el("span","win-grip"); grip.title="Drag to move";
  grip.innerHTML='<svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor" aria-hidden="true"><circle cx="2" cy="2" r="1.2"/><circle cx="6" cy="2" r="1.2"/><circle cx="2" cy="7" r="1.2"/><circle cx="6" cy="7" r="1.2"/><circle cx="2" cy="12" r="1.2"/><circle cx="6" cy="12" r="1.2"/></svg>';
  const led=el("span","win-led pending");
  const winTabs=el("div","win-tabs");
  const wtabsTrack=el("div","wtabs-track");
  const wtEdgeL=el("span","wtabs-edge left"); wtEdgeL.textContent="‹";
  const wtEdgeR=el("span","wtabs-edge right"); wtEdgeR.textContent="›";
  winTabs.append(wtabsTrack,wtEdgeL,wtEdgeR);
  wtabsTrack.addEventListener("scroll",()=>updTabEdges(wtabsTrack));
  wtabsTrack.addEventListener("wheel",(e)=>{if(e.deltaY){wtabsTrack.scrollLeft+=e.deltaY;e.preventDefault();}},{passive:false});
  wtabsTrack.addEventListener("dblclick",(e)=>{if(e.target===wtabsTrack)addTab(s);});  // dbl-click empty strip → new tab
  wtEdgeL.addEventListener("click",()=>wtabsTrack.scrollBy({left:-120,behavior:"smooth"}));
  wtEdgeR.addEventListener("click",()=>wtabsTrack.scrollBy({left:120,behavior:"smooth"}));
  const wtabAdd=el("button","wtab-add"); wtabAdd.textContent="+"; wtabAdd.title="New tab ("+kbd("⌘","⌥","A")+")";
  const ctrls=el("div","win-ctrls");
  const bRestart=wbtn("Restart shell"); bRestart.classList.add("restart");
  const bTheme=wbtn("Terminal theme\u2026");
  const bMin=wbtn("Minimize");
  const bMax=wbtn("Expand");
  const bClose=wbtn("Close"); bClose.classList.add("close");
  bTheme.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/><circle cx="6.5" cy="12.5" r=".9" fill="currentColor" stroke="none"/><circle cx="8.5" cy="7.5" r=".9" fill="currentColor" stroke="none"/><circle cx="13.5" cy="6.5" r=".9" fill="currentColor" stroke="none"/><circle cx="17.5" cy="10.5" r=".9" fill="currentColor" stroke="none"/></svg>'; // Lucide palette, replaces the emoji
  // Remaining controls → inline Lucide icons (monochrome, currentColor), replacing the old glyphs.
  bRestart.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.74L21 8"/><path d="M21 3v5h-5"/></svg>';
  bMin.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>';
  bMax.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>';
  bClose.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
  ctrls.append(bRestart,bTheme,bMin,bMax,bClose);
  head.append(grip,winTabs,wtabAdd,ctrls);  // grip = drag affordance; per-tab dots + sidebar chip cover status

  // panes container + footer
  const panes=el("div","win-panes");
  const foot=el("div","win-foot");
  const badgeShell=el("span","badge shell"); badgeShell.textContent=isLog?"\u25b6 log":"\u2013";
  if(LIVE&&!isLog){badgeShell.classList.add("pick"); badgeShell.title="Change shell"; badgeShell.onclick=(e)=>{e.stopPropagation(); const sx=sessions.get(id); if(sx) openShellMenu(sx,badgeShell);};}
  const badgeCwd=el("span","badge cwd"); badgeCwd.textContent=desc.cwd||"~";
  const badgeCmd=el("span","badge cmd"), badgePort=el("span","foot-port");   // last command + detected dev-server port of the active tab (#22); the port is a globe icon in the action group
  badgePort.hidden=true; badgePort.innerHTML=ICON.globe;
  const portOf=()=>activeTab(sessions.get(id))?.port;
  const openPort=(port)=>window.open("http://localhost:"+port,"_blank","noopener");
  badgePort.onclick=(e)=>{e.stopPropagation(); const p=portOf(); if(p&&LOCAL_PAGE) openPort(p);};   // remote (tunnel/proxy): that port isn't reachable from here, so it's info only
  badgePort.oncontextmenu=(e)=>{
    e.preventDefault(); e.stopPropagation(); const port=portOf(); if(!port)return;
    const url="http://localhost:"+port;
    showCtxMenu(e.clientX,e.clientY,[
      {label:"Open "+url.slice(7),disabled:!LOCAL_PAGE,run:()=>openPort(port)},
      {label:"Copy URL",run:()=>navigator.clipboard?.writeText(url)},
      {sep:true},
      {label:"Stop server",run:()=>stopPort(id,port)},
    ]);
  };
  if(isLog){const bl=el("span","badge log"); bl.textContent="read-only"; foot.append(bl);}
  const uptimeEl=el("span","uptime"); uptimeEl.textContent="00:00";
  const footGame=el("span","foot-game"); footGame.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="11" x2="10" y2="11"/><line x1="8" y1="9" x2="8" y2="13"/><line x1="15" y1="12" x2="15.01" y2="12"/><line x1="18" y1="10" x2="18.01" y2="10"/><rect x="2" y="6" width="20" height="12" rx="2"/></svg>'; footGame.title="Play a game while this runs ("+kbd("⌘","⌥","G")+")";
  footGame.onclick=(e)=>{e.stopPropagation(); const sx=sessions.get(id); if(sx)revealWindow(sx); openGame();};
  // Saved-snippet quick-insert: monochrome icon → anchored menu → inserts the command into THIS terminal (no newline).
  const footSnip=el("span","foot-snip"); footSnip.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12v18l-6-4-6 4z"/></svg>'; footSnip.title="Insert a saved snippet";
  footSnip.onclick=(e)=>{e.stopPropagation(); const sx=sessions.get(id); if(sx){focusWindow(sx); openSnippetMenu(sx,footSnip);}};   // focus this tab so runSnippet targets it
  const footActions=el("span","foot-actions");   // right-aligned toolbar: passive status stays left, controls group right
  footActions.append(badgePort);   // globe sits left of the snippet icon
  if(!isLog) footActions.append(footSnip);   // read-only log terminals ignore input, so no insert affordance
  footActions.append(footGame);
  foot.append(badgeShell,badgeCwd,badgeCmd,footActions,uptimeEl);   // icons grouped, timer pinned to the trailing corner
  const grips=["n","s","e","w","nw","ne","sw","se"].map((d)=>{const g=el("div","wgrip wgrip-"+d);g.dataset.dir=d;return g;});
  win.append(head,panes,foot,...grips);
  desktop.append(win);

  // position
  if(desc.width){win.style.left=desc.left; win.style.top=desc.top; win.style.width=desc.width; win.style.height=desc.height;}
  else{const n=[...sessions.values()].filter((x)=>x.project===project).length; win.style.left=(40+(n%6)*46)+"px"; win.style.top=(28+(n%6)*40)+"px"; win.style.width="580px"; win.style.height="380px";}

  // dock chip
  const chip=el("div","chip");
  const cled=el("span","cled pending");
  const cname=el("span","cname"); cname.textContent=name;
  chip.title="Double-click to hide";
  const cmove=el("button","cmove"); cmove.innerHTML=ICON.moveTo; cmove.title="Move to project\u2026";
  chip.append(cled,cname,cmove);
  dockTrack.append(chip); updateDockEdges(); updateProjEdges();

  const startedAt=Date.now();   // uptime footer: tickUptimes()

  const s={
    id,project,name,isLog:!!isLog,cwd:desc.cwd||curCwd()||"",
    win,head,led,winTabs,wtabsTrack,wtabAdd,panes,foot,badgeShell,badgeCwd,badgeCmd,badgePort,uptimeEl,startedAt,chip,cled,cname,cmove,
    themeId:desc.themeId&&THEMES[desc.themeId]?desc.themeId:null,
    tabs:[],activeTabId:null,
    status:"pending",minimized:false,maximized:false,prevRect:desc.prevRect||null,glue:desc.glue||null,
    closedByUser:false,
  };
  sessions.set(id,s); order.push(id); syncMoveBtns();
  const proj=projects.get(project); if(proj && !proj.root && s.cwd) proj.root=s.cwd;  // anchor tree to first shell's path

  wireWindow(s);
  wireChip(s);

  if(desc.maximized){s.prevRect=desc.prevRect||{left:"80px",top:"60px",width:"580px",height:"380px"}; Object.assign(win.style,{left:"0px",top:"0px",width:"100%",height:"100%"}); win.classList.add("max"); s.maximized=true;}

  const belongsActive=project===activeProject;
  if(!belongsActive){win.style.display="none"; chip.style.display="none";}
  else{hint.style.display="none"; focusWindow(s);}

  // spawn tabs — restore saved ones (names + cwd + agent tag), else one fresh tab
  if(desc.tabs?.length) desc.tabs.forEach((t)=>addTab(s,{id:t.id,name:t.name,cwd:t.cwd,agent:t.agent,shell:t.shell,cmd:t.resume,resume:t.resume,rtpl:t.rtpl}));
  else addTab(s,{cmd:desc.cmd,resume:desc.resume,rtpl:desc.rtpl,agent:desc.agent,shell:desc.shell});   // desc.cmd = one-shot startup command (Dir popover / SSH / AI CLI); not persisted, so it won't re-fire on reload. agent=arm idle "waiting" watch.

  if(desc.minimized) minimize(s);
  updateProjCounts(); scheduleSave();
  return s;
}

/* ── Find-in-terminal (xterm search addon). One shared bar, retargeted per focused tab. ── */
const FIND_DECO={matchBackground:"#5b4b1f",matchBorder:"#e0a94e",matchOverviewRuler:"#e0a94e",
  activeMatchBackground:"#e0a94e",activeMatchColorOverviewRuler:"#4fd6be"};
let findBar=null, findTarget=null, findDisp=null;
function buildFindBar(){
  const b=el("div","findbar");
  const inp=el("input","find-inp"); inp.type="text"; inp.placeholder="Find"; inp.spellcheck=false;
  const cnt=el("span","find-count");
  const prev=el("button","find-btn"); prev.innerHTML=ICON.up; prev.title="Previous  ⇧⏎";
  const next=el("button","find-btn"); next.innerHTML=ICON.down; next.title="Next  ⏎";
  const cls=el("button","find-btn"); cls.innerHTML=ICON.x; cls.title="Close  Esc";
  b.append(inp,cnt,prev,next,cls);
  const run=(dir)=>{ if(!findTarget)return; const q=inp.value;
    if(!q){ try{findTarget.search.clearDecorations();}catch{} cnt.textContent=""; return; }
    try{ dir<0 ? findTarget.search.findPrevious(q,{decorations:FIND_DECO})
               : findTarget.search.findNext(q,{decorations:FIND_DECO}); }catch{}
  };
  inp.addEventListener("input",()=>run(1));
  inp.addEventListener("keydown",(e)=>{
    if(e.key==="Enter"){e.preventDefault(); run(e.shiftKey?-1:1);}
    else if(e.key==="Escape"){e.preventDefault(); closeFind();}
  });
  prev.onclick=()=>run(-1); next.onclick=()=>run(1); cls.onclick=closeFind;
  b.inp=inp; b.cnt=cnt; b.run=run;
  document.body.append(b);
  return b;
}
function openFind(s,tab){
  if(!findBar) findBar=buildFindBar();
  if(findDisp){try{findDisp.dispose();}catch{} findDisp=null;}
  findTarget=tab;
  findDisp=tab.search.onDidChangeResults((r)=>{
    findBar.cnt.textContent = (!r||r.resultCount===undefined) ? ""
      : (r.resultCount ? (r.resultIndex+1)+"/"+r.resultCount : "0/0");
  });
  findBar.classList.add("open");
  const sel=tab.term.getSelection(); if(sel && sel.length<80) findBar.inp.value=sel;
  findBar.inp.focus(); findBar.inp.select();
  if(findBar.inp.value) findBar.run(1);
}
function closeFind(){
  if(!findBar)return;
  findBar.classList.remove("open");
  if(findDisp){try{findDisp.dispose();}catch{} findDisp=null;}
  const t=findTarget; findTarget=null;
  if(t){ try{t.search.clearDecorations();}catch{} try{t.term.focus();}catch{} }
}
// Serialize a terminal's scrollback to a downloaded .log (user-initiated, local only).
function saveTabOutput(s,tab){
  let data=""; try{ data=tab.ser.serialize(); }catch{}
  const name=(s.name||"terminal").replace(/[^\w.-]+/g,"_")+"-"+tab.id+".log";
  downloadFile(name,data,"text/plain");
  toast(ICON.check,"Saved",name);
}
function downloadFile(name,data,type){
  const a=el("a"); a.href=URL.createObjectURL(new Blob([data],{type})); a.download=name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}

// Clickable file paths in output: `src/a.ts:42`, `./x.md`, `~/n.txt`, `/abs/f.js`. A token is linked
// only if /api/stat says it's a real file (relative paths resolve against the tab's live cwd), so
// prose and URLs stay plain. Opens in the file viewer, scrolled to :line. Single rows only (no wrapped paths).
const PATH_RE=/(?<![\w/.:@~-])((?:~|\.{1,2})?\/?(?:[\w.@+-]+\/)*[\w.@+-]+\.[A-Za-z][A-Za-z0-9]{0,7})(?::(\d+)(?::\d+)?)?/g;
const statCache=new Map();   // full path → {t, p:Promise<bool>}; 5s TTL so a just-created file becomes linkable
function isFilePath(full){
  const c=statCache.get(full);
  if(c&&Date.now()-c.t<5000) return c.p;
  if(statCache.size>500) statCache.clear();
  const p=fetch("/api/stat?path="+encodeURIComponent(full)).then((r)=>r.json()).then((j)=>!!j.file).catch(()=>false);
  statCache.set(full,{t:Date.now(),p});
  return p;
}
function registerPathLinks(term,tab){
  term.registerLinkProvider({provideLinks(y,cb){
    const line=term.buffer.active.getLine(y-1); if(!line) return cb(undefined);
    const text=line.translateToString(true), hits=[];
    for(const m of text.matchAll(PATH_RE)){
      const raw=m[1], full=/^([/~]|[A-Za-z]:)/.test(raw)?raw:joinPath(tab.cwd||"~",raw);
      hits.push(isFilePath(full).then((ok)=>ok?{
        text:m[0],
        range:{start:{x:m.index+1,y},end:{x:m.index+m[0].length,y}},
        activate:()=>openFileViewer(full,full.split(/[\\/]/).pop(),undefined,m[2]?+m[2]:0),
      }:null));
    }
    Promise.all(hits).then((ls)=>cb(ls.filter(Boolean)));
  }});
}

function addTab(s, opts){
  opts=opts||{};
  const tid=opts.id||newId("t"+(++tabSeq));   // reuse the saved id on restore: the WS id is s.id+"-"+tab.id, so a fresh id here means a fresh shell
  const pane=el("div","win-pane");
  s.panes.append(pane);

  const themeId=s.themeId||defaultThemeId;
  pane.style.background=THEMES[themeId].xterm.background;   // match terminal bg so inset padding never shows a mismatched stripe
  const term=new window.Terminal({
    fontFamily:fontStack(getFont().family),
    fontSize:getFont().size,lineHeight:1.15,cursorBlink:!s.isLog,
    theme:THEMES[themeId].xterm,allowProposedApi:true,scrollback:getScrollback(),
    overviewRuler:{width:10},   // xterm 6 sizes its scrollbar from this (default 14): keeps the thin 10px bar
    disableStdin:!!s.isLog,
  });
  const fit=new window.FitAddon.FitAddon();
  const search=new window.SearchAddon.SearchAddon();
  const ser=new window.SerializeAddon.SerializeAddon();
  term.loadAddon(fit); term.loadAddon(search); term.loadAddon(ser);
  term.loadAddon(new window.WebLinksAddon.WebLinksAddon());   // clickable URLs in output
  try { term.loadAddon(new window.Unicode11Addon.Unicode11Addon()); term.unicode.activeVersion="11"; } catch {}   // emoji / CJK widths as modern shells and TUIs count them (default is Unicode 6)
  term.open(pane);
  syncWebgl();                                                // GPU renderer if it's shown (see the WebGL budget)

  // tab widget in head
  const wt=el("div","wtab");
  const wtDot=el("span","wt-dot pending");
  const wtName=el("span","wt-name"); wtName.textContent=opts.name||("tab "+(s.tabs.length+1));
  const wtX=el("span","wt-x"); wtX.innerHTML=ICON.x; wtX.title="Close tab";
  wt.append(wtDot,wtName,wtX);
  s.wtabsTrack.append(wt); updTabEdges(s.wtabsTrack);

  const tab={id:tid,pane,term,fit,search,ser,wt,wtDot,wtName,name:wtName.textContent,
    conn:null,status:"pending",exited:false,closedByUser:false,
    reconnecting:false,retries:0,reconnectTimer:null,
    cwd:opts.cwd||s.cwd||"",shellName:"",cmd:opts.cmd||"",shell:opts.shell||"",resume:opts.resume||"",rtpl:opts.rtpl||"",agent:!!opts.agent,waiting:false};
  s.tabs.push(tab);
  if(tab.agent) updateAgentOverview();
  if(LIVE) registerPathLinks(term,tab);

  wt.addEventListener("click",(e)=>{if(e.target===wtX||wtName.isContentEditable)return; switchTab(s,tid);});
  wtX.addEventListener("click",(e)=>{e.stopPropagation(); requestCloseTab(s,tid);});
  // Double-click the tab name to rename (in-session; tab names aren't persisted across reloads). Same pattern as project tabs.
  wtName.title="Double-click to rename";
  wtName.addEventListener("dblclick",(e)=>{e.stopPropagation(); wtName.contentEditable="true"; wtName.focus(); document.getSelection().selectAllChildren(wtName);});
  const commitTabName=()=>{wtName.contentEditable="false"; tab.name=wtName.textContent.trim()||tab.name; wtName.textContent=tab.name; if(tab.agent) updateAgentOverview(); scheduleSave();};
  wtName.addEventListener("blur",commitTabName);
  wtName.addEventListener("keydown",(e)=>{if(e.key==="Enter"){e.preventDefault();wtName.blur();} if(e.key==="Escape"){wtName.textContent=tab.name;wtName.blur();} e.stopPropagation();});

  if(!s.isLog){
    term.onData((d)=>{
      if(tab.conn?.send) tab.conn.send(d);
      tab.lastIn=Date.now();
      if(d.includes("\r")) markRunning(s,tab);
      if(tab.line===undefined)tab.line="";
      trackInput(tab,d); if(d.includes("\r")) updateCmdBadges(s);   // Enter → a command may be running; start the long-run timer

      // Broadcast: mirror this tab's input to every other live shell in the SAME project.
      // Scoped to activeProject so a cast can't hit shells in a project you can't see.
      if(broadcastOn) sessions.forEach((os)=>{ if(os.project!==activeProject) return; os.tabs.forEach((ot)=>{
        if(ot!==tab && !os.isLog && castable(ot) && ot.conn?.send) ot.conn.send(d);
      });});
    });
  }

  // Keys handled while this terminal is focused (xterm would otherwise swallow them).
  term.attachCustomKeyEventHandler((ev)=>{
    const mod=ev.metaKey||ev.ctrlKey;
    if(mod&&!ev.altKey&&(ev.key==="k"||ev.key==="K")){                 // command palette (global handler defers to xterm, so claim it here)
      if(ev.type==="keydown"){ ev.preventDefault(); palette.classList.contains("open")?closePalette():openPalette(); } return false;
    }
    if(mod&&!ev.altKey&&(ev.key==="f"||ev.key==="F")){                 // find-in-terminal
      if(ev.type==="keydown"){ ev.preventDefault(); openFind(s,tab); } return false;
    }
    if(mod&&!ev.altKey&&(ev.key==="="||ev.key==="+")){                 // font zoom in
      if(ev.type==="keydown"){ ev.preventDefault(); zoomTab(s,tab,1); } return false;
    }
    if(mod&&!ev.altKey&&(ev.key==="-"||ev.key==="_")){                 // font zoom out
      if(ev.type==="keydown"){ ev.preventDefault(); zoomTab(s,tab,-1); } return false;
    }
    if(mod&&!ev.altKey&&ev.key==="0"){                                 // reset zoom
      if(ev.type==="keydown"){ ev.preventDefault(); zoomTab(s,tab,0); } return false;
    }
    // Alt/Option+Left/Right jumps a word, as before xterm 6 dropped this mapping (it now sends ESC[1;3D/C, unbound in most shells).
    if(ev.altKey&&!mod&&!ev.shiftKey&&(ev.key==="ArrowLeft"||ev.key==="ArrowRight")){
      if(ev.type==="keydown"){ ev.preventDefault(); const l=ev.key==="ArrowLeft"; term.input(MAC?(l?"\x1bb":"\x1bf"):(l?"\x1b[1;5D":"\x1b[1;5C"),true); } return false;
    }
    return true;
  });

  // Custom right-click menu on this pane's terminal surface.
  pane.addEventListener("contextmenu",(e)=>{
    e.preventDefault();
    const sel=term.getSelection();
    const items=[{label:"Copy",key:kbd("⌘","C"),disabled:!sel,run:()=>{try{navigator.clipboard.writeText(sel);}catch{}}}];
    if(!s.isLog) items.push({label:"Paste",key:kbd("⌘","V"),run:async()=>{
      try{const t=await navigator.clipboard.readText(); if(t)safePaste(s,tab,t);}catch{}
    }});
    if(sel) items.push({label:"Send selection to agent…",run:()=>sendToAgent({text:sel,build:()=>"Output from \u201c"+s.name+"\u201d:\n"+fenceOf(cleanSel(sel)),prefProject:s.project,exclude:tab})});
    items.push({sep:true},
      {label:"Find…",key:kbd("⌘","F"),run:()=>openFind(s,tab)},
      {label:"Select all",run:()=>term.selectAll()},
      {label:"Clear",run:()=>term.clear()},
      {sep:true},
      {label:"Save output…",run:()=>saveTabOutput(s,tab)});
    showCtxMenu(e.clientX,e.clientY,items);
  });

  switchTab(s,tid);

  if(!LIVE){tab.conn=demoShell(tab,term,s.isLog); setTabStatus(s,tab,"demo"); s.badgeShell.textContent="demo";}
  else openTabWS(s,tab);

  requestAnimationFrame(()=>{try{fit.fit();}catch{}});
  if(opts.agent) updateAgentOverview();
  scheduleSave();
  return tab;
}

// Attention: mark a tab that produced output while unwatched; chip blinks then stays lit until clicked.
function markAttn(s,tab){
  if(tab.attn)return;
  tab.attn=true; tab.wt.classList.remove("attn"); void tab.wt.offsetWidth; tab.wt.classList.add("attn");
  s.chip.classList.remove("attn"); void s.chip.offsetWidth; s.chip.classList.add("attn");
}
function clearTabAttn(s,tab){
  if(!tab)return;
  if(tab.waiting) setWaiting(s,tab,false);   // viewing the tab clears its "waiting" queue mark
  if(!tab.attn)return;
  tab.attn=false; tab.wt.classList.remove("attn");
  if(!s.tabs.some((t)=>t.attn)) s.chip.classList.remove("attn");
}
// Toggle the tab-strip overflow arrows for a session's track.
function updTabEdges(track){
  const wrap=track.parentNode; if(!wrap)return;
  const max=track.scrollWidth-track.clientWidth;
  wrap.classList.toggle("can-left",track.scrollLeft>1);
  wrap.classList.toggle("can-right",track.scrollLeft<max-1);
}
function switchTab(s,tid){
  s.activeTabId=tid; touchTab(s.tabs.find((t)=>t.id===tid)); syncWebgl();
  s.tabs.forEach((t)=>{
    const on=t.id===tid;
    t.pane.classList.toggle("active",on);
    t.wt.classList.toggle("active",on);
    if(on){t.wt.scrollIntoView({inline:"nearest",block:"nearest"}); focusTermSoon(t);}   // (also spares a tab name being renamed: dblclick fires after this)
  });
  updTabEdges(s.wtabsTrack);
  const tab=s.tabs.find((t)=>t.id===tid);
  if(tab){
    clearTabAttn(s,tab);
    setCwdBadge(s,tab.cwd);
    if(tab.shellName) s.badgeShell.textContent=tab.shellName;
    updateCmdBadges(s);
  }
}

function closeTab(s,tid){
  if(s.tabs.length<=1){closeSession(s); return;}
  const idx=s.tabs.findIndex((t)=>t.id===tid);
  const tab=s.tabs[idx];
  if(findTarget===tab) closeFind();
  tab.closedByUser=true; clearTimeout(tab.reconnectTimer); stopAgentIdle(s,tab);
  if(tab.conn){if(tab.conn.kill)tab.conn.kill(); if(tab.conn.close)tab.conn.close();}
  glDetach(tab); try{tab.term.dispose();}catch{}
  tab.wt.remove(); tab.pane.remove();
  s.tabs.splice(idx,1); updTabEdges(s.wtabsTrack);
  if(s.activeTabId===tid){const nxt=s.tabs[Math.min(idx,s.tabs.length-1)]; if(nxt) switchTab(s,nxt.id);}
  s.chip.classList.toggle("waiting",s.tabs.some((t)=>t.waiting));
  s.chip.classList.toggle("approval",s.tabs.some((t)=>t.approval));
  updateConn(); // recompute LED/conn + Cast gate after losing a shell
  updateProjectAttention(s.project);
  updateAgentOverview();
  scheduleSave();
}

function activeTab(s){return s.tabs.find((t)=>t.id===s.activeTabId)||s.tabs[0];}

// ── WebGL budget ──
// Chrome keeps ~16 live WebGL contexts per page and drops the oldest past that, which used to leave a terminal on the
// slower DOM renderer for good. Only shown terminals (the active tab of each visible window) get one, at most GL_MAX,
// recycling the one shown longest ago. A lost context (GPU reset, sleep/wake) is re-created when the terminal is
// shown again, or after a back-off while it stays on screen.
const GL_MAX=12;                 // = MAX_TERMS: every window of a project at once, with headroom for other pages
let glOff=false;                 // no WebGL2 here: stay on the DOM renderer
let glLost=0;                    // contexts lost so far: sets the retry back-off
const glTabs=new Set();          // tabs holding a WebglAddon
function glDetach(t){
  if(!t.webgl) return;
  glTabs.delete(t); const a=t.webgl, gl=t.glCanvas?.getContext("webgl2"); t.webgl=t.glCanvas=null;
  try{a.dispose();}catch{}
  // xterm leaves the context to garbage collection, and until then Chrome counts it against the limit
  try{ if(gl&&!gl.isContextLost()) gl.getExtension("WEBGL_lose_context")?.loseContext(); }catch{}
}
function glAttach(t){
  try{
    const a=new window.WebglAddon.WebglAddon(), before=new Set(t.term.element.querySelectorAll("canvas"));
    a.onContextLoss(()=>{ if(t.webgl!==a) return; glDetach(t); setTimeout(syncWebgl,1000*Math.min(64,2**++glLost)); });
    t.term.loadAddon(a); t.webgl=a; glTabs.add(t);
    t.glCanvas=[...t.term.element.querySelectorAll("canvas")].find((c)=>!before.has(c)&&!/-layer\b/.test(c.className))||null;   // not its 2D xterm-*-layer canvases
  }catch{ glOff=true; }
}
let glQueued=false;
function syncWebgl(){              // batched to the next frame: callers change visibility in several steps
  if(glQueued) return; glQueued=true;
  requestAnimationFrame(()=>{
    glQueued=false;
    if(glOff||!window.WebglAddon) return;
    const now=performance.now(), shown=[];
    sessions.forEach((s)=>{ const t=s.project===activeProject&&!s.minimized&&activeTab(s); if(t&&!t.closedByUser){ t.glShown=now; shown.push(t); } });
    for(const t of shown.slice(0,GL_MAX)){
      if(t.webgl) continue;
      if(glTabs.size>=GL_MAX){
        const old=[...glTabs].filter((x)=>x.glShown!==now).sort((a,b)=>a.glShown-b.glShown)[0];
        if(!old) break;
        glDetach(old);
      }
      glAttach(t);
    }
  });
}
