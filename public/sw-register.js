// Guarda o app no aparelho para abrir mesmo sem internet (public/sw.js).
// Fica num arquivo (e não dentro do index.html) por causa da CSP do site:
// só script com endereço próprio roda (ver vercel.json).
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').catch(function () {});
    // O que a página já baixou antes do service worker vai para o cache também.
    navigator.serviceWorker.ready.then(function (registration) {
      var urls = performance.getEntriesByType('resource').map(function (entry) {
        return entry.name;
      });
      if (registration.active) registration.active.postMessage({ type: 'precache', urls: urls });
    });
  });
}
