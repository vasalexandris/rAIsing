import { treeToConversation, type TreeNode } from '../../../src/tree';
import type { Conversation } from '../../../src/types';

/**
 * chatgpt.com. The conversation (a message tree: `mapping` + `current_node`) comes from the site's own
 * same-origin API, authorised with the session's access token. Undocumented – it can change without notice.
 * NOTE: written from the known response shape; not yet verified against a live account.
 */

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

interface ApiNode {
  id: string;
  parent?: string | null;
  children?: string[];
  message?: {
    author?: { role?: string };
    create_time?: number | null;
    content?: { content_type?: string; parts?: unknown[]; text?: string };
    metadata?: { is_visually_hidden_from_conversation?: boolean };
  } | null;
}
export interface ApiChatGpt {
  title?: string;
  current_node?: string | null;
  mapping?: Record<string, ApiNode>;
}

export function chatgptId(url: string = location.href): string | null {
  return new RegExp(`/c/(${UUID})`, 'i').exec(new URL(url).pathname)?.[1] ?? null;
}

/** Visible text of a message; '' for system/tool/hidden/empty ones. */
function textOf(n: ApiNode): string {
  const m = n.message;
  if (!m || m.metadata?.is_visually_hidden_from_conversation) return '';
  const role = m.author?.role;
  if (role !== 'user' && role !== 'assistant') return '';
  const c = m.content;
  if (!c || (c.content_type !== 'text' && c.content_type !== 'multimodal_text')) return '';
  const parts = (c.parts ?? []).map((p) => (typeof p === 'string' ? p : '[εικόνα/αρχείο]'));
  // private-use markers wrap citations / entity references in answers
  return parts.join('\n\n').replace(/[\s\S]*?/g, '').trim();
}

export function convertChatGpt(api: ApiChatGpt, id: string): Conversation {
  const raw = api.mapping ?? {};
  const all = Object.values(raw);
  const text = new Map(all.map((n) => [n.id, textOf(n)] as const));
  const keep = new Set(all.filter((n) => text.get(n.id)).map((n) => n.id));
  if (keep.size === 0) throw new Error('Η συζήτηση δεν έχει ορατό κείμενο.');
  const up = (n: ApiNode): string | null => {
    let p = n.parent ? raw[n.parent] : undefined;
    for (let i = 0; p && i < 100_000; i++) {
      if (keep.has(p.id)) return p.id;
      p = p.parent ? raw[p.parent] : undefined;
    }
    return null;
  };

  // timestamps: use create_time, falling back to the nearest earlier one so ordering stays stable
  const nodes = new Map<string, TreeNode>();
  all.forEach((n, i) => {
    if (!keep.has(n.id)) return;
    const t = n.message?.create_time;
    nodes.set(n.id, {
      id: n.id,
      role: n.message!.author!.role === 'user' ? 'user' : 'ai',
      text: text.get(n.id)!,
      ts: typeof t === 'number' ? t * 1000 : i,
      parent: up(n),
      children: [],
    });
  });
  for (const n of [...nodes.values()].sort((a, b) => a.ts - b.ts)) if (n.parent) nodes.get(n.parent)!.children.push(n.id);

  // the line ChatGPT currently shows stays in the main column
  const preferred = new Set<string>();
  let cur: string | null | undefined = api.current_node;
  while (cur && raw[cur]) {
    if (nodes.has(cur)) preferred.add(cur);
    cur = raw[cur].parent;
  }

  const roots = [...nodes.values()].filter((n) => n.parent === null).sort((a, b) => a.ts - b.ts);
  const mainRoot = roots.find((r) => preferred.has(r.id)) ?? roots[0];
  const firstUser = [...nodes.values()].find((n) => n.role === 'user')?.text ?? 'ChatGPT';
  return treeToConversation(nodes, {
    title: api.title?.trim() || firstUser.replace(/\s+/g, ' ').slice(0, 70),
    source: 'chatgpt',
    url: `${location.origin}/c/${id}`,
    externalId: `chatgpt:${id}`,
    mainRoot: mainRoot.id,
    orphanRoots: roots.filter((r) => r !== mainRoot).map((r) => r.id),
    preferred,
  });
}

export async function captureChatGpt(): Promise<Conversation> {
  const id = chatgptId();
  if (!id) throw new Error('Άνοιξε μια συζήτηση (chatgpt.com/c/…).');
  let token = '';
  try {
    const s = await fetch('/api/auth/session', { credentials: 'include' });
    if (s.ok) token = ((await s.json()) as { accessToken?: string }).accessToken ?? '';
  } catch {
    /* handled below */
  }
  if (!token) throw new Error('Δεν βρέθηκε σύνδεση στο ChatGPT. Είσαι συνδεδεμένος;');
  const r = await fetch(`/backend-api/conversation/${id}`, { headers: { Authorization: `Bearer ${token}` }, credentials: 'include' });
  if (!r.ok) throw new Error(`Το ChatGPT απάντησε ${r.status}.`);
  return convertChatGpt((await r.json()) as ApiChatGpt, id);
}
