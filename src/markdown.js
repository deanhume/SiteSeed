function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function assetUrl(url, assetBase) {
  if (
    /^[a-z][a-z0-9+.-]*:/i.test(url) ||
    url.startsWith('//') ||
    url.startsWith('/') ||
    url.startsWith('#')
  ) {
    return url;
  }
  return `${assetBase}${url.replace(/^\.\//, '')}`;
}

function linkUrl(url, assetBase) {
  if (
    /\.(?:avif|docx?|gif|html?|jpe?g|m4a|mov|mp3|mp4|ogg|pdf|png|pptx?|svg|txt|wav|webm|webp|xlsx?|zip)(?:$|[?#])/i.test(
      url,
    )
  ) {
    return assetUrl(url, assetBase);
  }
  return url;
}

function parseBookmark(source) {
  let value;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new Error(`Invalid bookmark JSON: ${error.message}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('A bookmark must be a JSON object.');
  }
  const fields = [
    'url', 'title', 'description', 'author', 'publisher',
    'icon', 'thumbnail', 'caption',
  ];
  const bookmark = {};
  for (const [field, content] of Object.entries(value)) {
    if (!fields.includes(field) || typeof content !== 'string') {
      throw new Error(`Invalid bookmark field: ${field}. Expected a supported string field.`);
    }
    bookmark[field] = content.trim();
  }
  if (!bookmark.url || !bookmark.title) {
    throw new Error('A bookmark requires a URL and title.');
  }
  for (const field of ['url', 'icon', 'thumbnail']) {
    const url = bookmark[field];
    if (!url) continue;
    if (
      /[\u0000-\u0020\u007f\\]/.test(url) ||
      (field === 'url' && !/^(?:https?:\/\/|\/(?!\/))/i.test(url))
    ) {
      throw new Error(`Invalid bookmark ${field}: use an HTTP(S) URL or local path.`);
    }
    let parsed;
    try {
      parsed = new URL(url, 'https://bookmark.invalid/');
    } catch {
      throw new Error(`Invalid bookmark ${field} URL.`);
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new Error(`Invalid bookmark ${field}: only HTTP(S) URLs and local paths are allowed.`);
    }
  }
  return bookmark;
}

function renderBookmark(bookmark, assetBase) {
  const metadata = [bookmark.author, bookmark.publisher]
    .filter(Boolean)
    .map((value) => `<span>${escapeHtml(value)}</span>`)
    .join('<span aria-hidden="true"> · </span>');
  const icon = bookmark.icon
    ? `<img class="bookmark-icon" src="${escapeHtml(assetUrl(bookmark.icon, assetBase))}" alt="" width="24" height="24" loading="lazy" decoding="async">`
    : '';
  return `<figure class="bookmark-card">
  <a class="bookmark-link" href="${escapeHtml(bookmark.url)}" aria-label="${escapeHtml(bookmark.title)}">
    <span class="bookmark-content">
      <span class="bookmark-title">${escapeHtml(bookmark.title)}</span>
      ${bookmark.description ? `<span class="bookmark-description">${escapeHtml(bookmark.description)}</span>` : ''}
      ${icon || metadata ? `<span class="bookmark-metadata">${icon}${metadata}</span>` : ''}
    </span>
    ${bookmark.thumbnail ? `<span class="bookmark-thumbnail"><img src="${escapeHtml(assetUrl(bookmark.thumbnail, assetBase))}" alt="" loading="lazy" decoding="async"></span>` : ''}
  </a>
  ${bookmark.caption ? `<figcaption>${escapeHtml(bookmark.caption)}</figcaption>` : ''}
</figure>`;
}

function inlineMarkdown(value, assetBase, { allowLineBreaks = false } = {}) {
  let html = String(value);
  const protectedHtml = [];

  // Protect generated HTML while escaping and applying emphasis to surrounding text.
  function protect(fragment) {
    protectedHtml.push(fragment);
    return `\u0000HTML${protectedHtml.length - 1}\u0000`;
  }

  html = html.replace(/`([^`]+)`/g, (_, contents) => {
    return protect(`<code>${escapeHtml(contents)}</code>`);
  });
  if (allowLineBreaks) {
    html = html.replace(/<br\s*\/?>/gi, () => protect('<br>'));
  }
  html = html.replace(/\\([\\`*{}\[\]()#+\-.!_|>])/g, (_, character) =>
    protect(escapeHtml(character)),
  );
  html = html.replace(
    /!\[([^\]]*)\]\((\S+?)(?:\s+"([^"]*)")?\)/g,
    (_, alt, url, title) =>
      protect(
        `<img src="${escapeHtml(assetUrl(url, assetBase))}" alt="${escapeHtml(alt)}" loading="lazy"${title ? ` title="${escapeHtml(title)}"` : ''}>`,
      ),
  );
  html = html.replace(
    /\[([^\]]+)\]\((\S+?)(?:\s+"([^"]*)")?\)/g,
    (_, label, url, title) =>
      protect(
        `<a href="${escapeHtml(linkUrl(url, assetBase))}"${title ? ` title="${escapeHtml(title)}"` : ''}>${escapeHtml(label)}</a>`,
      ),
  );
  html = escapeHtml(html);
  html = html
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>');
  while (/\u0000HTML\d+\u0000/.test(html)) {
    html = html.replace(
      /\u0000HTML(\d+)\u0000/g,
      (_, index) => protectedHtml[Number(index)],
    );
  }
  return html;
}

function headingText(value) {
  return String(value)
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_]/g, '')
    .trim();
}

function headingSlug(value) {
  return (
    headingText(value)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'section'
  );
}

const voidHtmlElements = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);

function rawHtmlBlock(lines, start) {
  const firstLine = lines[start];
  const trimmed = firstLine.trimStart();

  if (trimmed.startsWith('<!--')) {
    const block = [];
    for (let index = start; index < lines.length; index += 1) {
      block.push(lines[index]);
      if (lines[index].includes('-->')) {
        return { html: block.join('\n'), end: index };
      }
    }
    return null;
  }

  const opening = trimmed.match(/^<([a-z][a-z0-9:-]*)\b/i);
  if (!opening) return null;

  const tag = opening[1].toLowerCase();
  const closing = new RegExp(`</${tag}\\s*>`, 'i');
  if (
    voidHtmlElements.has(tag) ||
    /\/>\s*$/.test(firstLine) ||
    closing.test(firstLine)
  ) {
    return { html: firstLine, end: start };
  }

  const block = [firstLine];
  for (let index = start + 1; index < lines.length; index += 1) {
    block.push(lines[index]);
    if (closing.test(lines[index])) {
      return { html: block.join('\n'), end: index };
    }
  }
  return null;
}

function tableCells(line) {
  const cells = [''];
  let separators = 0;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '\\' && index + 1 < line.length) {
      const next = line[++index];
      cells[cells.length - 1] += next === '|' ? '|' : `\\${next}`;
    } else if (character === '|') {
      cells.push('');
      separators += 1;
    } else {
      cells[cells.length - 1] += character;
    }
  }
  if (!separators) return null;
  if (!cells[0].trim()) cells.shift();
  if (cells.length && !cells.at(-1).trim()) cells.pop();
  return cells.map((cell) => cell.trim());
}

function markdownTable(lines, start, assetBase) {
  const headers = tableCells(lines[start]);
  const separators = tableCells(lines[start + 1] || '');
  if (
    !headers?.length ||
    !separators ||
    headers.length !== separators.length ||
    !separators.every((cell) => /^:?-{3,}:?$/.test(cell))
  ) {
    return null;
  }
  const alignments = separators.map((cell) => {
    if (cell.startsWith(':') && cell.endsWith(':')) return 'center';
    if (cell.endsWith(':')) return 'right';
    if (cell.startsWith(':')) return 'left';
    return '';
  });
  function row(cells, tag) {
    return `<tr>${headers.map((_, index) => {
      const value = inlineMarkdown(cells[index] || '', assetBase, {
        allowLineBreaks: true,
      });
      const alignment = alignments[index]
        ? ` style="text-align:${alignments[index]}"`
        : '';
      return `<${tag}${tag === 'th' ? ' scope="col"' : ''}${alignment}>${value}</${tag}>`;
    }).join('')}</tr>`;
  }
  const rows = [];
  let end = start + 1;
  for (let index = start + 2; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*(?:#{1,6}\s|>|[-*+]\s|\d+\.\s|```|<)/.test(line)) break;
    const cells = tableCells(line);
    if (!cells) break;
    rows.push(row(cells, 'td'));
    end = index;
  }
  return {
    html: `<div class="table-scroll" role="region" aria-label="Scrollable table" tabindex="0"><table><thead>${row(headers, 'th')}</thead><tbody>${rows.join('')}</tbody></table></div>`,
    end,
  };
}

function renderMarkdownDocument(
  markdown,
  { assetBase = '/', allowHtml = false } = {},
) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const output = [];
  const headings = [];
  const bookmarks = [];
  const headingCounts = new Map();
  let paragraph = [];
  let listType = null;
  let codeLanguage = '';
  let codeLines = null;

  function flushParagraph() {
    if (!paragraph.length) return;
    output.push(`<p>${inlineMarkdown(paragraph.join(' '), assetBase)}</p>`);
    paragraph = [];
  }

  function closeList() {
    if (!listType) return;
    output.push(`</${listType}>`);
    listType = null;
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = line.match(/^```([\w-]*)\s*$/);
    if (fence) {
      flushParagraph();
      closeList();
      if (codeLines) {
        if (codeLanguage === 'bookmark') {
          const bookmark = parseBookmark(codeLines.join('\n'));
          bookmarks.push(bookmark);
          output.push(renderBookmark(bookmark, assetBase));
        } else {
          output.push(
            `<pre><code${codeLanguage ? ` class="language-${escapeHtml(codeLanguage)}"` : ''}>${escapeHtml(codeLines.join('\n'))}</code></pre>`,
          );
        }
        codeLines = null;
        codeLanguage = '';
      } else {
        codeLines = [];
        codeLanguage = fence[1];
      }
      continue;
    }

    if (codeLines) {
      codeLines.push(line);
      continue;
    }

    if (allowHtml) {
      const rawBlock = rawHtmlBlock(lines, index);
      if (rawBlock) {
        flushParagraph();
        closeList();
        output.push(rawBlock.html);
        index = rawBlock.end;
        continue;
      }
    }

    if (!line.trim()) {
      flushParagraph();
      closeList();
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length;
      const label = headingText(heading[2]);
      const slug = headingSlug(heading[2]);
      const count = (headingCounts.get(slug) || 0) + 1;
      const id = count === 1 ? slug : `${slug}-${count}`;
      headingCounts.set(slug, count);
      output.push(
        `<h${level} id="${escapeHtml(id)}">${inlineMarkdown(heading[2], assetBase)}</h${level}>`,
      );
      if (level >= 2 && level <= 4) headings.push({ level, id, label });
      continue;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      closeList();
      output.push(`<blockquote>${inlineMarkdown(quote[1], assetBase)}</blockquote>`);
      continue;
    }

    const unordered = line.match(/^[-*+]\s+(.+)$/);
    const ordered = line.match(/^\d+\.\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      const nextListType = unordered ? 'ul' : 'ol';
      if (listType !== nextListType) {
        closeList();
        listType = nextListType;
        output.push(`<${listType}>`);
      }
      output.push(`<li>${inlineMarkdown((unordered || ordered)[1], assetBase)}</li>`);
      continue;
    }

    const thematicBreak = line.match(/^(?:---+|\*\*\*+)$/);
    if (thematicBreak) {
      flushParagraph();
      closeList();
      output.push('<hr>');
      continue;
    }

    const table = markdownTable(lines, index, assetBase);
    if (table) {
      flushParagraph();
      closeList();
      output.push(table.html);
      index = table.end;
      continue;
    }

    const imageOnly = line.match(/^!\[([^\]]*)\]\((.+)\)$/);
    if (imageOnly) {
      flushParagraph();
      closeList();
      output.push(`<figure>${inlineMarkdown(line, assetBase)}</figure>`);
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
  closeList();
  if (codeLines) {
    if (codeLanguage === 'bookmark') {
      throw new Error('Unclosed bookmark block.');
    }
    output.push(
      `<pre><code${codeLanguage ? ` class="language-${escapeHtml(codeLanguage)}"` : ''}>${escapeHtml(codeLines.join('\n'))}</code></pre>`,
    );
  }

  return {
    html: output.join('\n'),
    headings,
    bookmarks,
  };
}

function renderMarkdown(markdown, options) {
  return renderMarkdownDocument(markdown, options).html;
}

module.exports = {
  escapeHtml,
  parseBookmark,
  renderMarkdown,
  renderMarkdownDocument,
};
