import type { Conversation } from '../../src/types';
import { captureCurrent, conversationIdFromUrl } from './claudeApi';

/** Light index of the user's rAIsing conversations, pushed by the app (see bridge.ts). */
interface IndexConv {
  id: string;
  title: string;
  externalId?: string;
  linkedExternalIds?: string[];
  updatedAt: number;
  messages: { id: string; num: string; role: string; snippet: string }[];
}
type LinkTo = { convId: string; forkMsgId: string };

// Floating "send to rAIsing" button, only visible on a chat page. Shadow DOM keeps claude.ai's CSS out.
const host = document.createElement('div');
host.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;';
const root = host.attachShadow({ mode: 'open' });
root.innerHTML = `
  <style>
    * { box-sizing: border-box; font-family: system-ui, sans-serif; }
    .btn { font: 600 13px system-ui, sans-serif; padding: 8px 14px; border-radius: 999px; border: 0;
           background: #2f6fdb; color: #fff; cursor: pointer; box-shadow: 0 2px 10px rgba(0,0,0,.35); float: right; }
    .btn:hover { background: #2559b3; }
    .btn:disabled { opacity: .75; cursor: default; }
    .panel { position: absolute; right: 0; bottom: 44px; width: 340px; background: #fff; color: #1f2328; border-radius: 12px;
             padding: 12px; box-shadow: 0 6px 24px rgba(0,0,0,.35); font-size: 13px; display: flex; flex-direction: column; gap: 8px; }
    .panel[hidden] { display: none; }
    .panel label { display: flex; gap: 6px; align-items: center; }
    .panel select { width: 100%; padding: 5px; border: 1px solid #ccc; border-radius: 6px; font-size: 12px; }
    .panel .sub { display: flex; flex-direction: column; gap: 6px; padding-left: 22px; }
    .panel .sub[hidden] { display: none; }
    .row { display: flex; gap: 8px; justify-content: flex-end; }
    .row button { padding: 6px 12px; border-radius: 6px; border: 1px solid #ccc; background: #fff; cursor: pointer; }
    .row .ok { background: #2f6fdb; color: #fff; border-color: #2f6fdb; }
  </style>
  <div class="panel" hidden></div>
  <button class="btn" type="button" title="Στείλε αυτή τη συζήτηση στο rAIsing">⬆ rAIsing</button>`;
const btn = root.querySelector<HTMLButtonElement>('.btn')!;
const panel = root.querySelector<HTMLDivElement>('.panel')!;
document.documentElement.appendChild(host);

const LABEL = '⬆ rAIsing';
const sync = () => {
  host.style.display = conversationIdFromUrl() ? '' : 'none';
};
setInterval(sync, 1000);
sync();

type Tag = 'div' | 'input' | 'select' | 'button' | 'label' | 'strong';
function el<K extends Tag>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  Object.assign(n, props);
  n.append(...kids);
  return n;
}

/**
 * For a chat rAIsing doesn't know yet: ask whether it is a standalone conversation or a branch
 * of an existing one (and from which message). Resolves null = standalone, 'cancel' = abort.
 * All text is inserted with textContent/Option, never as HTML.
 */
function chooseTarget(index: IndexConv[]): Promise<LinkTo | null | 'cancel'> {
  return new Promise((resolve) => {
    const convs = [...index].sort((a, b) => b.updatedAt - a.updatedAt);
    panel.replaceChildren();

    const rNew = el('input', { type: 'radio', name: 'mode', checked: true });
    const rBranch = el('input', { type: 'radio', name: 'mode' });
    const selConv = el('select');
    const selMsg = el('select');
    const sub = el('div', { className: 'sub', hidden: true }, selConv, selMsg);

    for (const c of convs) selConv.add(new Option(`${c.title} (${c.messages.length})`, c.id));
    const fillMessages = () => {
      selMsg.replaceChildren();
      const c = convs.find((x) => x.id === selConv.value);
      for (const m of c?.messages ?? []) selMsg.add(new Option(`#${m.num} ${m.role === 'user' ? 'Εγώ' : 'ΑΙ'}: ${m.snippet}`, m.id));
      if (selMsg.options.length) selMsg.selectedIndex = selMsg.options.length - 1; // default: last message
    };
    fillMessages();
    selConv.addEventListener('change', fillMessages);
    const toggle = () => {
      sub.hidden = !rBranch.checked;
    };
    rNew.addEventListener('change', toggle);
    rBranch.addEventListener('change', toggle);

    const done = (v: LinkTo | null | 'cancel') => {
      panel.hidden = true;
      resolve(v);
    };
    const ok = el('button', { className: 'ok', type: 'button' }, 'Αποστολή');
    const cancel = el('button', { type: 'button' }, 'Άκυρο');
    ok.addEventListener('click', () =>
      done(rBranch.checked && selConv.value && selMsg.value ? { convId: selConv.value, forkMsgId: selMsg.value } : null),
    );
    cancel.addEventListener('click', () => done('cancel'));

    panel.append(
      el('strong', {}, 'Αποστολή στο rAIsing'),
      el('label', {}, rNew, 'Ξεχωριστή συζήτηση'),
      el('label', {}, rBranch, 'Διακλάδωση υπάρχουσας συζήτησης'),
      sub,
      el('div', { className: 'row' }, cancel, ok),
    );
    panel.hidden = false;
  });
}

btn.addEventListener('click', async () => {
  btn.disabled = true;
  btn.textContent = '…';
  let label = LABEL;
  try {
    const conv = (await captureCurrent()) as Conversation & { linkTo?: LinkTo };
    const { pending = [], index = [] } = (await chrome.storage.local.get(['pending', 'index'])) as {
      pending?: Conversation[];
      index?: IndexConv[];
    };
    // Already known to rAIsing (standalone or as a branch) -> just update it in place.
    const known = index.some((c) => c.externalId === conv.externalId || c.linkedExternalIds?.includes(conv.externalId ?? ''));
    if (!known && index.length > 0) {
      btn.textContent = 'Διάλεξε…';
      const choice = await chooseTarget(index);
      if (choice === 'cancel') {
        btn.textContent = LABEL;
        btn.disabled = false;
        return;
      }
      if (choice) conv.linkTo = choice;
    }
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
