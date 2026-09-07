import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const vapidPublic = Deno.env.get("CHAYA_VAPID_PUBLIC_KEY")!;
    const vapidPrivate = Deno.env.get("CHAYA_VAPID_PRIVATE_KEY")!;
    const vapidSubject = Deno.env.get("CHAYA_VAPID_SUBJECT") || "mailto:admin@example.com";
    if (!vapidPublic || !vapidPrivate) return json({ error: "VAPID secrets not configured" }, 500);

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    const user = userData?.user;
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json();
    const roomId = String(body.room_id || "");
    const kind = body.kind === "chat" ? "chat" : "call";
    const text = String(body.text || "").slice(0, 180);
    const view = ["home", "chat"].includes(body.view) ? body.view : "home";
    const tag = String(body.tag || "").slice(0, 120);
    if (!roomId) return json({ error: "room_id required" }, 400);

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    const { data: membership } = await admin
      .from("ck_memberships")
      .select("display_name")
      .eq("user_id", user.id)
      .eq("room_id", roomId)
      .maybeSingle();
    if (!membership) return json({ error: "Room access denied" }, 403);

    const sender = membership.display_name || "Someone";
    const title = kind === "call" ? "🔥 Chaya Call!" : "💬 Chaya Chat";
    const notificationBody = kind === "call"
      ? `${sender} വിളിക്കുന്നു — ചായ കുടിക്കാൻ പോയാലോ? ☕`
      : `${sender}: ${text || "☕"}`;

    const { data: subs, error: subsError } = await admin
      .from("ck_push_subscriptions")
      .select("id,user_id,endpoint,p256dh,auth_key")
      .eq("room_id", roomId)
      .neq("user_id", user.id);
    if (subsError) throw subsError;

    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
    const payload = JSON.stringify({
      title,
      body: notificationBody,
      tag: tag || (kind === "call" ? `chaya-call-${roomId}` : `chaya-chat-${Date.now()}`),
      url: `./?view=${view}`
    });

    let sent = 0;
    let removed = 0;
    await Promise.all((subs || []).map(async (sub) => {
      try {
        await webpush.sendNotification({
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth_key }
        }, payload, { TTL: kind === "call" ? 600 : 3600 });
        sent++;
      } catch (err: any) {
        const status = Number(err?.statusCode || 0);
        if (status === 404 || status === 410) {
          await admin.from("ck_push_subscriptions").delete().eq("id", sub.id);
          removed++;
        } else {
          console.error("Push send failed", status, err?.message || err);
        }
      }
    }));

    return json({ ok: true, sent, removed });
  } catch (err: any) {
    console.error(err);
    return json({ error: err?.message || "Push function failed" }, 500);
  }

  function json(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
