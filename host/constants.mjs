// The names this repository shares with Reticle's bridge. They are Reticle's wire contract
// (`@reticlehq/core`), written here so that the host needs nothing installed to start.

/** The name a browser knows the native host by, in its manifest and in `connectNative`. */
export const HOST_NAME = 'sh.reticle.relay';
/** The port the Reticle daemon listens on when nothing else is said. */
export const DEFAULT_PORT = 4400;
/** The path of the bridge's WebSocket. */
export const BRIDGE_PATH = '/reticle';
/** The first message a page sends the bridge. */
export const HELLO_KIND = 'hello';
/** Where the daemon keeps its pairing token: `~/.reticle/pairing-token`, or the folder in this variable. */
export const TOKEN_DIR_ENV = 'RETICLE_PAIRING_TOKEN_DIR';
export const TOKEN_DIR = '.reticle';
export const TOKEN_FILE = 'pairing-token';

export function bridgeUrl(port) {
  return `ws://127.0.0.1:${String(port)}${BRIDGE_PATH}`;
}
