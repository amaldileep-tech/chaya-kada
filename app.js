/* Chaya Kada V3.2 — secure rooms + realtime + browser notifications + signature Chaya sounds */
(() => {
  "use strict";

  const CFG = window.CHAYA_CONFIG || {};
  const NAME_KEY = "chaya-v3-name";
  const ROOM_ID_KEY = "chaya-v3-room-id";
  const ROOM_NAME_KEY = "chaya-v3-room-name";
  const DEVICE_KEY = "chaya-v3-device-id";
  const LAST_CHAT_KEY = "chaya-v3-last-chat";
  const SOUND_KEY = "chaya-v3-sound-enabled";

  const quotes = [
    "ജോലി ഒക്കെ അവിടെ നിക്കട്ടെ… ആദ്യം ഒരു ചായ.",
    "ചായ + കടി + കഥ = ഓഫീസ് സമാധാനം.",
    "ഒരു ചായയ്ക്ക് ഇറങ്ങിയതാ… സമയം പോയത് ആരും കണ്ടില്ല. 😂",
    "മീറ്റിംഗ് കഴിയട്ടെ… ചായ തുടങ്ങാം.",
    "Deadline ഉണ്ടാകാം… ചായ break ഇല്ലാതിരിക്കില്ല.",
    "കണക്ക് പിന്നെ നോക്കാം… ആദ്യം ചായ.",
    "ഓഫീസിലെ ചെറിയ സന്തോഷങ്ങൾക്ക് ഒരു ചായ മതി.",
    "ചായ ഇല്ലാതെ architecture discussion നടക്കില്ല. 😌",
    "Bill വന്നാൽ മാത്രം എല്ലാവരും suddenly busy. 💸",
    "ഒരു five minute ചായ break… officially 27 minutes. 😂"
  ];

  const $ = (q, root = document) => root.querySelector(q);
  const $$ = (q, root = document) => [...root.querySelectorAll(q)];
  const esc = s => String(s ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
  const money = n => `AED ${Number(n || 0).toFixed(2)}`;
  const nowISO = () => new Date().toISOString();
  const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

  let me = localStorage.getItem(NAME_KEY) || "";
  let roomId = localStorage.getItem(ROOM_ID_KEY) || "";
  let roomName = localStorage.getItem(ROOM_NAME_KEY) || "Chaya Kada";
  let deviceId = localStorage.getItem(DEVICE_KEY) || uid();
  localStorage.setItem(DEVICE_KEY, deviceId);

  let db = null;
  let currentUserId = null;
  let isOnline = false;
  let isAdmin = false;
  let realtimeChannel = null;
  let notificationRegistration = null;
  let pendingModalAction = null;
  let preAdminSession = null;
  let syncTimer = null;
  let state = { profiles: [], sessions: [], members: [], payments: [], messages: [] };

  // ---------- Chaya Kada sound system ----------
  // Web Audio keeps the build tiny: no MP3/WAV assets and no extra network requests.
  let soundEnabled = localStorage.getItem(SOUND_KEY) !== "0";
  let audioCtx = null;
  let masterGain = null;

  function ensureAudio() {
    if (!soundEnabled) return null;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    if (!audioCtx) {
      audioCtx = new AudioContext();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = 0.24;
      masterGain.connect(audioCtx.destination);
    }
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => null);
    return audioCtx;
  }

  function tone(freq, duration = 0.05, volume = 0.035, type = "sine", delay = 0) {
    const ctx = ensureAudio();
    if (!ctx || !masterGain) return;
    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(Math.max(volume, 0.0001), start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(start);
    osc.stop(start + duration + 0.015);
  }

  function glassClink(delay = 0, strength = 1) {
    // Short metallic partials approximate a tea-glass clink without an audio asset.
    tone(1420, 0.12, 0.045 * strength, "sine", delay);
    tone(2180, 0.09, 0.028 * strength, "sine", delay + 0.004);
    tone(3260, 0.065, 0.016 * strength, "sine", delay + 0.008);
  }

  function playSound(kind = "tap") {
    if (!soundEnabled) return;
    switch (kind) {
      case "call":
        glassClink(0, 1);
        glassClink(0.13, 0.82);
        tone(780, 0.18, 0.018, "sine", 0.03);
        break;
      case "notification":
        glassClink(0, 0.72);
        break;
      case "success":
        tone(620, 0.07, 0.025, "sine", 0);
        tone(880, 0.10, 0.022, "sine", 0.065);
        break;
      case "error":
        tone(230, 0.10, 0.024, "sine", 0);
        tone(180, 0.12, 0.018, "sine", 0.07);
        break;
      default:
        tone(680, 0.035, 0.012, "sine", 0);
    }
  }

  function updateSoundButton() {
    const b = $("#soundBtn");
    if (!b) return;
    b.classList.toggle("active", soundEnabled);
    b.title = soundEnabled ? "Sound on — click to mute" : "Sound off — click to enable";
    b.innerHTML = soundEnabled ? "🔊 <span>Sound</span>" : "🔇 <span>Muted</span>";
  }

  function toggleSound() {
    soundEnabled = !soundEnabled;
    localStorage.setItem(SOUND_KEY, soundEnabled ? "1" : "0");
    if (soundEnabled) {
      ensureAudio();
      playSound("success");
      toast("Chaya sounds on 🔊");
    } else {
      toast("Chaya sounds muted 🔇");
    }
    updateSoundButton();
  }

  function toast(text, type = "") {
    if (type === "success") playSound("success");
    else if (type === "error") playSound("error");
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = text;
    $("#toastHost").appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  async function initBackend() {
    if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY || !window.supabase) {
      throw new Error("Supabase config missing.");
    }
    db = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });
    isOnline = true;
    await setupServiceWorker();
    updateNotificationButton();
    updateSoundButton();
  }

  async function setupServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    try {
      notificationRegistration = await navigator.serviceWorker.register("./service-worker.js");
    } catch (e) {
      console.warn("Service worker registration failed", e);
    }
  }

  async function ensureAnonymousSession() {
    const { data } = await db.auth.getSession();
    if (data?.session?.user) {
      currentUserId = data.session.user.id;
      return data.session.user;
    }
    const { data: anon, error } = await db.auth.signInAnonymously();
    if (error) {
      throw new Error("Anonymous sign-in is not enabled in Supabase Auth. Enable Anonymous Sign-Ins first.");
    }
    currentUserId = anon.user.id;
    return anon.user;
  }

  async function refreshAuthState() {
    const { data } = await db.auth.getSession();
    currentUserId = data?.session?.user?.id || null;
    isAdmin = false;
    if (!currentUserId) {
      updateAdminButton();
      return false;
    }
    const { data: adminOk, error } = await db.rpc("ck_is_admin");
    if (!error && adminOk === true) isAdmin = true;
    updateAdminButton();
    return isAdmin;
  }

  async function joinRoom(code, name) {
    const cleanName = name.trim().slice(0, 28);
    if (!cleanName || !code.trim()) throw new Error("Name and office code required.");
    await ensureAnonymousSession();
    await refreshAuthState();
    if (isAdmin) {
      // Admin sessions may access a stored room but ordinary entry should use anonymous auth.
      await db.auth.signOut();
      await ensureAnonymousSession();
      await refreshAuthState();
    }
    const { data, error } = await db.rpc("ck_join_room", {
      p_code: code.trim(),
      p_name: cleanName,
      p_device_id: deviceId
    });
    if (error) {
      const msg = String(error.message || "");
      if (msg.includes("INVALID_OFFICE_CODE")) throw new Error("Office code തെറ്റാണ് 😅");
      throw error;
    }
    const result = Array.isArray(data) ? data[0] : data;
    if (!result?.room_id) throw new Error("Room join failed.");
    roomId = result.room_id;
    roomName = result.room_name || "Chaya Kada";
    me = cleanName;
    localStorage.setItem(NAME_KEY, me);
    localStorage.setItem(ROOM_ID_KEY, roomId);
    localStorage.setItem(ROOM_NAME_KEY, roomName);
    await pullAll();
    subscribeRealtime();
    if ("Notification" in window && Notification.permission === "granted") {
      await setupServiceWorker();
      registerPushSubscription();
    }
  }

  async function pullAll() {
    if (!roomId) return;
    const [profiles, sessions, members, payments, messages] = await Promise.all([
      db.from("ck_memberships").select("id,user_id,room_id,display_name,device_id,joined_at").eq("room_id", roomId).order("joined_at"),
      db.from("ck_sessions").select("*").eq("room_id", roomId).order("started_at", { ascending: false }),
      db.from("ck_session_members").select("*").eq("room_id", roomId).order("joined_at"),
      db.from("ck_payments").select("*").eq("room_id", roomId).order("created_at"),
      db.from("ck_messages").select("*").eq("room_id", roomId).order("created_at", { ascending: true }).limit(300)
    ]);
    for (const r of [profiles, sessions, members, payments, messages]) {
      if (r.error) throw r.error;
    }
    state = {
      profiles: profiles.data || [],
      sessions: sessions.data || [],
      members: members.data || [],
      payments: payments.data || [],
      messages: messages.data || []
    };
    updateSyncBadge();
  }

  function subscribeRealtime() {
    if (!db || !roomId) return;
    if (realtimeChannel) db.removeChannel(realtimeChannel);
    const filter = `room_id=eq.${roomId}`;
    realtimeChannel = db.channel(`ck-room-${roomId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "ck_sessions", filter }, p => handleRealtime("sessions", p))
      .on("postgres_changes", { event: "*", schema: "public", table: "ck_session_members", filter }, p => handleRealtime("members", p))
      .on("postgres_changes", { event: "*", schema: "public", table: "ck_payments", filter }, p => handleRealtime("payments", p))
      .on("postgres_changes", { event: "*", schema: "public", table: "ck_memberships", filter }, p => handleRealtime("profiles", p))
      .on("postgres_changes", { event: "*", schema: "public", table: "ck_messages", filter }, p => handleRealtime("messages", p))
      .subscribe();
  }

  function handleRealtime(kind, payload) {
    const row = payload.new || payload.old || {};
    if (kind === "sessions" && payload.eventType === "INSERT" && row.created_by_user_id !== currentUserId) {
      playSound("call");
      notifySystem("🔥 Chaya Call!", `${row.created_by_name || "Someone"} വിളിക്കുന്നു — ചായ കുടിക്കാൻ പോയാലോ? ☕`, `call-${row.id}`, "home");
    }
    if (kind === "messages" && payload.eventType === "INSERT" && row.sender_user_id !== currentUserId) {
      playSound("notification");
      notifySystem("💬 Chaya Chat", `${row.sender_name}: ${String(row.body || "").slice(0, 120)}`, `chat-${row.id}`, "chat");
    }
    if (kind === "payments" && payload.eventType === "UPDATE" && row.status === "paid" && row.to_name === me) {
      playSound("notification");
      notifySystem("✅ Payment updated", `${row.from_name} marked ${money(row.amount)} as paid.`, `pay-${row.id}`, "split");
    }
    clearTimeout(syncTimer);
    syncTimer = setTimeout(async () => {
      try {
        await pullAll();
        renderAll();
      } catch (e) {
        console.error(e);
      }
    }, 120);
  }

  async function notifySystem(title, body, tag, view) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    try {
      if (!notificationRegistration) await setupServiceWorker();
      if (notificationRegistration) {
        await notificationRegistration.showNotification(title, {
          body,
          tag,
          icon: "assets/chaya-kadi.jpg",
          badge: "assets/chaya-kadi.jpg",
          data: { url: `./?view=${encodeURIComponent(view || "home")}` }
        });
      } else {
        new Notification(title, { body, tag });
      }
    } catch (e) {
      console.warn("Notification failed", e);
    }
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
  }

  async function registerPushSubscription() {
    if (!notificationRegistration || !CFG.VAPID_PUBLIC_KEY || !roomId || !currentUserId) return false;
    if (!("PushManager" in window)) return false;
    try {
      let sub = await notificationRegistration.pushManager.getSubscription();
      if (!sub) {
        sub = await notificationRegistration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(CFG.VAPID_PUBLIC_KEY)
        });
      }
      const json = sub.toJSON();
      const { error } = await db.rpc("ck_save_push_subscription", {
        p_room_id: roomId,
        p_endpoint: json.endpoint,
        p_p256dh: json.keys?.p256dh || "",
        p_auth_key: json.keys?.auth || ""
      });
      if (error) throw error;
      return true;
    } catch (e) {
      console.warn("Push subscription not active yet", e);
      return false;
    }
  }

  async function sendWebPush(kind, text, view, tag) {
    if (!db || !roomId) return;
    try {
      await db.functions.invoke("send-chaya-push", {
        body: { room_id: roomId, kind, text: String(text || "").slice(0, 180), view: view || "home", tag: String(tag || "").slice(0, 120) }
      });
    } catch (e) {
      // Edge Function is optional during initial deployment. Live in-page notifications still work.
      console.debug("Closed-site web push sender not deployed yet", e);
    }
  }

  async function enableNotifications() {
    if (!("Notification" in window)) throw new Error("This browser does not support notifications.");
    const permission = await Notification.requestPermission();
    updateNotificationButton();
    if (permission === "granted") {
      await setupServiceWorker();
      const pushReady = await registerPushSubscription();
      toast(pushReady ? "Push notifications enabled 🔔" : "Live browser notifications enabled 🔔", "success");
      await notifySystem("☕ Chaya Kada", "Notifications ready. ഇനി chaya call miss ആവില്ല 😎", "welcome", "home");
    } else {
      toast("Notification permission not enabled", "error");
    }
  }

  function updateNotificationButton() {
    const b = $("#notifyBtn");
    if (!b) return;
    const granted = "Notification" in window && Notification.permission === "granted";
    b.classList.toggle("active", granted);
    b.innerHTML = granted ? "🔔 <span>On</span>" : "🔕 <span>Notifications</span>";
  }

  function updateSyncBadge() {
    const el = $("#syncBadge");
    if (!el) return;
    el.className = `sync-badge ${isOnline && roomId ? "online" : "local"}`;
    el.textContent = isOnline && roomId ? `● Live shared • ${roomName}` : "● Not connected";
  }

  function activeSession() {
    return [...state.sessions].filter(s => s.status === "active").sort((a, b) => new Date(b.started_at) - new Date(a.started_at))[0] || null;
  }
  function membersFor(sessionId) { return state.members.filter(m => m.session_id === sessionId); }
  function paymentsFor(sessionId) { return state.payments.filter(p => p.session_id === sessionId); }

  async function startCall() {
    const existing = activeSession();
    if (existing) {
      await joinSession(existing.id);
      toast("Already one Chaya Call is live — you joined it ☕", "success");
      return;
    }
    const { data, error } = await db.from("ck_sessions").insert({
      room_id: roomId,
      created_by_user_id: currentUserId,
      created_by_name: me,
      status: "active"
    }).select().single();
    if (error) throw error;
    const m = await db.from("ck_session_members").insert({ room_id: roomId, session_id: data.id, user_id: currentUserId, name: me });
    if (m.error && !String(m.error.message).toLowerCase().includes("duplicate")) throw m.error;
    await pullAll();
    renderAll();
    toast("🔥 Chaya Call live!", "success");
    sendWebPush("call", "", "home", `call-${data.id}`);
  }

  async function joinSession(sessionId) {
    const exists = membersFor(sessionId).some(m => m.user_id === currentUserId);
    if (exists) { toast("നീ already gang-il ഉണ്ട് 😎"); return; }
    const { error } = await db.from("ck_session_members").insert({ room_id: roomId, session_id: sessionId, user_id: currentUserId, name: me });
    if (error && !String(error.message).toLowerCase().includes("duplicate")) throw error;
    await pullAll();
    renderAll();
    toast("Gang-il ചേർന്നു ☕", "success");
  }

  async function cancelActive() {
    const s = activeSession();
    if (!s) return;
    const { error } = await db.from("ck_sessions").update({ status: "cancelled", closed_at: nowISO() }).eq("id", s.id).eq("room_id", roomId);
    if (error) throw error;
    await pullAll();
    renderAll();
    toast("Chaya call cancelled");
  }

  async function createSplit(total, payer, names) {
    const s = activeSession();
    if (!s) throw new Error("Start a Chaya Call first.");
    if (!names.length) throw new Error("Select at least one person.");
    const per = Number(total) / names.length;
    const debts = names.filter(n => n !== payer).map(n => ({
      room_id: roomId,
      session_id: s.id,
      from_name: n,
      to_name: payer,
      amount: Number(per.toFixed(2)),
      status: "pending"
    }));
    const upd = await db.from("ck_sessions").update({ status: "completed", total_amount: Number(total), payer_name: payer, closed_at: nowISO() }).eq("id", s.id).eq("room_id", roomId);
    if (upd.error) throw upd.error;
    if (debts.length) {
      const ins = await db.from("ck_payments").insert(debts);
      if (ins.error) throw ins.error;
    }
    await pullAll();
    renderAll();
    navigate("split");
    $("#billAmount").value = "";
    toast(`Split done — ${money(per)} each ✨`, "success");
  }

  async function markPaid(paymentId) {
    const { error } = await db.from("ck_payments").update({ status: "paid", paid_at: nowISO() }).eq("id", paymentId).eq("room_id", roomId);
    if (error) throw error;
    await pullAll();
    renderAll();
    toast("Payment marked as paid ✅", "success");
  }

  async function sendMessage(body) {
    const clean = body.trim().slice(0, 500);
    if (!clean) return;
    const { data, error } = await db.from("ck_messages").insert({
      room_id: roomId,
      sender_user_id: currentUserId,
      sender_name: me,
      body: clean
    }).select().single();
    if (error) throw error;
    $("#chatInput").value = "";
    await pullAll();
    renderChat();
    markChatRead();
    sendWebPush("chat", clean, "chat", `chat-${data.id}`);
  }

  async function deleteOwnMessage(id) {
    const { error } = await db.from("ck_messages").delete().eq("id", id).eq("room_id", roomId);
    if (error) throw error;
    await pullAll();
    renderChat();
    if (isAdmin) renderAdmin();
    toast("Message deleted");
  }

  async function adminSignIn(email, password) {
    const before = await db.auth.getSession();
    preAdminSession = before.data?.session || null;
    const { error } = await db.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await refreshAuthState();
    if (!isAdmin) {
      await db.auth.signOut();
      throw new Error("This account is not approved as Chaya Kada admin.");
    }
    $("#adminLoginDialog").close();
    await pullAll();
    renderAll();
    navigate("admin");
    toast("Admin mode unlocked 🛡", "success");
  }

  async function adminSignOut() {
    await db.auth.signOut();
    isAdmin = false;
    currentUserId = null;
    updateAdminButton();

    if (preAdminSession?.access_token && preAdminSession?.refresh_token) {
      const restored = await db.auth.setSession({
        access_token: preAdminSession.access_token,
        refresh_token: preAdminSession.refresh_token
      });
      preAdminSession = null;
      if (!restored.error) {
        currentUserId = restored.data?.session?.user?.id || null;
        await pullAll();
        subscribeRealtime();
        renderAll();
        navigate("home");
        toast("Admin logged out");
        return;
      }
    }

    // If the page was reloaded while admin was logged in, the previous anonymous
    // session is unavailable. Ask for the office code again rather than storing it.
    localStorage.removeItem(ROOM_ID_KEY);
    localStorage.removeItem(ROOM_NAME_KEY);
    roomId = "";
    roomName = "Chaya Kada";
    showGate();
    if (me) $("#nameInput").value = me;
    toast("Admin logged out — enter office code to rejoin", "success");
  }

  async function deleteMemberAdmin(id) {
    if (!isAdmin) throw new Error("Admin login required.");
    const { error } = await db.from("ck_memberships").delete().eq("id", id).eq("room_id", roomId);
    if (error) throw error;
    await pullAll();
    renderAll();
    toast("Person removed from room", "success");
  }

  async function deleteSessionAdmin(id) {
    if (!isAdmin) throw new Error("Admin login required.");
    const { error } = await db.from("ck_sessions").delete().eq("id", id).eq("room_id", roomId);
    if (error) throw error;
    await pullAll();
    renderAll();
    toast("Event deleted permanently", "success");
  }

  async function deleteMessageAdmin(id) {
    if (!isAdmin) throw new Error("Admin login required.");
    const { error } = await db.from("ck_messages").delete().eq("id", id).eq("room_id", roomId);
    if (error) throw error;
    await pullAll();
    renderAll();
    toast("Chat message removed", "success");
  }

  async function clearChatAdmin() {
    if (!isAdmin) throw new Error("Admin login required.");
    const { error } = await db.from("ck_messages").delete().eq("room_id", roomId);
    if (error) throw error;
    await pullAll();
    renderAll();
    toast("Room chat cleared", "success");
  }

  function updateAdminButton() {
    const btn = $("#adminBtn");
    if (!btn) return;
    btn.classList.toggle("active", isAdmin);
    btn.innerHTML = isAdmin ? "🛡 <span>Admin ✓</span>" : "🛡 <span>Admin</span>";
  }

  function navigate(view) {
    if (view === "admin" && !isAdmin) {
      $("#adminLoginDialog").showModal();
      return;
    }
    $$(".view").forEach(v => v.classList.toggle("active", v.id === `view-${view}`));
    $$('[data-view]').forEach(b => b.classList.toggle("active", b.dataset.view === view));
    if (view === "split") renderSplit();
    if (view === "chat") { renderChat(); markChatRead(); }
    if (view === "admin") renderAdmin();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderAll() {
    renderIdentity();
    renderHome();
    renderChat();
    renderSplit();
    renderHistory();
    renderStats();
    renderUnread();
    if (isAdmin) renderAdmin();
  }

  function renderIdentity() {
    $("#profileName").textContent = me || "—";
    $("#profileAvatar").textContent = (me[0] || "?").toUpperCase();
    $("#helloText").textContent = `എന്താ ${me}… ഒരു ചായ ആയാലോ? ☕`;
    $("#roomLabel").textContent = roomName || "Chaya member";
    $("#chatRoomStatus").textContent = `● ${roomName}`;
  }

  function renderHome() {
    const s = activeSession();
    const list = $("#gangList");
    const status = $("#sessionStatus");
    if (!s) {
      status.textContent = "No active call";
      status.className = "status-pill";
      list.className = "gang-list empty-state";
      list.innerHTML = '<div class="empty-icon">☕</div><p>ഇന്നത്തെ ആദ്യ ചായ call ഇനിയും വന്നിട്ടില്ല.</p><small>Start a call and everyone in this room can join.</small>';
      $("#sessionActions").classList.add("hidden");
      $("#joinCallBtn").disabled = true;
      $("#joinCallBtn").style.opacity = .55;
      $("#joinCallBtn").textContent = "🙋 ഞാൻ വരുന്നു";
    } else {
      status.textContent = `🔥 Live • by ${s.created_by_name}`;
      status.className = "status-pill live";
      const ms = membersFor(s.id);
      list.className = "gang-list";
      list.innerHTML = ms.map((m, i) => `<div class="gang-person"><div class="person-avatar">${esc((m.name[0] || "?").toUpperCase())}</div><div><strong>${esc(m.name)} ${m.user_id === s.created_by_user_id ? "🔥" : ""}</strong><small>${i === 0 ? "Call starter" : "Ready for chaya"}</small></div></div>`).join("");
      $("#sessionActions").classList.remove("hidden");
      const joined = ms.some(m => m.user_id === currentUserId);
      $("#joinCallBtn").disabled = joined;
      $("#joinCallBtn").style.opacity = joined ? .55 : 1;
      $("#joinCallBtn").textContent = joined ? "✅ Gang-il ഉണ്ട്" : "🙋 ഞാൻ വരുന്നു";
    }
    const completed = state.sessions.filter(x => x.status === "completed");
    const total = completed.reduce((a, x) => a + Number(x.total_amount || 0), 0);
    const pending = state.payments.filter(p => p.status !== "paid").reduce((a, p) => a + Number(p.amount || 0), 0);
    const joins = countJoins();
    const king = Object.entries(joins).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";
    $("#statTrips").textContent = completed.length;
    $("#statSpent").textContent = money(total);
    $("#statKing").textContent = king;
    $("#statPending").textContent = money(pending);
  }

  function candidateMembers() {
    const s = activeSession();
    if (s) return membersFor(s.id).map(m => m.name);
    return state.profiles.map(p => p.display_name);
  }

  function renderSplit() {
    const names = [...new Set(candidateMembers())];
    const payer = $("#payerSelect");
    const oldPayer = payer.value;
    payer.innerHTML = names.length ? names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join("") : '<option value="">No members</option>';
    if (names.includes(oldPayer)) payer.value = oldPayer;
    $("#memberPicker").innerHTML = names.length ? names.map(n => `<label class="checked"><input type="checkbox" value="${esc(n)}" checked> <span>${esc(n)}</span></label>`).join("") : '<div class="empty-mini">Active Chaya Call-ൽ ആളുകൾ join ചെയ്താൽ ഇവിടെ വരും.</div>';
    $$("#memberPicker input").forEach(i => i.onchange = () => { i.closest("label").classList.toggle("checked", i.checked); renderSplitPreview(); });
    renderSplitPreview();
    const pending = state.payments.filter(p => p.status !== "paid");
    $("#pendingList").innerHTML = state.payments.length ? state.payments.map(p => `<div class="payment-row"><div><strong>${esc(p.from_name)} → ${esc(p.to_name)}</strong><small>${money(p.amount)}</small></div>${p.status === "paid" ? '<span class="paid-chip">✅ Paid</span>' : `<button class="pay-btn" data-pay="${p.id}">Mark paid</button>`}</div>`).join("") : '<div class="empty-mini">Pending ഒന്നുമില്ല. Friendship safe 😌</div>';
    $$('[data-pay]').forEach(b => b.onclick = () => safe(() => markPaid(b.dataset.pay)));
  }

  function renderSplitPreview() {
    const total = Number($("#billAmount")?.value || 0);
    const names = $$("#memberPicker input:checked").map(i => i.value);
    const per = names.length ? total / names.length : 0;
    $("#perPersonAmount").textContent = money(per);
    $("#splitPreviewRows").innerHTML = names.length ? names.map(n => `<div class="preview-row"><span>${esc(n)}</span><strong>${money(per)}</strong></div>`).join("") : '<div class="empty-mini">Amount & members select ചെയ്താൽ കണക്ക് ഇവിടെ കാണാം.</div>';
  }

  function renderHistory() {
    const list = [...state.sessions].filter(s => s.status !== "active");
    $("#historyList").innerHTML = list.length ? list.map(s => {
      const date = new Date(s.started_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
      const count = membersFor(s.id).length;
      const status = s.status === "completed" ? "☕ Completed" : "✕ Cancelled";
      return `<article class="history-card"><header><div><h3>${esc(date)}</h3><span class="status-pill">${status}</span></div><div class="history-money">${s.status === "completed" ? money(s.total_amount) : "—"}</div></header><p>${count} people • Started by ${esc(s.created_by_name)}${s.payer_name ? ` • Paid by ${esc(s.payer_name)}` : ""}</p></article>`;
    }).join("") : '<div class="empty-mini">History empty. ആദ്യം ചായ കുടിക്കൂ 😄</div>';
  }

  function countJoins() {
    const map = {};
    const completedIds = new Set(state.sessions.filter(s => s.status === "completed").map(s => s.id));
    state.members.filter(m => completedIds.has(m.session_id)).forEach(m => map[m.name] = (map[m.name] || 0) + 1);
    return map;
  }

  function renderStats() {
    const completed = state.sessions.filter(s => s.status === "completed");
    const joins = countJoins();
    const sponsor = {};
    completed.forEach(s => { if (s.payer_name) sponsor[s.payer_name] = (sponsor[s.payer_name] || 0) + Number(s.total_amount || 0); });
    const pend = {};
    state.payments.filter(p => p.status !== "paid").forEach(p => pend[p.from_name] = (pend[p.from_name] || 0) + Number(p.amount || 0));
    const king = Object.entries(joins).sort((a, b) => b[1] - a[1])[0];
    const topSponsor = Object.entries(sponsor).sort((a, b) => b[1] - a[1])[0];
    const topPending = Object.entries(pend).sort((a, b) => b[1] - a[1])[0];
    $("#kingName").textContent = king?.[0] || "—";
    $("#sponsorName").textContent = topSponsor?.[0] || "—";
    $("#pendingName").textContent = topPending?.[0] || "—";
    $("#economyValue").textContent = money(completed.reduce((a, s) => a + Number(s.total_amount || 0), 0));
    const allNames = [...new Set([...state.profiles.map(p => p.display_name), ...state.members.map(m => m.name)])];
    const board = allNames.map(name => ({ name, joins: joins[name] || 0, paid: sponsor[name] || 0, pending: pend[name] || 0 })).sort((a, b) => b.joins - a.joins || b.paid - a.paid);
    $("#leaderboard").innerHTML = board.length ? board.map((x, i) => `<div class="leader-row"><div class="leader-rank">#${i + 1}</div><div><strong>${esc(x.name)}</strong><small>${x.joins} trips • paid ${money(x.paid)} • pending ${money(x.pending)}</small></div><div class="leader-score">${x.joins} ☕</div></div>`).join("") : '<div class="empty-mini">Stats വരാൻ കുറച്ച് ചായ കുടിക്കണം 😄</div>';
  }

  function renderChat() {
    const list = $("#chatList");
    if (!state.messages.length) {
      list.innerHTML = '<div class="empty-state"><div class="empty-icon">💬</div><p>Chat silent ആണ്.</p><small>ആദ്യ message ഇടാൻ ആരാണ് ധൈര്യം കാണിക്കുന്നത്? 😂</small></div>';
      return;
    }
    let lastDay = "";
    const html = [];
    for (const m of state.messages) {
      const d = new Date(m.created_at);
      const day = d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
      if (day !== lastDay) {
        html.push(`<div class="chat-day">${esc(day)}</div>`);
        lastDay = day;
      }
      const mine = m.sender_user_id === currentUserId;
      const canDelete = mine || isAdmin;
      html.push(`<article class="chat-bubble ${mine ? "mine" : ""}"><div class="chat-meta"><strong>${esc(m.sender_name)}</strong><time>${esc(d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))}</time></div><p>${esc(m.body)}</p>${canDelete ? `<div class="chat-actions"><button class="chat-delete" data-chat-delete="${m.id}">delete</button></div>` : ""}</article>`);
    }
    list.innerHTML = html.join("");
    $$('[data-chat-delete]').forEach(b => b.onclick = () => askConfirm("Message delete ചെയ്യണോ?", "ഈ chat message permanently remove ചെയ്യും.", "🗑", () => safe(() => isAdmin ? deleteMessageAdmin(b.dataset.chatDelete) : deleteOwnMessage(b.dataset.chatDelete))));
    requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
  }

  function unreadCount() {
    const last = Number(localStorage.getItem(`${LAST_CHAT_KEY}:${roomId}`) || 0);
    return state.messages.filter(m => m.sender_user_id !== currentUserId && new Date(m.created_at).getTime() > last).length;
  }

  function renderUnread() {
    const n = unreadCount();
    for (const id of ["#sideChatBadge", "#mobileChatBadge"]) {
      const el = $(id);
      if (!el) continue;
      el.textContent = n > 99 ? "99+" : String(n);
      el.classList.toggle("hidden", n === 0);
    }
  }

  function markChatRead() {
    if (!roomId) return;
    localStorage.setItem(`${LAST_CHAT_KEY}:${roomId}`, String(Date.now()));
    renderUnread();
  }

  function renderAdmin() {
    if (!isAdmin) return;
    const people = [...state.profiles].sort((a, b) => new Date(b.joined_at) - new Date(a.joined_at));
    const sessions = [...state.sessions].sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
    const messages = [...state.messages].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 60);
    $("#adminPeopleCount").textContent = `${people.length} ${people.length === 1 ? "person" : "people"}`;
    $("#adminEventCount").textContent = `${sessions.length} ${sessions.length === 1 ? "event" : "events"}`;
    $("#adminPeopleList").innerHTML = people.length ? people.map(p => `<div class="admin-row"><div class="admin-avatar">${esc((p.display_name[0] || "?").toUpperCase())}</div><div class="admin-row-main"><strong>${esc(p.display_name)}</strong><small>${esc(new Date(p.joined_at).toLocaleString())}</small></div><button class="admin-delete" data-admin-member="${p.id}">Delete</button></div>`).join("") : '<div class="empty-mini">No members.</div>';
    $("#adminEventList").innerHTML = sessions.length ? sessions.map(s => `<div class="admin-row"><div class="admin-event-icon">${s.status === "active" ? "🔥" : s.status === "completed" ? "☕" : "✕"}</div><div class="admin-row-main"><strong>${esc(new Date(s.started_at).toLocaleString())}</strong><small>${esc(s.status)} • by ${esc(s.created_by_name)} • ${membersFor(s.id).length} people • ${s.status === "completed" ? money(s.total_amount) : "—"}</small></div><button class="admin-delete" data-admin-session="${s.id}">Delete</button></div>`).join("") : '<div class="empty-mini">No events.</div>';
    $("#adminChatList").innerHTML = messages.length ? messages.map(m => `<div class="admin-row"><div class="admin-event-icon">💬</div><div class="admin-row-main"><strong>${esc(m.sender_name)}</strong><small>${esc(String(m.body).slice(0, 90))}</small></div><button class="admin-delete" data-admin-message="${m.id}">Delete</button></div>`).join("") : '<div class="empty-mini">No chat messages.</div>';
    $$('[data-admin-member]').forEach(b => b.onclick = () => askConfirm("Delete person?", "Member room list-ൽ നിന്ന് remove ചെയ്യും. Old history stays.", "🗑", () => safe(() => deleteMemberAdmin(b.dataset.adminMember))));
    $$('[data-admin-session]').forEach(b => b.onclick = () => askConfirm("Delete event permanently?", "Event, participants and split payments cascade delete ചെയ്യും.", "⚠️", () => safe(() => deleteSessionAdmin(b.dataset.adminSession))));
    $$('[data-admin-message]').forEach(b => b.onclick = () => askConfirm("Delete chat message?", "Selected message permanently remove ചെയ്യും.", "🗑", () => safe(() => deleteMessageAdmin(b.dataset.adminMessage))));
  }

  function rotateQuotes(random = true) {
    const index = random ? Math.floor(Math.random() * quotes.length) : 0;
    const q = quotes[index];
    if ($("#heroQuote")) $("#heroQuote").textContent = `“${q}”`;
    if ($("#sideQuoteMl")) $("#sideQuoteMl").textContent = `“${quotes[(index + 4) % quotes.length]}”`;
  }

  function askConfirm(title, text, icon, action) {
    pendingModalAction = action;
    $("#modalTitle").textContent = title;
    $("#modalText").textContent = text;
    $("#modalIcon").textContent = icon;
    $("#confirmDialog").showModal();
  }

  async function safe(fn) {
    try { await fn(); }
    catch (e) { console.error(e); toast(e.message || "Something went wrong", "error"); }
  }

  async function resetIdentity() {
    if (realtimeChannel) db.removeChannel(realtimeChannel);
    await db.auth.signOut();
    for (const k of [NAME_KEY, ROOM_ID_KEY, ROOM_NAME_KEY]) localStorage.removeItem(k);
    location.reload();
  }

  function bind() {
    // First real user interaction unlocks Web Audio on mobile browsers.
    document.addEventListener("pointerdown", e => {
      if (e.target.closest("button, .btn, [data-view]")) {
        ensureAudio();
        if (!e.target.closest("#soundBtn")) playSound("tap");
      }
    }, { passive: true });
    $$('[data-view]').forEach(b => b.addEventListener("click", e => { e.preventDefault(); navigate(b.dataset.view); }));
    $("#startCallBtn").onclick = () => askConfirm("Chaya Call ഇടട്ടെ?", "ഇപ്പോൾ room-ൽ എല്ലാവർക്കും fresh tea plan തുടങ്ങാം. 🔥", "☕", () => safe(startCall));
    $("#joinCallBtn").onclick = () => { const s = activeSession(); if (s) safe(() => joinSession(s.id)); };
    $("#goSplitBtn").onclick = () => navigate("split");
    $("#cancelSessionBtn").onclick = () => askConfirm("Call cancel ചെയ്യണോ?", "Active Chaya Call cancelled ആയി history-ൽ കാണും.", "✕", () => safe(cancelActive));
    $("#modalConfirmBtn").onclick = () => { const fn = pendingModalAction; pendingModalAction = null; if (fn) setTimeout(fn, 0); };
    $("#refreshBtn").onclick = () => safe(async () => { await pullAll(); renderAll(); toast("Refreshed ↻"); });
    $("#notifyBtn").onclick = () => safe(enableNotifications);
    $("#soundBtn").onclick = toggleSound;
    $("#billAmount").addEventListener("input", renderSplitPreview);
    $("#payerSelect").addEventListener("change", renderSplitPreview);
    $("#selectAllBtn").onclick = () => { const inputs = $$("#memberPicker input"); const all = inputs.length && inputs.every(i => i.checked); inputs.forEach(i => { i.checked = !all; i.closest("label").classList.toggle("checked", !all); }); renderSplitPreview(); };
    $("#splitForm").onsubmit = e => { e.preventDefault(); const total = Number($("#billAmount").value); const payer = $("#payerSelect").value; const names = $$("#memberPicker input:checked").map(i => i.value); if (!total || total <= 0) return toast("Enter a valid bill amount", "error"); if (!names.length) return toast("Select at least one person", "error"); safe(() => createSplit(total, payer, names)); };
    $("#chatForm").onsubmit = e => { e.preventDefault(); safe(() => sendMessage($("#chatInput").value)); };
    $$('[data-emoji]').forEach(b => b.onclick = () => { const i = $("#chatInput"); i.value = `${i.value}${i.value ? " " : ""}${b.dataset.emoji}`; i.focus(); });
    $("#clearMyChatUnread").onclick = () => { markChatRead(); toast("Chat marked as read"); };
    $("#logoutBtn").onclick = () => safe(resetIdentity);
    $("#profileMenuBtn").onclick = () => toast("Top bar-ലെ Change name ഉപയോഗിക്കൂ 😄");
    $("#adminBtn").onclick = () => { if (isAdmin) navigate("admin"); else $("#adminLoginDialog").showModal(); };
    $("#adminLoginCancel").onclick = () => $("#adminLoginDialog").close();
    $("#adminLoginForm").onsubmit = e => { e.preventDefault(); safe(() => adminSignIn($("#adminEmail").value.trim(), $("#adminPassword").value)); };
    $("#adminLogoutBtn").onclick = () => safe(adminSignOut);
    $("#adminClearChatBtn").onclick = () => askConfirm("Clear entire chat?", "ഈ room-ലെ എല്ലാ chat messages permanently delete ചെയ്യും.", "⚠️", () => safe(clearChatAdmin));
    $("#gateForm").onsubmit = e => { e.preventDefault(); safe(async () => {
      const name = $("#nameInput").value.trim();
      const code = $("#codeInput").value;
      await joinRoom(code, name);
      showApp();
      renderAll();
      toast(`Welcome to ${roomName} ☕`, "success");
    }); };
  }

  function showApp() { $("#gate").classList.add("hidden"); $("#app").classList.remove("hidden"); }
  function showGate() { $("#gate").classList.remove("hidden"); $("#app").classList.add("hidden"); }

  async function boot() {
    bind();
    try {
      await initBackend();
      const existing = await db.auth.getSession();
      const existingUser = existing.data?.session?.user || null;
      if (me && roomId && existingUser) {
        currentUserId = existingUser.id;
        await refreshAuthState();
        const allowed = isAdmin ? true : (await db.rpc("ck_has_room", { p_room_id: roomId })).data === true;
        if (allowed) {
          await pullAll();
          subscribeRealtime();
          if ("Notification" in window && Notification.permission === "granted") registerPushSubscription();
          showApp();
          renderAll();
          const view = new URLSearchParams(location.search).get("view");
          if (["home", "chat", "split", "history", "stats"].includes(view)) navigate(view);
        } else {
          localStorage.removeItem(ROOM_ID_KEY);
          localStorage.removeItem(ROOM_NAME_KEY);
          roomId = "";
          showGate();
          $("#nameInput").value = me;
        }
      } else {
        showGate();
        if (me) $("#nameInput").value = me;
      }
    } catch (e) {
      console.error(e);
      showGate();
      toast(e.message || "Startup failed", "error");
    }
    rotateQuotes(true);
    setInterval(() => rotateQuotes(true), 12000);
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
