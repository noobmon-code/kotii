// Service worker do Nooky na web: guarda o app para abrir sem internet.
// - Páginas: rede primeiro; sem rede, a última index.html guardada (sempre com os bundles dela).
// - /_expo/static, /assets e /icons: arquivos com hash no nome, guardados já
//   na instalação (e na primeira vez que aparecem) e servidos do cache depois.
// - O resto (Supabase, outros domínios) passa direto: os dados ficam com o app.
const VERSION = 'nooky-v1';
const SHELL = '/index.html';
const STATIC = ['/_expo/static/', '/assets/', '/icons/'];

const cacheable = (url) => url.origin === self.location.origin && STATIC.some((prefix) => url.pathname.startsWith(prefix));

/** Guarda cada endereço que ainda não está no cache; um que falhe não derruba os outros. */
async function precache(urls) {
  const cache = await caches.open(VERSION);
  await Promise.all(
    urls.map(async (url) => {
      if (await cache.match(url)) return;
      const response = await fetch(url).catch(() => null);
      if (response && response.ok) await cache.put(url, response);
    }),
  );
}

/**
 * Guarda a página só depois do JavaScript/CSS que ela referencia. Se algum
 * falhar, lança e a página guardada antes continua valendo: nunca fica uma
 * index.html apontando para um bundle que não está no cache.
 */
async function cacheShell(response) {
  const html = await response.clone().text();
  const assets = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)]
    .map((match) => new URL(match[1], self.location.origin))
    .filter(cacheable)
    .map((url) => url.pathname);
  const cache = await caches.open(VERSION);
  await Promise.all(
    assets.map(async (url) => {
      if (await cache.match(url)) return;
      const asset = await fetch(url);
      if (!asset.ok) throw new Error(`${url}: ${asset.status}`);
      await cache.put(url, asset);
    }),
  );
  await cache.put(SHELL, response);
}

// Na instalação já guarda a página e o que ela carrega: sem isso, na primeira
// visita o app instalado não abriria sem internet (a página e o bundle
// carregaram antes de o service worker existir). Se algo falhar, a instalação
// falha junto e o navegador tenta de novo na próxima visita — nunca fica
// ativo um service worker sem o app guardado.
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const response = await fetch(SHELL, { cache: 'reload' });
      if (!response.ok) throw new Error(`${SHELL}: ${response.status}`);
      await cacheShell(response);
      await self.skipWaiting();
    })(),
  );
});

// A página manda o que já baixou antes de o service worker assumir (fontes,
// imagens, pedaços do bundle), para guardar também.
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'precache' || !Array.isArray(event.data.urls)) return;
  const urls = event.data.urls
    .map((raw) => {
      try {
        return new URL(raw, self.location.origin);
      } catch {
        return null;
      }
    })
    .filter((url) => url && cacheable(url))
    .map((url) => url.pathname + url.search);
  event.waitUntil(precache(urls));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    // Cópia feita na hora, antes de o navegador ler a resposta.
    const network = fetch(request).then((response) => ({ response, copy: response.ok ? response.clone() : null }));
    event.respondWith(
      network
        .then(({ response }) => response)
        .catch(() => caches.match(SHELL).then((cached) => cached || Response.error())),
    );
    // Página nova (deploy novo) só substitui a guardada com os bundles dela no cache.
    event.waitUntil(network.then(({ copy }) => (copy ? cacheShell(copy) : undefined)).catch(() => undefined));
    return;
  }

  if (cacheable(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(VERSION).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});
