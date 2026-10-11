// TermDeck frontend: the first-run tour.
// One of the classic scripts in public/js/, loaded in order by index.html and sharing one global scope.
"use strict";

/* ════════════════════════════════════════════════
   FIRST-RUN TOUR — spotlight + card, no deps, no network. Auto-shows once; replay: palette / Help.
   ════════════════════════════════════════════════ */
const TOUR_KEY="td.tourDone.v1";
const TOUR_STEPS=[
  {sel:"#pal-btn",title:"Command palette",body:"Press "+kbd("⌘","K")+" for everything: new terminals, agent tasks, themes, snippets, sessions. Tab switches categories."},
  {sel:null,title:"One worktree per agent",body:"Palette → New agent task cuts a git worktree for a branch and launches an agent in it, isolated from your other agents."},
  {sel:"#agent-btn",title:"Sessions",body:"Every agent across all projects in one queue: see which is working, waiting or blocked, and jump straight to it. Switch to Grid for a live view of every session."},
  {sel:"#projects",title:"Projects & dock",body:"Group shells into projects with these tabs. Minimized windows wait in the dock at the bottom."},
  {sel:"#sb-more-btn",tree:true,title:"Directory tree",body:"Open it with "+kbd("⌘","B")+". The ⋯ menu holds Follow focused terminal (the tree reveals the focused window's live folder), Show hidden files, Back to project root and Pin as project root. ↑ goes up a level; drag the tree's right edge to resize."},
  {sel:"#sc-btn",title:"Help",body:"All shortcuts live here. Replay this tour any time from the palette (Take the tour)."},
];
let tourEl=null;
function takeTour(){
  if(tourEl) return;
  closeModals("tour");
  const prev=document.activeElement;
  let i=0;
  const root=el("div","tour"); root.append(el("div","tour-spot"));
  const card=el("div","tour-card"); card.setAttribute("role","dialog"); card.setAttribute("aria-modal","true");
  card.setAttribute("aria-labelledby","tour-t"); card.setAttribute("aria-describedby","tour-b");
  root.append(card); document.body.append(root); tourEl=root;
  const spot=root.firstChild;
  const close=()=>{
    try{localStorage.setItem(TOUR_KEY,"1");}catch{}
    document.removeEventListener("keydown",onKey,true); window.removeEventListener("resize",place);
    if(treeByTour) closeSidebar();
    root.remove(); tourEl=null; if(prev&&prev.focus) prev.focus();
  };
  let treeByTour=false;   // the tree step opens the sidebar; put it back when the tour leaves that step
  const go=(d)=>{ if(i+d>=TOUR_STEPS.length) return close(); i=Math.max(0,i+d); render(); };
  function place(){
    const st=TOUR_STEPS[i], t=st.sel&&document.querySelector(st.sel), r=t&&t.getBoundingClientRect();
    const has=!!(r&&r.width&&r.height);
    root.classList.toggle("nospot",!has);
    const vw=innerWidth, vh=innerHeight, cw=card.offsetWidth, ch=card.offsetHeight;
    if(has){
      const pad=6; Object.assign(spot.style,{left:r.left-pad+"px",top:r.top-pad+"px",width:r.width+2*pad+"px",height:r.height+2*pad+"px"});
      const below=r.bottom+pad+12+ch<=vh;
      card.style.top=Math.max(12,below?r.bottom+pad+12:r.top-pad-12-ch)+"px";
      card.style.left=clamp(r.left,12,Math.max(12,vw-cw-12))+"px";
    }else{ card.style.top=Math.max(12,(vh-ch)/2)+"px"; card.style.left=Math.max(12,(vw-cw)/2)+"px"; }
  }
  function render(){
    const st=TOUR_STEPS[i], last=i===TOUR_STEPS.length-1;
    if(st.tree&&!sidebarOpen){openSidebar(); treeByTour=true; setTimeout(place,260);}   // re-place once the slide-in settles
    else if(!st.tree&&treeByTour){closeSidebar(); treeByTour=false;}
    card.innerHTML='<div class="tour-n">'+(i+1)+' / '+TOUR_STEPS.length+'</div><h3 id="tour-t"></h3><p id="tour-b"></p>'+
      '<div class="tour-foot"><button class="tour-skip" type="button">Skip tour</button>'+
      '<button class="btn" type="button" data-back'+(i?"":" hidden")+'>Back</button>'+
      '<button class="btn primary" type="button" data-next>'+(last?"Done":"Next")+'</button></div>';
    card.querySelector("#tour-t").textContent=st.title; card.querySelector("#tour-b").textContent=st.body;
    card.querySelector(".tour-skip").onclick=close;
    card.querySelector("[data-back]").onclick=()=>go(-1);
    const nx=card.querySelector("[data-next]"); nx.onclick=()=>go(1); nx.focus();
    place();
  }
  function onKey(e){
    if(e.key==="Escape"){e.preventDefault();e.stopPropagation();close();return;}
    if(e.key==="ArrowRight"){e.preventDefault();e.stopPropagation();go(1);return;}
    if(e.key==="ArrowLeft"){e.preventDefault();e.stopPropagation();go(-1);return;}
    if(e.key==="Tab"){   // keep focus inside the card
      const b=[...card.querySelectorAll("button:not([hidden])")], k=b.indexOf(document.activeElement);
      e.preventDefault(); b[(k+(e.shiftKey?-1:1)+b.length)%b.length].focus(); return;
    }
    if(e.key!=="Enter"&&e.key!==" ") e.stopPropagation();   // swallow app shortcuts behind the overlay
  }
  document.addEventListener("keydown",onKey,true); window.addEventListener("resize",place);
  render();
}
for(const id of ["hint-tour","tour-link"]){
  const a=document.getElementById(id);
  a.addEventListener("click",()=>{scOverlay.classList.remove("open");takeTour();});
  a.addEventListener("keydown",(e)=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();a.click();}});
}
// First visit only; skipped on narrow/touch screens where the anchors don't fit (replay still works).
setTimeout(()=>{
  let done=false; try{done=localStorage.getItem(TOUR_KEY)==="1";}catch{}
  if(!done&&innerWidth>=720&&!matchMedia("(pointer:coarse)").matches&&!document.querySelector(".palette.open,.sc-overlay.open")) takeTour();
},1200);
