export type Role = 'user' | 'ai';

export const MAIN = 'main';

export interface Msg {
  id: string;
  branchId: string;
  role: Role;
  text: string;
  createdAt: number;
}

export interface Branch {
  id: string;
  /** null only for the main thread */
  parentBranchId: string | null;
  /** the message this branch forks from (null for main) */
  forkMsgId: string | null;
  title: string;
  createdAt: number;
  /** set when this column is a whole external conversation that was linked here as a branch */
  externalId?: string;
  source?: string;
  url?: string;
}

export interface Conversation {
  id: string;
  title: string;
  source: string;
  url?: string;
  /** id of the conversation in the source system (claude.ai, Claude Code session) */
  externalId?: string;
  createdAt: number;
  updatedAt: number;
  branches: Branch[];
  /** Messages in order; the order within one branch is the order in this array. */
  messages: Msg[];
}

export interface Persisted {
  convs: Conversation[];
  activeId: string | null;
}

export const SOURCES = ['claude.ai', 'gemini', 'glm', 'chatgpt', 'claude-code', 'άλλο'];

export const uid = () => crypto.randomUUID();
