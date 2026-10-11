// TermDeck frontend: mini-games: dino runner and snake.
// One of the classic scripts in public/js/, loaded in order by index.html and sharing one global scope.
"use strict";

/* ═══ mini-games: dino runner + snake ═══
   Launched from the palette (or ⌘⌥G) while a command runs. Header dropdowns pick the
   game (🦖/🐍) and the watch scope (tab / window / project). Arms on the focused
   terminal; when a matching shell's done-heuristic fires, gameOnTermDone() shows an
   in-game banner naming it. Game never auto-closes — the user decides.
   Games share the driver (loop/reset/draw/keys); each is a module in GAMES. */
let gameWatch=null;               // {scope,sid,tid,proj} — what this game watches
const gameOv=document.getElementById("game-overlay");
const gameCv=document.getElementById("game-canvas");
const gameBn=document.getElementById("game-banner");
const gameScope=document.getElementById("game-scope");
// scope: "term"=one tab, "win"=any tab in that window, "proj"=any live shell in that project
function gameMatches(s,tab){
  if(!gameWatch)return false;
  if(gameWatch.scope==="proj")return s.project===gameWatch.proj;
  if(gameWatch.scope==="win") return s.id===gameWatch.sid;
  return s.id===gameWatch.sid&&tab.id===gameWatch.tid;
}
const gctx=gameCv.getContext("2d");
gameOv.addEventListener("contextmenu",(e)=>e.preventDefault());   // no native right-click menu over the game
const gamePick=document.getElementById("game-pick");
const gameHint=document.getElementById("game-hint");
const CW=600, CH=180;
let gameRAF=null, gState=null, gCur=null;   // gCur = current game module
function gColors(){const cs=getComputedStyle(document.documentElement);return{
  fg:cs.getPropertyValue("--text").trim()||"#e6e6e6",
  mut:cs.getPropertyValue("--muted").trim()||"#888",
  bg:cs.getPropertyValue("--bg").trim()||"#0c0c0c",   // halo colour so canvas text reads in light or dark themes
  acc:cs.getPropertyValue("--live").trim()||"#4fd6be"};}
function gOverText(msg,c){gctx.save();gctx.font="bold 14px monospace";gctx.textAlign="center";gctx.textBaseline="middle";
  const x=CW/2,y=CH/2;
  gctx.lineJoin="round";gctx.lineWidth=5;gctx.strokeStyle=c.bg;
  gctx.shadowColor=c.bg;gctx.shadowBlur=8;gctx.strokeText(msg,x,y);
  gctx.shadowBlur=0;gctx.fillStyle=c.fg;gctx.fillText(msg,x,y);gctx.restore();}

/* ── dino runner ── */
const DINO={
  hint:"Space / ↑ / click to jump · P pause · Esc close",
  reset(){const g=150;gState={ground:g,dino:{y:g-22,vy:0},obs:[],score:0,speed:5,spawn:0,over:false,paused:false};},
  tap(){const g=gState;if(g.over){gReset();return;}if(g.dino.y>=g.ground-22-0.5)g.dino.vy=-11;},
  key(e){if(e.key===" "||e.key==="ArrowUp"){e.preventDefault();DINO.tap();}},
  step(){const g=gState;g.score++;g.speed=5+g.score/900;
    const d=g.dino;d.vy+=0.7;d.y+=d.vy;if(d.y>g.ground-22){d.y=g.ground-22;d.vy=0;}
    if(--g.spawn<=0){g.obs.push({x:CW,w:12+Math.floor(g.score%3)*6,h:18+Math.floor(g.score%2)*10});g.spawn=Math.max(45,90-g.score/40);}
    for(const o of g.obs)o.x-=g.speed;
    g.obs=g.obs.filter(o=>o.x+o.w>0);
    for(const o of g.obs)if(40<o.x+o.w&&60>o.x&&d.y+22>g.ground-o.h){g.over=true;break;}},
  draw(c){const g=gState;
    gctx.strokeStyle=c.mut;gctx.beginPath();gctx.moveTo(0,g.ground);gctx.lineTo(CW,g.ground);gctx.stroke();
    gctx.fillStyle=c.acc;gctx.fillRect(40,g.dino.y,20,22);
    gctx.fillStyle=c.fg;for(const o of g.obs)gctx.fillRect(o.x,g.ground-o.h,o.w,o.h);
    gScoreBadge(Math.floor(g.score/10),c);
    if(g.over)gOverText("Game over — Space to restart",c);}
};

/* ── snake ── */
const SNK=16, COLS=Math.floor(CW/SNK), ROWS=Math.floor(CH/SNK);
const SNAKE={
  hint:"Arrows / WASD to steer · P pause · Esc close",
  reset(){gSeed=(Date.now()&0x7fffffff)||1;   // vary food each game
    gState={body:[{x:5,y:5},{x:4,y:5},{x:3,y:5}],dir:{x:1,y:0},next:{x:1,y:0},
    food:{x:12,y:5},score:0,tick:0,every:7,over:false,paused:false};},
  tap(){if(gState.over)gReset();},   // click/Space = restart only (no self-collision from a jump)
  key(e){const d=gState.dir,n=({ArrowUp:{x:0,y:-1},w:{x:0,y:-1},ArrowDown:{x:0,y:1},s:{x:0,y:1},
      ArrowLeft:{x:-1,y:0},a:{x:-1,y:0},ArrowRight:{x:1,y:0},d:{x:1,y:0}})[e.key];
    if(n){e.preventDefault();if(n.x!==-d.x||n.y!==-d.y)gState.next=n;}   // no 180° reverse
    else if(e.key===" "&&gState.over)gReset();},
  step(){const g=gState;if(++g.tick<g.every)return;g.tick=0;
    g.dir=g.next;
    const h={x:g.body[0].x+g.dir.x,y:g.body[0].y+g.dir.y};
    if(h.x<0||h.y<0||h.x>=COLS||h.y>=ROWS||g.body.some(b=>b.x===h.x&&b.y===h.y)){g.over=true;return;}
    g.body.unshift(h);
    if(h.x===g.food.x&&h.y===g.food.y){g.score++;g.every=Math.max(3,7-Math.floor(g.score/5));gSpawnFood();}
    else g.body.pop();},
  draw(c){const g=gState;
    gctx.fillStyle=c.fg;gctx.fillRect(g.food.x*SNK+2,g.food.y*SNK+2,SNK-4,SNK-4);
    gctx.fillStyle=c.acc;for(const b of g.body)gctx.fillRect(b.x*SNK+1,b.y*SNK+1,SNK-2,SNK-2);
    gScoreBadge(g.score,c);
    if(g.over)gOverText("Game over — Space to restart",c);}
};
function gSpawnFood(){const g=gState;let f;do{f={x:Math.floor(gRand()*COLS),y:Math.floor(gRand()*ROWS)};}
  while(g.body.some(b=>b.x===f.x&&b.y===f.y));g.food=f;}
let gSeed=1;function gRand(){gSeed=(gSeed*1103515245+12345)&0x7fffffff;return gSeed/0x7fffffff;}  // no Math.random dep needed
function gScoreBadge(n,c){gctx.save();gctx.font="11px monospace";gctx.textAlign="right";
  gctx.lineJoin="round";gctx.lineWidth=3;gctx.strokeStyle=c.bg;gctx.strokeText("score "+n,CW-10,18);
  gctx.fillStyle=c.fg;gctx.fillText("score "+n,CW-10,18);gctx.restore();}

const GAMES={dino:DINO,snake:SNAKE};
function gReset(){gCur.reset();gameBn.classList.remove("show");gDraw();}
function gDraw(){gctx.clearRect(0,0,CW,CH);const c=gColors();gCur.draw(c);
  if(gState.paused)gOverText("paused — P to resume",c);}
function gStep(){if(!gState.over&&!gState.paused)gCur.step();gDraw();}
function gLoop(){gStep();gameRAF=requestAnimationFrame(gLoop);}
function gKey(e){
  if(e.target===gameScope||e.target===gamePick)return;   // dropdowns handle their own keys
  if(e.key==="Escape"){closeGame();return;}
  if((e.key==="p"||e.key==="P")&&!gState.over){gState.paused=!gState.paused;gDraw();return;}
  gCur.key(e);
}
function gSelect(kind){gCur=GAMES[kind]||DINO;gamePick.value=kind;gameHint.textContent=gCur.hint;gReset();}
function gameArm(){                  // build gameWatch from focused terminal + chosen scope
  const s=focusedId&&sessions.get(focusedId);
  const t=s&&activeTab(s);
  gameWatch = (s&&t) ? {scope:gameScope.value,sid:s.id,tid:t.id,proj:s.project} : null;
}
let gameElapsedTick=null;
function gameUpdElapsed(){            // show elapsed of the watched command (single-tab scope only)
  const el=document.getElementById("game-elapsed");
  const r=gameWatch&&gameWatch.scope==="term"&&running.get(gameWatch.sid+gameWatch.tid);
  el.textContent = r ? ("⏱ "+fmtDur(Date.now()-r.start)) : "";
}
function openGame(){
  closeModals("game");
  gameArm();
  gSelect(gamePick.value); gameOv.classList.add("open");
  document.addEventListener("keydown",gKey);
  gameCv.onpointerdown=(e)=>{e.preventDefault();gCur.tap();gDraw();gameCv.focus();};  // press, not release — matches Space latency
  // blur the <select> after choosing so arrow keys steer the game, not the dropdown
  gameScope.onchange=()=>{gameArm();gameCv.focus();};
  gamePick.onchange=()=>{gSelect(gamePick.value);gameCv.focus();};
  gameUpdElapsed(); gameElapsedTick=setInterval(gameUpdElapsed,1000);
  gameCv.focus();                     // keys reach the game, not a stray control
  if(!gameRAF)gLoop();
}
function closeGame(){
  gameOv.classList.remove("open");
  gameWatch=null;
  document.removeEventListener("keydown",gKey);
  if(gameRAF){cancelAnimationFrame(gameRAF);gameRAF=null;}
  if(gameElapsedTick){clearInterval(gameElapsedTick);gameElapsedTick=null;}
}
function gameOnTermDone(name,durMs){
  const took=durMs!=null?" in "+fmtDur(durMs):"";
  gameBn.textContent="✅ “"+name+"” finished"+took+" — Esc to close, or keep playing";
  gameBn.classList.add("show");
  gameUpdElapsed();   // clear the ticking elapsed now the command ended
  osNotify("✅","Terminal finished","“"+name+"”"+took+" — back to the game to close it");
}
document.getElementById("game-close").onclick=closeGame;
