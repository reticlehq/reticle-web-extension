// In the main world of the page, after the reader: connect it. The URL has the bridge's path, so
// the tunnel takes it. The native host knows the real port and adds the pairing token.
globalThis.__reticleInstance?.connect({
  url: 'ws://127.0.0.1:4400/reticle',
  allowNonLocalhost: true,
  lease: true,
});
