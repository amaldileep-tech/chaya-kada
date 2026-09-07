const CACHE = "chaya-kada-v3-2-static-1";
const CORE = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./supabase-config.js"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)).catch(() => null));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request).then(response => {
      const clone = response.clone();
      caches.open(CACHE).then(cache => cache.put(event.request, clone)).catch(() => null);
      return response;
    }).catch(() => caches.match(event.request).then(r => r || caches.match("./index.html")))
  );
});

// Ready for true Web Push later. V3 currently triggers notifications from the live page/realtime connection.
self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text() || "" }; }
  event.waitUntil(self.registration.showNotification(data.title || "☕ Chaya Kada", {
    body: data.body || "ഒരു ചായ ആയാലോ?",
    icon: "assets/chaya-kadi.jpg",
    badge: "assets/chaya-kadi.jpg",
    tag: data.tag || "chaya-push",
    silent: false,
    vibrate: data.kind === "call" ? [80, 60, 80] : [60],
    data: { url: data.url || "./" }
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = event.notification.data?.url || "./";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if ("focus" in client) {
          client.navigate(target).catch(() => null);
          return client.focus();
        }
      }
      return clients.openWindow ? clients.openWindow(target) : null;
    })
  );
});
