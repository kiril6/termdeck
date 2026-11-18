// TermDeck frontend: file viewer, session search, directory tree sidebar.
// One of the classic scripts in public/js/, loaded in order by index.html and sharing one global scope.
"use strict";

/* ════════════════════════════════════════════════
   FILE VIEWER  (click a file in the tree → peek its text)
   ════════════════════════════════════════════════ */
const DEMO_MD=`# TermDeck

A browser cockpit of **floating terminals**, each backed by a real PTY.

## Markdown viewer

Click any \`.md\` file in the tree, or press \u2318K \u2192 *Open file\u2026*.

- Headings, lists, **bold**, *italic*, \`inline code\`
- Tables, quotes and [links](https://github.com/kiril6/termdeck)

| Key | Action |
|-----|--------|
| \u2318K | Command palette |
| \u2318B | Directory tree |

> No dependencies \u2014 rendered by ~40 lines of inline JS.
`;
const fileOverlay=document.getElementById("file-overlay");
const fvName=document.getElementById("fv-name"),fvPath=document.getElementById("fv-path"),fvBody=document.getElementById("fv-body"),fvTog=document.getElementById("fv-tog");
function closeFileViewer(){fileOverlay.classList.remove("open");}
// Tiny markdown → HTML (headings, emphasis, code, lists, quotes, tables, links, rules). Input is
// HTML-escaped first, so nothing in the file can inject markup; links are limited to http(s)/mailto.
function mdToHtml(src){
  const esc=(t)=>t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");   // quotes too: link URLs land inside href="…"
  const inline=(t)=>esc(t).replace(/`([^`]+)`/g,"<code>$1</code>")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g,"$1")   // images can't load here → keep alt text (badges become plain links)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g,(m,x,u)=>'<a href="'+u+'" target="_blank" rel="noopener noreferrer">'+x+"</a>")
    .replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>").replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g,"$1<em>$2</em>").replace(/~~([^~]+)~~/g,"<del>$1</del>");
  const L=src.replace(/\r\n?/g,"\n").split("\n"); let h="", i=0;
  const cells=(l)=>l.replace(/^\s*\||\|\s*$/g,"").split("|").map((c)=>c.trim());
  while(i<L.length){
    const l=L[i]; let m;
    if((m=l.match(/^\s*(```|~~~)/))){const f=m[1],buf=[]; i++; while(i<L.length&&!L[i].trim().startsWith(f)) buf.push(L[i++]); i++; h+="<pre><code>"+esc(buf.join("\n"))+"</code></pre>"; continue;}
    if(!l.trim()){i++;continue;}
    if((m=l.match(/^(#{1,4})\s+(.*?)\s*#*$/))){h+="<h"+m[1].length+">"+inline(m[2])+"</h"+m[1].length+">";i++;continue;}
    if(/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)){h+="<hr>";i++;continue;}
    if(l.startsWith(">")){const buf=[]; while(i<L.length&&L[i].startsWith(">")) buf.push(L[i++].replace(/^>\s?/,"")); h+="<blockquote>"+mdToHtml(buf.join("\n"))+"</blockquote>"; continue;}
    if(l.includes("|")&&/^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(L[i+1]||"")){
      h+="<table><thead><tr>"+cells(l).map((c)=>"<th>"+inline(c)+"</th>").join("")+"</tr></thead><tbody>"; i+=2;
      while(i<L.length&&L[i].includes("|")&&L[i].trim()) h+="<tr>"+cells(L[i++]).map((c)=>"<td>"+inline(c)+"</td>").join("")+"</tr>";
      h+="</tbody></table>"; continue;
    }
    if((m=l.match(/^\s*([-*+]|\d+\.)\s+/))){
      const tag=/\d/.test(m[1])?"ol":"ul"; h+="<"+tag+">";
      while(i<L.length&&(m=L[i].match(/^\s*([-*+]|\d+\.)\s+(.*)/))){h+="<li>"+inline(m[2])+"</li>";i++;}
      h+="</"+tag+">"; continue;
    }
    const buf=[]; while(i<L.length&&L[i].trim()&&!/^\s*(```|~~~|#{1,4}\s|>|([-*+]|\d+\.)\s)/.test(L[i])) buf.push(L[i++]);
    if(!buf.length) buf.push(L[i++]);   // guard: a line no block rule claimed must still advance
    h+="<p>"+inline(buf.join(" "))+"</p>";
  }
  return h;
}
let fvText=null, fvRendered=false, fvLine=0, fvTable=false;   // fvText = source of the open markdown/CSV file (null → neither); fvTable → CSV
function fvShowMd(rendered){
  fvRendered=rendered; fvTog.textContent=rendered?"Raw":(fvTable?"Table":"Rendered");
  if(rendered&&fvTable) fvBody.replaceChildren(csvTable(fvText)), fvBody.className="fv-body csv";
  else if(rendered){fvBody.className="fv-body md"; fvBody.innerHTML=mdToHtml(fvText);}
  else fvRaw(fvText);
}
// CSV / TSV → table. Small RFC-4180 parser (quoted fields, "" escapes, newlines inside quotes); delimiter sniffed from
// the header line. Renders at most CSV_ROWS rows so a huge export can't freeze the tab.
const CSV_ROWS=5000;
function csvParse(t){
  const head=t.slice(0,t.search(/\r?\n|$/)), cnt=(c)=>head.split(c).length-1;
  const d=cnt("\t")>cnt(",")&&cnt("\t")>=cnt(";")?"\t":cnt(";")>cnt(",")?";":",";
  const rows=[]; let row=[],f="",q=false;
  for(let i=0;i<t.length;i++){
    const c=t[i];
    if(q){ if(c==='"'){ if(t[i+1]==='"'){f+='"';i++;} else q=false; } else f+=c; }
    else if(c==='"'&&!f) q=true;
    else if(c===d){row.push(f);f="";}
    else if(c==="\n"||c==="\r"){ if(c==="\r"&&t[i+1]==="\n")i++; row.push(f);f=""; rows.push(row);row=[]; if(rows.length>CSV_ROWS)return rows; }
    else f+=c;
  }
  if(f||row.length){row.push(f);rows.push(row);}
  return rows;
}
function csvTable(t){
  const rows=csvParse(t), box=el("div"), tb=el("table"); const cut=rows.length>CSV_ROWS; if(cut)rows.length=CSV_ROWS;
  rows.forEach((r,i)=>{const tr=el("tr"); r.forEach((v)=>{const c=el(i?"td":"th"); c.textContent=v; c.title=v; tr.append(c);}); tb.append(tr);});
  box.append(tb); if(cut){const n=el("div","fv-note"); n.textContent="Showing the first "+CSV_ROWS+" rows — use Raw for the rest."; box.append(n);}
  return box;
}
// Extensions the server's /api/raw serves (keep in sync with RAW_TYPES in server.js) → how to display them.
const FV_MEDIA={png:"img",jpg:"img",jpeg:"img",gif:"img",webp:"img",avif:"img",bmp:"img",ico:"img",svg:"img",pdf:"pdf",
  mp3:"audio",wav:"audio",ogg:"audio",m4a:"audio",flac:"audio",mp4:"video",webm:"video",mov:"video"};
// Message + the two ways out for a file the viewer can't show: reveal it, or open it in the OS default app.
// Routes that launch something on the host are POST-only (a GET can be triggered by any link or image).
const apiPost=(url,body)=>fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
function fvFallback(msg,full){
  fvBody.className="fv-body msg"; fvBody.textContent=msg;
  const acts=el("div","fv-acts");
  const mk=(label,url)=>{const b=el("button","fv-act"); b.type="button"; b.textContent=label;
    b.addEventListener("click",async()=>{const r=await apiPost(url,{path:full}).catch(()=>null);
      if(!r||!r.ok){const j=r?await r.json().catch(()=>({})):{}; toast(ICON.warn,label,j.error||"failed",3000);}}); return b;};
  acts.append(mk("Reveal in Finder / Explorer","/api/reveal"),mk("Open in default app","/api/open"));
  fvBody.append(acts);
}
function fvMedia(kind,full){
  const url="/api/raw?path="+encodeURIComponent(full);
  let m;
  if(kind==="img"){m=el("img","fv-img"); m.alt="";}
  else if(kind==="pdf"){m=el("iframe","fv-pdf"); m.title="PDF preview";}
  else{m=el(kind); m.controls=true; m.preload="metadata";}
  m.addEventListener("error",()=>fvFallback("Can’t preview this file in the browser.",full));
  m.src=url; fvBody.className="fv-body media"; fvBody.replaceChildren(m);
}
// Plain-text body; with fvLine set, that 1-based line is highlighted and scrolled into view.
function fvRaw(text){
  fvBody.className="fv-body";
  let a=0;
  for(let i=1;fvLine&&i<fvLine;i++){const n=text.indexOf("\n",a); if(n<0){a=-1;break;} a=n+1;}
  if(!fvLine||a<0){fvBody.textContent=text;return;}
  let b=text.indexOf("\n",a); if(b<0)b=text.length;
  const hl=el("span","fv-hl"); hl.textContent=text.slice(a,b)||" ";
  fvBody.replaceChildren(text.slice(0,a),hl,text.slice(Math.min(b+1,text.length)));
  hl.scrollIntoView({block:"center"});
}
fvTog.addEventListener("click",()=>fvShowMd(!fvRendered));
fileOverlay.addEventListener("mouseup",()=>setTimeout(positionSendBtn,0));
fileOverlay.addEventListener("keyup",(e)=>{if(e.shiftKey||e.key==="a")setTimeout(positionSendBtn,0);});
fileOverlay.addEventListener("mousedown",hideSendBtn);
fileOverlay.addEventListener("scroll",hideSendBtn,true);
sendBtn.addEventListener("mousedown",(e)=>e.preventDefault());   // keep the selection while clicking
sendBtn.addEventListener("click",()=>{
  const vs=sendSel; if(!vs)return;
  sendToAgent({text:vs.text,build:vs.build,prefProject:fvProject});
});

// text: optional preloaded content (demo mode has no backend to read from)
async function openFileViewer(full,name,text,line){
  closeModals("file"); fvLine=line||0; fvMode="file"; fvRoot=full; fvProject=activeProject; hideSendBtn();
  fvName.textContent=name; fvPath.textContent=full; fvText=null; fvTable=false; fvRendered=false; fvTog.hidden=true;
  fvBody.className="fv-body msg"; fvBody.textContent="Loading…";
  fileOverlay.classList.add("open");
  fileOverlay.focus();   // pull focus off any terminal textarea so Esc closes the viewer
  try{
    let j={text};
    const kind=LIVE&&text===undefined?FV_MEDIA[(name.split(".").pop()||"").toLowerCase()]:null;
    if(kind){fvMedia(kind,full);return;}
    if(text===undefined){
      const r=await fetch("/api/read?path="+encodeURIComponent(full));
      j=await r.json().catch(()=>({}));
      if(!r.ok){fvBody.textContent="⚠ "+(j.error||("HTTP "+r.status));return;}
      if(j.binary){fvFallback("Binary file — can’t preview.",full);return;}
    }
    const body=(j.text||"")+(j.truncated?"\n\n… truncated (file larger than 2 MB) …":"");
    if(/\.(md|markdown)$/i.test(name)){fvText=body; fvTog.hidden=false; fvShowMd(!fvLine);}   // a :line target shows the raw source
    else if(/\.(csv|tsv)$/i.test(name)&&!fvLine){fvText=j.text||""; fvTable=true; fvTog.hidden=false; fvShowMd(true);}
    else fvRaw(body);
  }catch(e){fvBody.textContent="⚠ "+e.message;}
}
// Palette → Open file…: path relative to the project root unless absolute/~.
async function openFilePrompt(){
  if(!LIVE){openFileViewer("~/termdeck/README.md","README.md",DEMO_MD);return;}
  const v=await inputModal("Open file",[{key:"p",label:"Path (relative to the project root, absolute, or ~/…) — text, .md, .csv, images, PDF, audio, video",placeholder:"README.md"}],"Open");
  if(!v||!v.p||!v.p.trim())return;
  const raw=v.p.trim(), full=/^([/~]|[A-Za-z]:)/.test(raw)?raw:joinPath(treeRootPath(),raw);
  openFileViewer(full,full.split(/[\\/]/).pop());
}
document.getElementById("fv-close").addEventListener("click",closeFileViewer);
fileOverlay.addEventListener("click",(e)=>{if(e.target===fileOverlay)closeFileViewer();});

/* ════════════════════════════════════════════════
   SESSION SEARCH
   ════════════════════════════════════════════════ */
function openSessSearch(){
  closeModals("sess");
  sessSearchOpen=true; sessSearch.classList.add("open"); ssInput.value=""; ssInput.focus(); filterSess("");
}
function closeSessSearch(){
  sessSearchOpen=false; sessSearch.classList.remove("open"); sessSearch.classList.remove("filtering");
  searchBtn.classList.remove("active");
  sessions.forEach((s)=>{s.chip.classList.remove("ss-hidden"); if(s.project===activeProject&&!s.minimized)s.win.classList.remove("ss-dim");});
  ssCount.textContent="";
}
function filterSess(q){
  q=q.toLowerCase(); let shown=0;
  sessions.forEach((s)=>{
    if(s.project!==activeProject)return;
    const match=!q||s.name.toLowerCase().includes(q)||(s.cwd||"").toLowerCase().includes(q)
      ||s.tabs.some((t)=>(t.name||"").toLowerCase().includes(q)||(t.cwd||"").toLowerCase().includes(q));
    s.chip.classList.toggle("ss-hidden",!match);
    if(!s.minimized) s.win.classList.toggle("ss-dim",!match);
    if(match) shown++;
  });
  const on=!!q;
  sessSearch.classList.toggle("filtering",on);   // accent the bar so an active filter is obvious
  searchBtn.classList.toggle("active",on);        // toolbar hint: filter is hiding terminals
  ssCount.textContent=on?(shown+" match"+(shown!==1?"es":"")):"";
  updateDockEdges(); updateProjEdges();
}
ssInput.addEventListener("input",()=>filterSess(ssInput.value));
// ✕ clears the filter first (keeps the bar open); a second click closes the bar.
document.getElementById("ss-close").addEventListener("click",()=>{
  if(ssInput.value){ssInput.value="";filterSess("");ssInput.focus();}
  else closeSessSearch();
});

/* ════════════════════════════════════════════════
   DIRECTORY TREE SIDEBAR
   ════════════════════════════════════════════════ */
function toggleSidebar(){sidebarOpen?closeSidebar():openSidebar();}
// the tree's width is a per-open tweak: drag the right edge to resize, it returns to the default on every open/close
const sbResize=document.getElementById("sb-resize");
function fadeCrumbs(){sbTitleEl.classList.toggle("clipped",sbTitleEl.scrollLeft>0);}
function resetSbWidth(){document.documentElement.style.removeProperty("--sbw"); document.body.classList.remove("sb-drag"); requestAnimationFrame(()=>{sbTitleEl.scrollLeft=sbTitleEl.scrollWidth;fadeCrumbs();});}
sbResize.addEventListener("pointerdown",e=>{
  e.preventDefault(); sbResize.setPointerCapture(e.pointerId); document.body.classList.add("sb-drag");
  const x0=e.clientX, w0=sidebar.offsetWidth;
  const move=ev=>{document.documentElement.style.setProperty("--sbw",Math.max(180,Math.min(640,Math.round(w0+ev.clientX-x0)))+"px"); sbTitleEl.scrollLeft=sbTitleEl.scrollWidth; fadeCrumbs();};
  const up=()=>{document.body.classList.remove("sb-drag"); sbResize.removeEventListener("pointermove",move); sbResize.removeEventListener("pointerup",up);};
  sbResize.addEventListener("pointermove",move); sbResize.addEventListener("pointerup",up);
});
sbResize.addEventListener("dblclick",resetSbWidth);
function openSidebar(){sidebarOpen=true;resetSbWidth();sidebar.classList.add("open");desktop.classList.add("sb-open");refreshTree();}
function closeSidebar(){sidebarOpen=false;resetSbWidth();sidebar.classList.remove("open");desktop.classList.remove("sb-open");}

let treeRoot=null; // breadcrumb override; null = follow project/focus
let showHidden=false; try{showHidden=localStorage.getItem(TREE_HIDDEN_STORE)==="1";}catch{}   // include dotfiles in the tree
const treeOpen=new Set();  // absolute paths of expanded folders — survives a refresh so state + new files both show
let treeLastRoot=null;
function treeRootPath(){
  if(treeRoot) return treeRoot;
  const proj=projects.get(activeProject);
  if(proj&&proj.root) return proj.root;
  const focused=focusedId&&sessions.has(focusedId)?sessions.get(focusedId):null;
  if(focused&&focused.project===activeProject&&focused.cwd) return focused.cwd; // never borrow another project's cwd
  return "~";
}
function renderCrumbs(root){
  sbTitleEl.innerHTML="";
  if(!LIVE||root==="~"||root.startsWith("~")){ // demo / home fallback: single crumb, no deep nav
    const c=el("span","crumb");c.textContent=root.replace(/^\/home\/[^/]+/,"~");sbTitleEl.append(c);return;
  }
  const parts=root.split("/").filter(Boolean); let acc="";
  parts.forEach((p,i)=>{
    acc+="/"+p; const path=acc, last=i===parts.length-1;
    if(i) sbTitleEl.append(Object.assign(el("span","crumb-sep"),{textContent:"/"}));
    const c=el(last?"span":"button","crumb");c.textContent=p;c.title=path;
    if(!last){c.type="button"; c.addEventListener("click",()=>{treeRoot=path;refreshTree();});}
    sbTitleEl.append(c);
  });
  sbTitleEl.title=root; // full path on hover, also over the clipped part
  sbTitleEl.scrollLeft=sbTitleEl.scrollWidth; // keep current folder in view
  fadeCrumbs();
}
// parent of the shown root, or null at the filesystem top / when "~" can't be resolved yet (demo mode)
function treeParent(){
  let r=treeRootPath(); if(r==="~") r=treeHome||""; r=r.replace(/[\\/]+$/,"");
  if(!LIVE||!/^([/\\]|[A-Za-z]:)/.test(r)||/^[A-Za-z]:$/.test(r)) return null;
  const i=Math.max(r.lastIndexOf("/"),r.lastIndexOf("\\"));
  return i<0?null:(r.slice(0,i)||"/");
}
function refreshTree(){
  if(!sidebarOpen)return;
  sbUpBtn.disabled=!treeParent();
  const root=treeRootPath();
  if(root!==treeLastRoot){treeOpen.clear();treeLastRoot=root;treeEl.innerHTML="";findClear();} // new root → forget prior expansions and show the loader
  if(followTerm&&LIVE) revealPrep();   // every render (open, project switch, ↻) re-applies the highlight
  renderCrumbs(root);
  if(LIVE) mountTree(treeEl,root);
  else     renderDemoTree(treeEl,root.replace(/^\/home\/[^/]+/,"~"));
}
// set the active project's tree root explicitly and persist it ("state the path specifically")
function setProjectRoot(path){
  const proj=projects.get(activeProject); if(!proj)return;
  proj.root=path; treeRoot=null; treeLastRoot=null; refreshTree(); scheduleSave();
  toast(ICON.pin,"Project root set",path,2200);
}

// \u2500\u2500 real filesystem tree (LIVE): reads /api/ls, lazy-expands dirs \u2500\u2500
function fIcon(name){const e=(name.split(".").pop()||"").toLowerCase();return({ts:"\ud83d\udcd8",js:"\ud83d\udcd9",json:"\ud83d\udcdd",md:"\ud83d\udcda",env:"\ud83d\udd10",sh:"\ud83d\udc1a",py:"\ud83d\udc0d",html:"\ud83c\udf10",css:"\ud83c\udfa8",svg:"\ud83d\uddbc"})[e]||"\ud83d\udcc4";}
function joinPath(dir,name){const sep=dir.includes("\\")&&!dir.includes("/")?"\\":"/";return dir.replace(/[\\/]+$/,"")+sep+name;}
async function apiLs(dir){
  const r=await fetch("/api/ls?dir="+encodeURIComponent(dir||"~")+(showHidden?"&all=1":""));
  const j=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(j.error||("HTTP "+r.status));
  return j;
}
function treeMsg(depth,txt){const d=el("div","tn");d.style.paddingLeft=(8+depth*14)+"px";d.style.color="var(--muted)";d.style.fontSize="10px";d.textContent=txt;return d;}
function treeEmpty(ic,msg,sub){const w=el("div","tree-empty");w.append(Object.assign(el("div","te-ic"),{innerHTML:ic}),Object.assign(el("div","te-msg"),{textContent:msg}));if(sub)w.append(Object.assign(el("div","te-sub"),{textContent:sub}));return w;}
async function fillNode(container,dir,depth){
  const top=depth===0; // root level gets a full-panel placeholder, not a lone 10px word
  if(!top||!container.firstChild){container.innerHTML=""; container.append(top?treeEmpty(ICON.hourglass,"Loading\u2026"):treeMsg(depth,"\u2026"));}   // a refresh keeps the old rows until the new ones arrive
  try{
    const d=await apiLs(dir); container.innerHTML="";
    if(top&&dir==="~"){const first=!treeHome; treeHome=d.dir; if(first&&followTerm) setTimeout(followTree,0);}   // lets follow-mode resolve the "~" root to an absolute path (and reveal once it is known)
    if(!d.entries.length){container.append(top?treeEmpty(ICON.folder,"Empty folder","Nothing here, or only hidden files."):treeMsg(depth,"empty")); return;}
    d.entries.forEach((en)=>container.append(treeNode(en,joinPath(d.dir,en.name),depth)));  // d.dir is absolute → real cwd for spawn/reveal
    markHere();
  }catch(e){ container.innerHTML=""; container.append(top?treeEmpty(ICON.warn,"Can\u2019t read folder",e.message):treeMsg(depth,"can\u2019t read: "+e.message)); }
}
function mountTree(container,dir){ fillNode(container,dir,0); }

// ── follow focused terminal: reveal its cwd in the tree (expand ancestors, highlight, scroll) — never re-roots ──
let followTerm=false, hereDir=null, treeHome=null, hereBlink=false;
try{followTerm=localStorage.getItem(TREE_FOLLOW_STORE)==="1";}catch{}
const followOpened=new Set();   // folders follow-mode expanded itself (not the user) — collapsed again when follow is turned off
function markHere(){
  treeEl.querySelectorAll(".tn.here").forEach((n)=>n.classList.remove("here"));
  if(!hereDir) return;
  const row=[...treeEl.querySelectorAll(".tn[data-path]")].find((n)=>n.dataset.path===hereDir);
  if(row){
    row.classList.add("here"); row.scrollIntoView({block:"center"});
    if(hereBlink){hereBlink=false; row.classList.add("blink"); row.addEventListener("animationend",()=>row.classList.remove("blink"),{once:true});}   // pulse once per focus change, not on every lazy fill
  }
}
// Work out where the focused shell is inside the shown root: expand its ancestors (tracked in followOpened),
// remember the row to highlight. Returns true when something new was expanded (tree needs a re-render).
let outsideRoot=null;   // set by revealPrep: the focused shell's cwd when it is known but outside the shown root
function revealPrep(){
  const s=focusedId&&sessions.has(focusedId)?sessions.get(focusedId):null;
  let root=treeRootPath(); if(root==="~") root=treeHome||root;
  root=root.replace(/[\\/]+$/,"");
  const t=s&&activeTab(s), live=t&&t.cwd||s&&s.cwd;   // tab.cwd is the shell's live dir; s.cwd is only the spawn dir
  const cwd=s&&s.project===activeProject&&live?live.replace(/[\\/]+$/,""):null;
  const rel=cwd&&/^([/\\]|[A-Za-z]:)/.test(root)&&cwd.startsWith(root)&&(cwd.length===root.length||/[\\/]/.test(cwd[root.length]))?cwd.slice(root.length):null;
  outsideRoot=rel===null&&cwd?cwd:null;
  if(rel===null){hereDir=null; return false;}      // unknown cwd / outside the shown root: leave the tree alone
  let acc=root, fresh=false;
  for(const seg of rel.split(/[\\/]/).filter(Boolean)){acc=joinPath(acc,seg); if(!treeOpen.has(acc)){treeOpen.add(acc);followOpened.add(acc);fresh=true;}}
  if(acc!==hereDir) hereBlink=true;
  hereDir=acc;
  if(!rel.replace(/[\\/]/g,"")){hereDir=null; hereBlink=false; treeEl.scrollTop=0;}   // terminal sits in the root itself: no row, so show the top
  return fresh;
}
function followTree(){
  if(!followTerm||!LIVE){if(treeRootPath()!==treeLastRoot) refreshTree(); return;}   // off: tree root follows the focused shell's project/cwd; re-render only if it changed
  const fresh=revealPrep();
  if(outsideRoot){   // focused shell is outside the shown root: try the project root, else re-root to its home / parent so its folder shows
    const cwd=outsideRoot; treeRoot=null; revealPrep();
    if(outsideRoot){const h=treeHome&&treeHome.replace(/[\\/]+$/,""); treeRoot=h&&cwd.startsWith(h+"/")?h:cwd.replace(/[\\/][^\\/]*$/,"")||"/";}
    refreshTree(); return;
  }
  if(fresh||treeEl.firstChild===null) refreshTree(); else markHere();   // markHere also runs after each lazy fill
}
function treeNode(en,full,depth){
  const wrap=el("div");
  const row=el("div","tn"+(en.dir?" dir-node":""));
  row.style.paddingLeft=(8+depth*14)+"px"; row.dataset.path=full;
  const reveal=()=>apiPost("/api/reveal",{path:full}).catch(()=>{});
  const openEditor=()=>apiPost("/api/open-editor",{path:full}).then(async(r)=>{
    if(!r.ok){const j=await r.json().catch(()=>({}));toast(ICON.warn,"Open in editor",j.error||"failed",3500);}
  }).catch(()=>toast(ICON.warn,"Open in editor","request failed",3500));
  const copyPath=()=>{try{navigator.clipboard.writeText(full);toast(ICON.copy,"Path copied",full,1600);}catch{}};
  if(en.dir){
    const car=el("span","tn-caret");car.innerHTML=ICON.caret;
    const ic=el("span","tn-icon");ic.textContent="\ud83d\udcc1";
    const nm=el("span","tn-name");nm.textContent=en.name;
    const add=el("button","tn-act");add.innerHTML=ICON.plus;add.title="New terminal here";
    row.append(car,ic,nm,add);
    const kids=el("div","tc"); let loaded=false;
    const setOpen=(o)=>{
      row.classList.toggle("open",o); ic.textContent=o?"\ud83d\udcc2":"\ud83d\udcc1"; kids.classList.toggle("open",o);
      if(o){treeOpen.add(full); if(!loaded){loaded=true; fillNode(kids,full,depth+1);}}
      else treeOpen.delete(full);
    };
    row.addEventListener("click",(e)=>{ if(e.target.closest(".tn-act"))return; setOpen(!row.classList.contains("open")); });
    add.addEventListener("click",(e)=>{e.stopPropagation(); createSession({cwd:full}); scheduleSave(); toast(ICON.plus,"New terminal",full,2000);});
    row.addEventListener("contextmenu",(e)=>{e.preventDefault();e.stopPropagation(); showCtxMenu(e.clientX,e.clientY,[
      {label:"New terminal here",run:()=>{createSession({cwd:full});scheduleSave();}},
      {label:"Open as new project",run:()=>{const proj=addProject(en.name); if(!proj)return; setCwd(full); createSession({cwd:full,project:proj.id}); scheduleSave();}},
      {label:"Set as project root",run:()=>setProjectRoot(full)},
      {sep:true},
      {label:"Copy path",run:copyPath},
      {label:"Open in editor",run:openEditor},
      {label:"Reveal in file manager",run:reveal},
    ]);});
    wrap.append(row,kids);
    if(treeOpen.has(full)) setOpen(true);   // restore expansion after a refresh (also picks up new files)
  }else{
    const ic=el("span","tn-icon");ic.textContent=fIcon(en.name);
    const nm=el("span","tn-name");nm.textContent=en.name;
    const rev=el("button","tn-act");rev.innerHTML=ICON.reveal;rev.title="Reveal in file manager";
    row.append(ic,nm,rev);
    row.addEventListener("click",()=>openFileViewer(full,en.name)); rev.addEventListener("click",(e)=>{e.stopPropagation();reveal();});
    row.addEventListener("contextmenu",(e)=>{e.preventDefault();e.stopPropagation(); showCtxMenu(e.clientX,e.clientY,[
      {label:"Open file",run:()=>openFileViewer(full,en.name)},
      {label:"Copy path",run:copyPath},
      {label:"Open in editor",run:openEditor},
      {label:"Reveal in file manager",run:reveal},
    ]);});
    wrap.append(row);
  }
  return wrap;
}

function renderDemoTree(container,root){
  // static demo tree for preview / when not live
  const demo=[
    {n:"src",type:"d",open:true,kids:[
      {n:"index.ts",type:"f"},{n:"server.ts",type:"f"},
      {n:"utils",type:"d",kids:[{n:"helpers.ts",type:"f"},{n:"logger.ts",type:"f"}]},
    ]},
    {n:"public",type:"d",kids:[{n:"index.html",type:"f"}]},
    {n:"package.json",type:"f"},{n:".env",type:"f"},{n:"README.md",type:"f"},
  ];
  function rNode(node,depth,parent){
    const row=el("div","tn"+(node.type==="d"?" dir-node":""));
    row.style.paddingLeft=(8+depth*14)+"px";
    if(node.type==="d"){
      const car=el("span","tn-caret");car.innerHTML=ICON.caret;if(node.open)row.classList.add("open");
      const ic=el("span","tn-icon");ic.textContent=node.open?"\ud83d\udcc2":"\ud83d\udcc1";
      const nm=el("span","tn-name");nm.textContent=node.n;
      row.append(car,ic,nm);parent.append(row);
      if(node.kids){
        const wrap=el("div","tc"+(node.open?" open":""));
        node.kids.forEach((k)=>rNode(k,depth+1,wrap));
        parent.append(wrap);
        row.addEventListener("click",()=>{node.open=!node.open;row.classList.toggle("open",node.open);ic.textContent=node.open?"\ud83d\udcc2":"\ud83d\udcc1";wrap.classList.toggle("open",node.open);});
      }
    } else {
      const ic=el("span","tn-icon");ic.textContent=fIcon(node.n);
      const nm=el("span","tn-name");nm.textContent=node.n;
      row.append(ic,nm);parent.append(row);
      row.addEventListener("click",()=>/\.md$/i.test(node.n)?openFileViewer("~/termdeck/"+node.n,node.n,DEMO_MD):toast(ICON.file,node.n,"Click to open in your editor",2000));
    }
  }
  const demoLabel=el("div","tn");demoLabel.style.paddingLeft="8px";demoLabel.style.color="var(--muted)";demoLabel.style.fontSize="10px";demoLabel.textContent=root+" (demo)";container.append(demoLabel);
  demo.forEach((n)=>rNode(n,0,container));
}

document.getElementById("sb-btn").addEventListener("click",toggleSidebar);
const sbCloseBtn=document.getElementById("sb-close-btn"); sbCloseBtn.innerHTML=ICON.collapse;
sbCloseBtn.addEventListener("click",closeSidebar);
const sbRefreshBtn=document.getElementById("sb-refresh-btn");
sbRefreshBtn.innerHTML=ICON.refresh;
sbRefreshBtn.addEventListener("animationend",()=>sbRefreshBtn.classList.remove("spin"));
sbRefreshBtn.addEventListener("click",()=>{
  sbRefreshBtn.classList.remove("spin"); void sbRefreshBtn.offsetWidth; sbRefreshBtn.classList.add("spin"); // restart the one-turn spin so every press gives feedback
  refreshTree();
}); // same root keeps treeOpen → expanded folders restore, new files appear
const sbUpBtn=document.getElementById("sb-up-btn"); sbUpBtn.innerHTML=ICON.arrowUp;
sbUpBtn.addEventListener("click",()=>{const p=treeParent(); if(p){treeRoot=p; refreshTree();}});
const sbMoreBtn=document.getElementById("sb-more-btn"); sbMoreBtn.innerHTML=ICON.more;
const syncMoreBtn=()=>sbMoreBtn.classList.toggle("flag",followTerm);   // accent dot: a toggle inside the menu is on
syncMoreBtn();
function toggleFollow(){
  followTerm=!followTerm; try{localStorage.setItem(TREE_FOLLOW_STORE,followTerm?"1":"0");}catch{} syncMoreBtn();
  if(!followTerm){hereDir=null;followOpened.forEach((d)=>treeOpen.delete(d));followOpened.clear();}
  if(followTerm) followTree(); else refreshTree();   // off: re-render so the folders follow opened collapse
}
function toggleHidden(){showHidden=!showHidden;try{localStorage.setItem(TREE_HIDDEN_STORE,showHidden?"1":"0");}catch{}refreshTree();}
sbMoreBtn.addEventListener("click",()=>{
  const r=sbMoreBtn.getBoundingClientRect(), blank='<svg viewBox="0 0 24 24" aria-hidden="true"></svg>';
  const it=[
    {icon:followTerm?ICON.check:blank,label:"Follow focused terminal",run:toggleFollow},
    {icon:showHidden?ICON.check:blank,label:"Show hidden files",run:toggleHidden},
  ];
  if(treeRoot) it.push({sep:true},
    {icon:blank,label:"Back to project root",run:()=>{treeRoot=null;refreshTree();}},
    {icon:blank,label:"Pin as project root",run:()=>setProjectRoot(treeRoot)});
  showCtxMenu(Math.min(r.left,innerWidth-230),r.bottom+4,it);
});

// ── find by name (#167): a filter box over the whole root, not just the expanded rows ──
// While a query is active a flat result list (relative path, name emphasised) replaces the tree; clearing restores it.
const tfInput=document.getElementById("tf-input"), treeResEl=document.getElementById("tree-results");
document.getElementById("tf-icon").innerHTML=ICON.search;
const DEMO_FIND=[["src",1],["src/index.ts"],["src/server.ts"],["src/utils",1],["src/utils/helpers.ts"],["src/utils/logger.ts"],["public",1],["public/index.html"],["package.json"],[".env"],["README.md"]];
let findSeq=0, findTimer=0, findCtl=null;
function findClear(blur){
  clearTimeout(findTimer); if(findCtl)findCtl.abort(); findSeq++;
  tfInput.value=""; treeResEl.hidden=true; treeResEl.innerHTML=""; treeEl.hidden=false;
  if(blur)tfInput.blur();
}
function findRow(r,base){
  const i=r.path.lastIndexOf("/"), name=r.path.slice(i+1), parent=i<0?"":r.path.slice(0,i);
  const row=el("div","tn"+(r.dir?" dir-node":"")); row.style.paddingLeft="8px"; row.title=r.path;
  const ic=el("span","tn-icon"); ic.textContent=r.dir?"📁":fIcon(name);
  const nm=el("span","tn-name"); nm.textContent=name; row.append(ic,nm);
  if(parent){const pe=el("span","tn-sub"); pe.textContent=parent; row.append(pe);}
  const full=base&&base!=="~"?joinPath(base,r.path):r.path;
  row.addEventListener("click",()=>{
    if(r.dir&&LIVE){findClear(); treeRoot=full; refreshTree();}   // a folder re-roots the tree there, like a breadcrumb click
    else if(!r.dir) LIVE?openFileViewer(full,name):(/\.md$/i.test(name)?openFileViewer("~/termdeck/"+name,name,DEMO_MD):toast(ICON.file,name,"Click to open in your editor",2000));
  });
  return row;
}
function findShow(results,truncated,base){
  treeEl.hidden=true; treeResEl.hidden=false; treeResEl.innerHTML="";
  if(!results.length){treeResEl.append(treeEmpty(ICON.search,"No matches","Names are matched case-insensitively; node_modules and .git are skipped.")); return;}
  results.forEach((r)=>treeResEl.append(findRow(r,base)));
  if(truncated) treeResEl.append(treeMsg(0,"Showing the first "+results.length+" matches — type more to narrow."));
}
async function findRun(q){
  const seq=++findSeq; if(findCtl)findCtl.abort();
  if(!LIVE){
    const lq=q.toLowerCase(); findShow(DEMO_FIND.filter(([p])=>(!p.startsWith(".")||showHidden)&&p.slice(p.lastIndexOf("/")+1).toLowerCase().includes(lq)).map(([path,d])=>({path,dir:!!d})),false,""); return;
  }
  findCtl=new AbortController();
  try{
    const r=await fetch("/api/find?dir="+encodeURIComponent(treeRootPath())+"&q="+encodeURIComponent(q)+(showHidden?"&all=1":""),{signal:findCtl.signal});
    const j=await r.json().catch(()=>({}));
    if(seq!==findSeq)return;
    if(!r.ok) throw new Error(j.error||("HTTP "+r.status));
    findShow(j.results,j.truncated,j.dir);
  }catch(e){
    if(e.name==="AbortError"||seq!==findSeq)return;
    treeEl.hidden=true; treeResEl.hidden=false; treeResEl.innerHTML=""; treeResEl.append(treeEmpty(ICON.warn,"Search failed",e.message));
  }
}
tfInput.addEventListener("input",()=>{
  clearTimeout(findTimer); const q=tfInput.value.trim();
  if(!q){findClear(); return;}
  findTimer=setTimeout(()=>findRun(q),200);
});
tfInput.addEventListener("keydown",(e)=>{
  if(e.key==="Escape"){e.preventDefault(); e.stopPropagation(); findClear(true);}
  else if(e.key==="Enter"){const first=treeResEl.querySelector(".tn"); if(first){e.preventDefault(); first.click();}}
});
// "/" jumps to the box unless focus is in a terminal or any text field
document.addEventListener("keydown",(e)=>{
  if(e.key!=="/"||e.metaKey||e.ctrlKey||e.altKey||!sidebarOpen) return;
  const a=document.activeElement;
  if(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)||a&&a.isContentEditable) return;   // typing somewhere (a terminal is a textarea)
  e.preventDefault(); tfInput.focus(); tfInput.select();
});
