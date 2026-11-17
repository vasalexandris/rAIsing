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
  return normalizeConversation(raw?.conversation ?? raw);
}

/** Validate an untrusted conversation object (file or extension) and give it a fresh local id. */
export function normalizeConversation(c: any): Conversation {
  if (!c || !Array.isArray(c.branches) || !Array.isArray(c.messages)) {
    throw new Error('Το αρχείο δεν είναι έγκυρη συζήτηση rAIsing.');
  }
  const branches: Branch[] = c.branches.map((b: Branch) => ({
    id: String(b.id),
    parentBranchId: b.parentBranchId ?? null,
    forkMsgId: b.forkMsgId ?? null,
    title: String(b.title ?? ''),
    createdAt: Number(b.createdAt) || Date.now(),
    externalId: b.externalId ? String(b.externalId) : undefined,
    source: b.source ? String(b.source) : undefined,
    url: b.url ? String(b.url) : undefined,
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
    externalId: c.externalId ? String(c.externalId) : undefined,
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

interface Sets {
  branches: Branch[];
  messages: Msg[];
}

/**
 * Core of every re-import: structure and new messages come from the source,
 * local additions (own messages, own branches, linked conversations) survive.
 */
function mergeSets(existing: Sets, incoming: Sets, rootId: string): Sets {
  const oldText = new Map(existing.messages.map((m) => [m.id, m.text]));
  const incomingMsgIds = new Set(incoming.messages.map((m) => m.id));
  const incomingBranchIds = new Set(incoming.branches.map((b) => b.id));
  const local = existing.branches.filter((b) => b.id !== rootId && !b.id.startsWith('ext:') && !incomingBranchIds.has(b.id));
  const alive = new Set([...incomingBranchIds, ...local.map((b) => b.id)]);
  // a kept branch whose parent disappeared moves under the root so it never becomes invisible
  const kept = local.map((b) => (b.parentBranchId && alive.has(b.parentBranchId) ? b : { ...b, parentBranchId: rootId }));
  return {
    branches: [...incoming.branches, ...kept],
    messages: [
      // keep local edits of text, but take the position (branch) from the source
      ...incoming.messages.map((m) => ({ ...m, text: oldText.get(m.id) ?? m.text })),
      ...existing.messages.filter((m) => !incomingMsgIds.has(m.id) && alive.has(m.branchId)),
    ],
  };
}

/** Re-import of a conversation that already exists locally (same externalId). */
export function mergeImported(existing: Conversation, incoming: Conversation): Conversation {
  const merged = mergeSets(existing, incoming, MAIN);
  return { ...existing, url: incoming.url ?? existing.url, ...merged, updatedAt: Date.now() };
}

function subtreeIds(branches: Branch[], rootId: string): Set<string> {
  const out = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const b of branches) {
      if (!out.has(b.id) && b.parentBranchId && out.has(b.parentBranchId)) {
        out.add(b.id);
        grew = true;
      }
    }
  }
  return out;
}

/** Put a whole conversation under `root`: its main thread becomes `root`, its branches hang below. */
function remapInto(child: Conversation, root: Branch): Sets {
  return {
    branches: [
      root,
      ...child.branches.filter((b) => b.id !== MAIN).map((b) => (b.parentBranchId === MAIN ? { ...b, parentBranchId: root.id } : b)),
    ],
    messages: child.messages.map((m) => (m.branchId === MAIN ? { ...m, branchId: root.id } : m)),
  };
}

/** Attach `child` to `host` as a branch column that forks from message `forkMsgId`. */
export function linkAsBranch(host: Conversation, child: Conversation, forkMsgId: string): Conversation {
  const fork = host.messages.find((m) => m.id === forkMsgId);
  if (!fork) throw new Error('Το μήνυμα-πηγή δεν βρέθηκε.');
  const rootId = `link:${child.externalId ?? child.id}`;
  if (host.branches.some((b) => b.id === rootId)) throw new Error('Η συζήτηση είναι ήδη συνδεδεμένη εδώ.');
  const root: Branch = {
    id: rootId,
    parentBranchId: fork.branchId,
    forkMsgId,
    title: child.title,
    // linking time (and always newer than its siblings) keeps existing branch labels stable
    createdAt: Math.max(Date.now(), ...host.branches.map((b) => b.createdAt + 1)),
    externalId: child.externalId,
    source: child.source,
    url: child.url,
  };
  const sets = remapInto(child, root);
  return { ...host, branches: [...host.branches, ...sets.branches], messages: [...host.messages, ...sets.messages], updatedAt: Date.now() };
}

/** A conversation that is already linked as a branch was captured again: update that branch in place. */
export function mergeIntoLinked(host: Conversation, rootId: string, incoming: Conversation): Conversation {
  const root = host.branches.find((b) => b.id === rootId);
  if (!root) return host;
  const ids = subtreeIds(host.branches, rootId);
  const merged = mergeSets(
    { branches: host.branches.filter((b) => ids.has(b.id)), messages: host.messages.filter((m) => ids.has(m.branchId)) },
    remapInto(incoming, root),
    rootId,
  );
  return {
    ...host,
    branches: [...host.branches.filter((b) => !ids.has(b.id)), ...merged.branches],
    messages: [...host.messages.filter((m) => !ids.has(m.branchId)), ...merged.messages],
    updatedAt: Date.now(),
  };
}

/** Turn a linked branch column back into a standalone conversation. */
export function unlinkBranch(host: Conversation, rootId: string): { host: Conversation; child: Conversation } {
  const root = host.branches.find((b) => b.id === rootId);
  if (!root) throw new Error('Η διακλάδωση δεν βρέθηκε.');
  const ids = subtreeIds(host.branches, rootId);
  const now = Date.now();
  const child: Conversation = {
    id: uid(),
    title: root.title || 'Συζήτηση',
    source: root.source ?? host.source,
    url: root.url,
    externalId: root.externalId,
    createdAt: root.createdAt,
    updatedAt: now,
    branches: host.branches
      .filter((b) => ids.has(b.id))
      .map((b) =>
        b.id === rootId
          ? { id: MAIN, parentBranchId: null, forkMsgId: null, title: 'Κύρια συζήτηση', createdAt: b.createdAt }
          : b.parentBranchId === rootId
            ? { ...b, parentBranchId: MAIN }
            : b,
      ),
    messages: host.messages.filter((m) => ids.has(m.branchId)).map((m) => (m.branchId === rootId ? { ...m, branchId: MAIN } : m)),
  };
  return {
    child,
    host: {
      ...host,
      branches: host.branches.filter((b) => !ids.has(b.id)),
      messages: host.messages.filter((m) => !ids.has(m.branchId)),
      updatedAt: now,
    },
  };
}

export interface LinkTo {
  convId: string;
  forkMsgId: string;
}
export interface Incoming {
  conv: Conversation;
  linkTo?: LinkTo;
}

/**
 * Route captures from the extension:
 *  1. same externalId as a standalone conversation -> update it
 *  2. already linked as a branch somewhere        -> update that branch
 *  3. extension asked to attach it to a message    -> link as branch
 *  4. otherwise                                    -> new conversation
 */
export function applyImports(convs: Conversation[], items: Incoming[]): { convs: Conversation[]; activeId: string | null } {
  let next = convs;
  let activeId: string | null = null;
  for (const { conv: inc, linkTo } of items) {
    const ext = inc.externalId;
    const same = ext ? next.findIndex((c) => c.externalId === ext) : -1;
    if (same >= 0) {
      next = next.map((c, j) => (j === same ? mergeImported(c, inc) : c));
      activeId = next[same].id;
      continue;
    }
    const hostIdx = ext ? next.findIndex((c) => c.branches.some((b) => b.externalId === ext)) : -1;
    if (hostIdx >= 0) {
      const rootId = next[hostIdx].branches.find((b) => b.externalId === ext)!.id;
      next = next.map((c, j) => (j === hostIdx ? mergeIntoLinked(c, rootId, inc) : c));
      activeId = next[hostIdx].id;
      continue;
    }
    if (linkTo) {
      const h = next.findIndex((c) => c.id === linkTo.convId && c.messages.some((m) => m.id === linkTo.forkMsgId));
      if (h >= 0) {
        try {
          const merged = linkAsBranch(next[h], inc, linkTo.forkMsgId);
          next = next.map((c, j) => (j === h ? merged : c));
          activeId = next[h].id;
          continue;
        } catch {
          /* fall through to a standalone conversation */
        }
      }
    }
    next = [inc, ...next];
    activeId = inc.id;
  }
  return { convs: next, activeId };
}
