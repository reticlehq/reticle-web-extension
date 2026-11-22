// In the main world of the page, after the reader: connect it. The URL has the bridge's path, so
// the tunnel takes it. The native host knows the real port, and puts the real pairing token in the
// HELLO in place of this placeholder.
//
// The placeholder is there because the reader refuses a page that is not on localhost when it has
// no token: discord.com and example.com joined nothing. It opens nothing by itself, because only
// the host's token is checked by the bridge.
globalThis.__reticleInstance?.connect({
  url: 'ws://127.0.0.1:4400/reticle',
  allowNonLocalhost: true,
  lease: true,
  token: 'set-by-the-native-host',
  // No HUD in the page: the desktop realm's HUD shows the work of the whole computer, the page's
  // actions with it. Two HUDs for one task was one too many.
  present: false,
});
