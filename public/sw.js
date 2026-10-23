/* GE EASY Campo — service worker (offline do app de campo e notificações push).
 * - arquivos estáticos do Next: cache primeiro (são imutáveis por hash);
 * - telas do /campo (sem dados pessoais: o app busca os dados à parte): rede primeiro, cópia local sem internet;
 * - nada de dados de outras telas ou de APIs de escrita fica em cache.
 * Ao revogar o aparelho, o app apaga estes caches e o banco local. */
const VERSAO = "campo-v1";
const ESTATICOS = `${VERSAO}-estaticos`;
const TELAS = `${VERSAO}-telas`;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(TELAS).then((c) => c.addAll(["/offline.html", "/brand/logo-192.png"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => !k.startsWith(VERSAO)).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

async function redePrimeiro(req, cache) {
  try {
    const res = await fetch(req);
    if (res.ok && res.type === "basic") (await caches.open(cache)).put(req, res.clone());
    return res;
  } catch {
    const cached = (await caches.match(req)) || (req.mode === "navigate" ? (await caches.match("/campo")) || (await caches.match("/offline.html")) : undefined);
    return cached || new Response(JSON.stringify({ offline: true }), { status: 503, headers: { "Content-Type": "application/json" } });
  }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/brand/")) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) caches.open(ESTATICOS).then((c) => c.put(req, res.clone()));
        return res;
      })),
    );
    return;
  }
  if (req.mode === "navigate" && url.pathname.startsWith("/campo")) {
    e.respondWith(redePrimeiro(req, TELAS));
    return;
  }
  // o pacote de dados do dia (clientes, endereços) NÃO vai para este cache: o app o guarda criptografado
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match("/offline.html")));
  }
});

// sincronização em segundo plano (quando o navegador suporta): avisa a tela aberta para enviar a fila
self.addEventListener("sync", (e) => {
  if (e.tag === "fila-campo") {
    e.waitUntil(self.clients.matchAll({ type: "window" }).then((cs) => cs.forEach((c) => c.postMessage({ tipo: "sincronizar" }))));
  }
});

self.addEventListener("message", (e) => {
  if (e.data && e.data.tipo === "limpar") {
    e.waitUntil(caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k)))));
  }
});

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { titulo: e.data ? e.data.text() : "GE EASY" }; }
  e.waitUntil(
    self.registration.showNotification(d.titulo || "GE EASY", {
      body: d.mensagem || "",
      icon: "/brand/logo-192.png",
      badge: "/brand/logo-32.png",
      tag: d.tag || undefined,
      data: { url: d.link || "/campo" },
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const alvo = (e.notification.data && e.notification.data.url) || "/campo";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
      for (const c of cs) if ("focus" in c) { c.navigate(alvo); return c.focus(); }
      return self.clients.openWindow(alvo);
    }),
  );
});
