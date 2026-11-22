# Reticle web extension

Hands a tab of a real browser to Reticle. An agent can then read and act on the page with the
page tools (DOM, network, console, framework state), with no SDK in the app and no debug port.

It works in Chromium browsers: Dia, Chrome, Arc, Brave, Edge.

## How a tab is handed over

1. A person, or Reticle's desktop realm, presses the extension's button or its key, `Alt+Shift+R`.
2. The extension puts Reticle's reader into the page of that tab.
3. The reader talks to the Reticle bridge through the extension and its native host
   (`host/host.mjs`). The page's own connection rules do not apply, and the pairing token never
   goes into the page.
4. The tab gets the reader again after each load, until it closes.

## Install

```sh
npm install
node install.mjs --browser dia        # or chrome, or chromium
```

Then load the `extension` folder once in each browser profile: open the extensions page, turn on
developer mode, and choose "Load unpacked".

`install.mjs` copies the native host to `~/Library/Application Support/Reticle/web-extension/`, and
writes its manifest into the folder where the browser looks for native hosts. Two things that Dia
showed:

- Dia looks in Chrome's folder (`~/Library/Application Support/Google/Chrome/NativeMessagingHosts`),
  not in its own.
- macOS counts a native host as the browser that starts it. A browser with no right to
  `~/Documents` cannot start a host that is in `~/Documents`, so the host is copied out.

Give `--port` when the daemon does not listen on 4400, and `--reader <reticle-inject.js>` to use a
local build of `@reticlehq/browser`.

## Check

`test/handoff.mjs` opens a tab in Dia, hands it over with the key through Reticle's desktop realm,
and proves a fill and a press on the page. The page forbids every connection of its own:

```sh
RETICLE_REPO=../reticle node test/handoff.mjs
```

It needs macOS, Dia with the extension loaded, the Accessibility permission, and a built Reticle
checkout with the desktop realm.
