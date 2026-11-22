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
const HOSTS_OF = {
  dia: join(support, 'Dia', 'User Data', 'NativeMessagingHosts'),
  chrome: join(support, 'Google', 'Chrome', 'NativeMessagingHosts'),
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

export function install({ dir, port = DEFAULT_PORT, reader }) {
  copyFileSync(readerPath(reader), join(here, 'extension', 'reticle-inject.js'));
  // A browser starts the host with a short PATH, so the host is started through the full path of
  // this Node.
  const start = join(here, 'host', 'host.sh');
  writeFileSync(
    start,
    `#!/bin/sh\nexec "${process.execPath}" "${join(here, 'host', 'host.mjs')}" --port ${String(port)} "$@"\n`,
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
  const done = install({ dir, port, reader: arg('reader') });
  process.stdout.write(
    `Wrote ${done.manifest}.\nNow load ${done.extension} once in each profile: the extensions page, developer mode, "Load unpacked".\n`,
  );
}
