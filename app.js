/* Chaya Kada — static frontend + optional Supabase realtime backend */
(() => {
  "use strict";

  const CFG = window.CHAYA_CONFIG || {};
  const LOCAL_KEY = "chaya-kada-demo-v1";
  const NAME_KEY = "chaya-kada-name";
  const CODE_KEY = "chaya-kada-code-ok";
  const ROOM_KEY = "chaya-kada-office-code";
  const DEVICE_KEY = "chaya-kada-device-id";
  const quotes = [
    "ജോലി ഒക്കെ അവിടെ നിക്കട്ടെ… ആദ്യം ഒരു ചായ.",
    "ചായ + കടി + കഥ = ഓഫീസ് സമാധാനം.",
    "ഒരു ചായയ്ക്ക് ഇറങ്ങിയതാ… സമയം പോയത് ആരും കണ്ടില്ല. 😂",
    "മീറ്റിംഗ് കഴിയട്ടെ… ചായ തുടങ്ങാം.",
    "ചായ ഉണ്ടെങ്കിൽ ചർച്ചയും ഉണ്ടാകും.",
    "Deadline ഉണ്ടാകാം… ചായ break ഇല്ലാതിരിക്കില്ല.",
    "ഒരു കപ്പ് ചായ, കുറച്ച് കഥ, പിന്നെ വീണ്ടും ജോലി.",
    "കണക്ക് പിന്നെ നോക്കാം… ആദ്യം ചായ.",
    "ഓഫീസിലെ ചെറിയ സന്തോഷങ്ങൾക്ക് ഒരു ചായ മതി.",
    "ആരും ചോദിച്ചില്ലെങ്കിലും… ചായയ്ക്ക് പോകാം. ☕"
  ];

  const $ = (q, root=document) => root.querySelector(q);
  const $$ = (q, root=document) => [...root.querySelectorAll(q)];
  const money = n => `AED ${Number(n || 0).toFixed(2)}`;
  const nowISO = () => new Date().toISOString();
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
  const esc = s => String(s ?? "").replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

  let me = localStorage.getItem(NAME_KEY) || "";
  let officeCode = localStorage.getItem(ROOM_KEY) || String(CFG.OFFICE_CODE || "CHAYA2026");
  let deviceId = localStorage.getItem(DEVICE_KEY) || uid();
  localStorage.setItem(DEVICE_KEY, deviceId);
  let db = null;
  let isOnline = false;
  let state = { users: [], sessions: [], members: [], payments: [] };
  let realtimeChannel = null;
  let pendingModalAction = null;

  function demoSeed(){
    return { users: [], sessions: [], members: [], payments: [] };
  }
  function loadLocal(){
    try { state = JSON.parse(localStorage.getItem(LOCAL_KEY)) || demoSeed(); }
    catch { state = demoSeed(); }
  }
  function saveLocal(){ localStorage.setItem(LOCAL_KEY, JSON.stringify(state)); }

  function toast(text, type=""){
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = text;
    $("#toastHost").appendChild(el);
    setTimeout(() => el.remove(), 2800);
  }

  function activeSession(){
    return [...state.sessions].filter(s => s.status === "active").sort((a,b) => new Date(b.started_at)-new Date(a.started_at))[0] || null;
  }
  function membersFor(sessionId){ return state.members.filter(m => m.session_id === sessionId); }
  function paymentsFor(sessionId){ return state.payments.filter(p => p.session_id === sessionId); }

  async function initBackend(){
    const configured = CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && window.supabase;
    if (!configured){
      loadLocal();
      isOnline = false;
      updateSyncBadge();
      return;
    }
    try{
      db = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
      isOnline = true;
      await pullAll();
      subscribeRealtime();
      updateSyncBadge();
    }catch(err){
      console.error(err);
      loadLocal();
      isOnline = false;
      updateSyncBadge();
      toast("Supabase connection failed — local demo mode", "error");
    }
  }

  async function pullAll(){
    if (!isOnline) return;
    const [u,s,m,p] = await Promise.all([
      db.from("chaya_users").select("*").eq("office_code", officeCode).order("created_at"),
      db.from("tea_sessions").select("*").eq("office_code", officeCode).order("started_at", {ascending:false}),
      db.from("session_members").select("*").eq("office_code", officeCode).order("joined_at"),
      db.from("payments").select("*").eq("office_code", officeCode).order("created_at")
    ]);
    for (const r of [u,s,m,p]) if (r.error) throw r.error;
    state = { users:u.data||[], sessions:s.data||[], members:m.data||[], payments:p.data||[] };
  }

  function subscribeRealtime(){
    if (!isOnline || !db) return;
    if (realtimeChannel) db.removeChannel(realtimeChannel);
    const roomFilter = `office_code=eq.${officeCode}`;
    realtimeChannel = db.channel(`chaya-kada-live-${officeCode}`)
      .on("postgres_changes", {event:"*", schema:"public", table:"tea_sessions", filter:roomFilter}, syncAndRender)
      .on("postgres_changes", {event:"*", schema:"public", table:"session_members", filter:roomFilter}, syncAndRender)
      .on("postgres_changes", {event:"*", schema:"public", table:"payments", filter:roomFilter}, syncAndRender)
      .on("postgres_changes", {event:"*", schema:"public", table:"chaya_users", filter:roomFilter}, syncAndRender)
      .subscribe();
  }
  let syncTimer;
  function syncAndRender(){
    clearTimeout(syncTimer);
    syncTimer = setTimeout(async () => { try { await pullAll(); renderAll(); } catch(e){ console.error(e); } }, 150);
  }

  function updateSyncBadge(){
    const el = $("#syncBadge");
    if (!el) return;
    el.className = `sync-badge ${isOnline ? "online" : "local"}`;
    el.textContent = isOnline ? `● Live shared • ${officeCode}` : "● NOT SHARED • connect Supabase";
  }

  async function registerUser(name){
    const clean = name.trim().slice(0,28);
    if (!clean) return;
    if (isOnline){
      const existing = state.users.find(u => u.device_id === deviceId && u.office_code === officeCode);
      if (existing){
        const {error} = await db.from("chaya_users").update({name:clean}).eq("id", existing.id);
        if (error) throw error;
      }else{
        const {error} = await db.from("chaya_users").insert({name:clean, device_id:deviceId, office_code:officeCode});
        if (error && !String(error.message).includes("duplicate")) throw error;
      }
      await pullAll();
    }else{
      let u = state.users.find(u => u.device_id === deviceId && (u.office_code || officeCode) === officeCode);
      if (u) u.name = clean;
      else state.users.push({id:uid(), name:clean, device_id:deviceId, office_code:officeCode, created_at:nowISO()});
      saveLocal();
    }
  }

  async function startCall(){
    let active = activeSession();
    if (active){
      await joinSession(active.id);
      toast("Already one Chaya Call is live — you joined it ☕", "success");
      return;
    }
    const session = {id:uid(), office_code:officeCode, created_by:me, status:"active", started_at:nowISO(), total_amount:null, payer_name:null, closed_at:null};
    if (isOnline){
      const payload = {...session}; delete payload.id;
      const {data,error} = await db.from("tea_sessions").insert(payload).select().single();
      if (error) throw error;
      await db.from("session_members").insert({session_id:data.id, name:me, office_code:officeCode});
      await pullAll();
    }else{
      state.sessions.unshift(session);
      state.members.push({id:uid(), session_id:session.id, name:me, office_code:officeCode, joined_at:nowISO()});
      saveLocal();
    }
    renderAll();
    toast("🔥 Chaya Call live!", "success");
  }

  async function joinSession(sessionId){
    const exists = membersFor(sessionId).some(m => m.name.toLowerCase() === me.toLowerCase());
    if (exists){ toast("നീ already gang-il ഉണ്ട് 😎"); return; }
    if (isOnline){
      const {error} = await db.from("session_members").insert({session_id:sessionId, name:me, office_code:officeCode});
      if (error && !String(error.message).includes("duplicate")) throw error;
      await pullAll();
    }else{
      state.members.push({id:uid(), session_id:sessionId, name:me, office_code:officeCode, joined_at:nowISO()}); saveLocal();
    }
    renderAll(); toast("Gang-il ചേർന്നു ☕", "success");
  }

  async function cancelActive(){
    const s = activeSession(); if (!s) return;
    if (isOnline){
      const {error} = await db.from("tea_sessions").update({status:"cancelled", closed_at:nowISO()}).eq("id",s.id); if(error) throw error; await pullAll();
    }else{ s.status="cancelled"; s.closed_at=nowISO(); saveLocal(); }
    renderAll(); toast("Chaya call cancelled");
  }

  async function createSplit(total,payer,names){
    const s = activeSession();
    if (!s) { toast("Start a Chaya Call first", "error"); return; }
    const per = Number(total)/names.length;
    const debts = names.filter(n => n !== payer).map(n => ({from_name:n,to_name:payer,amount:Number(per.toFixed(2)),status:"pending"}));
    if (isOnline){
      const {error} = await db.from("tea_sessions").update({status:"completed",total_amount:Number(total),payer_name:payer,closed_at:nowISO()}).eq("id",s.id); if(error) throw error;
      if (debts.length){ const r = await db.from("payments").insert(debts.map(d=>({...d,session_id:s.id,office_code:officeCode}))); if(r.error) throw r.error; }
      await pullAll();
    }else{
      Object.assign(s,{status:"completed",total_amount:Number(total),payer_name:payer,closed_at:nowISO()});
      debts.forEach(d=>state.payments.push({id:uid(),session_id:s.id,office_code:officeCode,created_at:nowISO(),...d})); saveLocal();
    }
    renderAll();
    navigate("split");
    toast(`Split done — ${money(per)} each ✨`, "success");
    $("#billAmount").value="";
  }

  async function markPaid(paymentId){
    if (isOnline){
      const {error} = await db.from("payments").update({status:"paid",paid_at:nowISO()}).eq("id",paymentId); if(error) throw error; await pullAll();
    }else{
      const p = state.payments.find(p=>p.id===paymentId); if(p){p.status="paid";p.paid_at=nowISO();saveLocal();}
    }
    renderAll(); toast("Payment marked as paid ✅", "success");
  }

  function navigate(view){
    $$(".view").forEach(v=>v.classList.toggle("active",v.id===`view-${view}`));
    $$("[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
    window.scrollTo({top:0,behavior:"smooth"});
    if(view==="split") renderSplit();
  }

  function renderAll(){
    renderIdentity(); renderHome(); renderSplit(); renderHistory(); renderStats(); rotateQuotes(false);
  }
  function renderIdentity(){
    $("#profileName").textContent=me;
    $("#profileAvatar").textContent=(me[0]||"?").toUpperCase();
    $("#helloText").textContent=`എന്താ ${me}… ഒരു ചായ ആയാലോ? ☕`;
  }

  function renderHome(){
    const s=activeSession(), list=$("#gangList"), status=$("#sessionStatus");
    if(!s){
      status.textContent="No active call";status.className="status-pill";
      list.className="gang-list empty-state";
      list.innerHTML='<div class="empty-icon">☕</div><p>ഇന്നത്തെ ആദ്യ ചായ call ഇനിയും വന്നിട്ടില്ല.</p><small>Start a call and everyone can join.</small>';
      $("#sessionActions").classList.add("hidden");
      $("#joinCallBtn").disabled=true; $("#joinCallBtn").style.opacity=.55;
    }else{
      status.textContent=`🔥 Live • by ${s.created_by}`;status.className="status-pill live";
      const ms=membersFor(s.id);
      list.className="gang-list";
      list.innerHTML=ms.map((m,i)=>`<div class="gang-person"><div class="person-avatar">${esc((m.name[0]||"?").toUpperCase())}</div><div><strong>${esc(m.name)} ${m.name===s.created_by?'🔥':''}</strong><small>${i===0?'Call starter':'Ready for chaya'}</small></div></div>`).join("");
      $("#sessionActions").classList.remove("hidden");
      const joined=ms.some(m=>m.name.toLowerCase()===me.toLowerCase());
      $("#joinCallBtn").disabled=joined; $("#joinCallBtn").style.opacity=joined?.55:1; $("#joinCallBtn").textContent=joined?"✅ Gang-il ഉണ്ട്":"🙋 ഞാൻ വരുന്നു";
    }
    const completed=state.sessions.filter(s=>s.status==="completed");
    const total=completed.reduce((a,s)=>a+Number(s.total_amount||0),0);
    const pending=state.payments.filter(p=>p.status!=="paid").reduce((a,p)=>a+Number(p.amount||0),0);
    const joins=countJoins(); const king=Object.entries(joins).sort((a,b)=>b[1]-a[1])[0]?.[0]||"—";
    $("#statTrips").textContent=completed.length; $("#statSpent").textContent=money(total); $("#statKing").textContent=king; $("#statPending").textContent=money(pending);
  }

  function candidateMembers(){
    const s=activeSession();
    if(s) return [...new Set(membersFor(s.id).map(m=>m.name))];
    return [...new Set(state.users.map(u=>u.name))];
  }
  function renderSplit(){
    const names=candidateMembers(); const picker=$("#memberPicker"), payer=$("#payerSelect");
    const selectedBefore=new Set($$("#memberPicker input:checked").map(i=>i.value));
    picker.innerHTML=names.length?names.map(n=>`<label class="member-check checked"><input type="checkbox" value="${esc(n)}" checked><span>${esc(n)}</span></label>`).join(""):'<div class="empty-mini">Active Chaya Gang ഇല്ല. ആദ്യം Home-ൽ call തുടങ്ങൂ.</div>';
    payer.innerHTML=names.length?names.map(n=>`<option>${esc(n)}</option>`).join(""):'<option value="">No members</option>';
    if(names.includes(me)) payer.value=me;
    picker.querySelectorAll("input").forEach(i=>i.addEventListener("change",()=>{i.closest("label").classList.toggle("checked",i.checked);renderSplitPreview();}));
    payer.onchange=renderSplitPreview;
    renderSplitPreview(); renderPayments();
  }
  function renderSplitPreview(){
    const total=Number($("#billAmount")?.value||0); const checked=$$("#memberPicker input:checked").map(i=>i.value); const payer=$("#payerSelect")?.value||"";
    const per=checked.length?total/checked.length:0; $("#perPersonAmount").textContent=money(per);
    const box=$("#splitPreviewRows");
    if(!total||!checked.length){box.innerHTML='<div class="empty-mini">Amount & members select ചെയ്താൽ കണക്ക് ഇവിടെ കാണാം.</div>';return;}
    box.innerHTML=checked.map(n=>`<div class="preview-row"><span>${esc(n)}${n===payer?' (paid)':''}</span><strong>${n===payer?'—':money(per)}</strong></div>`).join("");
  }
  function renderPayments(){
    const rows=[...state.payments].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)); const box=$("#pendingList");
    if(!rows.length){box.innerHTML='<div class="empty-mini">ഇപ്പോൾ pending payment ഒന്നുമില്ല. സമാധാനം 😌</div>';return;}
    box.innerHTML=rows.slice(0,30).map(p=>`<div class="payment-row"><div class="payment-route"><strong>${esc(p.from_name)} → ${esc(p.to_name)}</strong><small>${p.status==='paid'?'Settled ✅':'Waiting for settlement'}</small></div><div class="payment-amount">${money(p.amount)}</div>${p.status==='paid'?'<span class="paid-badge">PAID</span>':`<button class="pay-btn" data-pay="${p.id}">Mark paid</button>`}</div>`).join("");
    $$('[data-pay]').forEach(b=>b.onclick=()=>safe(()=>markPaid(b.dataset.pay)));
  }

  function renderHistory(){
    const done=state.sessions.filter(s=>["completed","cancelled"].includes(s.status)).sort((a,b)=>new Date(b.started_at)-new Date(a.started_at)); const box=$("#historyList");
    if(!done.length){box.innerHTML='<div class="panel empty-mini">History ഇനിയും empty ആണ്. ആദ്യ ചായ trip കഴിഞ്ഞാൽ ഇവിടെ വരും ☕</div>';return;}
    box.innerHTML=done.map(s=>{
      const ms=membersFor(s.id).map(m=>m.name); const date=new Date(s.started_at).toLocaleString([], {dateStyle:"medium",timeStyle:"short"});
      return `<article class="history-card"><div class="history-icon">${s.status==='completed'?'☕':'✕'}</div><div><h4>${s.status==='completed'?`Chaya with ${ms.length} people`:'Cancelled Chaya Call'}</h4><p>${esc(date)} • started by ${esc(s.created_by)}</p><div class="history-members">${ms.map(n=>`<span class="tiny-chip">${esc(n)}</span>`).join('')}</div></div><div class="history-money"><strong>${s.status==='completed'?money(s.total_amount):'—'}</strong><small>${s.payer_name?`Paid by ${esc(s.payer_name)}`:''}</small></div></article>`;
    }).join("");
  }

  function countJoins(){ const c={}; state.members.forEach(m=>{const s=state.sessions.find(x=>x.id===m.session_id);if(s?.status==='completed')c[m.name]=(c[m.name]||0)+1;}); return c; }
  function renderStats(){
    const completed=state.sessions.filter(s=>s.status==='completed'); const joins=countJoins();
    const sponsor={}; completed.forEach(s=>{if(s.payer_name)sponsor[s.payer_name]=(sponsor[s.payer_name]||0)+Number(s.total_amount||0)});
    const pend={}; state.payments.filter(p=>p.status!=='paid').forEach(p=>pend[p.from_name]=(pend[p.from_name]||0)+Number(p.amount||0));
    const king=Object.entries(joins).sort((a,b)=>b[1]-a[1])[0]; const topSponsor=Object.entries(sponsor).sort((a,b)=>b[1]-a[1])[0]; const topPending=Object.entries(pend).sort((a,b)=>b[1]-a[1])[0];
    $("#kingName").textContent=king?.[0]||"—"; $("#sponsorName").textContent=topSponsor?.[0]||"—"; $("#pendingName").textContent=topPending?.[0]||"—"; $("#economyValue").textContent=money(completed.reduce((a,s)=>a+Number(s.total_amount||0),0));
    const allNames=[...new Set([...state.users.map(u=>u.name),...state.members.map(m=>m.name)])];
    const board=allNames.map(n=>({name:n,joins:joins[n]||0,paid:sponsor[n]||0,pending:pend[n]||0})).sort((a,b)=>b.joins-a.joins || b.paid-a.paid);
    $("#leaderboard").innerHTML=board.length?board.map((x,i)=>`<div class="leader-row"><div class="leader-rank">#${i+1}</div><div><strong>${esc(x.name)}</strong><small>${x.joins} trips • paid ${money(x.paid)} • pending ${money(x.pending)}</small></div><div class="leader-score">${x.joins} ☕</div></div>`).join(''):'<div class="empty-mini">Stats വരാൻ കുറച്ച് ചായ കുടിക്കണം 😄</div>';
  }

  function rotateQuotes(random=true){
    const q=quotes[random?Math.floor(Math.random()*quotes.length):0];
    if($("#heroQuote")) $("#heroQuote").textContent=`“${q}”`;
    if($("#sideQuoteMl")) $("#sideQuoteMl").textContent=`“${quotes[(quotes.indexOf(q)+4)%quotes.length]}”`;
  }

  function askConfirm(title,text,icon,action){
    pendingModalAction=action; $("#modalTitle").textContent=title; $("#modalText").textContent=text; $("#modalIcon").textContent=icon; $("#confirmDialog").showModal();
  }
  async function safe(fn){ try{await fn();}catch(e){console.error(e);toast(e.message||"Something went wrong","error");} }

  function bind(){
    $$("[data-view]").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.view)));
    $("#startCallBtn").onclick=()=>askConfirm("Chaya Call ഇടട്ടെ?","ഇപ്പോൾ എല്ലാവർക്കും ഒരു fresh tea plan തുടങ്ങാം. 🔥","☕",()=>safe(startCall));
    $("#joinCallBtn").onclick=()=>{const s=activeSession();if(s)safe(()=>joinSession(s.id));};
    $("#goSplitBtn").onclick=()=>navigate("split");
    $("#cancelSessionBtn").onclick=()=>askConfirm("Call cancel ചെയ്യണോ?","ഈ active Chaya Call cancelled ആയി history-ൽ കാണും.","✕",()=>safe(cancelActive));
    $("#modalConfirmBtn").onclick=()=>{const fn=pendingModalAction;pendingModalAction=null;if(fn)setTimeout(fn,0);};
    $("#refreshBtn").onclick=()=>safe(async()=>{if(isOnline)await pullAll();else loadLocal();renderAll();toast("Refreshed ↻");});
    $("#billAmount").addEventListener("input",renderSplitPreview);
    $("#selectAllBtn").onclick=()=>{const inputs=$$("#memberPicker input");const all=inputs.every(i=>i.checked);inputs.forEach(i=>{i.checked=!all;i.closest('label').classList.toggle('checked',!all)});renderSplitPreview();};
    $("#splitForm").onsubmit=e=>{e.preventDefault();const total=Number($("#billAmount").value);const payer=$("#payerSelect").value;const names=$$("#memberPicker input:checked").map(i=>i.value);if(!names.length)return toast("Select at least one person","error");safe(()=>createSplit(total,payer,names));};
    $("#logoutBtn").onclick=()=>{localStorage.removeItem(NAME_KEY);localStorage.removeItem(CODE_KEY);localStorage.removeItem(ROOM_KEY);location.reload();};
    $("#profileMenuBtn").onclick=()=>toast("Use “Change name” on top to switch user");
    $("#gateForm").onsubmit=e=>safe(async()=>{
      e.preventDefault(); const name=$("#nameInput").value.trim(); const code=$("#codeInput").value.trim();
      if(code !== String(CFG.OFFICE_CODE||"CHAYA2026")) return toast("Office code തെറ്റാണ് 😅","error");
      me=name; officeCode=code; localStorage.setItem(NAME_KEY,me);localStorage.setItem(CODE_KEY,"yes");localStorage.setItem(ROOM_KEY,officeCode);
      if (isOnline){ await pullAll(); subscribeRealtime(); }
      await registerUser(me);showApp();renderAll();
    });
  }

  function showApp(){ $("#gate").classList.add("hidden");$("#app").classList.remove("hidden"); }
  function showGate(){ $("#gate").classList.remove("hidden");$("#app").classList.add("hidden"); }

  async function boot(){
    bind(); await initBackend();
    const allowed=localStorage.getItem(CODE_KEY)==="yes" && me;
    if(allowed){ await safe(()=>registerUser(me)); showApp(); renderAll(); }
    else showGate();
    rotateQuotes(true); setInterval(()=>rotateQuotes(true),12000);
  }
  document.addEventListener("DOMContentLoaded",boot);
})();
