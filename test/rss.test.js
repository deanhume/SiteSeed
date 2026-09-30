const assert = require('node:assert/strict');
const test = require('node:test');
const { renderRss } = require('../src/rss');
const { site } = require('../src/site').createBlogContext({
  rootDirectory: require('node:path').join(__dirname, 'fixtures', 'blog'),
  env: {},
});

test('omits executable raw HTML from RSS content', () => {
  const rss = renderRss({
    site,
    lastBuildDate: '2026-09-16',
    posts: [
      {
        title: 'Interactive article',
        slug: 'interactive-article',
        description: 'An article with an embed.',
        author: 'Alex Example',
        date: '2026-09-15',
        tags: [],
        featureImage: '',
        html:
          '<div class="embed">Fallback</div><script>window.example = true;</script>',
      },
    ],
  });

  assert.match(rss, /<div class="embed">Fallback<\/div>/);
  assert.match(rss, /<title><!\[CDATA\[Example Blog\]\]><\/title>/);
  assert.match(rss, /Notes on writing and learning\./);
  assert.match(rss, /<image><url>https:\/\/example\.com\/example-logo\.png<\/url>/);
  assert.doesNotMatch(rss, /<script>|window\.example/);
});

test('preserves recipe table structure and absolute cell links in RSS', () => {
  const { renderMarkdown } = require('../src/markdown');
  const rss = renderRss({
    site,
    lastBuildDate: '2026-09-29',
    posts: [{
      title: 'Recipe',
      slug: 'recipe',
      description: 'A recipe with a malt bill.',
      author: 'Alex Example',
      date: '2026-09-29',
      tags: [],
      featureImage: '',
      html: renderMarkdown(
        '| Ingredient | Amount |\n| --- | --- |\n| [Pale malt](malt.pdf) | 4 kg |',
        { assetBase: '/content/posts/recipe/' },
      ),
    }],
  });
  assert.match(rss, /<table><thead><tr><th scope="col">Ingredient<\/th>/);
  assert.match(rss, /href="https:\/\/example\.com\/content\/posts\/recipe\/malt\.pdf"/);
  assert.match(rss, /<td>4 kg<\/td>/);
  assert.doesNotMatch(rss, /\| --- \|/);
});

test('preserves bookmark titles, captions and absolute asset URLs in RSS', () => {
  const { renderMarkdown } = require('../src/markdown');
  const rss = renderRss({
    site,
    lastBuildDate: '2026-09-29',
    posts: [{
      title: 'Recipe',
      slug: 'recipe',
      description: 'A recipe with a linked article.',
      author: 'Alex Example',
      date: '2026-09-29',
      tags: [],
      featureImage: '',
      html: renderMarkdown('```bookmark\n' + JSON.stringify({
        url: '/writing-guide/',
        title: 'A guide to writing',
        thumbnail: 'water.jpg',
        caption: 'Water guide',
      }) + '\n```', { assetBase: '/content/posts/recipe/' }),
    }],
  });
  assert.match(rss, /<figure class="bookmark-card">/);
  assert.match(rss, /href="https:\/\/example\.com\/writing-guide\/"/);
  assert.match(rss, /src="https:\/\/example\.com\/content\/posts\/recipe\/water\.jpg"/);
  assert.match(rss, /<figcaption>Water guide<\/figcaption>/);
  assert.doesNotMatch(rss, /language-bookmark/);
});
