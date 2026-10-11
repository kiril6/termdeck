// TermDeck frontend: keyboard focus inside every modal dialog.
// One of the classic scripts in public/js/, loaded in order by index.html and sharing one global scope.
"use strict";

/* ════════════════════════════════════════════════
   DIALOGS — keyboard focus for every [aria-modal="true"] element
   Opening one moves focus into it, Tab / Shift+Tab cycle inside the topmost one, and closing it gives focus back to
   where it was. The static overlays toggle .open; the built-on-demand ones (confirm, prompt, layouts, tour) are
   appended to / removed from <body>. One observer covers both, so no open/close function has to remember.
   ════════════════════════════════════════════════ */
const FOCUSABLE='button:not([disabled]),a[href],summary,input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const shown=(n)=>!!n&&n.isConnected&&n.getClientRects().length>0;
const focusables=(m)=>[...m.querySelectorAll(FOCUSABLE)].filter(shown);
const modalReturn=new Map();   // open dialog → where focus goes back to when it closes
// The last element focused outside every dialog. Tracked as it happens, because a dialog often focuses its own input
// before the observer below runs (the palette does); it also makes dialog → dialog return to where the first came from.
let focusOutside=null;
document.addEventListener("focusin",(e)=>{if(!e.target.closest('[aria-modal="true"]')) focusOutside=e.target;},true);
function asDialog(node,label){node.setAttribute("role","dialog");node.setAttribute("aria-modal","true");node.setAttribute("aria-label",label);return node;}
function dialogOpened(m){
  modalReturn.set(m,focusOutside);
  setTimeout(()=>{
    if(!shown(m)||m.contains(document.activeElement)) return;   // it focused something of its own
    const f=focusables(m)[0]; if(f) f.focus(); else{m.tabIndex=-1; m.focus();}
  },0);
}
function dialogClosed(m){
  const back=modalReturn.get(m);
  // Deferred twice, so whatever the closing action focuses first wins (a command's new terminal, via focusTermSoon);
  // focus only goes back when it was lost — on <body>, or still inside the closed dialog.
  setTimeout(()=>setTimeout(()=>{
    if(modalReturn.get(m)!==back||shown(m)) return;   // reopened meanwhile
    modalReturn.delete(m);
    const ae=document.activeElement;
    if(shown(back)&&(!ae||ae===document.body||m.contains(ae))) back.focus();
  },0),0);
}
const modalOf=(n)=>n.nodeType!==1?null:n.matches('[aria-modal="true"]')?n:n.querySelector('[aria-modal="true"]');
const modalObs=new MutationObserver((recs)=>{
  for(const r of recs){
    if(r.type==="attributes"){const m=r.target, open=shown(m); if(open&&!modalReturn.has(m)) dialogOpened(m); else if(!open&&modalReturn.has(m)) dialogClosed(m); continue;}
    r.addedNodes.forEach((n)=>{const m=modalOf(n); if(m&&shown(m)) dialogOpened(m);});
    r.removedNodes.forEach((n)=>{const m=modalOf(n); if(m&&modalReturn.has(m)) dialogClosed(m);});
  }
});
document.querySelectorAll('[aria-modal="true"]').forEach((m)=>modalObs.observe(m,{attributes:true,attributeFilter:["class"]}));
modalObs.observe(document.body,{childList:true});
document.addEventListener("keydown",(e)=>{
  if(e.key!=="Tab"||e.defaultPrevented) return;   // the palette (categories) and the tour handle Tab themselves
  const m=[...modalReturn.keys()].filter(shown).pop(); if(!m) return;
  // Always moved by hand: browsers differ on what Tab reaches (WebKit skips links), and focus must never leave the dialog.
  e.preventDefault();
  const f=focusables(m), i=f.indexOf(document.activeElement), n=f.length;
  if(n) f[i<0?(e.shiftKey?n-1:0):(i+(e.shiftKey?-1:1)+n)%n].focus();
});
