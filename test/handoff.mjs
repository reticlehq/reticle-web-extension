// The desktop realm hands a browser tab to browser-level Reticle through the Reticle extension, in
// a real browser with no debug port: the realm presses the extension's key (Alt+Shift+R), as a
// person would. The page then joins the bridge as a browser session, and a fill and a press are
// proved through the tools an agent has.
//
// The page forbids every connection of its own (`connect-src 'none'`), and the reader still
// connects: it goes through the extension and its native host, not through the page.
//
//   RETICLE_REPO=../reticle node test/handoff.mjs
//
// macOS, with the Accessibility permission and Playwright's Chromium (`npx playwright install
// chromium`). Build the repository first. Not a gate: it opens a browser on the screen. The browser
// runs with a profile of this run, so it reads no account, and the native host is written into that
// profile only.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { install } from '../install.mjs';

// A built checkout of Reticle: its bridge, and its desktop realm.
const reticle = new URL(`${process.env.RETICLE_REPO ?? '../../reticle'}/`, import.meta.url);
const { ActionType, ReticleCommand } = await import(new URL('core/dist/index.js', reticle).href);
const { MacDriver, PeerCommands } = await import(
  new URL('adapters/realm/computer-use/dist/index.js', reticle).href
);
const { Bridge } = await import(new URL('server/dist/portal/bridge/bridge.js', reticle).href);
const { callTool, makeDeps, waitUntil } = await import(
  new URL('server/dist/portal/bridge/bridge.test-harness.js', reticle).href
);

const APP = 'Google Chrome for Testing';
const cache = join(homedir(), 'Library', 'Caches', 'ms-playwright');
const build = existsSync(cache)
  ? readdirSync(cache)
      .filter((name) => /^chromium-\d+$/.test(name))
      .sort()
      .at(-1)
  : undefined;
const binary =
  build === undefined
    ? undefined
    : join(cache, build, 'chrome-mac-arm64', `${APP}.app`, 'Contents', 'MacOS', APP);
if ('darwin' !== process.platform || binary === undefined || !existsSync(binary)) {
  console.error('computer-use-extension: not macOS, or no Playwright Chromium. Nothing was run.');
  process.exit(0);
}
const native = fileURLToPath(new URL('adapters/realm/computer-use/native/mac/', reticle));
execFileSync('swiftc', ['-O', `${native}reticle-ax.swift`, '-o', `${native}build/reticle-ax`], {
  stdio: 'ignore',
});

// A port and a token of this run, so that a daemon of the person is not touched.
const PORT = 14458;
const TOKEN = 'extension';
const tokens = mkdtempSync(join(tmpdir(), 'reticle-ext-token-'));
writeFileSync(join(tokens, 'pairing-token'), TOKEN);
const bridge = new Bridge({ port: PORT, token: TOKEN });
await bridge.ready;
const deps = makeDeps(bridge);

// The page allows no connection and no script from anywhere but itself.
const page = readFileSync(`${native}form.html`, 'utf8');
const server = createServer((_request, response) => {
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': "connect-src 'none'; script-src 'self' 'unsafe-inline'",
  });
  response.end(page);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const pageUrl = `http://127.0.0.1:${String(server.address().port)}/`;

const profile = mkdtempSync(join(tmpdir(), 'reticle-ext-chromium-'));
const { extension } = install({
  dir: join(profile, 'NativeMessagingHosts'),
  port: PORT,
  reader: fileURLToPath(new URL('adapters/realm/browser/dist/reticle-inject.js', reticle)),
});
const browser = spawn(
  binary,
  [
    `--user-data-dir=${profile}`,
    `--load-extension=${extension}`,
    // Chrome 137 and later ignore --load-extension without this.
    '--disable-features=DisableLoadExtensionCommandLineSwitch',
    '--no-first-run',
    '--no-default-browser-check',
    pageUrl,
  ],
  { env: { ...process.env, RETICLE_PAIRING_TOKEN_DIR: tokens }, stdio: 'ignore' },
);

try {
  const driver = new MacDriver({ helper: `${native}build/reticle-ax`, app: APP, pid: browser.pid });
  const desktop = new PeerCommands({ driver, emit: () => undefined, foreground: true });
  await waitUntil(
    async () => (await driver.read()).root.children.some((child) => 'window' === child.role),
    20_000,
  );
  // A browser this script starts is not in front, and with Stage Manager on it has no window to
  // read until it is: bring it forward, as a person who clicks it does.
  // By process: `open -a` starts a second browser with the default profile.
  execFileSync('osascript', [
    '-e',
    `tell application "System Events" to set frontmost of (first process whose unix id is ${String(browser.pid)}) to true`,
  ]);
  await sleep(1500);
  assert.equal(bridge.sessions.list().length, 0, 'the page joined before it was handed over');

  // The desktop realm hands the tab over: the key of the extension, pressed in the window.
  // Stage Manager moves a window that comes forward for a moment: until it stops, the realm
  // says that a person cannot reach it, and that is true. So the press is tried a few times.
  let pressed = '';
  for (let tries = 0; tries < 6 && 'done' !== pressed; tries += 1) {
    const window = (await desktop.answer(ReticleCommand.QUERY, { role: 'window' })).elements[0];
    pressed = await desktop
      .answer(ReticleCommand.ACT, {
        ref: window?.ref,
        action: ActionType.PRESS,
        args: { text: 'r', modifiers: ['Alt', 'Shift'], foreground: true, settleMs: 800 },
      })
      .then(
        () => 'done',
        (error) => String(error),
      );
    if ('done' !== pressed) {
      await sleep(800);
    }
  }
  assert.equal(pressed, 'done', `the key of the extension was not pressed: ${pressed}`);
  await waitUntil(() => bridge.sessions.list().length > 0, 15_000);

  // The baton: the page is a browser session now, read and driven with the page tools.
  const tree = (await callTool(deps, 'reticle_snapshot', {})).tree;
  const refOf = (element) =>
    /ref=(e\d+)/.exec(tree.split('\n').find((line) => line.includes(`- ${element}`)) ?? '')?.[1];
  assert.ok(refOf('button "Add"'), `the handed tab was not read:\n${tree}`);
  await callTool(deps, 'reticle_act', {
    ref: refOf('textbox "New note"'),
    action: 'fill',
    args: { value: 'Handed over' },
  });
  const proved = await callTool(deps, 'reticle_act_and_wait', {
    ref: refOf('button "Add"'),
    action: 'click',
    timeout_ms: 3000,
    until: { kind: 'element', query: { role: 'text', text: 'Handed over' }, state: 'visible' },
  });
  assert.equal(proved.verified, 'yes', `the press did not reach the page: ${String(proved.because)}`);
  console.error(
    'computer-use extension: the desktop realm handed the tab over, and a press was proved on the page',
  );
} finally {
  browser.kill();
  server.close();
  await bridge.close();
  await sleep(1500);
  rmSync(profile, { recursive: true, force: true });
  rmSync(tokens, { recursive: true, force: true });
  setTimeout(() => process.exit(process.exitCode ?? 0), 200);
}
