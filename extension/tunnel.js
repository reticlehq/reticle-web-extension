// In the main world of the page, before the reader: a socket to the bridge that goes through the
// extension. The reader opens `new WebSocket(url)` with the bridge's path; that one socket is a
// tunnel, and every other socket of the page is the real one. A ws:// socket from an https page is
// refused by the browser, and a page's connect-src rule can refuse it too: the tunnel has neither.
//
// ponytail: the page can read and post the same window messages. It can only speak as its own
// session, and the pairing token is added by the native host, outside the page.
(() => {
  if (globalThis.__reticleTunnel === true) {
    return;
  }
  globalThis.__reticleTunnel = true;
  // The reader's schemas make no `new Function` (a page's CSP can refuse it), as for the lease reader.
  (globalThis.__zod_globalConfig ??= {}).jitless ??= true;
  const TO_RELAY = '__reticleTunnel';
  const TO_PAGE = '__reticleTunnelBack';
  const BRIDGE_PATH = '/reticle';
  const Native = globalThis.WebSocket;

  class TunnelSocket {
    constructor(url) {
      this.url = url;
      this.readyState = Native.CONNECTING;
      this.onopen = null;
      this.onmessage = null;
      this.onclose = null;
      this.onerror = null;
      this.listen = (event) => {
        if (event.source !== window || event.data?.[TO_PAGE] !== true) {
          return;
        }
        const { type, data, code, reason } = event.data;
        if (type === 'open') {
          this.readyState = Native.OPEN;
          this.onopen?.(new Event('open'));
        } else if (type === 'message') {
          this.onmessage?.(new MessageEvent('message', { data }));
        } else if (type === 'close') {
          this.#closed(code ?? 1000, reason ?? '');
        }
      };
      window.addEventListener('message', this.listen);
      window.postMessage({ [TO_RELAY]: true, type: 'open' }, location.origin);
    }

    send(text) {
      if (this.readyState === Native.OPEN) {
        window.postMessage({ [TO_RELAY]: true, type: 'send', data: String(text) }, location.origin);
      }
    }

    close() {
      if (this.readyState !== Native.CLOSED) {
        window.postMessage({ [TO_RELAY]: true, type: 'close' }, location.origin);
        this.#closed(1000, '');
      }
    }

    #closed(code, reason) {
      if (this.readyState === Native.CLOSED) {
        return;
      }
      this.readyState = Native.CLOSED;
      window.removeEventListener('message', this.listen);
      this.onclose?.(new CloseEvent('close', { code, reason }));
    }
  }

  const isBridge = (url) => {
    try {
      return new URL(String(url), location.href).pathname === BRIDGE_PATH;
    } catch {
      return false;
    }
  };
  class Socket extends Native {
    constructor(url, protocols) {
      if (isBridge(url)) {
        return new TunnelSocket(url);
      }
      super(url, protocols);
    }
  }
  globalThis.WebSocket = Socket;
})();
