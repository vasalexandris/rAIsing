import type { Branch, Conversation, Msg } from './types';

export interface Col {
  branch: Branch;
  msgs: Msg[];
  numbers: string[];
  /** grid row (0-based, below the header) where the first message sits */
  startRow: number;
}

export interface Layout {
  cols: Col[];
  rows: number;
  numberOf: Map<string, string>;
  forkCount: Map<string, number>;
}

/**
 * Column order: main first, then its child branches newest-first
 * (the newest branch sits right next to main, older ones are pushed right),
 * each followed by its own sub-branches.
 */
export function orderBranches(branches: Branch[]): Branch[] {
  const kids = new Map<string | null, Branch[]>();
  for (const b of branches) {
    const list = kids.get(b.parentBranchId) ?? [];
    list.push(b);
    kids.set(b.parentBranchId, list);
  }
  for (const list of kids.values()) list.sort((a, b) => b.createdAt - a.createdAt);
  const out: Branch[] = [];
  const seen = new Set<string>();
  const walk = (id: string | null) => {
    for (const b of kids.get(id) ?? []) {
      if (seen.has(b.id)) continue;
      seen.add(b.id);
      out.push(b);
      walk(b.id);
    }
  };
  walk(null);
  return out;
}

export function computeLayout(c: Conversation): Layout {
  const byBranch = new Map<string, Msg[]>();
  for (const b of c.branches) byBranch.set(b.id, []);
  for (const m of c.messages) byBranch.get(m.branchId)?.push(m);

  const msgById = new Map(c.messages.map((m) => [m.id, m]));
  const branchById = new Map(c.branches.map((b) => [b.id, b]));
  const numberOf = new Map<string, string>();
  const rowOf = new Map<string, number>();
  const info = new Map<string, { numbers: string[]; startRow: number }>();
  const resolving = new Set<string>();
  const forkCount = new Map<string, number>();

  const resolve = (b: Branch): { numbers: string[]; startRow: number } => {
    const done = info.get(b.id);
    if (done) return done;
    const msgs = byBranch.get(b.id) ?? [];
    let prefix = '';
    let startRow = 0;
    if (b.forkMsgId && !resolving.has(b.id)) {
      resolving.add(b.id);
      const fork = msgById.get(b.forkMsgId);
      if (fork) {
        const parent = branchById.get(fork.branchId);
        if (parent && parent.id !== b.id) resolve(parent);
        prefix = (numberOf.get(fork.id) ?? '') + '.';
        startRow = (rowOf.get(fork.id) ?? 0) + 1;
      }
      resolving.delete(b.id);
    }
    const numbers = msgs.map((_, i) => prefix + (i + 1));
    msgs.forEach((m, i) => {
      numberOf.set(m.id, numbers[i]);
      rowOf.set(m.id, startRow + i);
    });
    const res = { numbers, startRow };
    info.set(b.id, res);
    return res;
  };

  for (const b of c.branches) {
    resolve(b);
    if (b.forkMsgId) forkCount.set(b.forkMsgId, (forkCount.get(b.forkMsgId) ?? 0) + 1);
  }

  const cols: Col[] = orderBranches(c.branches).map((branch) => {
    const { numbers, startRow } = resolve(branch);
    return { branch, msgs: byBranch.get(branch.id) ?? [], numbers, startRow };
  });
  // +1 for the "add message" row at the bottom of the longest column
  const rows = cols.reduce((mx, col) => Math.max(mx, col.startRow + col.msgs.length + 1), 1);
  return { cols, rows, numberOf, forkCount };
}
