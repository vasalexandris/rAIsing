const APP_URL = 'https://vasalexandris.github.io/rAIsing/';

async function openApp() {
  const [tab] = await chrome.tabs.query({ url: APP_URL + '*' });
  if (tab?.id !== undefined) {
    let bridged = false;
    try {
      bridged = !!(await chrome.tabs.sendMessage(tab.id, { type: 'ping' }))?.ok;
    } catch {
      /* no bridge in that tab */
    }
    // Tabs opened before the extension was installed/updated have no bridge: reload so it gets injected.
    if (!bridged) await chrome.tabs.reload(tab.id);
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: APP_URL });
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'open') {
    openApp().then(
      () => sendResponse({ ok: true }),
      () => sendResponse({ ok: false }),
    );
    return true; // async response
  }
  return false;
});
