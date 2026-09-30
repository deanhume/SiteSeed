const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const sharp = require('sharp');
const { createApp } = require('../app');
const { createBlogContext } = require('../src/site');
const { loadSiteContent } = require('../src/content');
const { buildSearchIndex } = require('../scripts/build-search-index');
const config = require('./fixtures/blog/siteseed.config.json');

let root;
let app;
let site;
let server;
let baseUrl;
const origin = config.url;
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="8" fill="blue"/></svg>';
const bookmark = {
  url: 'https://example.org/guide/',
  title: 'Writing guide',
  description: 'A useful reference.',
  author: 'Example Author',
  publisher: 'Example Publisher',
  thumbnail: 'guide.svg',
  icon: 'guide.svg',
  caption: 'Read the guide',
};
const body = [
  '## First section', '', 'An example article.', '',
  '## Details', '',
  '| Item | Quantity | Reference |',
  '| --- | ---: | --- |',
  '| Paper | 20 | [Download](notes.txt) |',
  '| Pens | 3 | First<br>second |', '',
  '```bookmark', JSON.stringify(bookmark), '```', '',
  '<script>window.example = true;</script>',
].join('\n');

function writeEntry(collection, slug, metadata, content = body) {
  const directory = path.join(root, 'content', collection, slug);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'index.md'),
    `---\n${Object.entries({ slug, ...metadata }).map(([key, value]) =>
      `${key}: ${JSON.stringify(value)}`).join('\n')}\n---\n\n${content}\n`);
  fs.writeFileSync(path.join(directory, 'guide.svg'), svg);
  fs.writeFileSync(path.join(directory, 'notes.txt'), 'Example download.');
  return directory;
}

async function listen(application) {
  return new Promise((resolve, reject) => {
    const listener = application.listen(0, '127.0.0.1', () => resolve(listener));
    listener.once('error', reject);
  });
}

async function close(listener) {
  if (!listener) return;
  await new Promise((resolve, reject) => {
    listener.close((error) => error ? reject(error) : resolve());
    listener.closeAllConnections();
  });
}

test.before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'siteseed-http-'));
  fs.writeFileSync(path.join(root, 'siteseed.config.json'), JSON.stringify(config));
  fs.mkdirSync(path.join(root, 'public'));
  fs.writeFileSync(path.join(root, 'public', 'example-logo.svg'), svg);
  const image = await sharp({
    create: { width: 20, height: 20, channels: 3, background: '#336699' },
  }).png().toBuffer();
  fs.writeFileSync(path.join(root, 'public', 'example-logo.png'), image);

  for (let index = 1; index <= 18; index += 1) {
    const number = String(index).padStart(2, '0');
    const directory = writeEntry('posts', `article-${number}`, {
      title: `Article ${number}`,
      description: `Description for article ${number}.`,
      date: `2026-09-${number}`,
      updated: `2026-09-${number}`,
      tags: ['Guides'],
      tag_slugs: ['guides'],
      feature_image: 'hero.png',
      feature_image_alt: 'Example cover',
      allow_html: true,
      draft: false,
    });
    fs.writeFileSync(path.join(directory, 'hero.png'), image);
  }
  writeEntry('posts', 'draft-example', {
    title: 'Unpublished draft', description: 'Draft description.',
    date: '2026-09-19', updated: '2026-09-19',
    tags: ['Drafts'], tag_slugs: ['drafts'], draft: true,
  });
  writeEntry('pages', 'about', {
    title: 'About', date: '2026-09-01', updated: '2026-09-01', draft: false,
  });
  writeEntry('pages', 'offline', {
    title: 'An ordinary page', date: '2026-09-01', updated: '2026-09-01', draft: false,
  });
  const tagDirectory = path.join(root, 'content', 'tags', 'guides');
  fs.mkdirSync(tagDirectory, { recursive: true });
  fs.writeFileSync(path.join(tagDirectory, 'index.json'), JSON.stringify({
    name: 'Guides', slug: 'guides', description: 'Useful guides.',
  }));
  const blog = createBlogContext({ rootDirectory: root, env: {} });
  buildSearchIndex(blog);
  site = loadSiteContent(blog.contentDirectory, { defaultAuthor: config.author.name });
  app = createApp({ rootDirectory: root, env: { NODE_ENV: 'production' } });
  server = await listen(app);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await close(server);
  if (root) fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

test('caches rendered HTML per production app', async () => {
  const before = app.locals.renderedHtmlCacheStats();
  const firstHtml = await (await fetch(`${baseUrl}/`)).text();
  const afterFirst = app.locals.renderedHtmlCacheStats();
  const secondHtml = await (await fetch(`${baseUrl}/`)).text();
  const afterSecond = app.locals.renderedHtmlCacheStats();
  assert.equal(before.enabled, true);
  assert.equal(afterFirst.entries, before.entries + 1);
  assert.equal(afterFirst.misses, before.misses + 1);
  assert.equal(afterSecond.hits, afterFirst.hits + 1);
  assert.equal(secondHtml, firstHtml);
});

test('all page types keep footer navigation and copyright without a wordmark', async () => {
  for (const route of ['/', '/article-01/', '/about/', '/tag/guides/', '/author/alex/', '/preview/draft-example/', '/missing-page/']) {
    const response = await fetch(`${baseUrl}${route}`);
    assert.equal(response.status, route === '/missing-page/' ? 404 : 200, route);
    const html = await response.text();
    assert.match(html, /<footer class="site-footer">/);
    assert.match(html, /<nav aria-label="Footer">/);
    assert.match(html, /<a href="\/rss\/">RSS<\/a>/);
    assert.match(html, /&copy; \d{4} Example Blog/);
    assert.doesNotMatch(html, /footer-wordmark/);
  }
});

test('serves published posts, pages and tags with the configured identity', async () => {
  assert.equal(site.posts.length, 18);
  assert.equal(site.pages.length, 2);
  assert.equal(site.tags.length, 1);
  for (const entry of [...site.posts, ...site.pages]) {
    const response = await fetch(`${baseUrl}/${entry.slug}/`);
    assert.equal(response.status, 200, entry.slug);
    const html = await response.text();
    assert(html.includes(`<link rel="canonical" href="${origin}/${entry.slug}/">`));
    assert.match(html, /<meta property="og:site_name" content="Example Blog">/);
    assert.match(html, /aria-label="Example Blog home">Example Blog<\/a>/);
    if (entry.type === 'post') {
      assert.match(html, /"publisher":\{"@type":"Organization","name":"Example Blog"/);
      assert(html.includes(config.author.name));
    }
  }
  const tagResponse = await fetch(`${baseUrl}/tag/guides/`);
  assert.equal(tagResponse.status, 200);
  assert.match(await tagResponse.text(), /Useful guides\./);
});

test('serves published media and downloads without exposing post Markdown', async () => {
  const post = site.posts[0];
  const [image, download, markdown] = await Promise.all([
    fetch(new URL(post.featureImage, baseUrl)),
    fetch(`${baseUrl}/content/posts/${post.slug}/notes.txt`),
    fetch(`${baseUrl}/content/posts/${post.slug}/index.md`),
  ]);
  assert.equal(image.status, 200);
  assert.match(image.headers.get('cache-control'), /max-age=86400/);
  assert.equal(await download.text(), 'Example download.');
  assert.equal(markdown.status, 404);
});

test('publishes every post in search and sitemaps, excluding drafts', async () => {
  const sitemap = await (await fetch(`${baseUrl}/sitemap-posts.xml`)).text();
  const search = await (await fetch(`${baseUrl}/search-index.json`)).json();
  assert.equal(search.length, site.posts.length);
  assert.deepEqual(search.map(({ slug }) => slug), site.posts.map(({ slug }) => slug));
  for (const post of site.posts) {
    assert(sitemap.includes(`${origin}/${post.slug}/</loc>`));
  }
  assert.doesNotMatch(sitemap, /draft-example/);
  assert.doesNotMatch(JSON.stringify(search), /draft-example|window\.example/);
  assert.match(search[0].text, /Writing guide/);
});

test('publishes the newest 15 RSS items with absolute media and sanitized content', async () => {
  const redirect = await fetch(`${baseUrl}/rss`, { redirect: 'manual' });
  const response = await fetch(`${baseUrl}/rss/`);
  const feed = await response.text();
  const items = [...feed.matchAll(/<item>([\s\S]*?)<\/item>/g)];
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.get('location'), '/rss/');
  assert.match(response.headers.get('content-type'), /application\/rss\+xml/);
  assert.match(response.headers.get('cache-control'), /max-age=300/);
  assert.match(feed, /<title><!\[CDATA\[Example Blog\]\]><\/title>/);
  assert.match(feed, /<image><url>https:\/\/example\.com\/example-logo\.png<\/url>/);
  assert.equal(items.length, 15);
  assert(items[0][1].includes(site.posts[0].title));
  assert(items[0][1].includes(`${origin}/${site.posts[0].slug}/`));
  assert.match(items[0][1], /<dc:creator><!\[CDATA\[Alex Example\]\]>/);
  assert.match(items[0][1], /<table><thead>/);
  assert.match(items[0][1], /class="bookmark-card"/);
  assert.doesNotMatch(feed, /\b(?:src|href)="\/content\/|window\.example|draft-example|&amp;amp;/);
});

test('homepage shows five posts and only configured navigation and branding', async () => {
  const home = await (await fetch(`${baseUrl}/`)).text();
  assert.equal((home.match(/class="home-post-card"/g) || []).length, 5);
  assert(home.includes(`/author/alex/">Browse all ${site.posts.length} articles</a>`));
  assert.match(home, /<title>Example Blog<\/title>/);
  assert.doesNotMatch(home, /googletagmanager/);
  const navigation = home.match(/<nav id="site-navigation"[^>]*>([\s\S]*?)<\/nav>/)[1];
  for (const [, url] of navigation.matchAll(/href="([^"]+)"/g)) {
    assert.equal((await fetch(`${baseUrl}${url}`)).status, 200, url);
  }
  assert.equal((await fetch(`${baseUrl}/example-logo.png`)).status, 200);
  assert.equal((await fetch(`${baseUrl}/example-logo.svg`)).status, 200);
});

test('author, robots and all sitemaps use the configured origin', async () => {
  const author = await fetch(`${baseUrl}/author/alex/`);
  assert.equal(author.status, 200);
  const html = await author.text();
  assert.match(html, /Alex Example \| Example Blog/);
  assert.equal((html.match(/class="post-card"/g) || []).length, site.posts.length);
  for (const name of ['', '-pages', '-posts', '-authors', '-tags']) {
    const sitemap = await (await fetch(`${baseUrl}/sitemap${name}.xml`)).text();
    const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, url]) => url);
    assert(locations.length > 0);
    assert(locations.every((url) => url.startsWith(`${origin}/`)));
    if (name === '-authors') assert.deepEqual(locations, [`${origin}/author/alex/`]);
    if (name === '-pages') assert(locations.includes(`${origin}/offline/`));
  }
  const robots = await (await fetch(`${baseUrl}/robots.txt`)).text();
  assert(robots.includes(`Sitemap: ${origin}/sitemap.xml`));
  const page = await fetch(`${baseUrl}/offline/`);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('x-robots-tag'), null);
});

test('redirects valid pagination and trailing-slash URLs with queries intact', async () => {
  for (const [source, destination] of [
    ['/page/2/', '/author/alex/'],
    ['/page/3?source=ghost', '/author/alex/?source=ghost'],
    ['/author/alex/page/2?source=ghost', '/author/alex/?source=ghost'],
    ['/tag/guides/page/2?source=ghost', '/tag/guides/?source=ghost'],
    ['/author/alex?from=nav', '/author/alex/?from=nav'],
    ['/article-01?from=nav', '/article-01/?from=nav'],
    ['/about?from=nav', '/about/?from=nav'],
  ]) {
    const response = await fetch(`${baseUrl}${source}`, { redirect: 'manual' });
    assert.equal(response.status, 301, source);
    assert.equal(response.headers.get('location'), destination, source);
  }
});

test('unknown authors and historical site-specific routes do not redirect', async () => {
  for (const url of [
    '/author/another-author/', '/Home/About', '/Home/ContactPage',
    '/Home/Tagged/guides', '/page/not-a-number/', '/tag/missing/page/2/',
  ]) {
    const response = await fetch(`${baseUrl}${url}`, { redirect: 'manual' });
    assert.equal(response.status, 404, url);
    assert.equal(response.headers.get('location'), null, url);
  }
});

test('renders a branded custom 404 and compresses article responses', async () => {
  const missing = await fetch(`${baseUrl}/missing-post/`);
  assert.equal(missing.status, 404);
  assert.match(await missing.text(), /<title>Page not found \| Example Blog<\/title>/);
  const response = await fetch(`${baseUrl}/article-18/`, { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(response.headers.get('content-encoding'), 'gzip');
  assert.match(await response.text(), /Return home|Article 18/);
});

test('tables and bookmark cards retain structure and working assets on posts and pages', async () => {
  for (const slug of ['article-18', 'about']) {
    const html = await (await fetch(`${baseUrl}/${slug}/`)).text();
    const table = html.match(/<table>([\s\S]*?)<\/table>/)[1];
    assert.equal((table.match(/<tr>/g) || []).length, 3);
    assert.equal((table.match(/<th scope="col"/g) || []).length, 3);
    assert.equal((table.match(/<td\b/g) || []).length, 6);
    assert.match(table, /Paper<\/td><td style="text-align:right">20<\/td>/);
    assert.match(table, /First<br>second/);
    assert.match(html, /class="table-scroll"/);
    const card = html.match(/<figure class="bookmark-card">([\s\S]*?)<\/figure>/)[1];
    assert.match(card, /Writing guide/);
    assert.match(card, /<figcaption>Read the guide<\/figcaption>/);
    for (const [, image] of card.matchAll(/<img[^>]+src="([^"]+)"/g)) {
      assert.equal((await fetch(`${baseUrl}${image}`)).status, 200);
    }
  }
});

test('draft previews retain private caching and isolated assets', async () => {
  const preview = await fetch(`${baseUrl}/preview/draft-example/`);
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get('cache-control'), 'private, no-store');
  assert.equal(preview.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.match(await preview.text(), /\/preview-assets\/posts\/draft-example\/guide\.svg/);
  const asset = await fetch(`${baseUrl}/preview-assets/posts/draft-example/guide.svg`);
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get('cache-control'), 'private, no-store');
  assert.equal((await fetch(`${baseUrl}/content/posts/draft-example/guide.svg`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/preview-assets/posts/draft-example/index.md`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/draft-example/`)).status, 404);
});

test('an empty blog works without posts, pages, tags, images or analytics', async () => {
  const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'siteseed-empty-'));
  let listener;
  try {
    fs.writeFileSync(path.join(emptyRoot, 'siteseed.config.json'), JSON.stringify({
      title: 'Empty Blog', description: 'Ready to write.',
      author: { name: 'Writer', slug: 'writer' }, navigation: [{ label: 'Home', url: '/' }],
    }));
    buildSearchIndex(createBlogContext({ rootDirectory: emptyRoot, env: {} }));
    listener = await listen(createApp({ rootDirectory: emptyRoot, env: { NODE_ENV: 'production' } }));
    const url = `http://127.0.0.1:${listener.address().port}`;
    const home = await (await fetch(url)).text();
    assert.match(home, /No articles have been published here yet/);
    assert.doesNotMatch(home, /href="\/about\/"|class="site-logo"|googletagmanager/);
    assert.deepEqual(await (await fetch(`${url}/search-index.json`)).json(), []);
    const rss = await (await fetch(`${url}/rss/`)).text();
    assert.doesNotMatch(rss, /<item>|<image>/);
    assert.equal((await fetch(`${url}/author/writer/`)).status, 200);
  } finally {
    await close(listener);
    fs.rmSync(emptyRoot, { recursive: true, force: true, maxRetries: 3 });
  }
});
