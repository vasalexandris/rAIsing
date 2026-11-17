import { newConversation } from './io';
import { MAIN, uid, type Branch, type Conversation, type Msg, type Role } from './types';

/**
 * Importer for Claude Code session transcripts (~/.claude/projects/<project>/<session>.jsonl).
 *
 * Each line is one entry with a uuid and a parentUuid, so a session is really a tree:
 *  - a rewind / edit / fork leaves several children under the same parent  -> becomes a branch column
 *  - after /compact (or auto-compact) the transcript restarts from a new root -> treated as a continuation
 *  - tool calls & results are noise by default; they can be folded into the AI cell of the same turn
 */

interface Block {
  type?: string;
  text?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
}
interface Raw {
  uuid?: string;
  parentUuid?: string | null;
  type?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  isCompactSummary?: boolean;
  timestamp?: string;
  summary?: string;
  message?: { role?: string; content?: string | Block[] };
}
interface Node {
  id: string;
  role: Role;
  text: string;
  ts: number;
  parent: string | null;
  children: string[];
}

export interface CCOptions {
  /** fold tool calls/results into the AI message of the same turn */
  tools: boolean;
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n).trimEnd() + '…' : s);
const stripReminders = (s: string) => s.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();

function inputSummary(input: unknown): string {
  if (input && typeof input === 'object') {
    const o = input as Record<string, unknown>;
    for (const k of ['command', 'file_path', 'path', 'pattern', 'url', 'query', 'description', 'prompt']) {
      if (typeof o[k] === 'string' && o[k]) return clip(String(o[k]).replace(/\s+/g, ' '), 160);
    }
  }
  try {
    return clip(JSON.stringify(input) ?? '', 160);
  } catch {
    return '';
  }
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b: Block) => (b?.type === 'text' && typeof b.text === 'string' ? b.text : b?.type === 'image' ? '[εικόνα]' : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

/** Turn one raw entry into a displayable message, or null if it should be dropped. */
function toMessage(r: Raw, opts: CCOptions): { role: Role; text: string } | null {
  if (r.isMeta) return null;
  const content = r.message?.content;
  const blocks: Block[] = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [];
  const isUser = r.type === 'user';
  let hasToolResult = false;
  const parts: string[] = [];

  for (const b of blocks) {
    if (b.type === 'text' && typeof b.text === 'string') {
      let t = isUser ? stripReminders(b.text) : b.text.trim();
      if (isUser && /<local-command-(stdout|stderr|caveat)>/.test(t)) continue;
      const cmd = /<command-name>([\s\S]*?)<\/command-name>/.exec(t);
      if (isUser && cmd) {
        const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(t);
        t = `${cmd[1].trim()} ${args ? args[1].trim() : ''}`.trim();
      }
      if (t) parts.push(t);
    } else if (b.type === 'image') {
      parts.push('[εικόνα]');
    } else if (b.type === 'tool_use') {
      if (opts.tools) parts.push(`🔧 ${b.name ?? 'tool'}: ${inputSummary(b.input)}`);
    } else if (b.type === 'tool_result') {
      hasToolResult = true;
      if (opts.tools) {
        const t = resultText(b.content).trim();
        if (t) parts.push(`↳ ${clip(t, 400)}`);
      }
    }
    // "thinking" blocks and anything else are intentionally skipped
  }

  let text = parts.join('\n\n').trim();
  if (!text) return null;
  if (r.isCompactSummary) text = `📦 Σύνοψη συμπίεσης (compact)\n\n${text}`;
  return { role: isUser && !hasToolResult ? 'user' : 'ai', text };
}

export function parseClaudeCode(raw: string, opts: CCOptions): Conversation {
  const entries: Raw[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    try {
      entries.push(JSON.parse(s) as Raw);
    } catch {
      /* skip malformed line */
    }
  }
  if (!entries.some((e) => e.uuid && (e.type === 'user' || e.type === 'assistant'))) {
    throw new Error('Δεν βρέθηκαν μηνύματα Claude Code. Διάλεξε αρχείο .jsonl από ~/.claude/projects/…');
  }

  // 1) kept nodes
  const rawById = new Map<string, Raw>();
  for (const e of entries) if (e.uuid) rawById.set(e.uuid, e);
  const nodes = new Map<string, Node>();
  let seq = 0;
  for (const e of entries) {
    seq++;
    if (!e.uuid || e.isSidechain || (e.type !== 'user' && e.type !== 'assistant')) continue;
    const m = toMessage(e, opts);
    if (!m) continue;
    const t = e.timestamp ? Date.parse(e.timestamp) : NaN;
    nodes.set(e.uuid, { id: e.uuid, role: m.role, text: m.text, ts: Number.isFinite(t) ? t : seq, parent: null, children: [] });
  }
  if (nodes.size === 0) throw new Error('Το αρχείο δεν έχει εμφανίσιμα μηνύματα (δοκίμασε με ενεργοποιημένα τα tool calls).');

  // 2) parent = nearest kept ancestor (through dropped entries)
  for (const n of nodes.values()) {
    let p = rawById.get(n.id)?.parentUuid ?? null;
    let guard = 0;
    while (p && !nodes.has(p) && guard++ < 10_000) p = rawById.get(p)?.parentUuid ?? null;
    n.parent = p && nodes.has(p) && p !== n.id ? p : null;
  }

  // 3) roots after the first (e.g. after /compact) continue from the last message that came before them
  const byTs = [...nodes.values()].sort((a, b) => a.ts - b.ts);
  const roots = byTs.filter((n) => n.parent === null);
  const orphanRoots: Node[] = [];
  roots.forEach((r, i) => {
    if (i === 0) return;
    let best: Node | null = null;
    for (const c of byTs) {
      if (c.ts >= r.ts) break;
      if (c.id !== r.id) best = c;
    }
    if (best && best.parent !== r.id) r.parent = best.id;
    else orphanRoots.push(r);
  });

  for (const n of byTs) if (n.parent) nodes.get(n.parent)!.children.push(n.id);
  const mainRoot = roots[0];

  // 4) fold consecutive AI entries of one turn into a single cell
  const stack: string[] = roots.filter((r) => r === mainRoot || orphanRoots.includes(r)).map((r) => r.id);
  while (stack.length) {
    const p = nodes.get(stack.pop()!)!;
    while (p.children.length === 1) {
      const c = nodes.get(p.children[0])!;
      if (p.role !== 'ai' || c.role !== 'ai') break;
      p.text += '\n\n' + c.text;
      p.children = c.children;
      for (const gc of p.children) nodes.get(gc)!.parent = p.id;
      nodes.delete(c.id);
    }
    for (const id of p.children) stack.push(id);
  }

  // 5) latest timestamp inside every subtree (decides which child continues the "main" line)
  const subMax = new Map<string, number>();
  const order: string[] = [];
  const st: string[] = [...nodes.values()].filter((n) => n.parent === null).map((n) => n.id);
  while (st.length) {
    const id = st.pop()!;
    order.push(id);
    for (const c of nodes.get(id)!.children) st.push(c);
  }
  for (let i = order.length - 1; i >= 0; i--) {
    const n = nodes.get(order[i])!;
    subMax.set(n.id, Math.max(n.ts, ...n.children.map((c) => subMax.get(c) ?? 0)));
  }

  // 6) emit branches
  const title =
    entries.find((e) => e.type === 'summary' && e.summary)?.summary ??
    clip((nodes.get(mainRoot.id)?.text ?? 'Claude Code').replace(/\s+/g, ' '), 70);
  const conv = newConversation(title, 'claude-code');
  const messages: Msg[] = [];
  const branches: Branch[] = [...conv.branches];

  const emit = (startId: string, branchId: string) => {
    let cur: Node | undefined = nodes.get(startId);
    while (cur) {
      messages.push({ id: cur.id, branchId, role: cur.role, text: cur.text, createdAt: cur.ts });
      if (cur.children.length === 0) break;
      const kids = cur.children.map((id) => nodes.get(id)!).sort((a, b) => (subMax.get(b.id)! - subMax.get(a.id)!) || b.ts - a.ts);
      const [next, ...others] = kids;
      for (const o of others) {
        const b: Branch = {
          id: uid(),
          parentBranchId: branchId,
          forkMsgId: cur.id,
          title: clip(o.text.replace(/\s+/g, ' '), 60),
          createdAt: o.ts,
        };
        branches.push(b);
        emit(o.id, b.id);
      }
      cur = next;
    }
  };

  emit(mainRoot.id, MAIN);
  for (const o of orphanRoots) {
    const b: Branch = { id: uid(), parentBranchId: MAIN, forkMsgId: null, title: clip(o.text.replace(/\s+/g, ' '), 60), createdAt: o.ts };
    branches.push(b);
    emit(o.id, b.id);
  }

  conv.branches = branches;
  conv.messages = messages;
  conv.createdAt = byTs[0].ts;
  conv.updatedAt = Date.now();
  return conv;
}
