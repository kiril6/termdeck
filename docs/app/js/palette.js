// TermDeck frontend: live grid overview, command palette, keyboard shortcuts overlay.
// One of the classic scripts in public/js/, loaded in order by index.html and sharing one global scope.
"use strict";

/* ════════════════════════════════════════════════
   LIVE GRID OVERVIEW (#25) — read-only tiles of every tab's last output lines
   ════════════════════════════════════════════════ */
const ovOverlay=document.getElementById("ov-overlay"), ovBody=document.getElementById("ov-body");
let ovTimer=null;
function tabTail(tab,n){
  const b=tab.term.buffer.active, out=[];
  for(let y=b.length-1;y>=0&&out.length<n;y--){
    const t=b.getLine(y)?.translateToString(true)||"";
    if(t.trim()||out.length) out.unshift(t);   // drop trailing blank rows only
  }
  return out.join("\n");
}
const OV_RANK={approval:0,waiting:1,working:2,run:3,idle:4,exited:5};   // most urgent first
const OV_FILTER_STORE="td.ovFilter.v1";
let ovFilterPref=null;   // "all" | "active" once the user picks; null = auto (Active while anything is running, else All)
try{const v=localStorage.getItem(OV_FILTER_STORE); if(v==="all"||v==="active") ovFilterPref=v;}catch{}
function renderOverview(){
  const q=new Map(getAgentQueue().map((x)=>[x.tab,x.state]));
  const byProj=new Map(); let nActive=0;
  sessions.forEach((s)=>{ if(s.status==="pending") return; s.tabs.forEach((tab)=>{
    if(tab.closedByUser) return;
    const st=tab.exited?"exited":(q.get(tab)||(tab.busy?"run":"idle"));
    if(OV_RANK[st]<=OV_RANK.run) nActive++;
    const a=byProj.get(s.project)||[]; a.push({s,tab,st}); byProj.set(s.project,a);
  });});
  const filter=ovFilterPref||(nActive?"active":"all");
  document.querySelectorAll("#ov-filter button").forEach((b)=>{const on=b.dataset.f===filter; b.classList.toggle("on",on); b.setAttribute("aria-pressed",on);
    if(b.dataset.f==="active") b.textContent="Active"+(nActive?" \u00b7 "+nActive:"");});
  ovBody.innerHTML="";
  if(!byProj.size){const e=el("div","ov-empty"); e.textContent="No sessions yet"; ovBody.append(e); return;}
  let shown=0;
  byProj.forEach((all,pid)=>{
    const items=all.filter((x)=>filter==="all"||OV_RANK[x.st]<=OV_RANK.run).sort((a,b)=>OV_RANK[a.st]-OV_RANK[b.st]);   // stable: window order kept within a state
    if(!items.length) return; shown+=items.length;
    const h=el("div","ov-proj"); h.textContent=projects.get(pid)?.name||pid||"project";
    const grid=el("div","ov-grid");
    items.forEach(({s,tab,st})=>{
      const tile=el("div","ov-tile "+st); tile.tabIndex=0;
      const hd=el("div","ov-tile-h"), dot=el("span","ov-dot"), nm=el("span","ov-name"), sl=el("span","ov-state");
      nm.textContent=(s.name||"session")+" \u00b7 "+(tab.name||"tab");
      sl.textContent=st==="approval"?"needs approval":st==="run"?"running":st;
      const go=el("span","ov-go"); go.textContent="Open \u21b5"; go.setAttribute("aria-hidden","true");
      hd.append(dot,nm,go,sl);
      const pre=el("pre","ov-out"); pre.textContent=tabTail(tab,9);   // textContent only \u2014 output is untrusted
      tile.append(hd,pre);
      tile.setAttribute("role","button"); tile.setAttribute("aria-label",nm.textContent+", "+sl.textContent+" \u2014 open");
      const jump=()=>{closeOverview(); revealWindow(s); switchTab(s,tab.id);};
      tile.addEventListener("click",jump);
      tile.addEventListener("keydown",(e)=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();jump();}});
      grid.append(tile);
    });
    ovBody.append(h,grid);
  });
  if(!shown){const e=el("div","ov-empty"); e.textContent="Nothing running \u2014 switch to All to see idle sessions"; ovBody.append(e);}
}
document.getElementById("ov-filter").addEventListener("click",(e)=>{
  const b=e.target.closest("button[data-f]"); if(!b) return;
  ovFilterPref=b.dataset.f; try{localStorage.setItem(OV_FILTER_STORE,ovFilterPref);}catch{}
  renderOverview();
});
function openOverview(){closeModals("ov"); ovOverlay.classList.add("open"); renderOverview(); clearInterval(ovTimer); ovTimer=setInterval(renderOverview,1500);}
function closeOverview(){ovOverlay.classList.remove("open"); clearInterval(ovTimer); ovTimer=null;}
document.getElementById("ov-close").addEventListener("click",closeOverview);
ovOverlay.addEventListener("click",(e)=>{if(e.target===ovOverlay) closeOverview();});   // a click on the scrim, outside the sheet
// One Sessions home: the toolbar button opens the queue; Queue | Grid flips between it and this overview.
document.getElementById("agent-to-grid").addEventListener("click",openOverview);
document.getElementById("ov-to-queue").addEventListener("click",openAgentPop);

/* ════════════════════════════════════════════════
   COMMAND PALETTE
   ════════════════════════════════════════════════ */
const PAL_CMDS=[
  {icon:ICON.terminal,label:"New terminal",sub:"Open a shell window",kbd:"\u2318\u2325T",run:()=>createSession({cwd:curCwd()})},
  {icon:ICON.log,label:"New log panel",sub:"Read-only output monitor",kbd:"\u2318\u2325L",run:()=>createSession({cwd:curCwd()},true)},
  {layout:1,icon:ICON.grid,label:"Tile windows",sub:"Auto-arrange into the best-fit grid",kbd:"\u2318\u2325\u21e7T",run:tileAll},
  ...LAYOUT_PRESETS.map(([c,r])=>({layout:1,icon:ICON.grid,label:"Layout "+c+"\u00d7"+r,sub:c+" column"+(c>1?"s":"")+" \u00d7 "+r+" row"+(r>1?"s":"")+" \u2014 extra windows are minimized",run:()=>tileGrid(c,r,"Layout "+c+"\u00d7"+r)})),
  {icon:ICON.monitor,label:"Live overview",sub:"Read-only tiles of every session's latest output",run:()=>{closePalette();openOverview();}},
  {icon:ICON.sidebar,label:"Toggle directory tree",sub:"Show/hide sidebar",kbd:"\u2318B",run:toggleSidebar},
  {icon:ICON.move,label:"Move or resize window",sub:"With the keyboard \u2014 arrows move, Shift+arrows resize, Enter done, Esc cancel",run:()=>{const s=focusedId&&sessions.get(focusedId); closePalette(); if(s) keyboardMoveWindow(s); else toast(ICON.warn,"No window focused","Click a window or press \u2325+1\u20139 first",2800);}},
  {icon:ICON.search,label:"Search sessions",sub:"Filter by name or path",kbd:"\u2318F",run:()=>{closePalette();openSessSearch();}},
  {icon:ICON.theme,label:"Change theme",sub:"Open theme picker",kbd:"\u2318\u21e7P",run:()=>{closePalette();openThemePop(null,themeBtn);}},
  {icon:ICON.grid,label:"Save layout as\u2026",sub:"Name the current projects, windows and folders so you can bring them back later",run:()=>{closePalette();saveLayoutAs();}},
  {icon:ICON.copy,label:"Export settings\u2026",sub:"Save theme, font, snippets, SSH hosts, AI CLI presets and toggles to a file \u2014 for another browser or a backup",run:()=>{closePalette();exportSettings();}},
  {icon:ICON.folder,label:"Import settings\u2026",sub:"Load a file made by Export settings \u2014 replaces those settings here, then reloads",run:()=>{closePalette();importSettings();}},
  {icon:ICON.grid,label:"Restore layout\u2026",sub:"Pick a saved layout \u2014 replaces the open windows with new shells in the saved folders",run:()=>{closePalette();openLayouts();}},
  {icon:ICON.folderPlus,label:"New project",sub:"Add a project tab",kbd:"\u2318\u21e7M",run:()=>addProject()},
  {icon:ICON.keyboard,label:"Keyboard shortcuts",sub:"Show all shortcuts",kbd:"?",run:openShortcuts},
{icon:ICON.eye,label:"Take the tour",sub:"A short walkthrough of the main features",run:()=>{closePalette();takeTour();}},
  {icon:ICON.log,label:"Open file\u2026",sub:"Peek a file \u2014 text, Markdown, CSV, images, PDF, audio and video",kbd:"\u2318\u2325O",run:()=>{closePalette();openFilePrompt();}},
  {icon:ICON.folder,label:"Open directory\u2026",sub:"Spawn shell in a specific folder",kbd:"\u2318\u21e7O",run:()=>{closePalette();document.getElementById("folder").click();}},
  {icon:ICON.snippet,label:"Save snippet\u2026",sub:"Store a reusable command",kbd:"\u2318\u2325S",run:()=>{closePalette();addSnippet();}},
  {icon:ICON.terminal,label:"Add SSH host\u2026",sub:"Save an ssh target \u2014 connect in one click from here",run:()=>{closePalette();addSshHost();}},
  {icon:ICON.folderPlus,label:"New agent task\u2026",sub:"Cut a git worktree for a branch and launch an agent in it \u2014 isolated from your other agents",kbd:"\u2318\u2325R",run:()=>{closePalette();newAgentTask();}},
  {icon:ICON.check,label:"Finish agent task\u2026",sub:"Merge or open a PR for this worktree, then optionally remove it \u2014 never auto-commits, never forces",run:()=>{closePalette();finishAgentTask();}},
  {icon:ICON.eye,label:"Review agent changes\u2026",sub:"Read-only diff of this project's worktree against the commit it was cut from",kbd:"\u2318\u2325D",run:()=>{closePalette();openAgentDiff();}},
  {icon:ICON.terminal,label:"Add AI CLI preset\u2026",sub:"Save an agent command \u2014 launch it in one click; pings you when it needs input",run:()=>{closePalette();addAiCli();}},
  {icon:ICON.terminal,label:"Reset usage",sub:"Clear the token totals shown in the agent queue and project tabs",run:()=>{closePalette();resetUsage();}},
  {icon:ICON.terminal,label:"Reset agent order",sub:"Forget which agents you use most — back to the default order",run:()=>{closePalette();resetAiOrder();}},
 {icon:ICON.log,label:"Terminal font\u2026",sub:"Font family and size for every terminal \u2014 use a Nerd Font for prompt glyphs",run:()=>{closePalette();setFont();}},
{icon:ICON.log,label:"Set scrollback\u2026",sub:"Lines of history each terminal keeps",run:()=>{closePalette();setScrollback();}},
  {icon:ICON.gamepad,label:"Play game",sub:"Dino or Snake while a command runs \u2014 pings when the watched terminal finishes",kbd:"\u2318\u2325G",run:()=>{closePalette();openGame();}},
  {icon:'<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><ellipse cx="6.5" cy="10" rx="1.7" ry="2.3"/><ellipse cx="10.5" cy="7.5" rx="1.8" ry="2.5"/><ellipse cx="15" cy="8" rx="1.8" ry="2.5"/><ellipse cx="18" cy="11" rx="1.7" ry="2.3"/><path d="M12 12.5c-2.6 0-4.7 1.9-4.7 3.9 0 1.7 1.6 2.6 4.7 2.6s4.7-.9 4.7-2.6c0-2-2.1-3.9-4.7-3.9z"/></svg>',label:"Toggle pixel pets",sub:"Cycle: auto (idle/away) → always on → off",kbd:"⌘⌥P",run:()=>togglePets()},
];

// Category of each built-in command; unlisted ones fall under Settings (theme, font, scrollback). Snippets/SSH → Terminals, AI presets → Agents, sessions → Sessions.
const PAL_CATS=["All","Terminals","Agents","Sessions","Layout","Settings","Help","Fun"];
const PAL_CAT_OF={"New terminal":"Terminals","New log panel":"Terminals","Add SSH host\u2026":"Terminals","Save snippet\u2026":"Terminals",
  "Open file\u2026":"Terminals","Open directory\u2026":"Terminals","New project":"Terminals",
  "New agent task\u2026":"Agents","Finish agent task\u2026":"Agents","Review agent changes\u2026":"Agents","Add AI CLI preset\u2026":"Agents",
  "Reset usage":"Agents","Reset agent order":"Agents",
  "Live overview":"Sessions","Search sessions":"Sessions",
  "Toggle directory tree":"Layout","Move or resize window":"Layout","Save layout as\u2026":"Layout","Restore layout\u2026":"Layout",
  "Keyboard shortcuts":"Help","Take the tour":"Help",
  "Play game":"Fun","Toggle pixel pets":"Fun"};
PAL_CMDS.forEach((c)=>{c.cat=PAL_CAT_OF[c.label]||(c.layout?"Layout":"Settings");});
// Empty palette shows a short list — Recent, then these — instead of every command; typing or a chip shows the rest.
const PAL_START=["New terminal","New agent task\u2026","Open directory\u2026","Open file\u2026","New project"];
const PAL_RECENT_KEY="td.palRecent.v1", PAL_RECENT_MAX=5;
function palRecent(){try{const a=JSON.parse(localStorage.getItem(PAL_RECENT_KEY));return Array.isArray(a)?a:[];}catch{return [];}}
function notePalRecent(label){try{localStorage.setItem(PAL_RECENT_KEY,JSON.stringify([label,...palRecent().filter((l)=>l!==label)].slice(0,PAL_RECENT_MAX)));}catch{}}
let palCat="All", aiMore=false;   // aiMore: "More agents" expanded
const inCat=(c)=>palCat==="All"||palCat===c;
const palCats=document.getElementById("pal-cats");
function setPalCat(c){palCat=c;renderPalCats();palMatches=buildPalette(palInput.value);palInput.focus();}
function renderPalCats(){
  palCats.innerHTML="";
  for(const c of PAL_CATS){
    const b=el("button","pal-cat"+(c===palCat?" on":""));b.textContent=c;b.type="button";b.tabIndex=-1;b.setAttribute("role","tab");b.setAttribute("aria-selected",c===palCat);
    b.addEventListener("mousedown",(e)=>e.preventDefault());   // keep focus in the input
    b.addEventListener("click",()=>setPalCat(c));
    palCats.append(b);
  }
}
let palHi=0, palMatches=[];
function buildPalette(q){
  palList.innerHTML=""; palHi=0;
  q=(q||"").toLowerCase().trim();
  const all=[];
  // commands — curated (Recent + Start) on an empty "All" palette, otherwise every match
  const cmdGroups=[];
  if(!q&&palCat==="All"){
    const byLabel=(l)=>PAL_CMDS.find((c)=>c.label===l);
    const rec=palRecent().map(byLabel).filter(Boolean);
    cmdGroups.push(["Recent",rec],["Start",PAL_START.map(byLabel).filter((c)=>c&&!rec.includes(c))]);
  }else{
    const xq=q.replace(/\u00d7/g,"x"), hit=(t)=>t.toLowerCase().replace(/\u00d7/g,"x").includes(xq);   // "2x2" finds "Layout 2×2"
    const found=PAL_CMDS.filter((c)=>inCat(c.cat)&&(!q||hit(c.label)||hit(c.sub)));
    if(q){   // rank: a label word starting with the query, then label contains it, then description only; ties → recently run first, layout presets last, then list order
      const wordStart=new RegExp("(^|[^a-z0-9])"+xq.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")), recent=palRecent();
      const score=(c)=>{const l=c.label.toLowerCase().replace(/\u00d7/g,"x"); return [wordStart.test(l)?0:hit(c.label)?1:2, recent.includes(c.label)?recent.indexOf(c.label):99, c.layout?1:0];};
      const sc=new Map(found.map((c,i)=>[c,[...score(c),i]]));
      found.sort((a,b)=>{const x=sc.get(a),y=sc.get(b); for(let k=0;k<4;k++) if(x[k]!==y[k]) return x[k]-y[k]; return 0;});
    }
    cmdGroups.push(["Commands",found]);
  }
  for(const [title,cmds] of cmdGroups){
    if(!cmds.length) continue;
    const g=el("div","pal-group");g.textContent=title;palList.append(g);
    cmds.forEach((c)=>{
      const item=el("div","pal-item");
      const ic=el("div","pi-icon");ic.innerHTML=c.icon;
      const body=el("div","pi-body");
      const lb=el("div","pi-label");lb.innerHTML=hlMatch(c.label,q);
      const sb=el("div","pi-sub");sb.textContent=c.sub;
      body.append(lb,sb);item.append(ic,body);
      if(c.kbd){const kc=el("div","pi-keys");for(const k of osKeys(c.kbd)){const kk=el("kbd");kk.textContent=k;kc.append(kk);}item.append(kc);}
      item.addEventListener("click",()=>{closePalette();notePalRecent(c.label);c.run();});
      palList.append(item);all.push(item);
    });
  }
  // snippets
  const snips=snippets.filter((sn)=>inCat("Terminals")&&(!q||sn.label.toLowerCase().includes(q)||sn.cmd.toLowerCase().includes(q)));
  if(snips.length){
    const g=el("div","pal-group");g.textContent="Snippets";palList.append(g);
    snips.forEach((sn)=>{
      const item=el("div","pal-item");
      const ic=el("div","pi-icon");ic.innerHTML=ICON.snippet;
      const body=el("div","pi-body");
      const lb=el("div","pi-label");lb.innerHTML=hlMatch(sn.label,q);
      const sb=el("div","pi-sub");sb.textContent=sn.cmd;
      body.append(lb,sb);
      const edit=el("button","pi-del pi-edit");edit.innerHTML=ICON_EDIT;edit.title="Edit snippet";
      edit.addEventListener("click",async(e)=>{e.stopPropagation();await editSnippet(sn);palMatches=buildPalette(palInput.value);palInput.focus();});
      const del=el("button","pi-del");del.innerHTML=ICON.x;del.title="Delete snippet";
      del.addEventListener("click",(e)=>{e.stopPropagation();deleteSnippet(sn.id);palMatches=buildPalette(palInput.value);});
      item.append(ic,body,edit,del);
      item.addEventListener("click",()=>{closePalette();runSnippet(sn);});
      palList.append(item);all.push(item);
    });
  }
  // ssh hosts
  const hosts=sshHosts.filter((h)=>inCat("Terminals")&&(!q||h.label.toLowerCase().includes(q)||h.target.toLowerCase().includes(q)));
  if(hosts.length){
    const g=el("div","pal-group");g.textContent="SSH";palList.append(g);
    hosts.forEach((h)=>{
      const item=el("div","pal-item");
      const ic=el("div","pi-icon");ic.innerHTML=ICON.terminal;
      const body=el("div","pi-body");
      const lb=el("div","pi-label");lb.innerHTML=hlMatch(h.label,q);
      const sb=el("div","pi-sub");sb.textContent="ssh "+h.target;
      body.append(lb,sb);
      const edit=el("button","pi-del pi-edit");edit.innerHTML=ICON_EDIT;edit.title="Edit host";
      edit.addEventListener("click",async(e)=>{e.stopPropagation();await editSshHost(h);palMatches=buildPalette(palInput.value);palInput.focus();});
      const del=el("button","pi-del");del.innerHTML=ICON.x;del.title="Delete host";
      del.addEventListener("click",(e)=>{e.stopPropagation();deleteSshHost(h.id);palMatches=buildPalette(palInput.value);});
      item.append(ic,body,edit,del);
      item.addEventListener("click",()=>{closePalette();connectSsh(h);});
      palList.append(item);all.push(item);
    });
  }
  // ai clis (built-ins + user presets) — one-click agent launch, most-used first
  const aiAllRanked=aiRanked().filter((p)=>inCat("Agents")&&(!q||p.label.toLowerCase().includes(q)||p.cmd.toLowerCase().includes(q)));
  if(aiAllRanked.length){
    const g=el("div","pal-group");g.textContent="AI CLI";palList.append(g);
    const {main,extra}=aiSplit(aiAllRanked);
    const expanded=!!q||aiMore;                 // searching shows every match; otherwise only on demand
    const rows=expanded?[...main,...extra]:main;
    rows.forEach((p)=>{
      const custom=!AICLI_BUILTIN.includes(p);
      const item=el("div","pal-item");
      const ic=el("div","pi-icon");ic.innerHTML=ICON.bot;
      const body=el("div","pi-body");
      const lb=el("div","pi-label");lb.innerHTML=hlMatch(p.label,q);
      const sb=el("div","pi-sub");sb.textContent=p.cmd;
      body.append(lb,sb);item.append(ic,body);
      if(custom){   // only user presets are editable/removable; built-ins are fixed
        const edit=el("button","pi-del pi-edit");edit.innerHTML=ICON_EDIT;edit.title="Edit preset";
        edit.addEventListener("click",async(e)=>{e.stopPropagation();await editAiCli(p);palMatches=buildPalette(palInput.value);palInput.focus();});
        const del=el("button","pi-del");del.innerHTML=ICON.x;del.title="Delete preset";
        del.addEventListener("click",(e)=>{e.stopPropagation();deleteAiCli(p.id);palMatches=buildPalette(palInput.value);});
        item.append(edit,del);
      }
      item.addEventListener("click",()=>{closePalette();launchAiCli(p);});
      palList.append(item);all.push(item);
    });
    if(!q&&extra.length){   // toggle row: a normal list item, so arrow keys + Enter reach it
      const item=el("div","pal-item pal-more");
      const body=el("div","pi-body");
      const lb=el("div","pi-label");lb.textContent=aiMore?"Fewer agents":"More agents ("+extra.length+")";
      body.append(lb);
      const ch=el("div","pi-keys");ch.textContent=aiMore?"▴":"▾";
      const mi=el("div","pi-icon");mi.innerHTML='<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';
      item.append(mi,body,ch);
      item.addEventListener("click",()=>{
        aiMore=!aiMore; palMatches=buildPalette(palInput.value);
        const k=palMatches.findIndex((m)=>m.classList.contains("pal-more"));   // keep the highlight on the toggle
        if(k>=0){palHi=k; palMark();}
        palInput.focus();
      });
      palList.append(item);all.push(item);
    }
  }
  // sessions
  const sess=[...sessions.values()].filter((s)=>inCat("Sessions")&&(!q||(s.name.toLowerCase().includes(q)||(s.cwd||"").toLowerCase().includes(q))));
  if(sess.length){
    const g=el("div","pal-group");g.textContent="Sessions";palList.append(g);
    sess.forEach((s)=>{
      const item=el("div","pal-item");
      const act=s.project===activeProject;
      const ic=el("div","pi-icon");ic.innerHTML=act?'<span class="led live"></span>':'<span class="led"></span>';
      const body=el("div","pi-body");
      const lb=el("div","pi-label");lb.innerHTML=hlMatch(s.name,q);
      const sb=el("div","pi-sub");sb.textContent=(s.cwd||"~").replace(/^\/home\/[^/]+/,"~")+" \u2014 "+(projects.get(s.project)?.name||"?");
      body.append(lb,sb);
      const st=el("span","pi-kbd");st.textContent=s.status;
      item.append(ic,body,st);
      item.addEventListener("click",()=>{closePalette();if(s.project!==activeProject)switchProject(s.project);if(s.minimized)restore(s);else focusWindow(s);});
      palList.append(item);all.push(item);
    });
  }
  if(!all.length){const e=el("div","pal-empty");e.textContent="No results for \u201c"+q+"\u201d";palList.append(e);}
  else if(!q&&palCat==="All"){const e=el("div","pal-foot");e.textContent="Type to search all "+PAL_CMDS.length+" commands \u00b7 Tab cycles categories";palList.append(e);}
  all.forEach((it,i)=>{it.id="pal-opt-"+i;it.setAttribute("role","option");});
  palMatches=all; palHi=0; palMark();
  return all;
}
// One highlighted row: the class for the eye, aria-selected + aria-activedescendant for screen readers (focus stays in the input).
function palMark(){
  palMatches.forEach((m,i)=>{m.classList.toggle("hi",i===palHi);m.setAttribute("aria-selected",String(i===palHi));});
  if(palMatches[palHi]) palInput.setAttribute("aria-activedescendant",palMatches[palHi].id); else palInput.removeAttribute("aria-activedescendant");
}
// Escapes every piece, so a label (snippet, SSH host, preset, window name) can never inject markup.
function hlMatch(str,q){
  const e=(t)=>t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  str=String(str??""); if(!q) return e(str);
  return str.split(new RegExp("("+q.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+")","gi")).map((p,i)=>i%2?"<mark>"+e(p)+"</mark>":e(p)).join("");
}
// Only one modal/overlay at a time — opening any closes the rest (proper close fns keep game/search teardown).
function closeModals(except){
  if(except!=="palette"&&palette.classList.contains("open")) closePalette();
  if(except!=="game"&&gameOv.classList.contains("open")) closeGame();
  if(except!=="sess"&&sessSearchOpen) closeSessSearch();
  if(except!=="ov"&&ovOverlay.classList.contains("open")) closeOverview();
  if(except!=="sc") scOverlay.classList.remove("open");
  if(except!=="file"&&fileOverlay.classList.contains("open")) closeFileViewer();
  if(except!=="theme") themePop.classList.remove("open");
  if(except!=="move") movePop.classList.remove("open");
  if(except!=="cwd") cwdPop.classList.remove("open");
  if(except!=="agent"&&agentPop&&agentPop.classList.contains("open")) agentPop.classList.remove("open");
}
function openShortcuts(){closeModals("sc");scOverlay.classList.add("open");}
function openPalette(){closeModals("palette");palOverlay.classList.add("open");palette.classList.add("open");palCat="All";aiMore=false;renderPalCats();palInput.value="";palClear.hidden=true;palInput.placeholder=snippets.length?"Type a command, snippet, or search sessions…":"Type a command or search sessions…";palMatches=buildPalette("");palInput.focus();}
function closePalette(){palOverlay.classList.remove("open");palette.classList.remove("open");}
function palMove(d){
  palHi=clamp(palHi+d,0,palMatches.length-1); palMark();
  if(palMatches[palHi]) palMatches[palHi].scrollIntoView({block:"nearest"});
}
const palClear=document.getElementById("pal-clear");
palClear.innerHTML=ICON.x;
palClear.addEventListener("mousedown",(e)=>e.preventDefault());   // keep focus in the input
palClear.addEventListener("click",()=>{palInput.value="";palInput.dispatchEvent(new Event("input"));});
palInput.addEventListener("input",()=>{palClear.hidden=!palInput.value;palMatches=buildPalette(palInput.value);palHi=0;});
palInput.addEventListener("keydown",(e)=>{
  if(e.key==="ArrowDown"){e.preventDefault();palMove(1);}
  else if(e.key==="ArrowUp"){e.preventDefault();palMove(-1);}
  else if(e.key==="Enter"){e.preventDefault();if(palMatches[palHi])palMatches[palHi].click();}
  else if(e.key==="u"&&e.ctrlKey){e.preventDefault();palClear.click();}
  else if(e.key==="Tab"){e.preventDefault();setPalCat(PAL_CATS[(PAL_CATS.indexOf(palCat)+(e.shiftKey?-1:1)+PAL_CATS.length)%PAL_CATS.length]);}   // Tab / Shift+Tab cycle categories
  else if(e.key==="Escape") closePalette();
});
palOverlay.addEventListener("click",closePalette);

/* ════════════════════════════════════════════════
   KEYBOARD SHORTCUTS OVERLAY
   ════════════════════════════════════════════════ */
document.getElementById("sc-close").addEventListener("click",()=>scOverlay.classList.remove("open"));
document.getElementById("about-link").addEventListener("click",openShortcuts);
scOverlay.addEventListener("click",(e)=>{if(e.target===scOverlay)scOverlay.classList.remove("open");});
