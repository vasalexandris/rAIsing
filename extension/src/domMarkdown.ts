/**
 * Small DOM -> Markdown converter for chat answers rendered as HTML.
 * Keeps headings, lists, emphasis, links, code blocks, tables and math (data-math) instead of flattening to plain text.
 */
const SKIP = new Set(['STYLE', 'SCRIPT', 'NOSCRIPT', 'BUTTON', 'MAT-ICON', 'GEM-ICON', 'SVG', 'TEXTAREA', 'INPUT']);

const collapse = (s: string) =>
  s
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

function isHidden(el: Element): boolean {
  return el.getAttribute('aria-hidden') === 'true' && !el.hasAttribute('data-math') && !el.querySelector('[data-math]')
    ? true
    : el.classList.contains('cdk-visually-hidden') || el.classList.contains('visually-hidden');
}

function codeBlock(el: Element): string {
  const code = el.querySelector('code') ?? el.querySelector('pre') ?? el;
  const text = (code.textContent ?? '').replace(/\n+$/, '');
  const cls = [...code.classList, ...(el.querySelector('code')?.classList ?? [])].find((c) => c.startsWith('language-'));
  const label = el.querySelector('.code-block-decoration span')?.textContent?.trim().toLowerCase();
  const lang = cls ? cls.slice(9) : label && /^[a-z0-9+#.-]{1,20}$/.test(label) ? label : '';
  return `\n\n\`\`\`${lang}\n${text}\n\`\`\`\n\n`;
}

function list(el: Element, ordered: boolean, depth: number): string {
  const lines: string[] = [];
  let n = 1;
  for (const li of Array.from(el.children)) {
    if (li.tagName !== 'LI') continue;
    let text = '';
    const nested: string[] = [];
    for (const c of Array.from(li.childNodes)) {
      if (c instanceof Element && (c.tagName === 'UL' || c.tagName === 'OL')) nested.push(list(c, c.tagName === 'OL', depth + 1));
      else text += md(c);
    }
    lines.push(`${'  '.repeat(depth)}${ordered ? `${n++}.` : '-'} ${collapse(text).replace(/\n+/g, ' ')}`);
    lines.push(...nested);
  }
  return lines.join('\n');
}

function table(el: Element): string {
  const rows = Array.from(el.querySelectorAll('tr')).map((tr) =>
    Array.from(tr.children).map((c) => collapse(md(c)).replace(/\n+/g, ' ').replace(/\|/g, '\\|')),
  );
  if (rows.length === 0) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array(width - r.length).fill('')];
  const line = (r: string[]) => `| ${pad(r).join(' | ')} |`;
  const out = [line(rows[0]), `| ${Array(width).fill('---').join(' | ')} |`, ...rows.slice(1).map(line)];
  return `\n\n${out.join('\n')}\n\n`;
}

function md(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').replace(/\s+/g, ' ');
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as Element;
  const tag = el.tagName;
  if (SKIP.has(tag) || isHidden(el)) return '';

  const math = el.getAttribute('data-math');
  if (math) return el.classList.contains('math-block') ? `\n\n$$\n${math}\n$$\n\n` : `$${math}$`;

  const kids = () => Array.from(el.childNodes).map(md).join('');
  switch (tag) {
    case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6':
      return `\n\n${'#'.repeat(Number(tag[1]))} ${collapse(kids()).replace(/\n+/g, ' ')}\n\n`;
    case 'P':
      return `\n\n${kids().trim()}\n\n`;
    case 'BR':
      return '\n';
    case 'HR':
      return '\n\n---\n\n';
    case 'STRONG': case 'B': {
      const t = kids().trim();
      return t ? `**${t}**` : '';
    }
    case 'EM': case 'I': {
      const t = kids().trim();
      return t ? `*${t}*` : '';
    }
    case 'CODE-BLOCK':
    case 'PRE':
      return codeBlock(el);
    case 'CODE':
      return el.closest('pre, code-block') ? (el.textContent ?? '') : `\`${el.textContent ?? ''}\``;
    case 'A': {
      const href = el.getAttribute('href') ?? '';
      const t = kids().trim();
      return /^https?:\/\//.test(href) && t ? `[${t}](${href})` : t;
    }
    case 'UL': case 'OL':
      return `\n\n${list(el, tag === 'OL', 0)}\n\n`;
    case 'BLOCKQUOTE':
      return `\n\n${collapse(kids()).split('\n').map((l) => `> ${l}`).join('\n')}\n\n`;
    case 'TABLE':
      return table(el);
    case 'IMG':
      return el.getAttribute('alt') ? `[εικόνα: ${el.getAttribute('alt')}]` : '[εικόνα]';
    case 'DIV': case 'SECTION': case 'ARTICLE': case 'MESSAGE-CONTENT':
      return `\n${kids()}\n`;
    default:
      return kids();
  }
}

export function domToMarkdown(root: Element): string {
  return collapse(md(root));
}
