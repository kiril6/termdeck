// TermDeck frontend: one WebSocket per tab, long-run tracking, the agent "waiting on you" watch, token usage.
// One of the classic scripts in public/js/, loaded in order by index.html and sharing one global scope.
"use strict";

/* ════════════════════════════════════════════════
   WS PER TAB
   ════════════════════════════════════════════════ */
const doneCooldown=new Map();
const PROMPT_END_RE=/[$#%>]\s*$/;
const TRAIL_ESC_RE=/(?:\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\))+$/;   // trailing CSI / OSC sequences
// ── long-run tracking: Enter starts a per-tab timer, done-heuristic clears it ──
// Ceiling: heuristic. Interactive programs (vim, less, REPL, ssh) look "running" forever;
// mitigated by nudging once per command and only for a tab you're not watching.
const NUDGE_MS=20000;                 // how long a command runs before we offer a game
const running=new Map();              // s.id+tab.id -> {start, timer, nudged}
function markRunning(s,tab){
  const k=s.id+tab.id, cur=running.get(k); if(cur)clearTimeout(cur.timer);
  running.set(k,{start:Date.now(),timer:setTimeout(()=>maybeNudge(s,tab),NUDGE_MS),nudged:false});
}
function clearRunning(s,tab){          // returns elapsed ms, or null if not tracked
  setBusy(s,tab,false);
  const k=s.id+tab.id, r=running.get(k); if(!r)return null;
  clearTimeout(r.timer); running.delete(k); return Date.now()-r.start;
}
// Shell "running" glyph (#28): a command is tracked (Enter → prompt) AND output is streaming. Quiet for
// BUSY_QUIET_MS (vim, ssh, idle dev server) → idle again; first BUSY_MIN_MS and keystroke echoes are
// ignored so `ls` and typing don't flicker. Heuristic, same ceiling as the long-run timer.
const BUSY_MIN_MS=1000, BUSY_QUIET_MS=3000, ECHO_MS=300;
function setBusy(s,tab,on){
  clearTimeout(tab.busyTimer);
  if(on) tab.busyTimer=setTimeout(()=>setBusy(s,tab,false),BUSY_QUIET_MS);
  if(!!tab.busy===on)return;
  tab.busy=on; updateAgentOverview();
}
function noteShellOutput(s,tab){
  const r=running.get(s.id+tab.id), now=Date.now();
  if(r&&now-r.start>BUSY_MIN_MS&&now-(tab.lastIn||0)>ECHO_MS) setBusy(s,tab,true);
}
function maybeNudge(s,tab){
  const r=running.get(s.id+tab.id); if(!r||r.nudged)return; r.nudged=true;
  if(gameOv.classList.contains("open"))return;   // already playing — no offer needed
  // Note: fire even while you're watching the tab — waiting on a slow command IS the moment to offer a game.
  toast(ICON.hourglass,"Still working…","\""+s.name+"\" running "+Math.round(NUDGE_MS/1000)+"s — play a game? "+kbd("⌘","⌥","G"),6000,
    ()=>{revealWindow(s);switchTab(s,tab.id);openGame();});   // toast() mirrors to an OS notification itself
}
function fmtDur(ms){const s=Math.round(ms/1000);return s<60?s+"s":s<3600?Math.floor(s/60)+"m"+String(s%60).padStart(2,"0")+"s":Math.floor(s/3600)+"h"+String(Math.floor(s%3600/60)).padStart(2,"0")+"m";}
// cwd badge text is ~-collapsed and CSS-truncated, so keep the full path in the hover title.
// Last command + detected port (#22). Deliberately conservative: a typed line is only recorded when it was typed
// plainly (no history recall / tab-complete / cursor keys), not in a full-screen app or agent, and not answering a
// password-style prompt. Better to show nothing than a wrong or secret command.
const ANSI_RE=/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const PORT_RE=/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{2,5})\b/;
const SECRET_PROMPT_RE=/(?:password|passphrase|token|secret|pin)[^\n]{0,40}:\s*$/i;
function trackInput(tab,d){
  if(d.includes("\x1b")||/[\x01-\x08\x0b-\x0c\x0e-\x1a]/.test(d)&&d!=="\x03"){tab.lineBad=true;return;}   // escape seq / other control key → line unreliable
  for(const ch of d){
    if(ch==="\r"||ch==="\n"){
      const cmd=tab.line.trim();
      if(cmd&&!tab.lineBad&&!tab.agent&&tab.term.buffer.active.type!=="alternate"&&!SECRET_PROMPT_RE.test(tab.outTail||"")) tab.lastCmd=cmd.slice(0,200);
      tab.line="";tab.lineBad=false;
    }else if(ch==="\x7f")tab.line=tab.line.slice(0,-1);
    else if(ch==="\x03"){tab.line="";tab.lineBad=false;}
    else if(ch>=" ")tab.line+=ch;
  }
}
const LOCAL_PAGE=/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
function updateCmdBadges(s){
  const t=activeTab(s); if(!t)return;
  s.badgeCmd.textContent=t.lastCmd?"$ "+t.lastCmd:""; s.badgeCmd.title=t.lastCmd?"Last command: "+t.lastCmd:"";
  s.badgePort.hidden=!t.port; s.badgePort.title=t.port?(LOCAL_PAGE?"Open localhost:"+t.port:"Port "+t.port+" on the termdeck host")+" · right-click for more":"";
  s.badgePort.style.cursor=LOCAL_PAGE?"":"default";
}
async function stopPort(id,port){
  try{
    const r=await fetch("/api/stop-port",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,port})});
    const j=await r.json().catch(()=>({}));
    if(r.ok) toast(ICON.check,"Stopping server","Sent SIGTERM to :"+port);
    else toast(ICON.warn,"Couldn't stop server",j.error||"HTTP "+r.status);
  }catch(e){toast(ICON.warn,"Couldn't stop server",String(e.message||e));}
}
function setCwdBadge(s,cwd){s.badgeCwd.textContent=tildePath(cwd); s.badgeCwd.title=cwd||"";}
// Collapse the home dir to ~ for the cwd badge (Linux /home/<user>, macOS /Users/<user>).
function tildePath(p){return (p||"~").replace(/^\/(?:home|Users)\/[^/]+/,"~");}

// ── Agent "waiting on you" watch (agent tabs only) ──────────────────────────
// An AI CLI streams output while working, then goes quiet when it wants input. So:
// output stops for AGENT_IDLE_MS on an unwatched agent tab → notify once. New output
// re-arms the timer and ends the waiting state (agent resumed). Only agent-tagged tabs
// are watched, so normal shells never trip it. Heuristic by design — the point is a
// glanceable "who needs me" queue, not perfect turn detection.
const AGENT_IDLE_MS=8000;
const EVT_STALE_MS=120000;   // tabs fed by hook events (#40): idle is only a safety net (e.g. Esc-interrupt fires no Stop hook)
const agentIdle=new Map();   // s.id+tab.id -> {timer, notified}
function armAgentIdle(s,tab,keepState){
  const k=s.id+tab.id, cur=agentIdle.get(k); if(cur)clearTimeout(cur.timer);
  if(!keepState&&tab.waiting&&!tab.approval) setWaiting(s,tab,false);   // fresh output = working again — but a pending approval stays flagged (repaint ≠ progress) until you look at it
  agentIdle.set(k,{notified:false,timer:setTimeout(()=>agentWaiting(s,tab),tab.evt?EVT_STALE_MS:AGENT_IDLE_MS)});
}
// Hook events (server → m.type "agent") are the source of truth for a tab once any arrive; the output
// heuristics (idle timer, APPROVAL_RE) then stand down for that tab. Receiving one also tags the tab as an agent.
function agentEvent(s,tab,ev){
  if(tab.exited||!ev||typeof ev!=="object")return;
  tab.agent=true;
  tab.evt=ev;
  if(tab.rtpl&&typeof ev.session==="string"&&/^[0-9a-f-]{36}$/i.test(ev.session)){   // the CLI's own session id (via hooks): resume exactly this one
    const r=tab.rtpl.replace("{id}",ev.session); if(r!==tab.resume){tab.resume=r; scheduleSave();}
  }
  recordUsage(s,tab,ev);
  armAgentIdle(s,tab,true);
  if(ev.type==="stop"||ev.type==="error") agentWaiting(s,tab);
  else if(ev.type==="permission_request"){
    // reqId = the hook is held open for a click (#44): the queue row offers Approve / Deny. No reqId = display-only.
    tab.ask=ev.reqId?{reqId:ev.reqId,text:[ev.tool,ev.files?.[0]||ev.detail].filter(Boolean).join(" "),cmd:ev.detail||"",risk:ev.risk||"",cwd:ev.cwd||"",canRule:ev.tool==="Bash"&&!ev.risk&&!!ev.cwd&&!!ev.detail}:null;
    agentApproval(s,tab);
  }
  else setWaiting(s,tab,false);   // prompt/tool activity = working (also clears a red approval once you answered)
  if(ev.type!=="permission_request") tab.ask=null;
  updateAgentOverview();
}
// ── Token usage (#85): what the agent itself reported, never estimated ────────────────────────────
// The hook helper reads it from the CLI's transcript on `stop` (Claude Code, Codex): `tokens` = new input +
// cache writes + output, `cache` = cache reads (shown separately — they dominate and are repeats). Each report
// is the CONVERSATION total, so a tab's entry is replaced, not added to. Kept per tab in localStorage so a
// reload keeps the totals (7-day prune); a project total is the sum of its tabs, closed ones included — they
// still cost money. Main conversation only: Claude sub-agent runs are not in that transcript. No $ — neither
// transcript carries one and termdeck ships no price table.
const USAGE_STORE="td.usage.v1", USAGE_TTL=7*864e5;
let usage=(()=>{try{const u=JSON.parse(localStorage.getItem(USAGE_STORE)||"{}"),now=Date.now(),t={};
  for(const k in (u.tabs||{})){const e=u.tabs[k]; if(e&&Number.isFinite(e.t)&&now-e.ts<USAGE_TTL) t[k]=e;} return {tabs:t};}catch{return {tabs:{}};}})();
function saveUsage(){try{localStorage.setItem(USAGE_STORE,JSON.stringify(usage));}catch{}}
const fmtTok=(n)=>n>=1e6?(n/1e6).toFixed(1)+"M":n>=1e3?(n/1e3).toFixed(n>=1e5?0:1)+"k":String(n);
function usageSum(pid){   // pid omitted = every existing project
  let t=0,c=0,n=0;
  for(const k in usage.tabs){const e=usage.tabs[k]; if(!projects.has(e.p)||(pid&&e.p!==pid))continue; t+=e.t; c+=e.c||0; n++;}
  return {tokens:t,cache:c,tabs:n};
}
const usageTip=(u)=>fmtTok(u.tokens)+" tokens (new input + cache writes + output)"+(u.cache?" · "+fmtTok(u.cache)+" cache reads":"")+" — as reported by the agent";
function recordUsage(s,tab,ev){
  if(!(ev.tokens>0))return;
  usage.tabs[s.id+"-"+tab.id]={t:ev.tokens,c:Number.isFinite(ev.cache)?ev.cache:0,ts:Date.now(),p:s.project};
  saveUsage(); updateUsageViews();
}
function updateUsageViews(){
  projects.forEach((p)=>{
    const nm=p.tab&&p.tab.querySelector(".pname"); if(!nm)return;
    const u=usageSum(p.id);
    nm.title="Double-click to rename"+(u.tokens?"\n"+u.tabs+" agent"+(u.tabs===1?"":"s")+" \u00b7 "+usageTip(u):"");
  });
  if(agentPop&&agentPop.classList.contains("open")) renderAgentList();
}
function resetUsage(){usage={tabs:{}};saveUsage();updateUsageViews();toast(ICON.bot,"Usage reset","Token totals cleared",2200);}
function evtSummary(tab){
  const e=tab.evt; if(!e)return "";
  const bits=[];
  if(e.type==="tool_start"||e.type==="permission_request"){
    bits.push([e.tool,e.files?.[0]?e.files[0].split(/[\\/]/).pop():e.detail].filter(Boolean).join(" "));
  }
  if(Number.isFinite(e.cost)) bits.push("$"+e.cost.toFixed(2));
  return bits.filter(Boolean).join(" · ").slice(0,80);
}
function stopAgentIdle(s,tab){const k=s.id+tab.id,cur=agentIdle.get(k);if(cur){clearTimeout(cur.timer);agentIdle.delete(k);}}
function agentWaiting(s,tab){
  const cur=agentIdle.get(s.id+tab.id); if(!cur||cur.notified)return;
  if(tab.exited||tab.status!=="live")return;
  cur.notified=true;
  const watching=focusedId===s.id&&s.activeTabId===tab.id&&!s.minimized&&s.project===activeProject&&document.hasFocus();
  setWaiting(s,tab,true,tab.approval);   // dock/tab pulse marks the queue even while you watch; preserve a red approval flag, never downgrade it
  if(watching)return;              // looking right at it → the pulse is enough, skip the toast
  toast(ICON.bot,"Waiting on you","\""+s.name+"\" is waiting for input",6000,()=>{revealWindow(s);switchTab(s,tab.id);});
}
// #3 approval-prompt routing: a tool-approval prompt blocks ALL progress, so it fires a
// louder, STICKY toast (ms=0) distinct from the plain idle "waiting", and flags the tab/chip
// red at once — no 8s wait. Cheap per-chunk regex across CLIs. NEVER auto-answers: surface + jump only.
const REPLAY_SCAN=2000;   // bytes of a replayed buffer treated as "current screen"
const APPROVAL_RE=/allow this (tool|command|action|edit)|do you want to (proceed|allow|continue|run|make this|create|edit)|approve this|grant (access|permission)|\b(y\s*\/\s*n|yes\s*\/\s*no|\[y\/n\])\b|press\s+y\s+to|❯\s*1\.?\s*yes/i;
function agentApproval(s,tab){
  if(tab.approval||tab.exited||tab.status!=="live")return;   // fire only on the transition into "blocked" — repaints of the prompt are ignored
  setWaiting(s,tab,true,true);
  const watching=focusedId===s.id&&s.activeTabId===tab.id&&!s.minimized&&s.project===activeProject&&document.hasFocus();
  if(watching)return;
  toast('<span class="t-appr">'+ICON.bot+"</span>","Needs approval","\""+s.name+"\" is blocked on a permission prompt",0,()=>{revealWindow(s);switchTab(s,tab.id);});
}
function setWaiting(s,tab,on,approval){
  const ap=on&&!!approval;
  if(tab.waiting===on&&!!tab.approval===ap)return;
  tab.waiting=on; tab.approval=ap;
  tab.wt.classList.toggle("waiting",on);
  tab.wt.classList.toggle("approval",ap);
  s.chip.classList.toggle("waiting",s.tabs.some((t)=>t.waiting));   // chip lit while ANY tab waits
  s.chip.classList.toggle("approval",s.tabs.some((t)=>t.approval)); // red chip while ANY tab is blocked on approval
  updateProjectAttention(s.project);
  updateAgentOverview();
}
