import type { Conversation } from '../../../src/types';
import { domToMarkdown } from '../domMarkdown';
import { linearConversation, type LinearMsg } from '../linear';

// Structure verified on gemini.google.com: one div.conversation-container per turn (stable id),
// .query-text = the user's text, message-content = the model's answer. Older turns load when the
// infinite-scroller is scrolled to the top.
const SCROLLER = '[data-test-id="chat-history-container"]';
const TURN = 'div.conversation-container';

export function geminiId(url: string = location.href): string | null {
  return /\/(?:app|gem\/[^/]+)\/([0-9a-f]{8,})/i.exec(new URL(url).pathname)?.[1] ?? null;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const turns = () => Array.from(document.querySelectorAll<HTMLElement>(TURN));

/** Scroll to the top until no more turns appear, then put the view back where the user was. */
async function loadAllTurns(): Promise<void> {
  for (let i = 0; i < 30 && turns().length === 0; i++) await wait(300);
  const sc = document.querySelector<HTMLElement>(SCROLLER);
  if (!sc) return;
  const fromBottom = sc.scrollHeight - sc.scrollTop;
  let last = turns().length;
  let stable = 0;
  for (let round = 0; round < 200 && stable < 3; round++) {
    sc.scrollTop = 0;
    await wait(900);
    const c = turns().length;
    if (c === last) stable++;
    else {
      stable = 0;
      last = c;
    }
  }
  sc.scrollTop = Math.max(0, sc.scrollHeight - fromBottom);
}

export async function captureGemini(): Promise<Conversation> {
  const convId = geminiId();
  if (!convId) throw new Error('Άνοιξε μια συζήτηση στο Gemini.');
  await loadAllTurns();

  const msgs: LinearMsg[] = [];
  turns().forEach((t, i) => {
    const key = t.id || String(i);
    // The hidden screen-reader label ("You said") lives in an h5 next to the real lines.
    const lines = Array.from(t.querySelectorAll<HTMLElement>('.query-text .query-text-line'));
    const q = t.querySelector<HTMLElement>('.query-text');
    const userText = lines.length
      ? lines.map((l) => l.innerText.trim()).join('\n')
      : (q?.innerText ?? '').replace(/^\s*(You said|Εσείς είπατε)\s*/i, '').trim();
    if (userText) msgs.push({ id: `gemini:${convId}:${key}:u`, role: 'user', text: userText });
    const answers = Array.from(t.querySelectorAll('message-content'));
    const text = answers.map((a) => domToMarkdown(a)).filter(Boolean).join('\n\n');
    if (text) msgs.push({ id: `gemini:${convId}:${key}:a`, role: 'ai', text });
  });

  return linearConversation({
    source: 'gemini',
    externalId: `gemini:${convId}`,
    title: document.title.replace(/\s*[-–]\s*Google Gemini\s*$/i, '').trim() || 'Gemini',
    url: location.origin + location.pathname,
    msgs,
  });
}
