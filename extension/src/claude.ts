import type { Conversation } from '../../src/types';
import { captureCurrent, conversationIdFromUrl } from './claudeApi';

// Floating "send to rAIsing" button, only visible on a chat page. Shadow DOM keeps claude.ai's CSS out.
const host = document.createElement('div');
host.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;';
const root = host.attachShadow({ mode: 'open' });
root.innerHTML = `
  <style>
    button { font: 600 13px system-ui, sans-serif; padding: 8px 14px; border-radius: 999px; border: 0;
             background: #2f6fdb; color: #fff; cursor: pointer; box-shadow: 0 2px 10px rgba(0,0,0,.35); }
    button:hover { background: #2559b3; }
    button:disabled { opacity: .75; cursor: default; }
  </style>
  <button type="button" title="Στείλε αυτή τη συζήτηση στο rAIsing">⬆ rAIsing</button>`;
const btn = root.querySelector('button')!;
document.documentElement.appendChild(host);

const LABEL = '⬆ rAIsing';
const sync = () => {
  host.style.display = conversationIdFromUrl() ? '' : 'none';
};
setInterval(sync, 1000);
sync();

btn.addEventListener('click', async () => {
  btn.disabled = true;
  btn.textContent = '…';
  let label = LABEL;
  try {
    const conv = await captureCurrent();
    const { pending = [] } = (await chrome.storage.local.get('pending')) as { pending?: Conversation[] };
    const rest = pending.filter((p) => p.externalId !== conv.externalId);
    rest.push(conv);
    await chrome.storage.local.set({ pending: rest });
    await chrome.runtime.sendMessage({ type: 'open' });
    label = `✓ ${conv.messages.length} μην. · ${conv.branches.length - 1} διακλ.`;
  } catch (e) {
    console.error('[rAIsing]', e);
    label = '⚠ ' + (e instanceof Error ? e.message : 'Σφάλμα');
  }
  btn.textContent = label;
  setTimeout(() => {
    btn.textContent = LABEL;
    btn.disabled = false;
  }, 3500);
});
