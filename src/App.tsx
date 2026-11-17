import { useEffect, useMemo, useState } from 'react';
import { Grid, type Actions } from './Grid';
import { makeDemo } from './demo';
import { parseClaudeCode } from './claudeCode';
import { download, newConversation, parseJSON, parseTranscript, safeName, toJSON, toMarkdown } from './io';
import { idbGet, idbSet } from './storage';
import { SOURCES, uid, type Conversation, type Persisted, type Role } from './types';

export default function App() {
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState(false);

  useEffect(() => {
    (async () => {
      // never hang on a stuck/blocked IndexedDB: fall back to the demo after 2.5s
      const s = await Promise.race([
        idbGet<Persisted>('state'),
        new Promise<undefined>((r) => setTimeout(() => r(undefined), 2500)),
      ]);
      if (s && s.convs.length) {
        setConvs(s.convs);
        setActiveId(s.activeId ?? s.convs[0].id);
      } else {
        const d = makeDemo();
        setConvs([d]);
        setActiveId(d.id);
      }
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => void idbSet('state', { convs, activeId } satisfies Persisted), 300);
    return () => clearTimeout(t);
  }, [convs, activeId, ready]);

  const conv = convs.find((c) => c.id === activeId) ?? null;

  const update = (fn: (c: Conversation) => Conversation) =>
    setConvs((cs) => cs.map((c) => (c.id === activeId ? { ...fn(c), updatedAt: Date.now() } : c)));

  const actions: Actions = useMemo(
    () => ({
      addMessage: (branchId: string, role: Role, text: string) =>
        update((c) => ({
          ...c,
          messages: [...c.messages, { id: uid(), branchId, role, text, createdAt: Date.now() }],
        })),
      editMessage: (id: string, text: string) =>
        update((c) => ({ ...c, messages: c.messages.map((m) => (m.id === id ? { ...m, text } : m)) })),
      deleteMessage: (id: string) => update((c) => ({ ...c, messages: c.messages.filter((m) => m.id !== id) })),
      addBranch: (forkMsgId: string) => {
        const title = window.prompt('Τίτλος διακλάδωσης (τι θέλεις να εξερευνήσεις;)');
        if (title === null) return;
        update((c) => {
          const fork = c.messages.find((m) => m.id === forkMsgId);
          if (!fork) return c;
          return {
            ...c,
            branches: [
              ...c.branches,
              { id: uid(), parentBranchId: fork.branchId, forkMsgId, title: title.trim(), createdAt: Date.now() },
            ],
          };
        });
      },
      renameBranch: (id: string) => {
        const cur = conv?.branches.find((b) => b.id === id);
        const title = window.prompt('Νέος τίτλος', cur?.title ?? '');
        if (title === null) return;
        update((c) => ({ ...c, branches: c.branches.map((b) => (b.id === id ? { ...b, title: title.trim() } : b)) }));
      },
      deleteBranch: (id: string) => {
        if (!window.confirm('Διαγραφή της διακλάδωσης και όλων των μηνυμάτων της;')) return;
        update((c) => {
          const gone = new Set([id]);
          let grew = true;
          while (grew) {
            grew = false;
            for (const b of c.branches) {
              if (!gone.has(b.id) && b.parentBranchId && gone.has(b.parentBranchId)) {
                gone.add(b.id);
                grew = true;
              }
            }
          }
          return {
            ...c,
            branches: c.branches.filter((b) => !gone.has(b.id)),
            messages: c.messages.filter((m) => !gone.has(m.branchId)),
          };
        });
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeId, conv],
  );

  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const addConv = (c: Conversation) => {
    setConvs((cs) => [c, ...cs]);
    setActiveId(c.id);
    setOpen(new Set());
    setDialog(false);
  };

  const rename = () => {
    if (!conv) return;
    const t = window.prompt('Τίτλος συζήτησης', conv.title);
    if (t !== null && t.trim()) update((c) => ({ ...c, title: t.trim() }));
  };

  const removeConv = (id: string) => {
    if (!window.confirm('Διαγραφή ολόκληρης της συζήτησης;')) return;
    const rest = convs.filter((c) => c.id !== id);
    setConvs(rest);
    if (activeId === id) setActiveId(rest[0]?.id ?? null);
  };

  return (
    <div className="app">
      <aside className="side">
        <div className="brand">r<b>AI</b>sing</div>
        <button className="primary" onClick={() => setDialog(true)}>
          + Νέα / Εισαγωγή
        </button>
        <ul className="convs">
          {convs.map((c) => (
            <li key={c.id} className={c.id === activeId ? 'active' : ''}>
              <button
                className="conv-btn"
                onClick={() => {
                  setActiveId(c.id);
                  setOpen(new Set());
                }}
              >
                <span className="conv-title">{c.title}</span>
                <span className="conv-meta">
                  {c.source} · {c.messages.length} μην. · {c.branches.length - 1} διακλ.
                </span>
              </button>
              <button className="ico" title="Διαγραφή" onClick={() => removeConv(c.id)}>
                ✕
              </button>
            </li>
          ))}
        </ul>
        <p className="note">Τα δεδομένα μένουν μόνο στον browser σου. Κράτα αντίγραφο με Εξαγωγή.</p>
      </aside>

      <main className="main">
        {conv ? (
          <>
            <div className="toolbar">
              <h1 onClick={rename} title="Κλικ για μετονομασία">
                {conv.title}
              </h1>
              <input
                type="search"
                placeholder="Αναζήτηση στα μηνύματα…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button onClick={() => setOpen(new Set(conv.messages.map((m) => m.id)))}>Ανάπτυξη όλων</button>
              <button onClick={() => setOpen(new Set())}>Σύμπτυξη όλων</button>
              <button onClick={() => download(`${safeName(conv.title)}.json`, toJSON(conv), 'application/json')}>
                Εξαγωγή JSON
              </button>
              <button onClick={() => download(`${safeName(conv.title)}.md`, toMarkdown(conv), 'text/markdown')}>
                Εξαγωγή Markdown
              </button>
            </div>
            <div className="scroll">
              <Grid conv={conv} open={open} toggle={toggle} query={query} actions={actions} />
            </div>
          </>
        ) : !ready ? null : (
          <div className="empty-state">
            <p>Δεν υπάρχει συζήτηση ακόμα.</p>
            <button className="primary" onClick={() => setDialog(true)}>
              + Νέα / Εισαγωγή
            </button>
          </div>
        )}
      </main>

      {dialog && <NewDialog onClose={() => setDialog(false)} onCreate={addConv} />}
    </div>
  );
}

function NewDialog({ onClose, onCreate }: { onClose(): void; onCreate(c: Conversation): void }) {
  const [title, setTitle] = useState('');
  const [source, setSource] = useState(SOURCES[0]);
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState('');

  const create = () => {
    onCreate(
      text.trim()
        ? parseTranscript(text, title.trim(), source, url.trim())
        : newConversation(title.trim(), source, url.trim()),
    );
  };

  const [tools, setTools] = useState(false);

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      onCreate(parseJSON(await file.text()));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Αποτυχία εισαγωγής.');
    }
  };

  const importClaudeCode = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    try {
      for (const f of Array.from(files)) onCreate(parseClaudeCode(await f.text(), { tools }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Αποτυχία εισαγωγής.');
    }
  };

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Νέα συζήτηση / Εισαγωγή</h2>
        <label>
          Τίτλος
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="π.χ. Σχεδιασμός rAIsing" />
        </label>
        <div className="two">
          <label>
            Πηγή
            <select value={source} onChange={(e) => setSource(e.target.value)}>
              {SOURCES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Σύνδεσμος συζήτησης (προαιρετικό)
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://claude.ai/chat/…" />
          </label>
        </div>
        <label>
          Επικόλληση κειμένου συζήτησης (προαιρετικό)
          <textarea
            rows={7}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'Εγώ: …\nClaude: …\nΕγώ: …'}
          />
        </label>
        <p className="hint">
          Αναγνωρίζονται ετικέτες στην αρχή γραμμής: Εγώ / Χρήστης / User / Human και Claude / ΑΙ / Assistant / Gemini / GLM /
          ChatGPT.
        </p>
        <fieldset className="cc">
          <legend>Εισαγωγή από Claude Code</legend>
          <p className="hint">
            Διάλεξε ένα ή περισσότερα αρχεία <code>.jsonl</code> από τον φάκελο <code>~/.claude/projects/&lt;έργο&gt;/</code> (Windows:{' '}
            <code>%USERPROFILE%\.claude\projects</code>). Οι διακλαδώσεις (rewind/fork) γίνονται στήλες και μετά από compact η συζήτηση
            συνεχίζεται στην ίδια στήλη.
          </p>
          <div className="cc-row">
            <label className="check">
              <input type="checkbox" checked={tools} onChange={(e) => setTools(e.target.checked)} />
              Να περιλαμβάνονται τα tool calls και τα αποτελέσματά τους
            </label>
            <label className="file">
              Επιλογή αρχείων .jsonl
              <input type="file" multiple accept=".jsonl,.json,application/x-ndjson" onChange={(e) => void importClaudeCode(e.target.files)} />
            </label>
          </div>
        </fieldset>
        {error && <p className="error">{error}</p>}
        <div className="dialog-actions">
          <label className="file">
            Εισαγωγή αρχείου JSON
            <input type="file" accept="application/json,.json" onChange={(e) => void importFile(e.target.files?.[0])} />
          </label>
          <span className="spacer" />
          <button onClick={onClose}>Άκυρο</button>
          <button className="primary" onClick={create}>
            Δημιουργία
          </button>
        </div>
      </div>
    </div>
  );
}
