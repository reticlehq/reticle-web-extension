// Gets the Reticle extension ready for a browser, on macOS:
//
//   node install.mjs --browser dia        (or chrome, or chromium)
//   node install.mjs --dir <NativeMessagingHosts folder> [--port 4400] [--reader <reticle-inject.js>]
//
// It copies the reader of `@reticlehq/browser` into the extension folder, and writes the manifest
// that lets the browser start the native host. Then load the extension folder once in each browser
// profile: open the extensions page, turn on developer mode, and choose "Load unpacked".
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_PORT, HOST_NAME } from './host/constants.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const support = join(homedir(), 'Library', 'Application Support');
/** Where the host runs from: a folder that every browser may read. */
const HOST_HOME = join(support, 'Reticle', 'web-extension');
const CHROME_HOSTS = join(support, 'Google', 'Chrome', 'NativeMessagingHosts');
/** Where each browser looks for a native host. Dia looks in Chrome's folder, not in its own. */
const HOSTS_OF = {
  dia: CHROME_HOSTS,
  chrome: CHROME_HOSTS,
  chromium: join(support, 'Chromium', 'NativeMessagingHosts'),
};

const arg = (name) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1] : undefined;
};

/** The ID a Chromium browser gives the extension: from the public key in its manifest. */
export function extensionId(key) {
  const hash = createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32);
  return [...hash].map((digit) => String.fromCharCode(97 + parseInt(digit, 16))).join('');
}

/** The reader of `@reticlehq/browser`: the one installed here, or the file `--reader` names. */
function readerPath(given) {
  return given ?? createRequire(import.meta.url).resolve('@reticlehq/browser/inject');
}

export function install({ browser, dir = HOSTS_OF[browser ?? ''], port = DEFAULT_PORT, reader }) {
  if (dir === undefined) {
    throw new Error('Give a browser (dia, chrome or chromium) or the NativeMessagingHosts folder.');
  }
  copyFileSync(readerPath(reader), join(here, 'extension', 'reticle-inject.js'));
  // The host is copied out of this folder. macOS counts a host as the browser that starts it, and
  // a browser with no right to ~/Documents cannot read a host that is there: Dia started it, and it
  // ended before its first line.
  mkdirSync(HOST_HOME, { recursive: true });
  for (const file of ['host.mjs', 'constants.mjs']) {
    copyFileSync(join(here, 'host', file), join(HOST_HOME, file));
  }
  // A browser starts the host with a short PATH, so the host is started through the full path of
  // this Node.
  const start = join(HOST_HOME, 'host.sh');
  writeFileSync(
    start,
    `#!/bin/sh\nexec "${process.execPath}" "${join(HOST_HOME, 'host.mjs')}" --port ${String(port)} "$@"\n`,
  );
  chmodSync(start, 0o755);
  const { key } = JSON.parse(readFileSync(join(here, 'extension', 'manifest.json'), 'utf8'));
  mkdirSync(dir, { recursive: true });
  const manifest = join(dir, `${HOST_NAME}.json`);
  writeFileSync(
    manifest,
    `${JSON.stringify(
      {
        name: HOST_NAME,
        description: 'Carries the pages handed to Reticle to the Reticle bridge.',
        path: start,
        type: 'stdio',
        allowed_origins: [`chrome-extension://${extensionId(key)}/`],
      },
      null,
      2,
    )}\n`,
  );
  return { manifest, extension: join(here, 'extension') };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const browser = arg('browser');
  const dir = arg('dir') ?? HOSTS_OF[browser ?? ''];
  if (dir === undefined) {
    process.stderr.write('Give --browser dia, chrome or chromium, or --dir <NativeMessagingHosts folder>.\n');
    process.exit(2);
  }
  const port = arg('port') === undefined ? DEFAULT_PORT : Number(arg('port'));
  const done = install({ browser, dir, port, reader: arg('reader') });
  process.stdout.write(
    `Wrote ${done.manifest}.\nNow load ${done.extension} once in each profile: the extensions page, developer mode, "Load unpacked".\n`,
  );
}
