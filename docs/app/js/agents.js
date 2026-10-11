// TermDeck frontend: the agent overview: who-needs-me queue, approvals, allow-rules.
// One of the classic scripts in public/js/, loaded in order by index.html and sharing one global scope.
"use strict";

/* ════════════════════════════════════════════════
   AGENT OVERVIEW (who-needs-me queue)
   ════════════════════════════════════════════════ */
function getAgentQueue(){
  const list=[];
  sessions.forEach((s)=>{
    const proj=projects.get(s.project);
    const pName=proj?.name||s.project||"project";
    s.tabs.forEach((tab)=>{
      if(!tab.agent||tab.exited||tab.closedByUser) return;
      let state="working", rank=3;
      if(tab.approval){ state="approval"; rank=1; }
      else if(tab.waiting){ state="waiting"; rank=2; }
      list.push({s,tab,pName,state,rank});
    });
  });
  list.sort((a,b)=>{
    if(a.rank!==b.rank) return a.rank-b.rank;
    const pa=a.pName.localeCompare(b.pName); if(pa!==0) return pa;
    const sa=(a.s.name||"").localeCompare(b.s.name||""); if(sa!==0) return sa;
    return (a.tab.name||"").localeCompare(b.tab.name||"");
  });
  return list;
}

function renderAgentList(queue){
  if(!agentList) return;
  if(!queue) queue=getAgentQueue();
  const ut=usageSum();
  if(agentPopCount){agentPopCount.textContent=queue.length+" active"+(ut.tokens?" \u00b7 "+fmtTok(ut.tokens)+" tok":""); agentPopCount.title=ut.tokens?ut.tabs+" agent"+(ut.tabs===1?"":"s")+" \u00b7 "+usageTip(ut):"";}
  agentList.innerHTML="";
  if(!queue.length){
    const emp=el("div","agent-empty");
    const t1=el("span"); t1.textContent="No active agents";
    const t2=el("span","agent-empty-sub"); t2.textContent="Agents you start show up here";
    // The palette's Agents tab is the one place to start an agent (presets, new agent task) — no second menu here.
    const go=el("button","agent-btn agent-start"); go.type="button";
    go.innerHTML=ICON.plus+"<span>Start an agent\u2026</span>";
    const k=el("kbd","agent-start-kbd"); k.textContent=kbd("\u2318","K"); go.append(k);
    go.title="Command palette \u2192 Agents: launch an AI CLI, or start an agent task in its own git worktree";
    go.addEventListener("click",(e)=>{e.stopPropagation(); openPalette(); setPalCat("Agents");});   // openPalette closes this popover
    emp.append(t1,t2,go);
    agentList.append(emp);
    return;
  }
  queue.forEach(({s,tab,pName,state})=>{
    const row=el("div","agent-row "+state);
    const dot=el("span","agent-row-dot");
    const info=el("div","agent-row-info");
    const path=el("div","agent-row-path");
    path.textContent=pName+" · "+(s.name||"session")+" · "+(tab.name||"tab");
    path.title=path.textContent;
    const st=el("div","agent-row-state");
    st.textContent=state==="approval"?"needs approval":state;
    const extra=evtSummary(tab);
    if(extra){const x=el("span","agent-row-evt"); x.textContent=" · "+extra; st.append(x);}   // textContent only — event data is untrusted
    const ue=usage.tabs[s.id+"-"+tab.id];
    if(ue){const x=el("span","agent-row-evt"); x.textContent=" \u00b7 "+fmtTok(ue.t)+" tok"; x.title=usageTip({tokens:ue.t,cache:ue.c}); st.append(x);}
    info.append(path,st);
    if(state==="approval"&&tab.ask){   // exact request + one-click answer; textContent only — the command is untrusted
      const q=el("div","agent-row-ask"); q.textContent=tab.ask.text; q.title=tab.ask.text;
      const bt=el("div","agent-row-btns");
      for(const [d,label] of [["allow","Approve"],["deny","Deny"]]){
        const b=el("button","agent-btn "+d); b.textContent=label; b.type="button";
        b.addEventListener("click",(e)=>{e.stopPropagation(); const a=tab.ask; if(!a||!tab.conn?.approve)return; tab.conn.approve(a.reqId,d);});
        bt.append(b);
      }
      if(tab.ask.canRule){
        const al=el("button","agent-btn"); al.textContent="Always allow\u2026"; al.type="button"; al.title="Create an opt-in rule for this command in this repo";
        al.addEventListener("click",(e)=>{e.stopPropagation(); alwaysAllow(tab);});
        bt.append(al);
      }
      info.append(q);
      if(tab.ask.risk){const rk=el("div","agent-risk"); rk.textContent="\u26a0 "+tab.ask.risk+" \u2014 always needs your click"; info.append(rk);}
      info.append(bt);
    }
    const ov=overlapByProject.get(s.project);
    if(ov){const w=el("div","agent-row-warn"); w.textContent="\u26a0 "+overlapText(ov); w.title=w.textContent; info.append(w);}   // textContent: file names are untrusted
    row.append(dot,info);
    row.addEventListener("click",()=>{
      revealWindow(s);
      switchTab(s,tab.id);
      if(agentPop) agentPop.classList.remove("open");
    });
    agentList.append(row);
  });
}

function updateAgentOverview(){
  if(!agentBadge) return;
  const queue=getAgentQueue();
  const hasAppr=queue.some((x)=>x.state==="approval");
  const hasWait=queue.some((x)=>x.state==="waiting");
  // working = live agent tab that's neither waiting nor blocked, or a shell streaming output for a command (tab.busy)
  const workingTabs=new Set(queue.filter((x)=>x.state==="working").map((x)=>x.tab));
  const isWorking=(t)=>workingTabs.has(t)||(!t.agent&&!t.exited&&t.busy);
  sessions.forEach((sess)=>{
    sess.tabs.forEach((t)=>t.wt.classList.toggle("working",isWorking(t)));
    sess.chip.classList.toggle("working",sess.tabs.some(isWorking));
  });

  agentBadge.className="agent-badge"+(hasAppr?" approval":(hasWait?" waiting":(queue.length?" working":"")));

  if(agentBtn){
    const apprCount=queue.filter((x)=>x.state==="approval").length;
    const waitCount=queue.filter((x)=>x.state==="waiting").length;
    let tip="Sessions \u2014 "+queue.length+" active agent"+(queue.length===1?"":"s");
    if(hasAppr) tip="Sessions \u2014 "+apprCount+" need"+(apprCount===1?"s":"")+" approval";
    else if(hasWait) tip="Sessions \u2014 "+waitCount+" waiting";
    else if(!queue.length) tip="Sessions \u2014 no active agents";
    agentBtn.title=tip;
  }

  if(agentPop&&agentPop.classList.contains("open")){
    renderAgentList(queue);
  }
}

// Recent approval decisions (server-side audit, #44): when, which terminal, what, and who decided.
const agentAudit=document.getElementById("agent-audit");
async function loadAudit(){
  if(!LIVE||!agentAudit)return;
  let rows; try{rows=await (await fetch("/api/approvals")).json();}catch{return;}
  agentAudit.innerHTML=""; agentAudit.hidden=!rows.length; if(!rows.length)return;
  const h=el("div"); h.textContent="Recent approvals"; agentAudit.append(h);
  const src={click:"you",terminal:"in terminal",timeout:"timed out",superseded:"replaced",rule:"rule"};
  rows.slice(0,8).forEach((a)=>{
    const sess=sessions.get(String(a.id).split("-")[0]);
    const r=el("div","agent-audit-row");
    const d=el("b"); d.textContent=a.source==="rule"?"Auto-allowed":a.decision==="allow"?"Approved":a.decision==="deny"?"Denied":"Not decided";
    r.append(new Date(a.ts).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})+" · ",d,
      document.createTextNode(" · "+(sess?.name||a.id)+" · "+[a.tool,a.files?.[0]||a.detail].filter(Boolean).join(" ")+" · "+(src[a.source]||a.source)));
    r.title=r.textContent; agentAudit.append(r);
  });
}
// Opt-in allow-rules (#44 phase 2): created from an approval row, listed here, deletable, pausable.
const agentRules=document.getElementById("agent-rules");
async function loadRules(){
  if(!LIVE||!agentRules)return;
  let st; try{st=await (await fetch("/api/approval-rules")).json();}catch{return;}
  agentRules.innerHTML=""; agentRules.hidden=!st.rules.length; if(!st.rules.length)return;
  const h=el("div"); h.textContent="Auto-allow rules \u00b7 "+(st.enabled?"on":"paused")+" \u00b7 "; 
  const tg=el("button","agent-rule-x"); tg.type="button"; tg.textContent=st.enabled?"pause":"resume";
  tg.addEventListener("click",async()=>{try{await fetch("/api/approval-rules/enabled",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled:!st.enabled})});}catch{} loadRules();});
  h.append(tg); agentRules.append(h);
  st.rules.forEach((r)=>{
    const row=el("div","agent-audit-row");
    row.append(document.createTextNode(r.agent+" \u00b7 "+(r.mode==="exact"?"exactly ":"starts with ")+r.pattern+" \u00b7 in "+r.dir+" "));
    const x=el("button","agent-rule-x"); x.type="button"; x.textContent="\u2715"; x.title="Delete this rule";
    x.addEventListener("click",async()=>{try{await fetch("/api/approval-rules/"+encodeURIComponent(r.id),{method:"DELETE"});}catch{} loadRules();});
    row.append(x); row.title=row.textContent; agentRules.append(row);
  });
}
async function alwaysAllow(tab){
  const a=tab.ask; if(!a)return;
  const w=a.cmd.trim().split(/\s+/), pre=w.length>=2?w.slice(0,2).join(" "):"";
  const v=await inputModal("Always allow this command?",[
    {type:"note",label:"termdeck will then answer on its own, without asking, whenever this agent runs a matching command in the git repo / worktree (or folder) containing:\n"+a.cwd+"\n\nTurned on only by you, right now. Risky commands (deleting, sudo, network, secrets\u2026) are never covered. Every automatic answer is logged and shown as a toast; manage or pause rules under Agents."},
    {key:"mode",label:"Allow",type:"select",options:[{value:"exact",label:"Only exactly: "+a.cmd},...(pre?[{value:"prefix",label:"Starting with: "+pre+" + plain words (no options, no paths outside the project)"}]:[])]},
  ],"Always allow");
  if(!v)return;
  let r; try{r=await fetch("/api/approval-rules",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({reqId:a.reqId,mode:v.mode})});}catch{toast(ICON.bot,"Rule not saved","Server unreachable",4000);return;}
  if(!r.ok){let e={}; try{e=await r.json();}catch{} toast(ICON.bot,"Rule not saved",e.error||"Refused",5000);return;}
  toast(ICON.bot,"Auto-allow rule saved",(v.mode==="exact"?"exactly ":"starts with ")+(v.mode==="exact"?a.cmd:pre),4000);
  if(tab.ask&&tab.ask.reqId===a.reqId&&tab.conn?.approve) tab.conn.approve(a.reqId,"allow");   // and answer this one now
  loadRules();
}
function openAgentPop(){
  closeModals("agent");
  loadAudit(); loadRules();
  const r=agentBtn.getBoundingClientRect();
  agentPop.style.top=(r.bottom+6)+"px";
  agentPop.style.left=Math.max(12,Math.min(window.innerWidth-352,r.right-340))+"px";
  agentPop.classList.add("open");
  renderAgentList();
}
function openTabWS(s,tab){
  const proto=location.protocol==="https:"?"wss":"ws";
  const p=new URLSearchParams({id:s.id+"-"+tab.id, cols:tab.term.cols||80, rows:tab.term.rows||24});
  if(tab.cwd) p.set("cwd",tab.cwd);
  if(tab.shell) p.set("shell",tab.shell);   // server honours it only if it is in its shell allowlist
  if(tab.cmd) p.set("cmd",tab.cmd);   // startup command; backend runs it only on a fresh shell
  if(s.isLog)  p.set("log","1");
  const ws=new WebSocket(proto+"://"+location.host+"/?"+p.toString());
  tab.exited=false;
  setTabStatus(s,tab,tab.reconnecting?"reconnecting":"pending");

  ws.onopen=()=>{tab.retries=0; tab.reconnecting=false; setTabStatus(s,tab,"live"); refitTab(s,tab); requestAnimationFrame(()=>snapWinHeight(s));};
  ws.onmessage=(ev)=>{
    let m; try{m=JSON.parse(ev.data);}catch{return;}
    if(m.type==="attach"){
      if(m.resumed){tab.term.reset(); tab.replay=true;}   // next output chunk is the replayed ring buffer, not live output
      if(m.cwd){tab.cwd=m.cwd; if(s.activeTabId===tab.id) setCwdBadge(s,m.cwd);}
      if(m.shell){tab.shellName=m.shell; if(s.activeTabId===tab.id) s.badgeShell.textContent=m.shell;}
    }else if(m.type==="agent"){
      agentEvent(s,tab,m.event);
    }else if(m.type==="autoallow"){   // an allow-rule answered on its own — never silent
      toast(ICON.bot,"Auto-allowed by rule","\""+s.name+"\": "+[m.tool,m.detail].filter(Boolean).join(" ").slice(0,80)+" (rule: "+m.rule+")",6000,()=>{revealWindow(s);switchTab(s,tab.id);});
      loadAudit();
    }else if(m.type==="approval"){   // the held request ended (clicked, answered in the terminal, timed out)
      if(tab.ask?.reqId===m.reqId){tab.ask=null; updateAgentOverview(); loadAudit();}
    }else if(m.type==="output"){
      tab.term.write(m.data);
      // On reattach the server replays the whole ring buffer in one chunk. Scanning all of it
      // would re-match an approval prompt you ALREADY answered and fire a false red. The tail is
      // the current screen, so that's the only part that reflects live state.
      const scan=tab.replay?m.data.slice(-REPLAY_SCAN):m.data; tab.replay=false;
      if(!tab.agent) noteShellOutput(s,tab);
      { const plain=scan.replace(ANSI_RE,""); tab.outTail=plain.slice(-120);        // port: latest localhost:PORT in the current screen
        const all=[...plain.matchAll(new RegExp(PORT_RE.source,"g"))];
        if(all.length){const np=+all[all.length-1][1]; if(np<=65535&&np!==tab.port){tab.port=np; if(s.activeTabId===tab.id)updateCmdBadges(s);}} }
      if(tab.agent&&!tab.evt){ armAgentIdle(s,tab); if(APPROVAL_RE.test(scan)) agentApproval(s,tab); }   // heuristics only until hook events take over   // (re)arm idle watch; a tool-approval prompt jumps straight to the louder red state
      // "command finished" heuristic: OSC 133;D (shell integration, reliable if configured),
      // a bell, or the prompt returning \u2014 trailing $ # % > covers bash/zsh/fish/PowerShell. zsh and bash 5.1+
      // end the prompt with escape codes (erase-line \x1b[K, bracketed paste \x1b[?2004h), so strip those first.
      const key=s.id+tab.id;
      const promptBack=m.data.includes("\x1b]133;D")||m.data.includes("\x07")||PROMPT_END_RE.test(m.data.replace(TRAIL_ESC_RE,""));
      // The prompt coming back always ends the long-run timer; the 3s cooldown only throttles the notifications.
      // (Gating clearRunning on it left a command run within 3s of the last prompt "running" until the 20s nudge.)
      if(promptBack&&tab.port){tab.port=null; if(s.activeTabId===tab.id)updateCmdBadges(s);}   // command ended → its server is gone
      const dur=promptBack?clearRunning(s,tab):null;   // elapsed ms (null if untracked)
      const done=promptBack&&!doneCooldown.get(key);
      const watching=focusedId===s.id&&s.activeTabId===tab.id&&!s.minimized&&s.project===activeProject&&document.hasFocus();
      if(done){
        doneCooldown.set(key,true); setTimeout(()=>doneCooldown.delete(key),3000);
        if(gameMatches(s,tab)) gameOnTermDone(s.name,dur);
        if(!watching){
          markAttn(s,tab);
          // Only announce completion of a command we actually saw start (Enter \u2192 markRunning).
          // A bare prompt redraw \u2014 e.g. every shell reflowing when you tile \u2014 is not a "done".
          if(dur!=null) toast(ICON.check,"Done","\""+s.name+"\" finished in "+fmtDur(dur),3000,()=>revealWindow(s));
        }
      }else if(!watching){
        markAttn(s,tab);
      }
    }else if(m.type==="cwd"){          // live cwd: shell cd'd — backend polled the new dir
      if(m.cwd){tab.cwd=m.cwd; if(s.activeTabId===tab.id) setCwdBadge(s,m.cwd); if(followTerm&&sidebarOpen&&focusedId===s.id) followTree();}
    }else if(m.type==="error"&&m.code==="panel_cap_reached"){
      // Backend terminal cap (TD_MAX_PANELS): retrying can't help until something closes, so park the tab
      // as dead (no auto-reconnect; the window's \u27f3 restarts it) and say why instead of looping forever.
      tab.exited=true; setTabStatus(s,tab,"dead");
      const lim=Number.isFinite(m.limit)?m.limit:"?";
      tab.term.write("\r\n\x1b[31m[terminal limit reached ("+lim+") \u2014 close a window or raise TD_MAX_PANELS, then click \u27f3 to retry]\x1b[0m\r\n");
      if(Date.now()-capToastAt>3000){capToastAt=Date.now(); toast(ICON.warn,"Terminal limit reached","The server allows "+lim+" live terminals. Close one, then click \u27f3 on this window.",6000,()=>revealWindow(s));}
    }else if(m.type==="taken"){
      // The same terminal was opened in another browser / device: the shell lives on there. Don't reconnect on our
      // own (the two would steal it back and forth); the window's ⟳ takes it back.
      tab.exited=true; setTabStatus(s,tab,"dead");
      tab.term.write("\r\n\x1b[33m[opened on another device — click ⟳ to use it here]\x1b[0m\r\n");
    }else if(m.type==="exit"){
      tab.exited=true; setTabStatus(s,tab,"dead");
      if(tab.agent) updateAgentOverview();
      tab.term.write("\r\n\x1b[2m[process exited \u2014 click \u27f3 to restart]\x1b[0m\r\n");
      announceExit(s,tab);   // coalesced: a burst (e.g. mass reattach after long away) becomes ONE toast
    }
  };
  ws.onclose=()=>{if(tab.closedByUser||tab.exited)return; checkSignedIn(); scheduleTabRecon(s,tab);};
  ws.onerror=()=>{};
  tab.conn={
    send:(d)=>ws.readyState===1&&ws.send(JSON.stringify({type:"input",data:d})),
    resize:(c,r)=>ws.readyState===1&&ws.send(JSON.stringify({type:"resize",cols:c,rows:r})),
    kill:()=>ws.readyState===1&&ws.send(JSON.stringify({type:"kill"})),
    approve:(reqId,decision)=>ws.readyState===1&&ws.send(JSON.stringify({type:"approve",reqId,decision})),
    close:()=>ws.close(),
  };
}
// Coalesce "shell exited" toasts: on mass reattach after a long absence every dead PTY fires exit
// near-simultaneously — collapse a burst into a single toast instead of N stacked ones.
let capToastAt=0;   // one "terminal limit" toast per burst, not one per refused tab
const DEAD_DOT='<span class="led dead"></span>';
let exitBatch=[], exitTimer=null;
function announceExit(s,tab){
  exitBatch.push({s,tab}); clearTimeout(exitTimer); exitTimer=setTimeout(flushExit,700);
}
function flushExit(){
  const b=exitBatch; exitBatch=[]; if(!b.length)return;
  const {s,tab}=b[0], jump=()=>{switchTab(s,tab.id);revealWindow(s);};
  if(b.length===1) toast(DEAD_DOT,"Shell exited","\""+s.name+"\" tab "+(s.tabs.indexOf(tab)+1),4000,jump);
  else             toast(DEAD_DOT,"Shells exited",b.length+" shells exited while you were away",5000,jump);
}
// The server answers 401 when this browser's sign-in cookie is missing or stale (cleared cookies, or a remote-mode
// restart): say so once instead of reconnecting silently forever. Reconnects keep going and succeed once signed in.
let signedOutAt=0;
function checkSignedIn(){
  if(Date.now()-signedOutAt<30000) return;
  fetch("/api/version",{cache:"no-store"}).then((r)=>{
    if(r.status!==401||Date.now()-signedOutAt<30000) return;
    signedOutAt=Date.now();
    toast(ICON.warn,"Signed out of termdeck","Run `termdeck open` in a terminal (or open the link termdeck printed at startup), then reload.",0);
  }).catch(()=>{});
}
function scheduleTabRecon(s,tab){
  tab.reconnecting=true; tab.retries++;
  setTabStatus(s,tab,"reconnecting");
  const d=Math.min(5000,500*Math.pow(2,Math.min(tab.retries,4)));
  clearTimeout(tab.reconnectTimer);
  tab.reconnectTimer=setTimeout(()=>{if(sessions.has(s.id)&&s.tabs.includes(tab))openTabWS(s,tab);},d);
}
// Tab wake (sleep/background → refocus) drops the localhost WS but fires no network event.
// On refocus, skip the up-to-5s backoff wait: reset + reconnect every reconnecting tab now.
document.addEventListener("visibilitychange",()=>{
  if(document.hidden||!LIVE)return;
  sessions.forEach((s)=>s.tabs.forEach((tab)=>{
    if(tab.reconnecting&&!tab.closedByUser&&!tab.exited){
      clearTimeout(tab.reconnectTimer); tab.retries=0; openTabWS(s,tab);
    }
  }));
});
function setTabStatus(s,tab,status){
  tab.status=status;
  tab.wtDot.className="wt-dot "+status;
  // Window/chip LED summarizes ALL tabs (worst wins), not just the active one.
  const rank={dead:3,reconnecting:2,pending:1,live:0};
  const agg=s.tabs.reduce((w,t)=>rank[t.status||"pending"]>rank[w]?(t.status||"pending"):w,"live");
  s.status=agg; s.led.className="win-led "+agg; s.cled.className="cled "+agg;
  s.win.classList.toggle("dead",agg==="dead");
  updateConn();
}

function restartSession(s){
  if(!LIVE)return;
  s.tabs.forEach((tab)=>{
    clearTimeout(tab.reconnectTimer); tab.exited=false; tab.retries=0; tab.reconnecting=false;
    tab.term.reset(); openTabWS(s,tab);
  });
  s.win.classList.remove("dead");
  if(s.tabs.some((t)=>t.agent)) updateAgentOverview();
}

function closeSession(s,skipCount){
  s.closedByUser=true;
  s.tabs.forEach((tab)=>{
    if(findTarget===tab) closeFind();
    tab.closedByUser=true; clearTimeout(tab.reconnectTimer); stopAgentIdle(s,tab);
    if(tab.conn){if(tab.conn.kill)tab.conn.kill(); if(tab.conn.close)tab.conn.close();}
    glDetach(tab); try{tab.term.dispose();}catch{}
  });
  s.win.remove(); s.chip.remove(); syncWebgl();
  const gp=s.glue&&sessions.get(s.glue); if(gp)gp.glue=null;
  const pid=s.project;
  sessions.delete(s.id); order=order.filter((x)=>x!==s.id);
  if(focusedId===s.id) focusedId=null;
  if(s.project===activeProject&&![...sessions.values()].some((x)=>x.project===activeProject))hint.style.display="";
  updateConn(); updateDockEdges(); updateProjEdges(); updateProjectAttention(pid); updateAgentOverview(); if(!skipCount){updateProjCounts(); scheduleSave();}
}
