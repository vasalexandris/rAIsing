import { treeToConversation, type TreeNode } from '../../../src/tree';
import type { Conversation } from '../../../src/types';

/**
 * chat.z.ai (GLM). The page is an Open-WebUI-style app: the chat (a real message tree with
 * parentId/childrenIds) is served by its own same-origin API, using the session token the page
 * keeps in localStorage. Undocumented – it can change without notice.
 */

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

interface ApiMsg {
  id: string;
  parentId?: string | null;
  role: string;
  content?: unknown;
  timestamp?: number;
}
interface ApiChat {
  id: string;
  title?: string;
  chat?: { history?: { currentId?: string | null; messages?: Record<string, ApiMsg> } };
}

export function glmId(url: string = location.href): string | null {
  return new RegExp(`/c/(${UUID})`, 'i').exec(new URL(url).pathname)?.[1] ?? null;
}

/** Answers start with a collapsed "thinking" block (<details type="reasoning">…</details>) – not part of the answer. */
const clean = (s: string) => s.replace(/<details[\s\S]*?<\/details>/g, '').trim();

export function convertGlm(api: ApiChat, id: string): Conversation {
  const raw = api.chat?.history?.messages ?? {};
  const all = Object.values(raw);
  const text = (m: ApiMsg) => (typeof m.content === 'string' ? clean(m.content) : '');

  // Messages without stored text are dropped; their children attach to the nearest ancestor that has text.
  const keep = new Set(all.filter((m) => text(m)).map((m) => m.id));
  const up = (m: ApiMsg): string | null => {
    let p = m.parentId ? raw[m.parentId] : undefined;
    for (let i = 0; p && i < 10_000; i++) {
      if (keep.has(p.id)) return p.id;
      p = p.parentId ? raw[p.parentId] : undefined;
    }
    return null;
  };
  if (keep.size === 0) throw new Error('Η συζήτηση δεν έχει αποθηκευμένο κείμενο.');

  const nodes = new Map<string, TreeNode>();
  all.forEach((m, i) => {
    if (!keep.has(m.id)) return;
    nodes.set(m.id, {
      id: m.id,
      role: m.role === 'user' ? 'user' : 'ai',
      text: text(m),
      ts: typeof m.timestamp === 'number' ? m.timestamp * 1000 : i,
      parent: up(m),
      children: [],
    });
  });
  for (const n of [...nodes.values()].sort((a, b) => a.ts - b.ts)) if (n.parent) nodes.get(n.parent)!.children.push(n.id);

  // keep the line that the chat currently shows (currentId) in the main column
  const preferred = new Set<string>();
  let cur: string | null | undefined = api.chat?.history?.currentId;
  while (cur && raw[cur]) {
    if (nodes.has(cur)) preferred.add(cur);
    cur = raw[cur].parentId;
  }

  const roots = [...nodes.values()].filter((n) => n.parent === null).sort((a, b) => a.ts - b.ts);
  const mainRoot = roots.find((r) => preferred.has(r.id)) ?? roots[0];
  const firstUser = [...nodes.values()].find((n) => n.role === 'user')?.text ?? 'GLM';

  return treeToConversation(nodes, {
    title: api.title?.trim() || firstUser.replace(/\s+/g, ' ').slice(0, 70),
    source: 'glm',
    url: `${location.origin}/c/${id}`,
    externalId: `glm:${id}`,
    mainRoot: mainRoot.id,
    orphanRoots: roots.filter((r) => r !== mainRoot).map((r) => r.id),
    preferred,
  });
}

export async function captureGlm(): Promise<Conversation> {
  const id = glmId();
  if (!id) throw new Error('Άνοιξε μια συζήτηση (chat.z.ai/c/…).');
  let token = '';
  try {
    token = localStorage.getItem('token') ?? '';
  } catch {
    /* storage blocked */
  }
  if (!token) throw new Error('Δεν βρέθηκε σύνδεση στο chat.z.ai. Είσαι συνδεδεμένος;');
  const r = await fetch(`/api/v1/chats/${id}`, { headers: { Authorization: `Bearer ${token}` }, credentials: 'include' });
  if (!r.ok) throw new Error(`Το chat.z.ai απάντησε ${r.status}.`);
  return convertGlm((await r.json()) as ApiChat, id);
}
