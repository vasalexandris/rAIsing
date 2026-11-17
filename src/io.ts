import { computeLayout } from './layout';
import { MAIN, uid, type Branch, type Conversation, type Msg, type Role } from './types';

export function download(filename: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const safeName = (s: string) => s.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 60) || 'rAIsing';

export function toJSON(c: Conversation): string {
  return JSON.stringify({ app: 'rAIsing', version: 1, conversation: c }, null, 2);
}

export function toMarkdown(c: Conversation): string {
  const { cols, forkCount: _f, numberOf } = computeLayout(c);
  const lines: string[] = [`# ${c.title}`, '', `Πηγή: ${c.source}${c.url ? ` · ${c.url}` : ''}`, ''];
  for (const col of cols) {
    if (col.branch.parentBranchId === null) {
      lines.push('## Κύρια συζήτηση', '');
    } else {
      const from = col.branch.forkMsgId ? numberOf.get(col.branch.forkMsgId) : undefined;
      lines.push(`## Διακλάδωση: ${col.branch.title}${from ? ` (από #${from})` : ''}`, '');
    }
    col.msgs.forEach((m, i) => {
      lines.push(`**${col.numbers[i]} · ${m.role === 'user' ? 'Χρήστης' : 'ΑΙ'}**`, '', m.text, '');
    });
  }
  return lines.join('\n');
}

/** Validate & normalise an imported rAIsing JSON file. Throws on bad input. */
export function parseJSON(text: string): Conversation {
  const raw = JSON.parse(text);
  const c = raw?.conversation ?? raw;
  if (!c || !Array.isArray(c.branches) || !Array.isArray(c.messages)) {
    throw new Error('Το αρχείο δεν είναι έγκυρη συζήτηση rAIsing.');
  }
  const branches: Branch[] = c.branches.map((b: Branch) => ({
    id: String(b.id),
    parentBranchId: b.parentBranchId ?? null,
    forkMsgId: b.forkMsgId ?? null,
    title: String(b.title ?? ''),
    createdAt: Number(b.createdAt) || Date.now(),
  }));
  if (!branches.some((b) => b.parentBranchId === null)) throw new Error('Λείπει η κύρια συζήτηση.');
  const ids = new Set(branches.map((b) => b.id));
  const messages: Msg[] = c.messages
    .filter((m: Msg) => ids.has(m.branchId))
    .map((m: Msg) => ({
      id: String(m.id),
      branchId: m.branchId,
      role: m.role === 'user' ? 'user' : 'ai',
      text: String(m.text ?? ''),
      createdAt: Number(m.createdAt) || Date.now(),
    }));
  return {
    id: uid(), // always a fresh id so an import never overwrites an existing conversation
    title: String(c.title ?? 'Εισαγωγή'),
    source: String(c.source ?? 'άλλο'),
    url: c.url ? String(c.url) : undefined,
    createdAt: Number(c.createdAt) || Date.now(),
    updatedAt: Date.now(),
    branches,
    messages,
  };
}

const LABEL =
  /^\s*(?:\*\*)?(user|human|you|εγώ|χρήστης|assistant|claude|ai|gemini|glm|chatgpt|model)(?:\*\*)?\s*[:：]\s*/i;
const USER_LABELS = new Set(['user', 'human', 'you', 'εγώ', 'χρήστης']);

/** Parse a pasted transcript with "Χρήστης:" / "Claude:" style labels into the main thread. */
export function parseTranscript(text: string, title: string, source: string, url?: string): Conversation {
  const now = Date.now();
  const messages: Msg[] = [];
  let cur: { role: Role; lines: string[] } | null = null;
  const flush = () => {
    if (cur && cur.lines.join('').trim()) {
      messages.push({
        id: uid(),
        branchId: MAIN,
        role: cur.role,
        text: cur.lines.join('\n').trim(),
        createdAt: now + messages.length,
      });
    }
  };
  for (const line of text.split(/\r?\n/)) {
    const m = LABEL.exec(line);
    if (m) {
      flush();
      cur = { role: USER_LABELS.has(m[1].toLowerCase()) ? 'user' : 'ai', lines: [line.slice(m[0].length)] };
    } else if (cur) {
      cur.lines.push(line);
    } else if (line.trim()) {
      cur = { role: 'user', lines: [line] };
    }
  }
  flush();
  return newConversation(title, source, url, messages);
}

export function newConversation(title: string, source: string, url?: string, messages: Msg[] = []): Conversation {
  const now = Date.now();
  return {
    id: uid(),
    title: title || 'Νέα συζήτηση',
    source,
    url: url || undefined,
    createdAt: now,
    updatedAt: now,
    branches: [{ id: MAIN, parentBranchId: null, forkMsgId: null, title: 'Κύρια συζήτηση', createdAt: now }],
    messages,
  };
}
