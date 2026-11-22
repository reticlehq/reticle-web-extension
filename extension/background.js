// Hands a tab to Reticle. A press on the toolbar button of the extension (a person, or the desktop
// realm through the Extensions menu) puts Reticle's reader into the page of that tab. The reader
// talks to the bridge through this extension and its native host, so the page's own rules for
// connections do not apply, and the pairing token never goes into the page.
//
// A tab that was handed over gets the reader again after each load, until the tab closes or a
// second press hands it back.

const HOST = 'sh.reticle.relay';
const HANDED = 'handed';
const TUNNEL = 'reticle-tunnel';

async function handedTabs() {
  const kept = await chrome.storage.session.get(HANDED);
  return new Set(kept[HANDED] ?? []);
}

async function keep(tabs) {
  await chrome.storage.session.set({ [HANDED]: [...tabs] });
}

async function giveReader(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['relay.js'], world: 'ISOLATED' });
  // One reader for each page. A second copy of the reader made a second HUD and a second set of
  // styles: a press on a tab that had one already put the HUD in the wrong place.
  const [has] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => undefined !== globalThis.__reticleInstance,
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    files: true === has?.result ? ['connect.js'] : ['tunnel.js', 'reticle-inject.js', 'connect.js'],
    world: 'MAIN',
  });
}

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id === undefined) {
    return;
  }
  const tabs = await handedTabs();
  // A second press hands the tab back: the reader stops, and a reload gives it no reader again.
  // A press on the wrong tab must be undone by the same key that made it.
  if (tabs.has(tab.id)) {
    tabs.delete(tab.id);
    await keep(tabs);
    await chrome.scripting
      .executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: () => globalThis.__reticleInstance?.disconnect(),
      })
      .catch(() => undefined);
    await chrome.action.setBadgeText({ tabId: tab.id, text: '' });
    return;
  }
  tabs.add(tab.id);
  await keep(tabs);
  await giveReader(tab.id);
  await chrome.action.setBadgeText({ tabId: tab.id, text: 'on' });
});

chrome.tabs.onUpdated.addListener(async (tabId, change) => {
  if (change.status !== 'complete' || !(await handedTabs()).has(tabId)) {
    return;
  }
  await giveReader(tabId).catch(() => undefined);
  await chrome.action.setBadgeText({ tabId, text: 'on' });
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const tabs = await handedTabs();
  if (tabs.delete(tabId)) {
    await keep(tabs);
  }
});

// One connection to the bridge for each page: the relay script of the page opens a port, and the
// port gets a native host of its own. What one side says, the other side gets.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== TUNNEL || port.sender?.tab?.id === undefined) {
    port.disconnect();
    return;
  }
  const host = chrome.runtime.connectNative(HOST);
  port.onMessage.addListener((message) => host.postMessage(message));
  host.onMessage.addListener((message) => port.postMessage(message));
  port.onDisconnect.addListener(() => host.disconnect());
  host.onDisconnect.addListener(() => {
    const why = chrome.runtime.lastError?.message ?? 'the native host stopped';
    port.postMessage({ type: 'close', code: 1011, reason: why });
    port.disconnect();
  });
});
