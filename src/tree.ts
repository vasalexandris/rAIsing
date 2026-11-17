import { newConversation } from './io';
import { MAIN, type Branch, type Conversation, type Msg, type Role } from './types';

/** A message in a source tree (Claude Code transcript, claude.ai conversation, …). */
export interface TreeNode {
  id: string;
  role: Role;
  text: string;
  ts: number;
  parent: string | null;
  /** children in chronological order */
  children: string[];
}

export const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n).trimEnd() + '…' : s);

export interface EmitOptions {
  title: string;
  source: string;
  url?: string;
  /** stable id of the source conversation, used to update instead of duplicate on re-import */
  externalId?: string;
  mainRoot: string;
  /** extra roots that could not be linked to the main line */
  orphanRoots?: string[];
  /** ids that must stay on the main line (e.g. the path to claude.ai's current leaf) */
  preferred?: Set<string>;
}

/**
 * Turn a message tree into a rAIsing conversation:
 *  - consecutive AI entries of one turn are folded into one cell
 *  - at every fork the preferred / latest line continues, the others become branch columns
 * Branch ids are deterministic (`ext:<first message id>`) so a re-import maps onto the same branches.
 */
export function treeToConversation(nodes: Map<string, TreeNode>, o: EmitOptions): Conversation {
  const orphans = o.orphanRoots ?? [];

  // fold consecutive AI nodes (parent has exactly one child)
  const stack: string[] = [o.mainRoot, ...orphans];
  while (stack.length) {
    const p = nodes.get(stack.pop()!);
    if (!p) continue;
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

  // latest activity inside each subtree
  const subMax = new Map<string, number>();
  const order: string[] = [];
  const st: string[] = [o.mainRoot, ...orphans];
  while (st.length) {
    const id = st.pop()!;
    order.push(id);
    for (const c of nodes.get(id)?.children ?? []) st.push(c);
  }
  for (let i = order.length - 1; i >= 0; i--) {
    const n = nodes.get(order[i])!;
    subMax.set(n.id, Math.max(n.ts, ...n.children.map((c) => subMax.get(c) ?? 0)));
  }

  const conv = newConversation(o.title, o.source, o.url);
  conv.externalId = o.externalId;
  const messages: Msg[] = [];
  const branches: Branch[] = [...conv.branches];
  const branchFor = (n: TreeNode, parentBranchId: string, forkMsgId: string | null): Branch => ({
    id: `ext:${n.id}`,
    parentBranchId,
    forkMsgId,
    title: clip(n.text.replace(/\s+/g, ' '), 60),
    createdAt: n.ts,
  });

  const emit = (startId: string, branchId: string) => {
    let cur: TreeNode | undefined = nodes.get(startId);
    while (cur) {
      messages.push({ id: cur.id, branchId, role: cur.role, text: cur.text, createdAt: cur.ts });
      if (cur.children.length === 0) break;
      const kids = cur.children
        .map((id) => nodes.get(id)!)
        .sort(
          (a, b) =>
            Number(o.preferred?.has(b.id) ?? false) - Number(o.preferred?.has(a.id) ?? false) ||
            subMax.get(b.id)! - subMax.get(a.id)! ||
            b.ts - a.ts,
        );
      const [next, ...others] = kids;
      for (const k of others) {
        const b = branchFor(k, branchId, cur.id);
        branches.push(b);
        emit(k.id, b.id);
      }
      cur = next;
    }
  };

  emit(o.mainRoot, MAIN);
  for (const id of orphans) {
    const n = nodes.get(id);
    if (!n) continue;
    const b = branchFor(n, MAIN, null);
    branches.push(b);
    emit(id, b.id);
  }

  conv.branches = branches;
  conv.messages = messages;
  let first = Infinity;
  for (const n of order) first = Math.min(first, nodes.get(n)?.ts ?? Infinity);
  conv.createdAt = Number.isFinite(first) ? first : Date.now();
  conv.updatedAt = Date.now();
  return conv;
}
