// TermDeck frontend: global keyboard handler, the connection status line.
// One of the classic scripts in public/js/, loaded in order by index.html and sharing one global scope.
"use strict";

/* ════════════════════════════════════════════════
   GLOBAL KEYBOARD HANDLER
   ════════════════════════════════════════════════ */
document.addEventListener("keydown",(e)=>{
  const mod=e.metaKey||e.ctrlKey;
  // don't steal from xterm — except our ⌘⌥/Ctrl+Alt app combos, which must work while a terminal is focused
  if(e.target.closest(".xterm-helper-textarea, .xterm textarea")&&!(mod&&e.altKey))return;

  if(e.key==="?"&&!mod&&!e.shiftKey&&document.activeElement===document.body){
    scOverlay.classList.contains("open")?scOverlay.classList.remove("open"):openShortcuts(); return;
  }
  if(mod&&e.key==="k"){e.preventDefault(); palette.classList.contains("open")?closePalette():openPalette(); return;}
  // Alt/⌥+1–9 → Nth window of the active project. Plain Alt is left alone while typing (inputs, terminals: Alt+digit is
  // a readline/Meta key there); ⌘⌥/Ctrl+Alt+1–9 works everywhere. e.code, because mac Option rewrites e.key.
  if(e.altKey&&!e.shiftKey&&/^Digit[1-9]$/.test(e.code)&&(mod||!e.target.closest("input,textarea,select,[contenteditable]"))){
    const s=order.map((id)=>sessions.get(id)).filter((w)=>w&&w.project===activeProject)[+e.code.slice(5)-1];
    if(s){e.preventDefault(); revealWindow(s);} return;
  }
  // ⌘⌥/Ctrl+Alt combos below use e.code (not e.key): mac Alt rewrites e.key (⌥T→"†").
  // These moved off plain ⌘/Ctrl because the browser/OS hard-owns those (new-tab, omnibox, etc.).
  if(mod&&e.altKey&&!e.shiftKey&&e.code==="KeyT"){e.preventDefault(); createSession({cwd:curCwd()}); return;}       // new terminal (⌘T = browser new-tab)
  if(mod&&e.altKey&&e.code==="KeyL"){e.preventDefault(); createSession({cwd:curCwd()},true); return;}                // new log  (⌘L = browser omnibox)
  if(mod&&e.key==="f"){e.preventDefault(); openSessSearch(); return;}
  if(mod&&e.altKey&&e.code==="KeyB"){e.preventDefault(); setBroadcast(!broadcastOn); return;}                       // broadcast (⌘⇧B = bookmarks bar)
  if(mod&&!e.altKey&&e.key==="b"){e.preventDefault(); toggleSidebar(); return;}
  if(mod&&e.altKey&&e.shiftKey&&e.code==="KeyT"){e.preventDefault(); tileAll(); return;}                            // tile all (⌘⇧T = browser reopen-tab)
  if(mod&&e.altKey&&e.code==="KeyG"){e.preventDefault(); gameOv.classList.contains("open")?closeGame():openGame(); return;}  // play game (⌘G = browser find-next)
  if(mod&&e.altKey&&e.code==="KeyP"){e.preventDefault(); togglePets(); return;}                                       // toggle pixel pets (⌘⇧P = theme picker)
  if(mod&&e.altKey&&e.code==="KeyS"){e.preventDefault(); addSnippet(); return;}                                     // save snippet (⌘S = browser save-page)
  if(mod&&e.altKey&&e.code==="KeyO"){e.preventDefault(); openFilePrompt(); return;}                                 // open file (⌘O = browser open-file)
  if(mod&&e.altKey&&e.code==="KeyR"){e.preventDefault(); newAgentTask(); return;}                                   // new agent task (⌘R = reload)
  if(mod&&e.altKey&&e.code==="KeyD"){e.preventDefault(); openAgentDiff(); return;}                                  // review agent diff (⌘D = bookmark)
  if(mod&&e.shiftKey&&e.key==="O"){e.preventDefault(); folderBtn.click(); return;}
  if(mod&&e.shiftKey&&e.key==="P"){e.preventDefault(); themeBtn.click(); return;}
  if(mod&&e.shiftKey&&e.key==="M"){e.preventDefault(); addProject(); return;}
  if(mod&&e.altKey&&e.code==="KeyW"&&focusedId&&sessions.has(focusedId)){e.preventDefault(); requestCloseSession(sessions.get(focusedId)); return;}          // close window (⌘W = browser close-tab)
  if(mod&&e.altKey&&!e.shiftKey&&e.code==="KeyM"&&focusedId&&sessions.has(focusedId)){e.preventDefault(); minimize(sessions.get(focusedId)); return;}         // minimize (⌘M = macOS minimize)
  if(mod&&e.altKey&&e.shiftKey&&e.code==="KeyM"&&focusedId&&sessions.has(focusedId)){e.preventDefault(); toggleMax(sessions.get(focusedId)); return;}
  if(mod&&e.altKey&&!e.shiftKey&&e.code==="KeyA"&&focusedId&&sessions.has(focusedId)){e.preventDefault(); addTab(sessions.get(focusedId)); return;}           // new tab / Add (⌘⌥N is macOS Notification Center; ⌘T/⌘⇧N owned by browser)
  if(mod&&e.shiftKey&&(e.key==="}"||e.key==="{"||e.key==="]"||e.key==="[")){  // cycle projects (⇧ = shift of tab-cycle)
    e.preventDefault();
    if(projectOrder.length>1){
      const i=projectOrder.indexOf(activeProject);
      const fwd=e.key==="}"||e.key==="]";
      switchProject(projectOrder[(i+(fwd?1:-1)+projectOrder.length)%projectOrder.length]);
    }
    return;
  }
  if(mod&&(e.key==="]"||e.key==="[")){
    e.preventDefault();
    if(focusedId&&sessions.has(focusedId)){
      const s=sessions.get(focusedId);
      const idx=s.tabs.findIndex((t)=>t.id===s.activeTabId);
      const nxt=e.key==="]"?s.tabs[(idx+1)%s.tabs.length]:s.tabs[(idx-1+s.tabs.length)%s.tabs.length];
      if(nxt) switchTab(s,nxt.id);
    }
    return;
  }
  if(e.key==="Escape"){
    if(fileOverlay.classList.contains("open")){closeFileViewer();return;}
    if(findBar&&findBar.classList.contains("open")){closeFind();return;}
    if(themePop.classList.contains("open")){themePop.classList.remove("open");return;}
    if(movePop.classList.contains("open")){movePop.classList.remove("open");return;}
    if(cwdPop.classList.contains("open")){cwdPop.classList.remove("open");return;}
    if(agentPop&&agentPop.classList.contains("open")){agentPop.classList.remove("open");return;}
    if(ovOverlay.classList.contains("open")){closeOverview();return;}
    if(scOverlay.classList.contains("open")){scOverlay.classList.remove("open");return;}
    if(sessSearchOpen){closeSessSearch();return;}
  }
});

/* ════════════════════════════════════════════════
   HELPERS
   ════════════════════════════════════════════════ */
function updateConn(){
  syncTileBtn(); syncCastBtn();
  if(!LIVE){connEl.className="status demo";connText.textContent="demo mode \u2014 run server for live shells";return;}
  const arr=[...sessions.values()];
  const live=arr.filter((s)=>s.status==="live").length;
  const recon=arr.filter((s)=>s.status==="reconnecting").length;
  if(!arr.length){connEl.className="status";connText.textContent="connected \u00b7 no terminals";return;}
  connEl.className=recon&&!live?"status demo":"status live";
  connText.textContent=live+" live"+(recon?" \u00b7 "+recon+" recon":"")+" \u00b7 "+arr.length+" total";
}
