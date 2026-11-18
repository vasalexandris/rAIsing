import { treeToConversation, type TreeNode } from '../../src/tree';
import type { Conversation, Role } from '../../src/types';

export interface LinearMsg {
  /** stable per message, so a re-capture maps onto the same cells */
  id: string;
  role: Role;
  text: string;
}

/** Sites without a branch tree (Gemini, GLM, …): a plain back-and-forth becomes a single main column. */
export function linearConversation(o: {
  source: string;
  externalId: string;
  title: string;
  url: string;
  msgs: LinearMsg[];
}): Conversation {
  const msgs = o.msgs.filter((m) => m.text.trim());
  if (msgs.length === 0) throw new Error('Δεν βρέθηκαν μηνύματα στη σελίδα.');
  const now = Date.now();
  const nodes = new Map<string, TreeNode>();
  msgs.forEach((m, i) =>
    nodes.set(m.id, {
      id: m.id,
      role: m.role,
      text: m.text.trim(),
      ts: now - (msgs.length - i) * 1000,
      parent: i > 0 ? msgs[i - 1].id : null,
      children: i < msgs.length - 1 ? [msgs[i + 1].id] : [],
    }),
  );
  return treeToConversation(nodes, {
    title: o.title,
    source: o.source,
    url: o.url,
    externalId: o.externalId,
    mainRoot: msgs[0].id,
  });
}
