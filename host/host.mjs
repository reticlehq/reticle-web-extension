// The native host of the Reticle extension: the browser starts one for each page that was handed
// to Reticle. It reads the frames of the page's tunnel on stdin, and keeps one socket to the bridge.
// It adds the pairing token to the page's HELLO, so the token stays out of the page.
//
// Native messaging: each message is a 4-byte length (little-endian) and then that much JSON.
//
//   node host.mjs [--port 4400]
//
// `install.mjs` writes the manifest that lets a browser start it. Not for a person to run.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_PORT, HELLO_KIND, TOKEN_DIR, TOKEN_DIR_ENV, TOKEN_FILE, bridgeUrl } from './constants.mjs';

const at = process.argv.indexOf('--port');
const port = at > 0 ? Number(process.argv[at + 1]) : DEFAULT_PORT;
const tokenDir = process.env[TOKEN_DIR_ENV] ?? join(homedir(), TOKEN_DIR);

function token() {
  try {
    return readFileSync(join(tokenDir, TOKEN_FILE), 'utf8').trim();
  } catch {
    return undefined;
  }
}

function say(frame) {
  const body = Buffer.from(JSON.stringify(frame));
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([head, body]));
}

/** The page's HELLO, with the pairing token. Every other frame goes as it came. */
function withToken(text) {
  const secret = token();
  if (secret === undefined) {
    return text;
  }
  try {
    const message = JSON.parse(text);
    if (message?.kind !== HELLO_KIND) {
      return text;
    }
    return JSON.stringify({ ...message, token: secret });
  } catch {
    return text;
  }
}

let socket;
function onFrame({ type, data }) {
  if (type === 'open') {
    socket?.close();
    socket = new WebSocket(bridgeUrl(port));
    socket.onopen = () => say({ type: 'open' });
    socket.onmessage = (event) => say({ type: 'message', data: String(event.data) });
    socket.onclose = (event) => {
      say({ type: 'close', code: event.code, reason: event.reason });
      process.exit(0);
    };
    socket.onerror = () => undefined;
  } else if (type === 'send' && socket?.readyState === WebSocket.OPEN) {
    socket.send(withToken(String(data)));
  } else if (type === 'close') {
    socket?.close();
  }
}

let pending = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  pending = Buffer.concat([pending, chunk]);
  while (pending.length >= 4) {
    const size = pending.readUInt32LE(0);
    if (pending.length < 4 + size) {
      return;
    }
    const body = pending.subarray(4, 4 + size).toString('utf8');
    pending = pending.subarray(4 + size);
    try {
      onFrame(JSON.parse(body));
    } catch {
      // A frame that is not JSON is not from the extension. It is dropped.
    }
  }
});
// The browser closes stdin when the page goes away: close the bridge socket with it.
process.stdin.on('end', () => {
  socket?.close();
  process.exit(0);
});
