// Reticle's desktop realm hands a tab of the real Dia to browser-level Reticle, through this
// extension, and a fill and a press are proved on the page with the tools an agent has.
//
// The page forbids every connection of its own (`connect-src 'none'`), and the reader still
// connects: it goes through the extension and its native host, not through the page.
//
//   RETICLE_REPO=../reticle node test/handoff.mjs
//
// macOS, Dia with this extension loaded, the Accessibility permission, and a built Reticle
// checkout with the desktop realm. Not a gate: it takes the screen for a few seconds. It opens a
// tab of its own and closes it at the end. It uses a bridge of its own on port 14459, and puts the
// native host back on the usual port at the end.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { install } from '../install.mjs';
import { DEFAULT_PORT, TOKEN_DIR, TOKEN_FILE } from '../host/constants.mjs';

// A built checkout of Reticle: its bridge, and its desktop realm.
const reticle = new URL(`${process.env.RETICLE_REPO ?? '../../reticle'}/`, import.meta.url);
const at = (path) => new URL(path, reticle).href;
const { ActionType, ReticleCommand } = await import(at('core/dist/index.js'));
const { MacDriver, PeerCommands } = await import(at('adapters/realm/computer-use/dist/index.js'));
const { Bridge } = await import(at('server/dist/portal/bridge/bridge.js'));
const { callTool, makeDeps, waitUntil } = await import(
  at('server/dist/portal/bridge/bridge.test-harness.js')
);
const native = fileURLToPath(new URL('adapters/realm/computer-use/native/mac/', reticle));
const reader = fileURLToPath(new URL('adapters/realm/browser/dist/reticle-inject.js', reticle));

const osa = (script) => execFileSync('osascript', ['-e', script], { encoding: 'utf8' }).trim();
const PORT = 14459;
const NOTE = 'Handed over in Dia';

// The host reads the person's pairing token (`~/.reticle/pairing-token`): a browser passes it no
// other folder. The daemon writes that file on its first start.
let token;
try {
  token = readFileSync(join(homedir(), TOKEN_DIR, TOKEN_FILE), 'utf8').trim();
} catch {
  console.error('handoff: no ~/.reticle/pairing-token. Start the Reticle daemon once. Nothing was run.');
  process.exit(0);
}
const bridge = new Bridge({ port: PORT, token });
await bridge.ready;
const deps = makeDeps(bridge);
install({ browser: 'dia', port: PORT, reader });

const page = readFileSync(`${native}form.html`, 'utf8');
const server = createServer((_request, response) => {
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': "connect-src 'none'; script-src 'self' 'unsafe-inline'",
  });
  response.end(page);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${String(server.address().port)}/`;

osa(`tell application "Dia" to tell front window to make new tab with properties {URL:"${url}"}`);
try {
  osa('tell application "Dia" to activate');
  await sleep(2000);
  assert.equal(osa('tell application "Dia" to get URL of active tab of front window'), url);
  const pid = Number(execFileSync('pgrep', ['-x', 'Dia'], { encoding: 'utf8' }).split('\n')[0]);
  const desktop = new PeerCommands({
    driver: new MacDriver({ helper: `${native}build/reticle-ax`, app: 'Dia', pid }),
    emit: () => undefined,
    foreground: true,
  });
  // With Stage Manager on, Dia has no window to read until it is in front.
  let window;
  for (let tries = 0; tries < 10 && window === undefined; tries += 1) {
    osa('tell application "Dia" to activate');
    await sleep(500);
    window = (await desktop.answer(ReticleCommand.QUERY, { role: 'window' })).elements[0];
  }
  assert.ok(window, 'Dia has no window to read');
  assert.equal(bridge.sessions.list().length, 0, 'a page joined before it was handed over');

  // The baton: the key of the extension, pressed in Dia as a person presses it.
  await desktop.answer(ReticleCommand.ACT, {
    ref: window.ref,
    action: ActionType.PRESS,
    args: { text: 'r', modifiers: ['Alt', 'Shift'], foreground: true, settleMs: 600 },
  });
  await waitUntil(() => bridge.sessions.list().length > 0, 8000);

  const tree = (await callTool(deps, 'reticle_snapshot', {})).tree;
  const refOf = (element) =>
    /ref=(e\d+)/.exec(tree.split('\n').find((line) => line.includes(`- ${element}`)) ?? '')?.[1];
  await callTool(deps, 'reticle_act', {
    ref: refOf('textbox "New note"'),
    action: 'fill',
    args: { value: NOTE },
  });
  const proved = await callTool(deps, 'reticle_act_and_wait', {
    ref: refOf('button "Add"'),
    action: 'click',
    timeout_ms: 3000,
    until: { kind: 'element', query: { role: 'listitem', name: NOTE }, state: 'visible' },
  });
  assert.equal(proved.verified, 'yes', `the press was not proved: ${String(proved.because)}`);
  console.error('handoff: the desktop realm handed a Dia tab over, and a press was proved on it');
} finally {
  if (osa('tell application "Dia" to get URL of active tab of front window') === url) {
    osa('tell application "Dia" to close active tab of front window');
  }
  install({ browser: 'dia', port: DEFAULT_PORT, reader });
  server.close();
  await bridge.close();
  setTimeout(() => process.exit(process.exitCode ?? 0), 300);
}
