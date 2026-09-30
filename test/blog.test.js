const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { createApp } = require('../app');
const { createBlogContext, publicAssetPath } = require('../src/site');
const { buildImages } = require('../scripts/build-images');
const { buildSearchIndex } = require('../scripts/build-search-index');
const { createGhostImporter } = require('../scripts/import-ghost');
const sharp = require('sharp');

sharp.cache({ files: 0 });

const engineDirectory = path.join(__dirname, '..');
const cliPath = path.join(engineDirectory, 'bin', 'siteseed.js');

function fixture(t, name = 'Example') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'siteseed-blog-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
  const config = {
    title: `${name} Notes`,
    description: `${name}'s independent blog.`,
    url: `https://${name.toLowerCase()}.example`,
    author: { name: `${name} Author`, slug: name.toLowerCase() },
  };
  const configPath = path.join(root, 'siteseed.config.json');
  fs.writeFileSync(configPath, JSON.stringify(config));
  const postDirectory = path.join(root, 'content', 'posts', 'hello');
  fs.mkdirSync(postDirectory, { recursive: true });
  fs.writeFileSync(path.join(postDirectory, 'index.md'), `---
title: ${name} post
slug: hello
description: A post from ${name}.
date: 2026-09-15
updated: 2026-09-15
tags: [Example]
tag_slugs: [example]
draft: false
---

Hello from ${name}.
`);
  return { root, config, configPath, postDirectory };
}

function cleanEnv(overrides = {}) {
  const env = { ...process.env };
  for (const key of ['SITESEED_ROOT', 'SITE_URL', 'GA4_MEASUREMENT_ID', 'NODE_ENV']) {
    delete env[key];
  }
  return { ...env, ...overrides };
}

async function serve(t, root) {
  const app = createApp({ rootDirectory: root, env: { NODE_ENV: 'production' } });
  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    listener.once('error', reject);
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  return { app, url: `http://127.0.0.1:${server.address().port}` };
}

test('configuration resolves an explicit blog with environment overrides and neutral defaults', (t) => {
  const { root, config, configPath } = fixture(t);
  delete config.url;
  fs.writeFileSync(configPath, JSON.stringify(config));
  const blog = createBlogContext({ rootDirectory: root, env: {} });
  assert.equal(blog.site.siteUrl, 'http://localhost:3000');
  assert.equal(blog.site.siteLogo, '');
  assert.equal(blog.site.siteImage, '');
  assert.equal(blog.site.locale, 'en-GB');
  assert.equal(blog.site.timezone, 'UTC');
  assert.equal(blog.contentDirectory, path.join(root, 'content'));
  assert.equal(blog.publicDirectory, path.join(root, 'public'));
  assert.deepEqual(blog.site.navigation, [
    { label: 'Home', url: '/' },
    { label: 'About', url: '/about/' },
  ]);

  const overridden = createBlogContext({
    rootDirectory: root,
    env: {
      SITESEED_ROOT: path.join(root, 'wrong-blog'),
      SITE_URL: 'https://override.example/',
      GA4_MEASUREMENT_ID: 'G-EXAMPLE01',
    },
  });
  assert.equal(overridden.rootDirectory, root);
  assert.equal(overridden.site.siteUrl, 'https://override.example');
  assert.equal(overridden.site.googleAnalyticsId, 'G-EXAMPLE01');
  assert.equal(createBlogContext({ env: { SITESEED_ROOT: root } }).rootDirectory, root);
  assert.deepEqual(JSON.parse(fs.readFileSync(configPath, 'utf8')), config);
});

test('navigation preserves external destinations, queries, and fragments', (t) => {
  const { root, config, configPath } = fixture(t);
  config.navigation = [
    { label: 'Local', url: 'https://example.example/about/?from=menu#contact' },
    { label: 'External', url: 'https://other.example/notes/?a=1&b=2#latest' },
  ];
  fs.writeFileSync(configPath, JSON.stringify(config));
  const { site } = createBlogContext({ rootDirectory: root, env: {} });
  assert.equal(site.navigation[0].url, '/about/?from=menu#contact');
  assert.equal(site.navigation[1].url, 'https://other.example/notes/?a=1&b=2#latest');
});

test('configuration errors identify the file and invalid field', (t) => {
  const { root, config, configPath } = fixture(t);
  for (const [change, field] of [
    [{ title: '' }, 'title'],
    [{ description: 12 }, 'description'],
    [{ url: 'not-a-url' }, 'url'],
    [{ url: 'https://example.com/blog/' }, 'url'],
    [{ url: 'https://user:password@example.com/' }, 'url'],
    [{ url: 'https://example.com/?tracking=1' }, 'url'],
    [{ author: { name: 'Person', slug: '../person' } }, 'author.slug'],
    [{ navigation: {} }, 'navigation'],
    [{ navigation: null }, 'navigation'],
    [{ navigation: [{ label: 'Unsafe', url: 'javascript:alert(1)' }] }, 'navigation[0].url'],
    [{ logo: '//other.example/logo.svg' }, 'logo'],
    [{ logo: '/logo.svg" onload="alert(1)' }, 'logo'],
    [{ timezone: 'Invalid/Timezone' }, 'locale/timezone'],
    [{ locale: 'zz-ZZ' }, 'locale/timezone'],
  ]) {
    fs.writeFileSync(configPath, JSON.stringify({ ...config, ...change }));
    assert.throws(
      () => createBlogContext({ rootDirectory: root, env: {} }),
      (error) => error.message.includes(configPath) && error.message.includes(field),
    );
  }
  fs.writeFileSync(configPath, '{broken');
  assert.throws(() => createBlogContext({ rootDirectory: root }), /Cannot read blog configuration/);
  fs.unlinkSync(configPath);
  assert.throws(() => createBlogContext({ rootDirectory: root }), /siteseed\.config\.json/);
});

test('two apps keep content, authors, assets, origins and production caches separate', async (t) => {
  const first = fixture(t, 'First');
  const second = fixture(t, 'Second');
  for (const item of [first, second]) {
    const blog = createBlogContext({ rootDirectory: item.root, env: {} });
    buildSearchIndex(blog);
    fs.writeFileSync(path.join(blog.publicDirectory, 'styles.css'), `/* ${item.config.title} */`);
    fs.writeFileSync(path.join(blog.publicDirectory, 'robots.txt'), 'Sitemap: https://wrong.example/sitemap.xml');
    fs.writeFileSync(path.join(item.postDirectory, 'notes.txt'), item.config.title);
  }
  const one = await serve(t, first.root);
  const two = await serve(t, second.root);
  for (const [instance, item, other] of [[one, first, second], [two, second, first]]) {
    const home = await (await fetch(`${instance.url}/`)).text();
    assert(home.includes(`<title>${item.config.title}</title>`));
    assert(!home.includes(other.config.title));
    assert.doesNotMatch(home, /SiteSeed|Your Name/);
    assert.match(home, /Latest articles/);
    assert.doesNotMatch(home, /rel="icon"|class="site-logo"/);
    const stylesheet = home.match(/href="(\/styles\.css\?v=[a-f0-9]{8})"/)[1];
    const expectedCss = `/* ${item.config.title} */`;
    const expectedHash = crypto.createHash('sha256').update(expectedCss).digest('hex').slice(0, 8);
    assert.equal(stylesheet, `/styles.css?v=${expectedHash}`);
    assert.equal(await (await fetch(`${instance.url}${stylesheet}`)).text(), expectedCss);
    const post = await (await fetch(`${instance.url}/hello/`)).text();
    assert(post.includes(item.config.author.name));
    assert(post.includes(`${item.config.url}/hello/`));
    const rss = await (await fetch(`${instance.url}/rss/`)).text();
    assert(rss.includes(`<title><![CDATA[${item.config.title}]]></title>`));
    assert(rss.includes(item.config.author.name));
    assert.doesNotMatch(rss, /<image>|Your Name/);
    const sitemap = await (await fetch(`${instance.url}/sitemap-posts.xml`)).text();
    assert(sitemap.includes(`${item.config.url}/hello/`));
    assert.equal(
      await (await fetch(`${instance.url}/robots.txt`)).text(),
      `User-agent: *\nAllow: /\n\nSitemap: ${item.config.url}/sitemap.xml\n`,
    );
    assert.equal(
      (await (await fetch(`${instance.url}/search-index.json`)).json())[0].title,
      `${item.config.author.slug === 'first' ? 'First' : 'Second'} post`,
    );
    assert.equal(await (await fetch(`${instance.url}/content/posts/hello/notes.txt`)).text(), item.config.title);
    assert.equal((await fetch(`${instance.url}/content/posts/hello/index.md`)).status, 404);
    for (const asset of ['search.js', 'navigation.js', 'article.js', 'jost.woff2']) {
      assert.equal((await fetch(`${instance.url}/${asset}`)).status, 200);
    }
    for (const privatePath of ['example-logo.svg', 'other-site-avatar.jpg', 'siteseed.config.json']) {
      assert.equal((await fetch(`${instance.url}/${privatePath}`)).status, 404);
    }
    assert.equal((await fetch(`${instance.url}/author/${item.config.author.slug}/`)).status, 200);
    const before = instance.app.locals.renderedHtmlCacheStats();
    await fetch(`${instance.url}/`);
    assert.equal(instance.app.locals.renderedHtmlCacheStats().hits, before.hits + 1);
    fs.unlinkSync(path.join(item.root, 'public', 'search-index.json'));
    assert.equal((await fetch(`${instance.url}/search-index.json`)).status, 404);
  }
});

test('builds images and search only inside the selected blog', async (t) => {
  const { root, configPath, postDirectory } = fixture(t);
  const engineOutputs = [
    path.join(engineDirectory, 'content', 'image-manifest.json'),
    path.join(engineDirectory, 'public', 'search-index.json'),
  ];
  const snapshot = (file) => fs.existsSync(file) ? fs.readFileSync(file) : null;
  const before = engineOutputs.map(snapshot);
  const configBefore = fs.readFileSync(configPath);
  await sharp({
    create: { width: 1280, height: 720, channels: 3, background: '#336699' },
  }).png().toFile(path.join(postDirectory, 'hero.png'));
  const markdownPath = path.join(postDirectory, 'index.md');
  fs.writeFileSync(markdownPath, fs.readFileSync(markdownPath, 'utf8').replace(
    'draft: false',
    'feature_image: hero.png\nfeature_image_alt: Example cover\ndraft: false',
  ));
  const blog = createBlogContext({ rootDirectory: root, env: {} });
  await buildImages(blog);
  buildSearchIndex(blog);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'content', 'image-manifest.json'), 'utf8'));
  assert.deepEqual(manifest['posts/hello/hero.png'].variants.map(({ width }) => width), [640, 1280]);
  for (const width of [640, 1280]) {
    assert(fs.existsSync(path.join(postDirectory, `hero-${width}.webp`)));
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'public', 'search-index.json'))).length, 1);
  assert.deepEqual(fs.readFileSync(configPath), configBefore);
  engineOutputs.forEach((file, index) => assert.deepEqual(snapshot(file), before[index]));
  assert.equal(publicAssetPath(blog, 'search.js'), path.join(engineDirectory, 'public', 'search.js'));
  assert.throws(() => publicAssetPath(blog, '../siteseed.config.json'), /must stay inside/);
  assert.throws(() => publicAssetPath(blog, 'example-logo.svg'), /Missing public asset/);
});

test('image cleanup rejects manifest paths outside the selected content directory', async (t) => {
  const { root } = fixture(t);
  const outside = path.join(root, 'keep.txt');
  fs.writeFileSync(outside, 'Keep this user file.');
  fs.writeFileSync(path.join(root, 'content', 'image-manifest.json'), JSON.stringify({
    'posts/hello/old.png': { variants: [{ file: '../../../keep.txt' }] },
  }));
  await assert.rejects(
    buildImages(createBlogContext({ rootDirectory: root, env: {} })),
    /Generated image escapes its content directory/,
  );
  assert.equal(fs.readFileSync(outside, 'utf8'), 'Keep this user file.');
});

test('CLI uses explicit, environment and working-directory roots and reports errors', (t) => {
  const { root, configPath, postDirectory } = fixture(t);
  const movedRoot = path.join(root, 'blog with spaces');
  fs.mkdirSync(movedRoot);
  fs.renameSync(configPath, path.join(movedRoot, 'siteseed.config.json'));
  fs.renameSync(path.join(root, 'content'), path.join(movedRoot, 'content'));
  for (const [args, cwd, env] of [
    [['check', '--root', 'blog with spaces'], root, cleanEnv({ SITESEED_ROOT: 'not-the-blog' })],
    [['build:search'], engineDirectory, cleanEnv({ SITESEED_ROOT: movedRoot })],
    [['check'], movedRoot, cleanEnv()],
  ]) {
    const result = spawnSync(process.execPath, [cliPath, ...args], { cwd, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Wrote 1 posts/);
  }
  assert(!fs.existsSync(postDirectory));
  for (const args of [['build', '--root'], ['build', '--unknown'], ['not-a-command']]) {
    const result = spawnSync(process.execPath, [cliPath, ...args], {
      cwd: root, env: cleanEnv(), encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Expected --root|Unknown command/);
  }
  const missing = spawnSync(process.execPath, [cliPath, 'build'], {
    cwd: root, env: cleanEnv(), encoding: 'utf8',
  });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /Cannot read blog configuration/);
  const help = spawnSync(process.execPath, [cliPath, '--help'], {
    cwd: root, env: cleanEnv(), encoding: 'utf8',
  });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage: siteseed/);
});

test('requiring engine modules does not read configuration or start a server', (t) => {
  const { root, configPath } = fixture(t);
  fs.unlinkSync(configPath);
  const modules = [
    'app.js',
    path.join('src', 'templates.js'),
    path.join('src', 'rss.js'),
    path.join('scripts', 'build-images.js'),
    path.join('scripts', 'build-search-index.js'),
    path.join('scripts', 'import-ghost.js'),
  ];
  const result = spawnSync(process.execPath, ['-e', modules.map((file) =>
    `require(${JSON.stringify(path.join(engineDirectory, file))});`,
  ).join('\n')], { cwd: root, env: cleanEnv(), encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.equal(result.stdout, '');
});

test('importer helpers use their own blog origins and export paths', async (t) => {
  const first = fixture(t, 'First');
  const second = fixture(t, 'Second');
  const one = createGhostImporter(createBlogContext({ rootDirectory: first.root, env: {} }));
  const two = createGhostImporter(createBlogContext({ rootDirectory: second.root, env: {} }));
  const html = '<img src="__GHOST_URL__/content/images/photo.jpg">';
  assert.equal(one.normalizeGhostHtml(html), '<img src="https://first.example/content/images/photo.jpg">');
  assert.equal(two.normalizeGhostHtml(html), '<img src="https://second.example/content/images/photo.jpg">');
  await assert.rejects(one.main(), (error) =>
    error.message === `Ghost export not found: ${path.join(first.root, 'ghost-backup.json')}`,
  );
});
