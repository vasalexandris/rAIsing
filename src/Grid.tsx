import { useMemo, useState, type ReactNode } from 'react';
import { computeLayout } from './layout';
import type { Conversation, Msg, Role } from './types';

export interface Actions {
  addMessage(branchId: string, role: Role, text: string): void;
  editMessage(id: string, text: string): void;
  deleteMessage(id: string): void;
  addBranch(forkMsgId: string): void;
  renameBranch(id: string): void;
  deleteBranch(id: string): void;
}

interface GridProps {
  conv: Conversation;
  open: Set<string>;
  toggle(id: string): void;
  query: string;
  actions: Actions;
}

export function Grid({ conv, open, toggle, query, actions }: GridProps) {
  const { cols, rows, numberOf, forkCount } = useMemo(() => computeLayout(conv), [conv]);
  const q = query.trim().toLowerCase();
  const style = { gridTemplateColumns: cols.map(() => '58px minmax(300px, 440px)').join(' ') };

  const cells: ReactNode[] = [];

  cols.forEach((col, ci) => {
    const isMain = col.branch.parentBranchId === null;
    const from = col.branch.forkMsgId ? numberOf.get(col.branch.forkMsgId) : undefined;
    cells.push(
      <div key={`hn${ci}`} className="hd num" style={{ gridRow: 1, gridColumn: ci * 2 + 1 }}>
        #
      </div>,
      <div key={`hc${ci}`} className="hd" style={{ gridRow: 1, gridColumn: ci * 2 + 2 }}>
        <div className="hd-title" title={col.branch.title}>
          {isMain ? conv.title : col.branch.title || 'Διακλάδωση'}
        </div>
        <div className="hd-sub">
          {isMain ? `Κύρια συζήτηση · ${conv.source}` : `Διακλάδωση από #${from ?? '?'}`}
          {!isMain && (
            <>
              <button className="ico" title="Μετονομασία" onClick={() => actions.renameBranch(col.branch.id)}>
                ✎
              </button>
              <button className="ico" title="Διαγραφή διακλάδωσης" onClick={() => actions.deleteBranch(col.branch.id)}>
                ✕
              </button>
            </>
          )}
        </div>
      </div>,
    );
  });

  for (let r = 0; r < rows; r++) {
    cols.forEach((col, ci) => {
      const idx = r - col.startRow;
      const rowStyle = { gridRow: r + 2 };
      const numStyle = { ...rowStyle, gridColumn: ci * 2 + 1 };
      const cStyle = { ...rowStyle, gridColumn: ci * 2 + 2 };
      const key = `${ci}-${r}`;

      if (idx >= 0 && idx < col.msgs.length) {
        const m = col.msgs[idx];
        const hit = q !== '' && m.text.toLowerCase().includes(q);
        cells.push(
          <div key={`n${key}`} className={`num ${m.role}`} style={numStyle}>
            {col.numbers[idx]}
          </div>,
          <Cell
            key={`c${m.id}`}
            style={cStyle}
            m={m}
            isOpen={open.has(m.id) || hit}
            hit={hit}
            forks={forkCount.get(m.id) ?? 0}
            canDelete={idx === col.msgs.length - 1 && !forkCount.get(m.id)}
            toggle={toggle}
            actions={actions}
          />,
        );
      } else if (idx === col.msgs.length) {
        const last = col.msgs[col.msgs.length - 1];
        cells.push(
          <div key={`n${key}`} className="num add" style={numStyle}>
            +
          </div>,
          <AddCell key={`c${key}`} style={cStyle} branchId={col.branch.id} lastRole={last?.role} onAdd={actions.addMessage} />,
        );
      } else {
        cells.push(
          <div key={`n${key}`} className="num empty" style={numStyle} />,
          <div key={`c${key}`} className="cell empty" style={cStyle} />,
        );
      }
    });
  }

  return (
    <div className="grid" style={style}>
      {cells}
    </div>
  );
}

interface CellProps {
  style: React.CSSProperties;
  m: Msg;
  isOpen: boolean;
  hit: boolean;
  forks: number;
  canDelete: boolean;
  toggle(id: string): void;
  actions: Actions;
}

function Cell({ style, m, isOpen, hit, forks, canDelete, toggle, actions }: CellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.text);

  if (editing) {
    return (
      <div className={`cell ${m.role} editing`} style={style}>
        <textarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} rows={6} />
        <div className="row-actions show">
          <button
            onClick={() => {
              actions.editMessage(m.id, draft);
              setEditing(false);
            }}
          >
            Αποθήκευση
          </button>
          <button
            onClick={() => {
              setDraft(m.text);
              setEditing(false);
            }}
          >
            Άκυρο
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`cell ${m.role}${isOpen ? ' open' : ''}${hit ? ' hit' : ''}`} style={style}>
      <div className="cell-body" onClick={() => toggle(m.id)}>
        <span className="who">{m.role === 'user' ? 'Εγώ' : 'ΑΙ'}</span>
        <span className="text">{m.text}</span>
      </div>
      <div className="row-actions">
        {forks > 0 && <span className="chip" title="Διακλαδώσεις από αυτό το μήνυμα">⑂ {forks}</span>}
        <button title="Διακλάδωση από εδώ" onClick={() => actions.addBranch(m.id)}>
          ⑂
        </button>
        <button
          title="Αντιγραφή"
          onClick={() => {
            void navigator.clipboard?.writeText(m.text);
          }}
        >
          ⧉
        </button>
        <button title="Επεξεργασία" onClick={() => setEditing(true)}>
          ✎
        </button>
        {canDelete && (
          <button title="Διαγραφή" onClick={() => actions.deleteMessage(m.id)}>
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

function AddCell({
  style,
  branchId,
  lastRole,
  onAdd,
}: {
  style: React.CSSProperties;
  branchId: string;
  lastRole?: Role;
  onAdd(branchId: string, role: Role, text: string): void;
}) {
  const [on, setOn] = useState(false);
  const [text, setText] = useState('');
  const [role, setRole] = useState<Role>('user');

  const submit = () => {
    if (!text.trim()) return;
    onAdd(branchId, role, text.trim());
    setText('');
    setRole(role === 'user' ? 'ai' : 'user');
  };

  if (!on) {
    return (
      <button
        className="cell add-btn"
        style={style}
        onClick={() => {
          setRole(lastRole === 'user' ? 'ai' : 'user');
          setOn(true);
        }}
      >
        + Προσθήκη μηνύματος
      </button>
    );
  }
  return (
    <div className="cell add-form" style={style}>
      <textarea
        autoFocus
        rows={4}
        value={text}
        placeholder="Επικόλληση μηνύματος… (Ctrl+Enter για προσθήκη)"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit();
        }}
      />
      <div className="row-actions show">
        <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
          <option value="user">Εγώ</option>
          <option value="ai">ΑΙ</option>
        </select>
        <button onClick={submit}>Προσθήκη</button>
        <button onClick={() => setOn(false)}>Κλείσιμο</button>
      </div>
    </div>
  );
}
