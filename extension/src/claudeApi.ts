import { treeToConversation, type TreeNode } from '../../src/tree';
import type { Conversation } from '../../src/types';

/**
 * Reads the conversation tree that claude.ai itself loads for the open chat
 * (same-origin request with the user's own session) and converts it to a rAIsing conversation.
 * NOTE: this is an internal, undocumented endpoint – it can change without notice.
 */

const NIL_PARENT = '00000000-0000-4000-8000-000000000000';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

interface Block {
  type?: string;
  text?: string;
}
interface ApiMsg {
  uuid: string;
  parent_message_uuid?: string | null;
  sender: string;
  created_at?: string;
  content?: Block[];
  text?: string;
}
interface ApiConv {
  uuid: string;
  name?: string;
  current_leaf_message_uuid?: string;
  chat_messages: ApiMsg[];
}

export function conversationIdFromUrl(url: string = location.href): string | null {
  return new RegExp(`/chat/(${UUID})`, 'i').exec(url)?.[1] ?? null;
}

async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) throw new Error(String(r.status));
  return (await r.json()) as T;
}

async function fetchConversation(id: string): Promise<ApiConv> {
  const orgs: string[] = [];
  const cookie = /(?:^|;\s*)lastActiveOrg=([^;]+)/.exec(document.cookie)?.[1];
  if (cookie) orgs.push(decodeURIComponent(cookie));
  try {
    for (const o of await getJSON<{ uuid: string }[]>('/api/organizations')) if (!orgs.includes(o.uuid)) orgs.push(o.uuid);
  } catch {
    /* fall through with whatever we have */
  }
  for (const org of orgs) {
    try {
      return await getJSON<ApiConv>(
        `/api/organizations/${org}/chat_conversations/${id}?tree=True&rendering_mode=messages&render_all_tools=true`,
      );
    } catch {
      /* try the next organization */
    }
  }
  throw new Error('Δεν βρέθηκε η συζήτηση. Είσαι συνδεδεμένος στο claude.ai;');
}

function textOf(m: ApiMsg): string {
  const t = (m.content ?? [])
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text!.trim())
    .join('\n\n')
    .trim();
  return t || (m.text ?? '').trim() || '[χωρίς κείμενο]';
}

export function convertConversation(api: ApiConv): Conversation {
  const msgs = api.chat_messages ?? [];
  if (msgs.length === 0) throw new Error('Η συζήτηση δεν έχει μηνύματα.');
  const ids = new Set(msgs.map((m) => m.uuid));
  const nodes = new Map<string, TreeNode>();
  msgs.forEach((m, i) => {
    const t = m.created_at ? Date.parse(m.created_at) : NaN;
    const parent = m.parent_message_uuid && m.parent_message_uuid !== NIL_PARENT && ids.has(m.parent_message_uuid) ? m.parent_message_uuid : null;
    nodes.set(m.uuid, {
      id: m.uuid,
      role: m.sender === 'human' ? 'user' : 'ai',
      text: textOf(m),
      ts: Number.isFinite(t) ? t : i,
      parent,
      children: [],
    });
  });
  for (const n of [...nodes.values()].sort((a, b) => a.ts - b.ts)) if (n.parent) nodes.get(n.parent)!.children.push(n.id);

  // the line the user is currently looking at (claude.ai's current leaf) stays in the main column
  const preferred = new Set<string>();
  let cur: string | null = api.current_leaf_message_uuid && nodes.has(api.current_leaf_message_uuid) ? api.current_leaf_message_uuid : null;
  while (cur && !preferred.has(cur)) {
    preferred.add(cur);
    cur = nodes.get(cur)!.parent;
  }

  const roots = [...nodes.values()].filter((n) => n.parent === null).sort((a, b) => a.ts - b.ts);
  const mainRoot = roots.find((r) => preferred.has(r.id)) ?? roots[0];
  const orphanRoots = roots.filter((r) => r !== mainRoot).map((r) => r.id);
  const firstHuman = [...nodes.values()].find((n) => n.role === 'user')?.text ?? 'claude.ai';

  return treeToConversation(nodes, {
    title: api.name?.trim() || firstHuman.replace(/\s+/g, ' ').slice(0, 70),
    source: 'claude.ai',
    url: `https://claude.ai/chat/${api.uuid}`,
    externalId: `claude.ai:${api.uuid}`,
    mainRoot: mainRoot.id,
    orphanRoots,
    preferred,
  });
}

/** Capture the chat that is currently open. */
export async function captureCurrent(): Promise<Conversation> {
  const id = conversationIdFromUrl();
  if (!id) throw new Error('Άνοιξε μια συζήτηση (claude.ai/chat/…).');
  return convertConversation(await fetchConversation(id));
}
