const TurndownService = require('turndown');
const { parseBookmark } = require('./markdown');

function createTurndown() {
  const service = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
  });

  service.remove(['script', 'style', 'noscript']);
  service.addRule('bookmark', {
    filter(node) {
      return node.nodeName === 'FIGURE' && node.classList.contains('kg-bookmark-card');
    },
    replacement(content, node) {
      const text = (selector) => node.querySelector(selector)?.textContent.replace(/\s+/g, ' ').trim() || '';
      const bookmark = {
        url: node.querySelector('a.kg-bookmark-container')?.getAttribute('href')?.trim() || '',
        title: text('.kg-bookmark-title'),
      };
      for (const field of ['description', 'author', 'publisher']) {
        const value = text(`.kg-bookmark-${field}`);
        if (value) bookmark[field] = value;
      }
      for (const [field, selector] of [
        ['icon', '.kg-bookmark-icon'],
        ['thumbnail', '.kg-bookmark-thumbnail img'],
      ]) {
        const source = node.querySelector(selector)?.getAttribute('src')?.trim();
        if (source) bookmark[field] = source;
      }
      const caption = text('figcaption');
      if (caption) bookmark.caption = caption;
      return `\n\n\`\`\`bookmark\n${JSON.stringify(parseBookmark(JSON.stringify(bookmark)), null, 2)}\n\`\`\`\n\n`;
    },
  });
  for (const [tag, label] of [['iframe', 'Embedded content'], ['video', 'Video'], ['audio', 'Audio']]) {
    service.addRule(tag, {
      filter: tag,
      replacement(content, node) {
        const source = node.getAttribute('src') || node.querySelector('source')?.getAttribute('src');
        return source ? `\n\n[${label}](${source})\n\n` : content;
      },
    });
  }
  service.addRule('table', {
    filter: 'table',
    replacement(content, node) {
      if (node.querySelector('table')) throw new Error('Cannot import a nested table as Markdown.');
      const rows = Array.from(node.querySelectorAll('tr'), (row) =>
        Array.from(row.children).filter((cell) => /^(TH|TD)$/.test(cell.nodeName)),
      );
      if (!rows.length || !rows[0].length) throw new Error('Cannot import a table without cells.');
      const width = rows[0].length;
      if (rows.some((row) => row.length !== width)) {
        throw new Error('Cannot import a table with inconsistent column counts.');
      }
      if (rows.flat().some((cell) =>
        ['rowspan', 'colspan'].some((name) => cell.hasAttribute(name) && cell.getAttribute(name) !== '1'),
      )) {
        throw new Error('Cannot import merged table cells as Markdown.');
      }
      const cellMarkdown = (cell) => service.turndown(cell.innerHTML)
        .trim().replace(/\s*\n+\s*/g, '<br>').replace(/\|/g, '\\|');
      const formatRow = (cells) => `| ${cells.join(' | ')} |`;
      const hasHeader = rows[0].every((cell) => cell.nodeName === 'TH');
      const header = hasHeader ? rows.shift() : [];
      const delimiters = Array.from({ length: width }, (_, index) => {
        const cell = header[index];
        const align = (cell?.getAttribute('align') || cell?.style?.textAlign || '').trim().toLowerCase();
        return { left: ':---', right: '---:', center: ':---:' }[align] || '---';
      });
      const caption = node.querySelector('caption');
      return '\n\n' +
        (caption ? `${service.turndown(caption.innerHTML)}\n\n` : '') +
        [
          formatRow(hasHeader ? header.map(cellMarkdown) : Array(width).fill('')),
          formatRow(delimiters),
          ...rows.map((row) => formatRow(row.map(cellMarkdown))),
        ].join('\n') + '\n\n';
    },
  });
  return service;
}

module.exports = { createTurndown };
