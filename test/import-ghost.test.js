const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createTurndown,
  isDownloadableUrl,
  normalizeGhostHtml,
} = require('../scripts/import-ghost').createGhostImporter(
  require('../src/site').createBlogContext({
    rootDirectory: require('node:path').join(__dirname, 'fixtures', 'blog'),
    env: { SITE_URL: 'https://example.com' },
  }),
);

test('uses SITE_URL when recognizing and rewriting Ghost URLs', () => {
  assert.equal(
    isDownloadableUrl(
      'https://www.example.com/content/media/brewing-guide',
      'href',
    ),
    true,
  );
  assert.equal(
    isDownloadableUrl(
      'https://other.example/content/media/brewing-guide',
      'href',
    ),
    false,
  );
  assert.equal(
    normalizeGhostHtml(
      '<a href="https://www.example.com/Home/BlogPost/brew-day/42">Brew day</a>' +
        '<img src="__GHOST_URL__/content/images/beer.jpg">',
    ),
    '<a href="https://example.com/brew-day/">Brew day</a>' +
      '<img src="https://example.com/content/images/beer.jpg">',
  );
});

test('imports HTML recipe tables without losing rows, quantities or formatting', () => {
  const markdown = createTurndown().turndown(
    '<h2>Hops</h2><table><thead><tr><th>Name</th><th>Amount</th><th>Time</th></tr></thead>' +
    '<tbody><tr><td><a href="https://example.com/hops">Calais Goldings</a></td><td>20 g</td><td><em>20 min</em></td></tr>' +
    '<tr><td>Hallertau Magnum</td><td>5 g</td><td>60 min</td></tr></tbody></table><p>After</p>',
  );
  assert.equal(markdown, [
    '## Hops', '',
    '| Name | Amount | Time |',
    '| --- | --- | --- |',
    '| [Calais Goldings](https://example.com/hops) | 20 g | *20 min* |',
    '| Hallertau Magnum | 5 g | 60 min |',
    '', 'After',
  ].join('\n'));
});

test('preserves table captions, empty cells, alignment, pipes and cell breaks', () => {
  const markdown = createTurndown().turndown(
    '<table><caption>Recipe notes</caption><tr><th align="left">Name</th><th style="text-align:right">Value</th><th align="center">Empty</th></tr>' +
    '<tr><td>A|B</td><td>first<br>second</td><td></td></tr>' +
    '<tr><td><code>x|y</code></td><td>-</td><td></td></tr></table>',
  );
  assert.equal(markdown, [
    'Recipe notes', '',
    '| Name | Value | Empty |',
    '| :--- | ---: | :---: |',
    '| A\\|B | first<br>second |  |',
    '| `x\\|y` | \\- |  |',
  ].join('\n'));
  const html = require('../src/markdown').renderMarkdown(markdown);
  assert.match(html, /<td style="text-align:left">A\|B<\/td>/);
  assert.match(html, /<code>x\|y<\/code>/);
});

test('imports headerless tables without treating a data row as a heading', () => {
  const markdown = createTurndown().turndown(
    '<table><tr><td>Malt</td><td>4 kg</td></tr><tr><td>Hops</td><td>20 g</td></tr></table>',
  );
  assert.equal(markdown, '|  |  |\n| --- | --- |\n| Malt | 4 kg |\n| Hops | 20 g |');
});

test('fails explicitly rather than flattening unsupported HTML tables', () => {
  const converter = createTurndown();
  assert.throws(() => converter.turndown(
    '<table><tr><th>A</th><th>B</th></tr><tr><td colspan="2">Merged</td><td>C</td></tr></table>',
  ), /merged table cells/);
  assert.throws(() => converter.turndown(
    '<table><tr><th>A</th><th>B</th></tr><tr><td>C</td></tr></table>',
  ), /inconsistent column counts/);
  assert.throws(() => converter.turndown(
    '<table><tr><td><table><tr><th>Inner</th></tr><tr><td>Value</td></tr></table></td></tr></table>',
  ), /nested table/);
});

test('imports Ghost bookmark metadata, localized media and captions as a safe card', () => {
  const markdown = createTurndown().turndown(
    '<figure class="kg-card kg-bookmark-card kg-card-hascaption">' +
    '<a class="kg-bookmark-container" href=" https://example.com/water/?a=1&amp;b=2 ">' +
    '<div class="kg-bookmark-content"><div class="kg-bookmark-title">Water &amp; brewing</div>' +
    '<div class="kg-bookmark-description">Learn about <em>water</em>.</div>' +
    '<div class="kg-bookmark-metadata"><img class="kg-bookmark-icon" src="icon.png">' +
    '<span class="kg-bookmark-author">Example Blog</span><span class="kg-bookmark-publisher">Alex Example</span></div></div>' +
    '<div class="kg-bookmark-thumbnail"><img src="water.jpg"></div></a>' +
    '<figcaption>Water guide</figcaption></figure>',
  );
  assert.match(markdown, /^```bookmark\n/);
  const document = require('../src/markdown').renderMarkdownDocument(markdown, {
    assetBase: '/content/posts/example/',
  });
  assert.deepEqual(document.bookmarks, [{
    url: 'https://example.com/water/?a=1&b=2',
    title: 'Water & brewing',
    description: 'Learn about water.',
    author: 'Example Blog',
    publisher: 'Alex Example',
    icon: 'icon.png',
    thumbnail: 'water.jpg',
    caption: 'Water guide',
  }]);
  assert.match(document.html, /class="bookmark-card"/);
  assert.match(document.html, /src="\/content\/posts\/example\/water\.jpg"/);
});

test('imports bookmarks without images and keeps other Ghost card types unchanged', () => {
  const converter = createTurndown();
  const markdown = converter.turndown(
    '<figure class="kg-card kg-bookmark-card"><a class="kg-bookmark-container" href="/recipe/">' +
    '<div class="kg-bookmark-title">Recipe</div></a></figure>',
  );
  assert.deepEqual(require('../src/markdown').renderMarkdownDocument(markdown).bookmarks, [
    { url: '/recipe/', title: 'Recipe' },
  ]);
  assert.equal(
    converter.turndown('<figure class="kg-card kg-image-card"><img src="beer.jpg" alt="Beer"></figure>'),
    '![Beer](beer.jpg)',
  );
  assert.equal(
    converter.turndown('<figure class="kg-card kg-embed-card"><iframe src="https://example.com/video"></iframe></figure>'),
    '[Embedded content](https://example.com/video)',
  );
  assert.throws(() => converter.turndown(
    '<figure class="kg-bookmark-card"><a class="kg-bookmark-container" href="javascript:alert(1)">' +
    '<div class="kg-bookmark-title">Unsafe</div></a></figure>',
  ), /Invalid bookmark url/);
});
