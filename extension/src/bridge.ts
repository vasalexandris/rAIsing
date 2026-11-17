import type { Conversation } from '../../src/types';

// Runs on the rAIsing page: hands captured conversations from extension storage to the app (and back an ack).
const post = (m: Record<string, unknown>) => window.postMessage({ source: 'raising-extension', ...m }, location.origin);
const getPending = async () => ((await chrome.storage.local.get('pending')) as { pending?: Conversation[] }).pending ?? [];

async function flush() {
  const pending = await getPending();
  if (pending.length) post({ type: 'import', conversations: pending });
}

window.addEventListener('message', async (e) => {
  if (e.source !== window || e.data?.source !== 'raising-app') return;
  if (e.data.type === 'ready') {
    post({ type: 'hello' });
    await flush();
  } else if (e.data.type === 'index' && Array.isArray(e.data.conversations)) {
    await chrome.storage.local.set({ index: e.data.conversations });
  } else if (e.data.type === 'ack') {
    const done: string[] = Array.isArray(e.data.externalIds) ? e.data.externalIds : [];
    const pending = await getPending();
    await chrome.storage.local.set({ pending: pending.filter((p) => !p.externalId || !done.includes(p.externalId)) });
  }
});

// lets the background script check that this page was loaded after the extension was installed
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'ping') sendResponse({ ok: true });
  return false;
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.pending) void flush();
});

post({ type: 'hello' });
