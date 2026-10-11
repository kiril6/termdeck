// TermDeck frontend: scrollback and font settings, footer menus, close guards, the terminal context menu.
// One of the classic scripts in public/js/, loaded in order by index.html and sharing one global scope.
"use strict";

// ── Scrollback: lines of history each terminal keeps. Global default, applied to new terminals at
// creation and live to open ones. Big = long logs survive; small = less RAM across many terminals. ──
const SCROLLBACK_STORE="td.scrollback.v1", SCROLLBACK_DEFAULT=8000;
function getScrollback(){let n=NaN; try{n=parseInt(localStorage.getItem(SCROLLBACK_STORE),10);}catch{}return Number.isFinite(n)?Math.min(200000,Math.max(500,n)):SCROLLBACK_DEFAULT;}
async function setScrollback(){
  const v=await inputModal("Scrollback lines",[
    {key:"n",label:"Lines of history per terminal (500–200000)",placeholder:String(SCROLLBACK_DEFAULT),value:String(getScrollback())},
  ]);
  if(!v||!v.n)return;
  const n=parseInt(v.n,10); if(!Number.isFinite(n)){toast(ICON.warn,"Not a number",v.n);return;}
  const clamped=Math.min(200000,Math.max(500,n));
  try{localStorage.setItem(SCROLLBACK_STORE,String(clamped));}catch{}
  sessions.forEach((s)=>s.tabs.forEach((t)=>{try{t.term.options.scrollback=clamped;}catch{}}));   // live-apply to open terminals
  toast(ICON.log,"Scrollback set",clamped+" lines"+(clamped!==n?" (clamped)":""),2200);
}
// ── Font: family + default size for every terminal. Any font installed on this machine works (nothing is
// downloaded), so a Nerd Font gives starship/p10k glyphs. Applied to new terminals and live to open ones. ──
const FONT_STORE="td.font.v1", FONT_FALLBACK='ui-monospace,Menlo,Consolas,monospace';
const FONT_DEFAULT={family:"JetBrains Mono",size:13};
function getFont(){
  let f={}; try{f=JSON.parse(localStorage.getItem(FONT_STORE))||{};}catch{}
  const fam=typeof f.family==="string"&&f.family.trim()&&!/[;{}<>]/.test(f.family)?f.family.trim():FONT_DEFAULT.family;
  const size=Number.isFinite(+f.size)?clamp(Math.round(+f.size),8,28):FONT_DEFAULT.size;
  return {family:fam,size};
}
const fontStack=(fam)=>'"'+fam.replace(/"/g,"")+'",'+FONT_FALLBACK;
function applyFont(){
  const f=getFont();
  sessions.forEach((s)=>s.tabs.forEach((t)=>{try{t.term.options.fontFamily=fontStack(f.family);t.term.options.fontSize=f.size;refitTab(s,t);}catch{}}));
}
async function setFont(){
  const cur=getFont();
  const v=await inputModal("Terminal font",[
    {key:"family",label:"Font family (must be installed on this machine)",placeholder:FONT_DEFAULT.family,value:cur.family},
    {key:"size",label:"Size in px (8–28)",placeholder:String(FONT_DEFAULT.size),value:String(cur.size)},
    {type:"note",label:"Glyphs missing in starship / powerlevel10k? Install a Nerd Font (nerdfonts.com), then enter its family name here, e.g. JetBrainsMono Nerd Font Mono.\nLeave both blank to restore the default."},
  ]);
  if(!v)return;
  try{
    if(!v.family&&!v.size) localStorage.removeItem(FONT_STORE);
    else localStorage.setItem(FONT_STORE,JSON.stringify({family:v.family,size:v.size}));
  }catch{}
  applyFont();
  const f=getFont(); toast(ICON.log,"Font set",f.family+" · "+f.size+"px",2200);
}
// Footer snippet menu: insert on row-click, edit/delete via hover icons, New snippet pinned at the bottom.
const ICON_EDIT='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
const ICON_TRASH='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/></svg>';
function openSnippetMenu(sx,anchor){
  const r=anchor.getBoundingClientRect();
  const items=snippets.length?snippets.map((sn)=>({
    label:sn.label,
    run:()=>runSnippet(sn),
    actions:[
      {icon:ICON_EDIT,title:"Edit",run:async()=>{await editSnippet(sn); openSnippetMenu(sx,anchor);}},
      {icon:ICON_TRASH,title:"Delete",run:()=>{deleteSnippet(sn.id); openSnippetMenu(sx,anchor);}},
    ],
  })):[{label:"No snippets yet",disabled:true}];
  items.push({sep:true},{label:"＋ New snippet…",sticky:true,run:async()=>{await addSnippet(); openSnippetMenu(sx,anchor);}});
  showCtxMenu(r.left,r.top,items);
}
// Shell allowlist from the server (cached). Shared by the Dir popover and the footer shell badge.
let shellList=null;
async function getShells(){
  if(shellList) return shellList;
  try{ shellList=(await (await fetch("/api/shells")).json()).shells||[]; }catch{ return []; }
  return shellList;
}
// Footer shell badge menu. Safe default = open a NEW tab in this tab's folder with the chosen shell.
// "Restart as" swaps the shell in place (new tab + close old), so it is blocked while an agent runs in the tab — it would kill it.
async function openShellMenu(s,anchor){
  const tab=activeTab(s); if(!tab||s.isLog) return;
  const shells=await getShells(); if(shells.length<2) return;
  const r=anchor.getBoundingClientRect();
  const agent=!!tab.agent, other=shells.filter((x)=>x.name!==tab.shellName);
  const items=[{label:"New tab in this folder",disabled:true},
    ...shells.map((x)=>({label:x.name+(x.name===tab.shellName?"  ✓":""),run:()=>addTab(s,{cwd:tab.cwd,shell:x.path})})),
    {sep:true},{label:"Restart this tab as…",disabled:true},
    ...other.map((x)=>({label:x.name,key:agent?"agent running":"",disabled:agent,run:()=>restartTabAs(s,tab,x)}))];
  showCtxMenu(r.left,r.top,items);
  ctxMenuEl.style.top=Math.max(6,r.top-ctxMenuEl.offsetHeight-4)+"px";   // open upward from the footer
}
async function restartTabAs(s,tab,shell){
  if(tab.agent||!s.tabs.includes(tab)) return;
  if(!(await confirmModal("Restart this tab as "+shell.name+"? Its shell state and history will be lost"+(running.has(s.id+tab.id)?", and the running command will stop":"")+".","Restart",true))) return;
  if(tab.agent||!s.tabs.includes(tab)) return;   // an agent may have started while the dialog was open
  const idx=s.tabs.indexOf(tab);
  const nt=addTab(s,{cwd:tab.cwd,shell:shell.path,name:tab.name});   // add first: closing a window's only tab would close the window
  s.tabs.splice(s.tabs.indexOf(nt),1); s.tabs.splice(idx,0,nt);     // new tab takes the old one's slot (strip + saved order)
  s.wtabsTrack.insertBefore(nt.wt,tab.wt);
  closeTab(s,tab.id);
}
// Send a snippet's text to the focused terminal WITHOUT a trailing newline, so the user reviews then hits Enter.
function runSnippet(sn){
  const s=focusedId&&sessions.get(focusedId); const t=s&&activeTab(s);
  if(!t||!t.conn?.send||t.status!=="live"){toast(ICON.warn,"No live terminal","Focus a running shell first");return;}
  t.conn.send(sn.cmd); try{t.term.focus();}catch{}
  // Cast on → mirror the snippet into every other live shell in the active project (matches input broadcast scope).
  if(broadcastOn) sessions.forEach((os)=>{ if(os.project!==activeProject) return; os.tabs.forEach((ot)=>{
    if(ot!==t && !os.isLog && castable(ot) && ot.conn?.send) ot.conn.send(sn.cmd);
  });});
}

// Count running (live) shells in a session. Demo/dead/reconnecting tabs don't hold a real PTY.
function liveTabs(s){return s.tabs.filter((t)=>t.status==="live").length;}
// A tab is "busy" only when a command is actively running (tracked in `running`) — an idle shell at its prompt is not.
function busyTabs(s){return s.tabs.filter((t)=>t.status==="live"&&running.has(s.id+t.id)).length;}
// App-controlled close guards — confirm only when killing a *busy* shell, not an idle one (see beforeunload for the browser-close path).
async function requestCloseSession(s){
  const n=busyTabs(s);
  if(n && !(await confirmModal('"'+s.name+'" has '+n+" running command"+(n>1?"s":"")+". Close it?","Close",true))) return;
  closeSession(s);
}
async function requestCloseTab(s,tid){
  if(s.tabs.length<=1) return requestCloseSession(s);   // last tab closes the whole window
  const tab=s.tabs.find((t)=>t.id===tid);
  if(tab&&tab.status==="live"&&running.has(s.id+tab.id) && !(await confirmModal("This tab has a running command. Close it?","Close tab",true))) return;
  closeTab(s,tid);
}
// Custom right-click menu, scoped to terminal panes (chrome/inputs keep the native menu).
let ctxMenuEl=null;
function closeCtxMenu(){
  if(!ctxMenuEl)return;
  ctxMenuEl.remove(); ctxMenuEl=null;
  document.removeEventListener("mousedown",onCtxAway,true);
  document.removeEventListener("keydown",onCtxKey,true);
  removeEventListener("blur",closeCtxMenu);
}
function onCtxAway(e){if(ctxMenuEl&&!ctxMenuEl.contains(e.target))closeCtxMenu();}
function onCtxKey(e){if(e.key==="Escape")closeCtxMenu();}
function showCtxMenu(x,y,items){
  closeCtxMenu();
  const m=el("div","ctxmenu");
  items.forEach((it)=>{
    if(it.sep){m.append(el("div","ctx-sep"));return;}
    const b=el("div","ctx-item"+(it.disabled?" disabled":"")+(it.sticky?" sticky":""));
    const lbl=el("span","ctx-lbl"); lbl.textContent=it.label; b.append(lbl);
    if(it.icon){const i=el("span","ctx-ico"); i.innerHTML=it.icon; lbl.prepend(i);}
    if(it.key){const k=el("span","ctx-key"); k.textContent=it.key; b.append(k);}
    if(it.actions&&it.actions.length){    // per-row icon buttons (edit/delete); click doesn't trigger the row's run
      const wrap=el("span","ctx-actions");
      it.actions.forEach((a)=>{
        const ab=el("button","ctx-act"); ab.innerHTML=a.icon; ab.title=a.title||"";
        ab.addEventListener("click",(e)=>{e.stopPropagation(); a.run();});
        wrap.append(ab);
      });
      b.append(wrap);
    }
    if(!it.disabled&&it.run) b.addEventListener("click",()=>{closeCtxMenu(); it.run();});
    m.append(b);
  });
  document.body.append(m);
  const r=m.getBoundingClientRect();   // clamp inside viewport
  m.style.left=Math.max(6,Math.min(x,innerWidth-r.width-6))+"px";
  m.style.top=Math.max(6,Math.min(y,innerHeight-r.height-6))+"px";
  ctxMenuEl=m;
  document.addEventListener("mousedown",onCtxAway,true);
  document.addEventListener("keydown",onCtxKey,true);
  addEventListener("blur",closeCtxMenu);
}
// Bring a session into view (switch project / un-minimize / focus) and flash its frame.
function revealWindow(s){
  if(!sessions.has(s.id))return;
  if(s.project!==activeProject) switchProject(s.project);
  if(s.minimized) restore(s); else focusWindow(s);
  s.win.classList.remove("blink"); void s.win.offsetWidth; s.win.classList.add("blink");
  setTimeout(()=>s.win.classList.remove("blink"),1600);
}
