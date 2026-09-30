const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { gzipSync } = require('node:zlib');
const test = require('node:test');
const sharp = require('sharp');
const { createBlogContext } = require('../src/site');
const { createApp } = require('../app');
const { parseFrontMatter, loadSiteContent } = require('../src/content');
const { validateContent } = require('../src/content-validator');
const { parseSitemap, extractPage, previewWebsite, fetchResource } = require('../src/import-source');
const { applyPreview, replaceUrls } = require('../src/import-write');
const { createGhostImporter } = require('../scripts/import-ghost');
const { parseImportArguments } = require('../scripts/import-site');
const { buildImages } = require('../scripts/build-images');
const { buildSearchIndex } = require('../scripts/build-search-index');

sharp.cache({ files: 0 });

function blogFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'siteseed-import-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
  fs.writeFileSync(path.join(root, 'siteseed.config.json'), JSON.stringify({
    title: 'New blog', description: 'Independent destination.', url: 'https://new.example',
    author: { name: 'New Author', slug: 'new-author' }, navigation: [],
  }));
  return createBlogContext({ rootDirectory: root, env: {} });
}

async function serverFixture(t, routes) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    const response = routes[req.url];
    if (!response) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(response.status || 200, {
      'content-type': response.type || 'text/html', ...response.headers,
    });
    res.end(typeof response.body === 'function' ? response.body(origin) : response.body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  return { origin, requests };
}

const html = `<html><head><title>A fallback</title>
<meta content="A real article" property="og:title">
<meta content="A description" name="description">
<meta content="2025-02-03T12:00:00Z" property="article:published_time">
<meta content="Source Writer" name="author">
<meta content="Writing" property="article:tag">
<meta content="/photo.png" property="og:image">
</head><body><nav>Outside navigation</nav><article><h1>A real article</h1>
<p>Useful content with <a href="/second/">another article</a> and <a href="/file.pdf">a download</a>.</p>
<img data-src="/photo.png" alt="Photo"><script>alert('not imported')</script>
<table><tr><th>Item</th><th>Amount</th></tr><tr><td>Paper</td><td>2</td></tr></table>
<footer>Unwanted footer</footer></article></body></html>`;

test('parses ordinary, namespaced and indexed sitemaps without filename assumptions', () => {
  const base = 'https://old.example/sitemap.xml';
  assert.deepEqual(parseSitemap(`<?xml version="1.0"?>
    <sm:urlset xmlns:sm="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
      <sm:url><sm:loc><![CDATA[https://old.example/post/?a=1&b=2]]></sm:loc>
      <sm:lastmod>2025-02-03</sm:lastmod><image:image><image:loc>https://old.example/image.png</image:loc></image:image></sm:url>
    </sm:urlset>`, base), {
    kind: 'urlset', records: [{ url: 'https://old.example/post/?a=1&b=2', lastModified: '2025-02-03' }],
  });
  assert.equal(parseSitemap('<sitemapindex><sitemap><loc>/anything.xml</loc></sitemap></sitemapindex>', base).kind, 'sitemapindex');
  assert.throws(() => parseSitemap('<html><body>oops</body></html>', base), /Expected a sitemap/);
  assert.throws(() => parseSitemap('<urlset><url></url></urlset>', base), /missing loc/);
  assert.throws(() => parseSitemap('<urlset><url></urlset>', base));
  assert.throws(() => parseSitemap('<!DOCTYPE foo><urlset/>', base), /doctypes/);
  assert.throws(() => parseSitemap('<urlset><url><loc>file:///etc/passwd</loc></url></urlset>', base), /HTTP/);
});

test('extracts metadata regardless of attribute order and keeps tables without executable HTML', () => {
  const entry = extractPage(html, 'https://old.example/2025/my-story.html');
  assert.equal(entry.title, 'A real article');
  assert.equal(entry.slug, '2025-my-story');
  assert.equal(entry.date, '2025-02-03T12:00:00.000Z');
  assert.equal(entry.author, 'Source Writer');
  assert.deepEqual(entry.tags, ['Writing']);
  assert.match(entry.markdown, /\| Paper \| 2 \|/);
  assert.match(entry.markdown, /https:\/\/old.example\/second\//);
  assert.doesNotMatch(entry.markdown, /alert|Unwanted footer|Outside navigation/);
  assert.deepEqual(entry.media.sort(), ['https://old.example/file.pdf', 'https://old.example/photo.png']);
});

test('reports extraction uncertainty and never treats sitemap lastmod as publication date', () => {
  const entry = extractPage('<main><h1>About</h1><p>Words here.</p></main>', 'https://old.example/about/', {
    defaultAuthor: 'Fallback', lastModified: '2025-02-03',
  });
  assert.equal(entry.date, '');
  assert.equal(entry.updated, '2025-02-03T00:00:00.000Z');
  assert.equal(entry.author, 'Fallback');
  assert(entry.warnings.some((warning) => warning.includes('Missing publication date')));
  assert(entry.warnings.some((warning) => warning.includes('Used main content')));
  const archive = extractPage('<main><article>A</article><article>B</article></main>', 'https://old.example/list/');
  assert.equal(archive.selected, false);
  assert.throws(() => extractPage('<div id="app"></div>', 'https://old.example/'), /No unambiguous/);
  assert.throws(() => extractPage('<article></article>', 'https://old.example/'), /empty/);
  assert.throws(() => extractPage('<article><table><tr><td colspan="2">Bad</td></tr></table></article>',
    'https://old.example/'), /merged table/);
});

test('uses structured metadata, base URLs and lazy images while reporting unsupported embeds', () => {
  const entry = extractPage(`<head><base href="https://cdn.example/content/">
    <script type="application/ld+json">{"@graph":[{"@type":"BlogPosting","headline":"Structured title",
      "datePublished":"2025-01-01","dateModified":"2025-01-02","author":[{"name":"A"},{"name":"B"}],
      "keywords":["One","Two"],"image":{"url":"hero.png"}}]}</script></head>
    <article><p>Text</p><img srcset="small.png 1x, big.png 2x" alt="An image">
    <iframe src="https://video.example/clip"></iframe><a href="javascript:alert(1)">Bad</a></article>`,
  'https://old.example/story/');
  assert.equal(entry.title, 'Structured title');
  assert.equal(entry.author, 'A, B');
  assert.equal(entry.featureImage, 'https://cdn.example/content/hero.png');
  assert(entry.media.includes('https://cdn.example/content/small.png'));
  assert.doesNotMatch(entry.markdown, /javascript:/);
  assert(entry.warnings.some((warning) => warning.includes('Embedded')));
});

test('discovers nested gzip sitemaps, deduplicates cycles and reports failed/off-origin pages', async (t) => {
  const routes = {
    '/': { body: '<html>Home</html>' },
    '/robots.txt': { type: 'text/plain', body: (origin) => `Sitemap: ${origin}/custom.xml` },
    '/custom.xml': { type: 'application/xml', body: '<sitemapindex><sitemap><loc>/nested.xml.gz</loc></sitemap><sitemap><loc>/custom.xml</loc></sitemap></sitemapindex>' },
    '/nested.xml.gz': { type: 'application/gzip', body: gzipSync('<urlset><url><loc>/story/</loc></url><url><loc>/story/</loc></url><url><loc>/bad/</loc></url><url><loc>https://outside.example/post/</loc></url></urlset>') },
    '/story/': { body: html }, '/bad/': { status: 500, body: 'error' },
  };
  const { origin, requests } = await serverFixture(t, routes);
  const blog = blogFixture(t);
  const preview = await previewWebsite(blog, origin);
  assert.equal(preview.entries.length, 1);
  assert.equal(preview.entries[0].url, `${origin}/story/`);
  assert.equal(preview.failures.length, 2);
  assert(preview.failures.some((failure) => failure.error.includes('HTTP 500')));
  assert(preview.failures.some((failure) => failure.error.includes('Off-origin')));
  assert.equal(requests.filter((url) => url === '/custom.xml').length, 1);
  assert(!requests.includes('/photo.png'));
  assert(!fs.existsSync(blog.contentDirectory));
});

test('ordinary sitemap preview and shared writer create drafts with local media and route mappings', async (t) => {
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#fff' } }).png().toBuffer();
  const { origin } = await serverFixture(t, {
    '/plain.xml': { type: 'application/xml', body: '<urlset><url><loc>/story/</loc></url><url><loc>/second/</loc></url></urlset>' },
    '/story/': { body: html },
    '/second/': { body: html.replace('A real article', 'Second article') },
    '/photo.png': { type: 'image/png', body: png },
    '/file.pdf': { type: 'application/pdf', body: '%PDF-1.4 example' },
  });
  const blog = blogFixture(t);
  const configBefore = fs.readFileSync(blog.configPath, 'utf8');
  const preview = await previewWebsite(blog, `${origin}/plain.xml`);
  preview.entries[1].collection = 'pages';
  const { report, reportPath } = await applyPreview(blog, preview);
  assert.equal(report.imported.length, 2);
  assert.equal(report.failures.length, 0);
  assert(fs.existsSync(reportPath));
  const target = path.join(blog.contentDirectory, 'posts', 'story');
  const { metadata, body } = parseFrontMatter(fs.readFileSync(path.join(target, 'index.md'), 'utf8'));
  assert.equal(metadata.draft, true);
  assert.equal(metadata.author, 'Source Writer');
  assert.equal(metadata.allow_html, undefined);
  assert(fs.existsSync(path.join(target, metadata.feature_image)));
  assert.match(body, /\[another article\]\(\/second\/\)/);
  assert.doesNotMatch(body, /\/photo.png|\/file.pdf/);
  assert.equal(fs.readFileSync(blog.configPath, 'utf8'), configBefore);
  assert.equal(loadSiteContent(blog.contentDirectory).posts.length, 0);
  await buildImages(blog);
  buildSearchIndex(blog);
  assert.deepEqual(validateContent(blog.rootDirectory).filter((issue) => issue.severity === 'error'), []);
  const app = createApp({ rootDirectory: blog.rootDirectory, env: { NODE_ENV: 'production' } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const host = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${host}/story/`)).status, 404);
  assert.equal((await fetch(`${host}/second/`)).status, 404);
  const draft = await fetch(`${host}/preview/story/`);
  assert.equal(draft.status, 200);
  assert.equal(draft.headers.get('cache-control'), 'private, no-store');
  const previewHtml = await draft.text();
  assert.match(previewHtml, /preview-assets\/posts\/story\//);
  const media = await fetch(`${host}/preview-assets/posts/story/${metadata.feature_image}`);
  assert.equal(media.status, 200);
  const pagePreview = await fetch(`${host}/preview/second/`);
  assert.equal(pagePreview.status, 200);
  assert.equal(pagePreview.headers.get('cache-control'), 'private, no-store');
  assert.equal(pagePreview.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.match(await pagePreview.text(), /preview-assets\/pages\/second\//);
  const pageMedia = await fetch(`${host}/preview-assets/pages/second/${metadata.feature_image}`);
  assert.equal(pageMedia.status, 200);
  assert.equal(pageMedia.headers.get('cache-control'), 'private, no-store');
  for (const url of [
    `/content/pages/second/${metadata.feature_image}`,
    '/content/pages/second/index.md', '/preview-assets/pages/second/index.md',
    '/content/posts/story/index.md', '/preview-assets/posts/story/index.md',
  ]) assert.equal((await fetch(`${host}${url}`)).status, 404, url);
  assert.doesNotMatch(await (await fetch(`${host}/sitemap-pages.xml`)).text(), /second/);
  assert.deepEqual(await (await fetch(`${host}/search-index.json`)).json(), []);
  assert.doesNotMatch(await (await fetch(`${host}/rss/`)).text(), /A real article/);
  await assert.rejects(applyPreview(blog, preview), /conflict/);
  assert.equal(fs.readFileSync(blog.configPath, 'utf8'), configBefore);
});

function simplePreview() {
  const entry = extractPage('<article><h1>Title</h1><p>Body</p></article>', 'https://old.example/post/', {
    defaultAuthor: 'Author',
  });
  entry.date = '2025-01-01';
  return { version: 1, kind: 'website', source: 'https://old.example', failures: [], entries: [entry] };
}

test('preflights dates, slugs, collisions, unsupported Markdown and excludes entries without writes', async (t) => {
  const blog = blogFixture(t);
  for (const [mutate, pattern] of [
    [(preview) => { preview.entries[0].date = ''; }, /publication date/],
    [(preview) => { preview.entries[0].date = '2025-02-30'; }, /publication date/],
    [(preview) => { preview.entries[0].slug = '../escape'; }, /Invalid collection or slug/],
    [(preview) => { preview.entries[0].slug = 'con'; }, /reserved/],
    [(preview) => { preview.entries.push({ ...preview.entries[0], collection: 'pages' }); }, /conflict/],
    [(preview) => { preview.entries[0].selected = false; }, /No entries/],
  ]) {
    const preview = simplePreview();
    mutate(preview);
    await assert.rejects(applyPreview(blog, preview), pattern);
    assert(!fs.existsSync(blog.contentDirectory));
  }
  const preview = simplePreview();
  preview.entries[0].markdown = '```unfinished';
  await assert.rejects(applyPreview(blog, preview), /validation/);
  assert.deepEqual(fs.readdirSync(blog.contentDirectory), []);
});

test('does not overwrite folders in either collection or follow destination junctions', async (t) => {
  const blog = blogFixture(t);
  fs.mkdirSync(path.join(blog.contentDirectory, 'pages', 'post'), { recursive: true });
  await assert.rejects(applyPreview(blog, simplePreview()), /conflict/);
  const linkedBlog = blogFixture(t);
  fs.symlinkSync(blog.contentDirectory, linkedBlog.contentDirectory, 'junction');
  await assert.rejects(applyPreview(linkedBlog, simplePreview()), /ordinary directory/);
});

test('reports media failures explicitly without installing executable downloads', async (t) => {
  const { origin } = await serverFixture(t, {
    '/image.png': { type: 'text/html', body: '<script>bad()</script>' },
  });
  const blog = blogFixture(t);
  const preview = simplePreview();
  preview.entries[0].media = [`${origin}/image.png`, `${origin}/missing.png`];
  preview.entries[0].featureImage = `${origin}/image.png`;
  preview.entries[0].markdown = `![Image](${origin}/image.png)`;
  const { report } = await applyPreview(blog, preview);
  assert.equal(report.failures.length, 2);
  const folder = path.join(blog.contentDirectory, 'posts', 'post');
  assert.deepEqual(fs.readdirSync(folder), ['index.md']);
  const { metadata, body } = parseFrontMatter(fs.readFileSync(path.join(folder, 'index.md'), 'utf8'));
  assert.equal(metadata.feature_image, undefined);
  assert.match(body, /http:/);
});

test('Ghost export is an optional offline input to the same safe draft writer', async (t) => {
  const blog = blogFixture(t);
  const file = path.join(blog.rootDirectory, 'export.json');
  fs.writeFileSync(file, JSON.stringify({ db: [{ data: {
    posts: [
      { id: '1', slug: 'from-ghost', title: 'Ghost article', html: '<p>Original body</p>',
        status: 'published', type: 'post', published_at: '2025-02-03', updated_at: '2025-02-04' },
      { id: '2', slug: 'source-draft', title: 'Draft', html: '<p>Draft body</p>', status: 'draft' },
      { id: '3', slug: 'unsupported', title: 'Editor-only', lexical: '{}', status: 'published' },
    ],
    tags: [{ id: 't', name: 'Notes', visibility: 'public' }],
    posts_tags: [{ post_id: '1', tag_id: 't' }],
    users: [{ id: 'a', name: 'Original Author' }],
    posts_authors: [{ post_id: '1', author_id: 'a' }],
    settings: [{ key: 'title', value: 'Do not overwrite' }],
  } }] }));
  const preview = await createGhostImporter(blog, { source: 'https://old.example', exportPath: file }).main();
  assert.equal(preview.entries.length, 2);
  assert.equal(preview.failures.length, 1);
  assert.equal(preview.entries[0].date, '2025-02-03T00:00:00.000Z');
  assert.deepEqual(preview.entries[0].tags, ['Notes']);
  assert.equal(preview.entries[0].author, 'Original Author');
  preview.entries[1].selected = false;
  await applyPreview(blog, preview);
  assert.equal(JSON.parse(fs.readFileSync(blog.configPath)).title, 'New blog');
});

test('URL rewriting preserves fragments and does not rewrite longer URL prefixes', () => {
  const result = replaceUrls('[One](https://old.example/a/#heading) [Two](https://old.example/a/longer)',
    new Map([['https://old.example/a/', '/new/']]));
  assert.equal(result, '[One](/new/#heading) [Two](https://old.example/a/longer)');
  const code = '`https://old.example/a/`\n\n```text\nhttps://old.example/a/\n```';
  assert.equal(replaceUrls(code, new Map([['https://old.example/a/', '/new/']])), code);
  const bookmark = '```bookmark\n{"url":"https://old.example/a/","title":"Article"}\n```';
  assert.match(replaceUrls(bookmark, new Map([['https://old.example/a/', '/new/']])), /"url":"\/new\/"/);
});

test('CLI argument validation rejects ambiguous import actions and unknown options', () => {
  assert.deepEqual(parseImportArguments(['--root', 'blog', '--source', 'https://old.example'], 'website'),
    { root: 'blog', source: 'https://old.example' });
  for (const args of [
    [], ['--source'], ['--source', 'a', '--source', 'b'], ['--apply', 'a', '--source', 'b'],
    ['--export', 'a'], ['--root', 'blog'],
  ]) assert.throws(() => parseImportArguments(args, 'website'));
  assert.throws(() => parseImportArguments(['--source', 'https://old.example'], 'ghost'), /export/);
});

function cli(args, cwd) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    for (const key of ['SITE_URL', 'SITESEED_ROOT', 'GA4_MEASUREMENT_ID']) delete env[key];
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'siteseed.js'), ...args], { cwd, env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('CLI preview, editable exclusions, apply and reruns work from an external blog directory', async (t) => {
  const blog = blogFixture(t);
  const { origin } = await serverFixture(t, {
    '/map.xml': { type: 'application/xml', body: '<urlset><url><loc>/story/</loc></url><url><loc>/excluded/</loc></url></urlset>' },
    '/story/': { body: '<article><h1>Story</h1><time datetime="2025-01-01"></time><p>Useful text.</p></article>' },
    '/excluded/': { body: '<article><h1>Excluded</h1><time datetime="2025-01-01"></time><p>Leave this out.</p></article>' },
  });
  const previewArgs = ['import:website', '--source', `${origin}/map.xml`, '--output', 'review.json', '--root', blog.rootDirectory];
  const preview = await cli(previewArgs, blog.rootDirectory);
  assert.equal(preview.code, 0, preview.stderr);
  assert(!fs.existsSync(blog.contentDirectory));
  assert.equal((await cli(previewArgs, blog.rootDirectory)).code, 1);
  const file = path.join(blog.rootDirectory, 'review.json');
  const review = JSON.parse(fs.readFileSync(file, 'utf8'));
  review.entries.find((entry) => entry.slug === 'excluded').selected = false;
  fs.writeFileSync(file, JSON.stringify(review));
  const applied = await cli(['import:website', '--apply', 'review.json'], blog.rootDirectory);
  assert.equal(applied.code, 0, applied.stderr);
  assert.match(applied.stdout, /Imported 1 drafts/);
  assert(!fs.existsSync(path.join(blog.contentDirectory, 'posts', 'excluded')));
  const beforeRerun = fs.readFileSync(path.join(blog.contentDirectory, 'posts', 'story', 'index.md'), 'utf8');
  const rerun = await cli(['import:website', '--apply', 'review.json'], blog.rootDirectory);
  assert.equal(rerun.code, 1);
  assert.match(rerun.stderr, /conflict/);
  assert.equal(fs.readFileSync(path.join(blog.contentDirectory, 'posts', 'story', 'index.md'), 'utf8'), beforeRerun);
});

test('CLI partial imports exit nonzero and retain an actionable media failure report', async (t) => {
  const blog = blogFixture(t);
  const { origin } = await serverFixture(t, {});
  const preview = simplePreview();
  preview.entries[0].media = [`${origin}/missing.png`];
  preview.entries[0].markdown += `\n\n![Missing](${origin}/missing.png)`;
  fs.writeFileSync(path.join(blog.rootDirectory, 'review.json'), JSON.stringify(preview));
  const result = await cli(['import:website', '--apply', 'review.json'], blog.rootDirectory);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /Imported 1 drafts/);
  assert.match(result.stdout, /Recorded 1 failures/);
  const reportFile = fs.readdirSync(blog.contentDirectory).find((name) => name.startsWith('import-report-'));
  const report = JSON.parse(fs.readFileSync(path.join(blog.contentDirectory, reportFile)));
  assert.match(report.failures[0].error, /HTTP 404/);
});

test('empty or malformed sitemaps produce reports rather than successful empty imports', async (t) => {
  const blog = blogFixture(t);
  const { origin } = await serverFixture(t, {
    '/invalid.xml': { type: 'application/xml', body: '<urlset><url><loc>/broken</urlset>' },
    '/empty.xml': { type: 'application/xml', body: '<urlset/>' },
  });
  const invalid = await previewWebsite(blog, `${origin}/invalid.xml`);
  assert.equal(invalid.entries.length, 0);
  assert.equal(invalid.failures.length, 1);
  const result = await cli(['import:website', '--source', `${origin}/empty.xml`, '--output', 'empty.json'], blog.rootDirectory);
  assert.equal(result.code, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(blog.rootDirectory, 'empty.json'))).entries.length, 0);
  assert(!fs.existsSync(blog.contentDirectory));
});

test('fetches are bounded and reject off-origin redirects before following them', async (t) => {
  const { origin } = await serverFixture(t, {
    '/large': { body: 'x'.repeat(200) },
    '/redirect': { status: 302, headers: { location: 'https://outside.example/' } },
    '/loop': { status: 302, headers: { location: '/loop' } },
  });
  await assert.rejects(fetchResource(`${origin}/large`, { maxBytes: 100 }), /exceeds/);
  await assert.rejects(fetchResource(`${origin}/redirect`, { origin }), /off-origin/);
  await assert.rejects(fetchResource(`${origin}/loop`), /Too many/);
});
