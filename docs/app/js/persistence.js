// TermDeck frontend: saving and restoring state, settings export / import, named layouts, the demo shell.
// One of the classic scripts in public/js/, loaded in order by index.html and sharing one global scope.
"use strict";

/* ════════════════════════════════════════════════
   PERSISTENCE
   ════════════════════════════════════════════════ */
function scheduleSave(){updateGlueUI();clearTimeout(saveTimer);saveTimer=setTimeout(saveState,300);}
function serializeState(){
    return {activeProject,
      projects:projectOrder.map((pid)=>({id:pid,name:projects.get(pid).name,root:projects.get(pid).root||null,repo:projects.get(pid).repo||null,base:projects.get(pid).base||null,baseBranch:projects.get(pid).baseBranch||null,launchedAt:projects.get(pid).launchedAt||null,lastCwd:projects.get(pid).lastCwd||null})),
      sessions:order.map((id)=>{const s=sessions.get(id);if(!s)return null;const st=s.win.style;
        return{id:s.id,project:s.project,name:s.name,cwd:s.cwd,themeId:s.themeId||null,isLog:s.isLog||false,
               left:st.left,top:st.top,width:st.width,height:st.height,
               minimized:s.minimized,maximized:s.maximized,prevRect:s.prevRect,glue:s.glue||null,
               // agent tag + resume command persist (resume only fires on a fresh shell, see agentRun); the launch cmd deliberately does NOT, so it can't re-fire
               tabs:s.tabs.map((t)=>({id:t.id,name:t.name,cwd:t.cwd||"",agent:!!t.agent,shell:t.shell||"",resume:t.resume||"",rtpl:t.rtpl||""}))};}).filter(Boolean)};
}
let saveFailed=false;
function saveState(){
  if(!instanceActive) return;   // passive tab: never write — would clobber the active tab's layout
  try{ localStorage.setItem(STORE,JSON.stringify(serializeState())); saveFailed=false; }
  catch(e){   // full or blocked storage: the layout would be lost on reload — say so once (again only after a save worked)
    if(!saveFailed) toast(ICON.warn,"Layout not saved","This browser refused to store it ("+(e.name||"error")+"). Free some site storage or leave private mode.",0);
    saveFailed=true;
  }
}
function restoreState(){
  let data=null;try{data=JSON.parse(localStorage.getItem(STORE)||"null");}catch{}
  if(!data)return false;
  applyState(data);
  return true;
}
function applyState(data){
  if(data.projects?.length) data.projects.forEach((p)=>{addProject(p.name,p.id,true); const pr=projects.get(p.id); if(pr){if(p.root)pr.root=p.root; if(p.repo)pr.repo=p.repo; if(p.base)pr.base=p.base; if(p.baseBranch)pr.baseBranch=p.baseBranch; if(p.launchedAt)pr.launchedAt=p.launchedAt; if(p.lastCwd)pr.lastCwd=p.lastCwd;}});
  else addProject("default",null,true);
  activeProject=projects.has(data.activeProject)?data.activeProject:projectOrder[0];
  projects.forEach((p)=>p.tab.classList.toggle("active",p.id===activeProject));
  if(data.sessions?.length) data.sessions.forEach((d)=>createSession(d));
  updateProjCounts(); updateProjectAttention(); updateAgentOverview(); updateGlueUI();
  hint.style.display=[...sessions.values()].some((s)=>s.project===activeProject&&!s.minimized)?"none":"";
}

/* ── Settings export / import: one JSON file with the preferences kept in this browser — theme, terminal font,
   scrollback, snippets, SSH hosts, AI CLI presets, pets, and the tree / overview toggles. Not the window layout (that is
   Save layout as…) and nothing per-tab (lock, caches, usage, the tour). Import merges key by key, then reloads; the
   terminals reconnect. ── */
const settingsKeys=()=>[THEME_STORE,FONT_STORE,SCROLLBACK_STORE,SNIP_STORE,SSH_STORE,AICLI_STORE,PETS_STORE,TREE_HIDDEN_STORE,TREE_FOLLOW_STORE,OV_FILTER_STORE];
function exportSettings(){
  const settings={};
  for(const k of settingsKeys()){let v=null; try{v=localStorage.getItem(k);}catch{} if(v!==null) settings[k]=v;}
  downloadFile("termdeck-settings.json",JSON.stringify({termdeck:"settings",version:1,exportedAt:new Date().toISOString(),settings},null,2)+"\n","application/json");
  toast(ICON.check,"Settings exported",Object.keys(settings).length+" setting"+(Object.keys(settings).length===1?"":"s")+" \u00b7 termdeck-settings.json");
}
// Only known keys with string values are taken from the file; each store re-validates its own value when it is read.
function parseSettingsFile(text){
  const j=JSON.parse(text);
  if(!j||j.termdeck!=="settings"||!j.settings||typeof j.settings!=="object") throw new Error("not a termdeck settings file");
  if(j.version!==1) throw new Error("made by a newer termdeck \u2014 update this one first");
  const allowed=new Set(settingsKeys());
  const entries=Object.entries(j.settings).filter(([k,v])=>allowed.has(k)&&typeof v==="string");
  if(!entries.length) throw new Error("it holds no settings");
  return entries;
}
function importSettings(){
  const inp=el("input"); inp.type="file"; inp.accept=".json,application/json";
  inp.addEventListener("change",async()=>{
    const f=inp.files&&inp.files[0]; if(!f) return;
    let entries;
    try{ if(f.size>2e6) throw new Error("larger than 2 MB"); entries=parseSettingsFile(await f.text()); }
    catch(e){ toast(ICON.warn,"Settings not imported",f.name+": "+(e instanceof SyntaxError?"not valid JSON":e.message),5000); return; }
    const ok=await confirmModal("Import "+entries.length+" setting"+(entries.length===1?"":"s")+" from \u201c"+f.name+"\u201d, replacing the same ones in this browser? Snippets and AI CLI presets run commands when you use them \u2014 import only a file you trust. The page then reloads; your terminals reconnect.","Import");
    if(!ok) return;
    try{ for(const [k,v] of entries) localStorage.setItem(k,v); localStorage.removeItem("td.themevars.v1"); }   // the colour cache belongs to the old theme
    catch(e){ toast(ICON.warn,"Settings not imported","This browser refused to store them ("+(e.name||"error")+").",5000); return; }
    selfReload=true; location.reload();
  });
  inp.click();
}

/* ── Named layouts (#17): save the whole workspace under a name, restore it later. Live: ~/.termdeck/layouts.json via
   /api/layouts; demo: localStorage. A snapshot is layout only (projects, windows, tabs, roots, cwds) — never running
   processes — and carries no agent/resume commands, so restoring can never launch an agent by itself. ── */
const LAYOUTS_LS="td.layouts.v1";
const lsLayouts=()=>{try{const a=JSON.parse(localStorage.getItem(LAYOUTS_LS));return Array.isArray(a)?a:[];}catch{return [];}};
const layoutMeta=(l)=>({id:l.id,name:l.name,savedAt:l.savedAt,projects:l.data.projects.length,windows:l.data.sessions.length});
async function layoutFetch(url,opt){
  const r=await fetch(url,opt); const j=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(j.error||("HTTP "+r.status)); return j;
}
const layoutsApi={
  list:async()=>LIVE?layoutFetch("/api/layouts"):lsLayouts().map(layoutMeta).sort((a,b)=>b.savedAt-a.savedAt),
  get:async(id)=>LIVE?layoutFetch("/api/layouts/"+encodeURIComponent(id)):lsLayouts().find((l)=>l.id===id),
  del:async(id)=>LIVE?layoutFetch("/api/layouts/"+encodeURIComponent(id),{method:"DELETE"}):localStorage.setItem(LAYOUTS_LS,JSON.stringify(lsLayouts().filter((l)=>l.id!==id))),
  save:async(name,data)=>{
    if(LIVE) return layoutFetch("/api/layouts",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,data})});
    const all=lsLayouts(), key=name.toLowerCase(); let l=all.find((x)=>x.name.toLowerCase()===key);
    if(!l){l={id:newId("l")};all.push(l);} Object.assign(l,{name:name.slice(0,60),savedAt:Date.now(),data});
    localStorage.setItem(LAYOUTS_LS,JSON.stringify(all)); return layoutMeta(l);
  },
};
function layoutSnapshot(){
  const d=serializeState();
  d.sessions.forEach((s)=>s.tabs.forEach((t)=>{t.agent=false;t.resume="";t.rtpl="";}));
  return d;
}
async function saveLayoutAs(){
  const v=await inputModal("Save layout",[{key:"name",label:"Name (saving under an existing name replaces it)",placeholder:"e.g. review day"}],"Save");
  if(!v||!v.name) return;
  try{
    const dup=(await layoutsApi.list()).find((l)=>l.name.toLowerCase()===v.name.toLowerCase());
    if(dup&&!(await confirmModal("Replace the saved layout “"+dup.name+"”?","Replace",true))) return;
    const m=await layoutsApi.save(v.name,layoutSnapshot());
    toast(ICON.check,"Layout saved",m.name+" · "+m.windows+" window"+(m.windows===1?"":"s")+(LIVE?"":" (this browser only)"),2600);
  }catch(e){toast(ICON.warn,"Couldn't save layout",e.message,3500);}
}
async function restoreLayout(id){
  let l; try{l=await layoutsApi.get(id);}catch(e){toast(ICON.warn,"Couldn't load layout",e.message,3500);return;}
  if(!l||!l.data) return;
  const n=sessions.size;
  if(n&&!(await confirmModal("Restore “"+l.name+"”? The "+n+" open window"+(n===1?"":"s")+" will be closed and replaced by new shells in the saved folders.","Restore",true))) return;
  const data=JSON.parse(JSON.stringify(l.data)), ids=new Map();
  data.sessions.forEach((d)=>{const nid=newId(); ids.set(d.id,nid); d.id=nid;});   // fresh ids → fresh tmux sessions, never a clash with a live one
  data.sessions.forEach((d)=>{d.glue=d.glue&&ids.get(d.glue)||null;});
  [...sessions.values()].forEach((s)=>closeSession(s,true));
  projectOrder.forEach((pid)=>{const p=projects.get(pid); if(p&&p.tab)p.tab.remove(); projects.delete(pid);}); projectOrder=[];
  applyState(data); syncMoveBtns(); treeRoot=null; treeLastRoot=null; refreshTree(); scheduleSave();
  toast(ICON.check,"Layout restored",l.name,2400);
}
async function openLayouts(){
  let list; try{list=await layoutsApi.list();}catch(e){toast(ICON.warn,"Couldn't load layouts",e.message,3500);return;}
  if(!list.length){toast(ICON.log,"No saved layouts","Palette → Save layout as…",2800);return;}
  closeModals("layouts");
  const o=el("div"); o.style.cssText="position:fixed;inset:0;z-index:9998;display:flex;align-items:center;justify-content:center;background:rgba(4,7,11,.6);backdrop-filter:blur(3px);padding:24px";
  const card=el("div"); card.style.cssText="max-width:480px;width:100%;max-height:70vh;overflow:auto;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px 20px;color:var(--text);font:13px/1.5 system-ui,sans-serif;box-shadow:0 18px 50px rgba(0,0,0,.5)";
  const h=el("div"); h.textContent="Restore layout"; h.style.cssText="font-weight:600;margin-bottom:10px"; card.append(h);
  const close=()=>{o.remove();document.removeEventListener("keydown",onKey);};
  const onKey=(e)=>{if(e.key==="Escape"){e.stopPropagation();close();}};
  list.forEach((m)=>{
    const row=el("div","lay-row");
    const t=el("span","lay-name"); t.textContent=m.name;
    const meta=el("span","lay-meta"); meta.textContent=m.projects+" project"+(m.projects===1?"":"s")+" · "+m.windows+" window"+(m.windows===1?"":"s")+" · "+new Date(m.savedAt).toLocaleString([],{dateStyle:"medium",timeStyle:"short"});
    const del=el("button","lay-del"); del.innerHTML=ICON.x; del.title="Delete layout"; del.setAttribute("aria-label","Delete layout "+m.name);
    del.addEventListener("click",async(e)=>{e.stopPropagation(); if(!(await confirmModal("Delete the saved layout “"+m.name+"”?","Delete",true)))return;
      try{await layoutsApi.del(m.id); row.remove(); if(!card.querySelector(".lay-row")) close();}catch(err){toast(ICON.warn,"Couldn't delete",err.message,3000);}});
    row.addEventListener("click",()=>{close(); restoreLayout(m.id);});
    row.tabIndex=0; row.setAttribute("role","button");   // keyboard: Tab to a layout, Enter/Space restores it
    row.addEventListener("keydown",(e)=>{if((e.key==="Enter"||e.key===" ")&&e.target===row){e.preventDefault(); row.click();}});
    row.append(t,meta,del); card.append(row);
  });
  o.addEventListener("mousedown",(e)=>{if(e.target===o)close();});
  o.append(card); asDialog(o,"Restore layout"); document.body.append(o); document.addEventListener("keydown",onKey);
}

/* ════════════════════════════════════════════════
   DEMO SHELL
   ════════════════════════════════════════════════ */
function demoShell(tab, term, isLog){
  const prompt="\x1b[38;2;79;214;190m\u27a1\x1b[0m \x1b[38;2;90;169;230m~\x1b[0m ";
  if(isLog){
    term.write("\x1b[2mLog panel \u2014 demo mode\x1b[0m\r\n\x1b[2mStreaming output would appear here in live mode.\x1b[0m\r\n\r\n");
    let i=0;
    const iv=setInterval(()=>{
      if(!tab||tab.closedByUser){clearInterval(iv);return;}
      term.write("\x1b[2m["+new Date().toLocaleTimeString()+"] log entry "+(++i)+"\x1b[0m\r\n");
    },2000);
    return{send:()=>{},resize:()=>{},close:()=>clearInterval(iv),kill:()=>clearInterval(iv)};
  }
  let line="";
  ["\x1b[2mTermDeck \u2014 demo shell\x1b[0m","\x1b[2mRun the Node server for real shells.\x1b[0m","\x1b[2mCommands: help, echo, date, whoami, ls, pwd, clear\x1b[0m",""].forEach((l)=>term.write(l+"\r\n"));
  term.write(prompt);
  function run(cmd){
    const[c,...rest]=cmd.trim().split(/\s+/);const arg=rest.join(" ");
    switch(c){case"":break;case"help":term.write("commands: help, echo, date, whoami, ls, pwd, clear\r\n");break;case"echo":term.write(arg+"\r\n");break;case"date":term.write(new Date().toString()+"\r\n");break;case"whoami":term.write("guest\r\n");break;case"pwd":term.write("/home/guest\r\n");break;case"ls":term.write("\x1b[38;2;79;214;190msrc  public  node_modules\x1b[0m  package.json  .env\r\n");break;case"clear":term.write("\x1b[2J\x1b[H");return;default:term.write("\x1b[38;2;224;101;95m"+c+": command not found\x1b[0m\r\n");}
  }
  return{
    send:(d)=>{for(const ch of d){if(ch==="\r"){term.write("\r\n");run(line);line="";term.write(prompt);}else if(ch==="\x7f"){if(line){line=line.slice(0,-1);term.write("\b \b");}}else if(ch==="\x03"){term.write("^C\r\n");line="";term.write(prompt);}else if(ch>=" "){line+=ch;term.write(ch);}}},
    resize:()=>{},close:()=>{},kill:()=>{},
  };
}
