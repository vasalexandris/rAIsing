import { clip, treeToConversation, type TreeNode } from './tree';
import type { Conversation, Role } from './types';

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
  sessionId?: string;
  message?: { role?: string; content?: string | Block[] };
}
export interface CCOptions {
  /** fold tool calls/results into the AI message of the same turn */
  tools: boolean;
}

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
  const nodes = new Map<string, TreeNode>();
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
  const orphanRoots: TreeNode[] = [];
  roots.forEach((r, i) => {
    if (i === 0) return;
    let best: TreeNode | null = null;
    for (const c of byTs) {
      if (c.ts >= r.ts) break;
      if (c.id !== r.id) best = c;
    }
    if (best && best.parent !== r.id) r.parent = best.id;
    else orphanRoots.push(r);
  });

  for (const n of byTs) if (n.parent) nodes.get(n.parent)!.children.push(n.id);
  const mainRoot = roots[0];

  const sessionId = entries.find((e) => e.sessionId)?.sessionId;
  const title =
    entries.find((e) => e.type === 'summary' && e.summary)?.summary ??
    clip((nodes.get(mainRoot.id)?.text ?? 'Claude Code').replace(/\s+/g, ' '), 70);
  return treeToConversation(nodes, {
    title,
    source: 'claude-code',
    externalId: sessionId ? `claude-code:${sessionId}` : undefined,
    mainRoot: mainRoot.id,
    orphanRoots: orphanRoots.map((r) => r.id),
  });
}
