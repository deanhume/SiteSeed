const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { loadSiteContent, parseFrontMatter } = require('../src/content');
const { renderMarkdown, renderMarkdownDocument } = require('../src/markdown');

test('parses front matter and arrays', () => {
  const result = parseFrontMatter(
    '---\ntitle: "Example: a test"\ntags: ["Node.js", "Testing"]\ndraft: false\n---\nHello',
    'example.md',
  );

  assert.equal(result.metadata.title, 'Example: a test');
  assert.deepEqual(result.metadata.tags, ['Node.js', 'Testing']);
  assert.equal(result.metadata.draft, false);
  assert.equal(result.body, 'Hello');
});

test('accepts a UTF-8 BOM and rejects duplicate front matter fields', () => {
  const result = parseFrontMatter(
    '\uFEFF---\ntitle: Example\ndate: 2026-09-15\n---\nHello',
    'example.md',
  );
  assert.equal(result.metadata.title, 'Example');

  assert.throws(
    () =>
      parseFrontMatter(
        '---\ntitle: First\ntitle: Second\n---\nHello',
        'duplicate.md',
      ),
    /Duplicate front matter field.*title/,
  );
});

test('renders Markdown and rewrites local image paths', () => {
  const html = renderMarkdown(
    '# Heading\n\n![Alt text](hero_image.jpg)\n\n[Video](clip.mp4)\n\n[Demo](sample.htm)\n\n[Flags](chrome://flags/)\n\nA **strong** paragraph.',
    { assetBase: '/content/posts/example/' },
  );

  assert.match(html, /<h1 id="heading">Heading<\/h1>/);
  assert.match(html, /src="\/content\/posts\/example\/hero_image.jpg"/);
  assert.match(html, /href="\/content\/posts\/example\/clip.mp4"/);
  assert.match(html, /href="\/content\/posts\/example\/sample.htm"/);
  assert.match(html, /href="chrome:\/\/flags\/"/);
  assert.doesNotMatch(html, /<em>image<\/em>/);
  assert.match(html, /<strong>strong<\/strong>/);
});

test('escapes Markdown URLs and attributes exactly once', () => {
  const html = renderMarkdown(
    '[Query](https://example.com/?first=1&second=2 "A & B")\n\n![A "quoted" image](hero.jpg)',
    { assetBase: '/content/posts/example/' },
  );

  assert.match(
    html,
    /href="https:\/\/example\.com\/\?first=1&amp;second=2"/,
  );
  assert.doesNotMatch(html, /&amp;amp;/);
  assert.match(html, /title="A &amp; B"/);
  assert.match(html, /alt="A &quot;quoted&quot; image"/);
});

test('renders Markdown tables with headers, alignment and inline formatting', () => {
  const html = renderMarkdown([
    'Before',
    '',
    '| Ingredient | Amount | Notes |',
    '| :--- | ---: | :---: |',
    '| **Pale malt** | 4 kg | *Base malt* |',
    '| [Hops](guide.pdf) | 20 g | `60 min` |',
    '',
    'After',
  ].join('\n'), { assetBase: '/content/posts/recipe/' });

  assert.match(html, /<p>Before<\/p>\n<div class="table-scroll"/);
  assert.match(html, /role="region" aria-label="Scrollable table" tabindex="0"/);
  assert.match(html, /<th scope="col" style="text-align:left">Ingredient<\/th>/);
  assert.match(html, /<th scope="col" style="text-align:right">Amount<\/th>/);
  assert.match(html, /<td style="text-align:center"><em>Base malt<\/em><\/td>/);
  assert.match(html, /<td style="text-align:left"><strong>Pale malt<\/strong><\/td>/);
  assert.match(html, /href="\/content\/posts\/recipe\/guide\.pdf"/);
  assert.match(html, /<code>60 min<\/code>/);
  assert.match(html, /<\/table><\/div>\n<p>After<\/p>/);
  assert.equal((html.match(/<tr>/g) || []).length, 3);
});

test('supports table edge pipes, empty cells, escaped pipes and safe line breaks', () => {
  const html = renderMarkdown([
    'Name | Notes | Empty',
    '--- | --- | ---',
    'A\\|B | `x\\|y` |',
    '| \\- | first<br>second<BR />third | |',
    '| | `<br>` | <script>alert(1)</script> |',
    '| ![Malt](malt.png) | \\*literal\\* | & |',
  ].join('\n'), { assetBase: '/content/posts/recipe/' });

  assert.match(html, /<td>A\|B<\/td><td><code>x\|y<\/code><\/td><td><\/td>/);
  assert.match(html, /<td>-<\/td><td>first<br>second<br>third<\/td><td><\/td>/);
  assert.match(html, /<td><\/td><td><code>&lt;br&gt;<\/code><\/td>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /src="\/content\/posts\/recipe\/malt\.png"/);
  assert.match(html, /<td>\*literal\*<\/td><td>&amp;<\/td>/);
});

test('pads short table rows and ends a table before another Markdown block', () => {
  const document = renderMarkdownDocument([
    '| Name | Amount |',
    '| --- | --- |',
    '| Malt |',
    '| Hops | 20 g | extra cell |',
    '## Next | section',
    '',
    'A paragraph with a | pipe.',
  ].join('\n'));
  assert.match(document.html, /<td>Malt<\/td><td><\/td>/);
  assert.match(document.html, /<td>Hops<\/td><td>20 g<\/td>/);
  assert.doesNotMatch(document.html, /extra cell/);
  assert.match(document.html, /<\/table><\/div>\n<h2 id="next-section">/);
  assert.equal(document.headings[0].label, 'Next | section');
  assert.match(document.html, /<p>A paragraph with a \| pipe\.<\/p>/);
});

test('does not interpret invalid tables, code fences or raw HTML as Markdown tables', () => {
  for (const markdown of [
    '| Name | Amount |\n| --- |\n| Malt | 4 kg |',
    '| Name | Amount |\n| not a separator | --- |\n| Malt | 4 kg |',
    '```\n| Name | Amount |\n| --- | --- |\n| Malt | 4 kg |\n```',
    '<table><tr><td>Untrusted</td></tr></table>',
  ]) {
    assert.doesNotMatch(renderMarkdown(markdown), /<table>/);
  }
  const trusted = renderMarkdown(
    '<div>\n| Name | Amount |\n| --- | --- |\n| Malt | 4 kg |\n</div>',
    { allowHtml: true },
  );
  assert.doesNotMatch(trusted, /<table>/);
  assert.match(trusted, /<div>\n\| Name/);
});

test('only renders raw HTML blocks when explicitly enabled', () => {
  const markdown = `Before

<div class="interactive">
  Embedded content
</div>

<script>
  const value = "<strong>trusted</strong>";

  window.example = value;
</script>

After`;
  const escaped = renderMarkdown(markdown);
  const trusted = renderMarkdown(markdown, { allowHtml: true });

  assert.match(escaped, /&lt;div class=&quot;interactive&quot;&gt;/);
  assert.match(escaped, /&lt;script&gt;/);
  assert.match(trusted, /<div class="interactive">[\s\S]*Embedded content/);
  assert.match(trusted, /<script>[\s\S]*window\.example = value;[\s\S]*<\/script>/);
  assert.match(trusted, /<p>Before<\/p>/);
  assert.match(trusted, /<p>After<\/p>/);
});

test('renders bookmark cards with escaped metadata and localized preview images', () => {
  const bookmark = {
    url: 'https://example.com/water/?first=1&second=2',
    title: 'Water & brewing <script>alert(1)</script>',
    description: 'A useful article about water.',
    author: 'Example Blog',
    publisher: 'Alex Example',
    icon: 'icon.png',
    thumbnail: 'water.jpg',
    caption: 'More about "water".',
  };
  const document = renderMarkdownDocument(
    `Before\n\n\`\`\`bookmark\n${JSON.stringify(bookmark)}\n\`\`\`\n\nAfter`,
    { assetBase: '/preview-assets/posts/recipe/' },
  );
  assert.deepEqual(document.bookmarks, [bookmark]);
  assert.match(document.html, /<p>Before<\/p>\n<figure class="bookmark-card">/);
  assert.match(document.html, /href="https:\/\/example\.com\/water\/\?first=1&amp;second=2"/);
  assert.match(document.html, /Water &amp; brewing &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(document.html, /src="\/preview-assets\/posts\/recipe\/icon\.png"/);
  assert.match(document.html, /src="\/preview-assets\/posts\/recipe\/water\.jpg"/);
  assert.match(document.html, /<span>Example Blog<\/span><span aria-hidden="true"> · <\/span><span>Alex Example<\/span>/);
  assert.match(document.html, /<figcaption>More about &quot;water&quot;\.<\/figcaption>/);
  assert.match(document.html, /<\/figure>\n<p>After<\/p>/);
  assert.doesNotMatch(document.html, /<script>|<pre>/);
  assert.deepEqual(document.headings, []);
});

test('renders text-only bookmarks and leaves ordinary code fences alone', () => {
  const source = JSON.stringify({ url: '/recipe/', title: 'Recipe' });
  const html = renderMarkdown(`\`\`\`bookmark\n${source}\n\`\`\``);
  assert.match(html, /class="bookmark-link" href="\/recipe\/"/);
  assert.doesNotMatch(html, /<img|bookmark-thumbnail|bookmark-metadata|figcaption/);
  const code = renderMarkdownDocument(`\`\`\`json\n${source}\n\`\`\``);
  assert.match(code.html, /<pre><code class="language-json">/);
  assert.deepEqual(code.bookmarks, []);
});

test('rejects malformed bookmarks, unsupported metadata and unsafe URLs', () => {
  for (const source of [
    '{bad JSON}', 'null', '[]',
    '{"url":"/recipe/"}',
    '{"url":"/recipe/","title":42}',
    '{"url":"/recipe/","title":"Recipe","onclick":"alert(1)"}',
    '{"url":"javascript:alert(1)","title":"Recipe"}',
    '{"url":"https://user:password@example.com/","title":"Recipe"}',
    '{"url":"https://example.com/","title":"Recipe","icon":"data:image/svg+xml,example"}',
    '{"url":"https://example.com/","title":"Recipe","thumbnail":"java\\nscript:alert(1)"}',
  ]) {
    assert.throws(() => renderMarkdown(`\`\`\`bookmark\n${source}\n\`\`\``), /bookmark/i);
  }
  assert.throws(() => renderMarkdown('```bookmark\n{"url":"/","title":"Home"}'), /Unclosed bookmark/);
});

test('creates unique heading links and table of contents metadata', () => {
  const document = renderMarkdownDocument(
    '## Getting **started**\n\n### Install [Node.js](https://nodejs.org)\n\n## Getting started',
  );

  assert.match(document.html, /<h2 id="getting-started">/);
  assert.match(document.html, /<h3 id="install-node-js">/);
  assert.match(document.html, /<h2 id="getting-started-2">/);
  assert.deepEqual(document.headings, [
    { level: 2, id: 'getting-started', label: 'Getting started' },
    { level: 3, id: 'install-node-js', label: 'Install Node.js' },
    { level: 2, id: 'getting-started-2', label: 'Getting started' },
  ]);
});

test('loads posts, pages, and tag metadata', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'siteseed-'));
  const postDirectory = path.join(root, 'posts', 'example');
  const pageDirectory = path.join(root, 'pages', 'about');
  const tagDirectory = path.join(root, 'tags', 'node-js');
  fs.mkdirSync(postDirectory, { recursive: true });
  fs.mkdirSync(pageDirectory, { recursive: true });
  fs.mkdirSync(tagDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(postDirectory, 'index.md'),
    '---\ntitle: Example\nslug: example\ndate: 2026-09-15\ntags: [Node.js]\ncard_image: card.svg\ncard_image_alt: Card art\nallow_html: true\n---\n<div class="embed">Post</div>',
  );
  fs.writeFileSync(path.join(postDirectory, 'card.svg'), '<svg></svg>');
  fs.writeFileSync(
    path.join(pageDirectory, 'index.md'),
    '---\ntitle: About\nslug: about\nupdated: 2026-09-15\n---\nPage\n\n| Name | Amount |\n| --- | --- |\n| Malt | 4 kg |',
  );
  fs.writeFileSync(
    path.join(tagDirectory, 'index.json'),
    JSON.stringify({
      name: 'Node.js',
      slug: 'node-js',
      description: 'Node.js articles.',
      featureImage: 'node.jpg',
    }),
  );
  fs.writeFileSync(
    path.join(root, 'image-manifest.json'),
    JSON.stringify({
      'tags/node-js/node.jpg': {
        width: 1200,
        height: 800,
        variants: [
          { file: 'node-640.webp', width: 640, height: 427 },
          { file: 'node-1200.webp', width: 1200, height: 800 },
        ],
      },
    }),
  );

  const result = loadSiteContent(root, { defaultAuthor: 'Example Author' });
  assert.equal(result.posts[0].author, 'Example Author');
  assert.equal(result.pages[0].author, 'Example Author');
  assert.equal(result.posts[0].slug, 'example');
  assert.equal(result.posts[0].cardImage, '/content/posts/example/card.svg');
  assert.equal(result.posts[0].cardImageAlt, 'Card art');
  assert.equal(result.posts[0].allowHtml, true);
  assert.match(result.posts[0].html, /<div class="embed">Post<\/div>/);
  assert.equal(result.pages[0].slug, 'about');
  assert.match(result.pages[0].html, /<table><thead>/);
  assert.match(result.pages[0].html, /<td>Malt<\/td><td>4 kg<\/td>/);
  assert.deepEqual(result.tags.map(({ slug }) => slug), ['node-js']);
  assert.equal(result.tags[0].description, 'Node.js articles.');
  assert.equal(
    result.tags[0].featureImage,
    '/content/tags/node-js/node-1200.webp',
  );
  assert.match(result.tags[0].featureImageSrcSet, /node-640\.webp 640w/);

  fs.rmSync(root, { recursive: true, force: true });
});

test('loads drafts only for preview and gives them preview asset URLs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'siteseed-draft-'));
  const draftDirectory = path.join(root, 'posts', 'draft-post');
  fs.mkdirSync(draftDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(draftDirectory, 'index.md'),
    '---\ntitle: Draft post\nslug: draft-post\ndate: 2026-09-15\ndraft: true\nfeature_image: hero.jpg\n---\n![Diagram](diagram.png)\n\n| Ingredient | Guide |\n| --- | --- |\n| Malt | [Download](malt.pdf) |',
  );

  assert.equal(loadSiteContent(root).posts.length, 0);

  const preview = loadSiteContent(root, {
    includeDrafts: true,
    draftAssetBase: '/preview-assets/posts/',
  });
  assert.equal(preview.posts.length, 1);
  assert.equal(
    preview.posts[0].featureImage,
    '/preview-assets/posts/draft-post/hero.jpg',
  );
  assert.match(
    preview.posts[0].html,
    /src="\/preview-assets\/posts\/draft-post\/diagram\.png"/,
  );
  assert.match(preview.posts[0].html, /<table><thead>/);
  assert.match(
    preview.posts[0].html,
    /href="\/preview-assets\/posts\/draft-post\/malt\.pdf"/,
  );

  fs.rmSync(root, { recursive: true, force: true });
});
