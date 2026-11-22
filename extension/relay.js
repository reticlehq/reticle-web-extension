// In the isolated world of the page: carries the frames of the reader's tunnel between the page and
// the extension. Runs once for each document.
(() => {
  if (globalThis.__reticleRelay === true) {
    return;
  }
  globalThis.__reticleRelay = true;
  const TO_RELAY = '__reticleTunnel';
  const TO_PAGE = '__reticleTunnelBack';
  let port;
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.[TO_RELAY] !== true) {
      return;
    }
    const { type, data } = event.data;
    if (type === 'open') {
      port?.disconnect();
      port = chrome.runtime.connect({ name: 'reticle-tunnel' });
      port.onMessage.addListener((frame) => {
        window.postMessage({ ...frame, [TO_PAGE]: true }, location.origin);
      });
      port.onDisconnect.addListener(() => {
        window.postMessage({ type: 'close', code: 1006, reason: 'relay gone', [TO_PAGE]: true }, location.origin);
        port = undefined;
      });
    }
    port?.postMessage({ type, data });
    if (type === 'close') {
      port?.disconnect();
      port = undefined;
    }
  });
})();
