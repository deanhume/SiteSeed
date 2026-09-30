const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { Readable, Writable, PassThrough } = require('node:stream');
const { spawn } = require('node:child_process');
const test = require('node:test');
const sharp = require('sharp');
const { runSetup, parseSetupArguments } = require('../scripts/setup');
const { prepareSetupImport } = require('../src/setup-content');
const { installDependencies } = require('../src/setup-install');
const { inspectCheckout, publishCheckout } = require('../src/setup-checkout');
const { themeAssets } = require('../src/site');
const { createPrompts, SetupCancelled } = require('../src/setup-prompts');
const { createApp } = require('../app');
const { loadSiteContent, parseFrontMatter } = require('../src/content');
const { validateContent } = require('../src/content-validator');

sharp.cache({ files: 0 });
const engine = path.join(__dirname, '..');
const cliPath = path.join(engine, 'bin', 'siteseed.js');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'siteseed-setup-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
  return { root, destination: path.join(root, 'my blog') };
}

function checkoutFixture(t) {
  const { root } = fixture(t);
  const checkout = path.join(root, 'checkout');
  fs.mkdirSync(checkout);
  for (const name of ['src', 'scripts', 'bin']) {
    fs.cpSync(path.join(engine, name), path.join(checkout, name), { recursive: true });
  }
  for (const name of ['app.js', 'package.json', 'package-lock.json', '.gitignore']) {
    fs.copyFileSync(path.join(engine, name), path.join(checkout, name));
  }
  fs.mkdirSync(path.join(checkout, 'public'));
  for (const name of themeAssets) fs.copyFileSync(path.join(engine, 'public', name), path.join(checkout, 'public', name));
  fs.mkdirSync(path.join(checkout, 'content'));
  fs.writeFileSync(path.join(checkout, 'content', 'image-manifest.json'), '{}\n');
  fs.writeFileSync(path.join(checkout, 'public', 'search-index.json'), '[]\n');
  const config = {
    title: 'Existing Title', description: 'Existing description.', url: 'https://checkout.example',
    locale: 'en-US', timezone: 'America/New_York', latestPostsTitle: 'My articles',
    author: { name: 'Existing Writer', slug: 'custom-author', bio: 'Preserve this biography.' },
    navigation: [{ label: 'Home', url: '/' }, { label: 'Elsewhere', url: 'https://other.example/' }],
  };
  fs.writeFileSync(path.join(checkout, 'siteseed.config.json'), JSON.stringify(config, null, 2) + '\n');
  fs.writeFileSync(path.join(checkout, 'keep.txt'), 'Unrelated work');
  fs.writeFileSync(path.join(checkout, 'public', 'custom.css'), '/* custom styles */');
  return { root, checkout, config, environment: { NODE_PATH: path.join(engine, 'node_modules') } };
}

function terminal(answers) {
  let text = '';
  return {
    input: Readable.from([answers.join('\n') + '\n']),
    output: new Writable({ write(chunk, encoding, callback) { text += chunk.toString(); callback(); } }),
    text: () => text,
  };
}

async function startServer(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}

function childRun(command, args, cwd, input = '', environment = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, ...environment };
    for (const name of ['SITE_URL', 'SITESEED_ROOT', 'GA4_MEASUREMENT_ID', 'NODE_ENV']) delete env[name];
    const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.on('error', (error) => { if (error.code !== 'EPIPE') reject(error); });
    child.stdin.end(input);
  });
}

function npm(command, cwd) {
  return process.platform === 'win32'
    ? childRun(process.env.ComSpec, ['/d', '/s', '/c', `npm ${command}`], cwd)
    : childRun('npm', command.split(' '), cwd);
}

test('setup/create arguments are strict', () => {
  assert.equal(parseSetupArguments('setup', []), undefined);
  assert.equal(parseSetupArguments('create', ['my-blog']), path.resolve('my-blog'));
  assert.equal(parseSetupArguments('setup', ['--root', 'my-blog']), path.resolve('my-blog'));
  for (const [command, args] of [['create', []], ['setup', ['--force']], ['create', ['--root', 'x']]]) {
    assert.throws(() => parseSetupArguments(command, args));
  }
});

test('starter setup writes a valid separate blog with complete content and configurable identity', async (t) => {
  const { destination } = fixture(t);
  const io = terminal(['Garden Journal', 'Alex Example', 'Notes from the garden.', 'https://garden.example', '1', 'yes']);
  const result = await runSetup('create', [destination], io);
  assert.equal(result.destination, destination);
  assert.equal(result.exitCode, 0);
  const config = JSON.parse(fs.readFileSync(path.join(destination, 'siteseed.config.json')));
  assert.equal(config.title, 'Garden Journal');
  assert.equal(config.url, 'https://garden.example');
  assert.equal(config.author.slug, 'alex-example');
  assert.deepEqual(config.navigation, [{ label: 'Home', url: '/' }, { label: 'About', url: '/about/' }]);
  const content = loadSiteContent(path.join(destination, 'content'), { includeDrafts: true });
  assert.equal(content.posts.length, 2);
  assert.equal(content.pages.length, 1);
  assert.equal(content.posts.find((post) => post.slug === 'welcome').draft, false);
  assert.equal(content.posts.find((post) => post.slug === 'example-draft').draft, true);
  assert.equal(content.pages[0].draft, false);
  const draft = parseFrontMatter(fs.readFileSync(path.join(destination, 'content', 'posts', 'example-draft', 'index.md'), 'utf8'));
  assert(draft.body.includes('| Step | What to do |'));
  assert.equal(draft.metadata.author, 'Alex Example');
  assert(fs.existsSync(path.join(destination, 'content', 'posts', 'example-draft', 'example.svg')));
  assert.deepEqual(validateContent(destination), []);
  const manifest = JSON.parse(fs.readFileSync(path.join(destination, 'package.json')));
  assert.equal(manifest.scripts.setup, 'siteseed setup --root .');
  assert.equal(manifest.scripts.check, 'siteseed check');
  assert.equal(path.resolve(destination, manifest.dependencies.siteseed.slice(5)), engine);
  assert.equal(manifest.private, true);
  assert(io.text().includes('Create this blog? (yes/no) [no]'));
  assert(io.text().includes('[done] Installing dependencies automatically'));
  assert(io.text().includes('Setup complete!'));
  assert(io.text().includes('the server is not running yet'));
  const next = io.text().slice(io.text().lastIndexOf('Next:'));
  assert.match(next, /npm run dev/);
  assert.doesNotMatch(next, /npm install/);
  assert(next.includes('http://localhost:'));
  assert(fs.existsSync(path.join(destination, 'node_modules', '.bin', process.platform === 'win32' ? 'siteseed.cmd' : 'siteseed')));
  assert(io.text().includes('/preview/example-draft/'));
});

test('starter homepage, About, preview, RSS, search and sitemaps work over HTTP', async (t) => {
  const { destination } = fixture(t);
  await runSetup('create', [destination], terminal(['Reading Notes', 'Sam', '', '', '', 'yes']));
  const app = createApp({ rootDirectory: destination, env: { NODE_ENV: 'production' } });
  const origin = await startServer(t, app);
  const home = await (await fetch(origin)).text();
  assert.match(home, /Reading Notes/);
  assert.match(home, /href="\/welcome\/"/);
  assert.equal((await fetch(`${origin}/about/`)).status, 200);
  assert.equal((await fetch(`${origin}/welcome/`)).status, 200);
  assert.equal((await fetch(`${origin}/example-draft/`)).status, 404);
  const preview = await fetch(`${origin}/preview/example-draft/`);
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get('cache-control'), 'private, no-store');
  assert.equal((await fetch(`${origin}/preview-assets/posts/example-draft/example.svg`)).status, 200);
  const search = await (await fetch(`${origin}/search-index.json`)).json();
  assert.deepEqual(search.map((entry) => entry.slug), ['welcome']);
  for (const route of ['/rss/', '/sitemap-posts.xml']) {
    const body = await (await fetch(`${origin}${route}`)).text();
    assert.match(body, /welcome/);
    assert.doesNotMatch(body, /<loc>[^<]*example-draft|<link>[^<]*example-draft/);
  }
});

test('cancel, EOF and declined confirmation do not create or alter the destination', async (t) => {
  const { root } = fixture(t);
  for (const [name, answers, exists] of [
    ['early', ['cancel'], false],
    ['eof', ['Blog', 'Author'], false],
    ['declined', ['Blog', 'Author', '', '', '', 'no'], false],
    ['existing-empty', ['Blog', 'Author', '', '', '', 'no'], true],
  ]) {
    const destination = path.join(root, name);
    if (exists) fs.mkdirSync(destination);
    const result = await runSetup('create', [destination], terminal(answers));
    assert.equal(result.cancelled, true);
    assert.equal(fs.existsSync(destination), exists);
    if (exists) assert.deepEqual(fs.readdirSync(destination), []);
  }
});

test('Ctrl+C interrupts prompts and pending import requests without publishing files', async (t) => {
  const input = new PassThrough();
  const output = new Writable({ write(chunk, encoding, callback) { callback(); } });
  const io = createPrompts(input, output);
  const question = io.ask('Name');
  process.emit('SIGINT');
  await assert.rejects(question, (error) => error instanceof SetupCancelled && error.exitCode === 130);
  io.close();
  const { destination } = fixture(t);
  const source = await startServer(t, () => { process.emit('SIGINT'); });
  const result = await runSetup('create', [destination],
    terminal(['Blog', 'Author', '', '', '2', `${source}/slow.xml`, 'yes']));
  assert.equal(result.cancelled, true);
  assert.equal(result.exitCode, 130);
  assert(!fs.existsSync(destination));
});

test('populated destinations, junctions and setup reruns never overwrite files', async (t) => {
  const { root, destination } = fixture(t);
  fs.mkdirSync(destination);
  fs.writeFileSync(path.join(destination, 'keep.txt'), 'original');
  await assert.rejects(runSetup('create', [destination], terminal([])), /not empty/);
  assert.equal(fs.readFileSync(path.join(destination, 'keep.txt'), 'utf8'), 'original');
  const linked = path.join(root, 'linked');
  fs.symlinkSync(destination, linked, 'junction');
  await assert.rejects(runSetup('create', [linked], terminal([])), /ordinary, empty/);
  const fresh = path.join(root, 'fresh');
  await runSetup('create', [fresh], terminal(['Blog', 'Author', '', '', '', 'yes']));
  const before = fs.readFileSync(path.join(fresh, 'siteseed.config.json'), 'utf8');
  await assert.rejects(runSetup('setup', ['--root', fresh], terminal([])), /not empty/);
  assert.equal(fs.readFileSync(path.join(fresh, 'siteseed.config.json'), 'utf8'), before);
});

test('terminal validation repeats invalid choices, blank names and invalid origins', async (t) => {
  const { destination } = fixture(t);
  const io = terminal(['Blog', '', 'Author', '', 'https://example.com/path', 'javascript:bad', '', '4', '', 'maybe', 'yes']);
  const result = await runSetup('create', [destination], io);
  assert.equal(result.exitCode, 0);
  assert(io.text().includes('Please enter a value.'));
  assert(io.text().includes('without a path'));
  assert(io.text().includes('Enter 1, 2 or 3.'));
  assert(io.text().includes('Enter yes or no.'));
});

test('website setup keeps every extracted item with flagged dates and one confirmation', async (t) => {
  const { destination } = fixture(t);
  const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#008000' } }).png().toBuffer();
  const source = await startServer(t, (req, res) => {
    if (req.url === '/photo.png') {
      res.setHeader('content-type', 'image/png');
      res.end(image);
      return;
    }
    res.setHeader('content-type', req.url === '/sitemap.xml' ? 'application/xml' : 'text/html');
    res.end(req.url === '/sitemap.xml'
      ? '<urlset><url><loc>/story/</loc></url><url><loc>/archive/</loc></url></urlset>'
      : '<meta property="og:image" content="/photo.png">' +
        `<article><h1>${req.url === '/story/' ? 'Story' : 'Archive'}</h1><p>A useful article.</p>` +
        '<img src="/photo.png" alt="Photo"><a href="/archive/">Archive</a></article>');
  });
  const io = terminal(['New Blog', 'New Author', '', 'https://new.example', '2',
    `${source}/sitemap.xml`, 'yes']);
  const started = Date.now();
  const result = await runSetup('create', [destination], io);
  assert.equal(result.exitCode, 0);
  assert(io.text().includes('Keeping all 2 extracted items'));
  assert.doesNotMatch(io.text(), /Action \(|Articles to import|Publication date \(required\)/);
  assert.equal((io.text().match(/\(yes\/no\)/g) || []).length, 1);
  assert(io.text().includes('Imported and published: 2 posts and 0 pages.'));
  assert(io.text().includes('posts will appear on the homepage'));
  assert.doesNotMatch(io.text(), /homepage starts empty/);
  const content = loadSiteContent(path.join(destination, 'content'), { includeDrafts: true });
  assert.deepEqual(content.posts.map((post) => post.slug).sort(), ['archive', 'story']);
  for (const post of content.posts) {
    assert.equal(post.draft, false);
    assert(new Date(post.date).getTime() >= started && new Date(post.date).getTime() <= Date.now());
    const { metadata } = parseFrontMatter(fs.readFileSync(
      path.join(destination, 'content', 'posts', post.slug, 'index.md'), 'utf8'));
    assert(metadata.import_notes.some((note) => note.includes('not the original publication date')));
    assert.match(metadata.feature_image, /^media-.*\.png$/);
    const adjustment = result.report.imported.find((entry) => entry.slug === post.slug).adjustments
      .find((entry) => entry.field === 'date');
    assert.equal(adjustment.original, '');
    assert.equal(adjustment.replacement, post.date);
  }
  assert.equal(content.pages.length, 0);
  assert.equal(loadSiteContent(path.join(destination, 'content')).posts.length, 2);
  assert(result.report.imported.every((entry) => entry.draft === false));
  assert(!fs.existsSync(path.join(destination, 'content', 'posts', 'welcome')));
  const preview = JSON.parse(fs.readFileSync(path.join(destination, 'import-preview.json')));
  assert(preview.entries.every((entry) => entry.selected));
  assert(preview.entries.find((entry) => entry.slug === 'archive').importNotes.some((note) => note.includes('possible home/archive')));
  const config = JSON.parse(fs.readFileSync(path.join(destination, 'siteseed.config.json')));
  assert.equal(config.url, 'https://new.example');
  assert.deepEqual(config.navigation, [{ label: 'Home', url: '/' }]);
  assert.deepEqual(validateContent(destination), []);
  const origin = await startServer(t, createApp({ rootDirectory: destination, env: { NODE_ENV: 'production' } }));
  const home = await (await fetch(origin)).text();
  assert.match(home, /href="\/story\/"/);
  assert.match(home, /href="\/archive\/"/);
  const post = await fetch(`${origin}/story/`);
  assert.equal(post.status, 200);
  const html = await post.text();
  assert.match(html, /href="\/archive\/"/);
  const media = html.match(/src="(\/content\/posts\/story\/media-[^"]+\.png)"/);
  assert(media, html);
  assert.equal((await fetch(`${origin}${media[1]}`)).status, 200);
  const feature = html.match(/src="(\/content\/posts\/story\/[^"]+\.webp)"/);
  assert(feature, html);
  assert.equal((await fetch(`${origin}${feature[1]}`)).status, 200);
  assert.equal((await fetch(`${origin}/content/posts/story/index.md`)).status, 404);
  const search = await (await fetch(`${origin}/search-index.json`)).json();
  assert.deepEqual(search.map((entry) => entry.slug).sort(), ['archive', 'story']);
  for (const route of ['/rss/', '/sitemap-posts.xml']) {
    const body = await (await fetch(`${origin}${route}`)).text();
    assert.match(body, /https:\/\/new.example\/story\//);
    assert.match(body, /https:\/\/new.example\/archive\//);
  }
});

test('Ghost setup publishes all content, preserves valid dates and flags placeholder metadata', async (t) => {
  const { root, destination } = fixture(t);
  const exportPath = path.join(root, 'export.json');
  fs.writeFileSync(exportPath, JSON.stringify({ db: [{ data: { posts: [
    { id: '1', slug: 'ghost-post', title: 'Original', status: 'published', html: '<p>Original content.</p>',
      published_at: '2025-01-01', updated_at: '2025-01-02' },
    { id: '2', slug: 'rss', title: '', type: 'page', status: 'scheduled', html: '<pre><code>Example</code></pre>',
      published_at: '2999-01-01' },
    { id: '3', slug: 'ghost-post', title: 'Another draft', status: 'draft', html: '<p>Another body.</p>' },
  ],
  tags: [{ id: 'tag', name: '\u65e5\u672c\u8a9e', visibility: 'public' }],
  posts_tags: [{ post_id: '1', tag_id: 'tag' }],
  } }] }));
  const io = terminal(['New Blog', 'New Author', '', '', '3', 'https://old.example', exportPath,
    'yes']);
  const result = await runSetup('create', [destination], io);
  assert.equal(result.exitCode, 0);
  const content = loadSiteContent(path.join(destination, 'content'), { includeDrafts: true });
  assert.equal(content.posts.length, 2);
  const original = content.posts.find((post) => post.slug === 'ghost-post');
  assert.equal(original.date, '2025-01-01T00:00:00.000Z');
  assert.equal(original.updated, '2025-01-02T00:00:00.000Z');
  assert.equal(original.tags[0].name, '\u65e5\u672c\u8a9e');
  assert.match(original.tags[0].slug, /^tag-[a-f0-9]{12}$/);
  assert(content.posts.some((post) => post.slug === 'ghost-post-2'));
  assert.equal(content.pages[0].title, 'Imported content: rss-2');
  assert.equal(content.pages[0].slug, 'rss-2');
  assert.equal(content.pages[0].author, 'New Author');
  assert([...content.posts, ...content.pages].every((item) => !item.draft));
  assert(result.report.imported.every((entry) => entry.draft === false));
  assert(io.text().includes('Imported and published: 2 posts and 1 page.'));
  const adjustments = result.report.imported.find((entry) => entry.slug === 'rss-2').adjustments;
  assert.equal(adjustments.find((entry) => entry.field === 'date').original, '2999-01-01T00:00:00.000Z');
  assert(adjustments.some((entry) => entry.field === 'description'));
  assert.doesNotMatch(io.text(), /Action \(|Articles to import/);
  assert.deepEqual(validateContent(destination), []);
  const origin = await startServer(t, createApp({ rootDirectory: destination, env: { NODE_ENV: 'production' } }));
  for (const entry of result.report.imported) assert.equal((await fetch(`${origin}${entry.destination}`)).status, 200);
  assert.match(await (await fetch(`${origin}/sitemap-pages.xml`)).text(), /\/rss-2\//);
});

test('bulk preparation records missing metadata and preserves non-Latin tag names', () => {
  const source = {
    url: 'https://old.example/story/', selected: true, collection: 'posts', slug: 'story',
    title: 'Story', author: '', description: '', date: '', updated: '', warnings: [],
    tags: ['\u65e5\u672c\u8a9e'], markdown: 'Body', media: [], featureImage: '',
  };
  const result = prepareSetupImport({ site: { author: { name: 'Configured Author' } } },
    { version: 1, kind: 'website', entries: [source], failures: [] }, new Date('2025-06-01T12:00:00Z'));
  const entry = result.entries[0];
  assert.equal(entry.author, 'Configured Author');
  assert.equal(entry.date, '2025-06-01T12:00:00.000Z');
  assert.equal(entry.updated, entry.date);
  assert.deepEqual(entry.tags, source.tags);
  assert.match(entry.tagSlugs[0], /^tag-[a-f0-9]{12}$/);
  assert(entry.importNotes.some((note) => note.includes('Placeholder author')));
  assert.equal(source.date, '');
  assert.deepEqual(source.warnings, []);
});

test('declining the bulk import confirmation leaves the destination untouched', async (t) => {
  const { root, destination } = fixture(t);
  const exportPath = path.join(root, 'export.json');
  fs.writeFileSync(exportPath, JSON.stringify({ db: [{ data: { posts: [
    { id: '1', slug: 'post', title: 'Post', status: 'draft', html: '<p>Draft body.</p>' },
  ] } }] }));
  const result = await runSetup('create', [destination],
    terminal(['Blog', 'Author', '', '', '3', 'https://old.example', exportPath, 'no']));
  assert.equal(result.cancelled, true);
  assert(!fs.existsSync(destination));
});

test('network failures leave no blog and partial media failures are clearly reported', async (t) => {
  const { root, destination } = fixture(t);
  const source = await startServer(t, (req, res) => {
    if (req.url === '/map.xml') {
      res.setHeader('content-type', 'application/xml');
      res.end('<urlset><url><loc>/story/</loc></url></urlset>');
    } else if (req.url === '/story/') {
      res.setHeader('content-type', 'text/html');
      res.end('<article><h1>Story</h1><time datetime="2025-01-01"></time><p>Body</p><img src="/missing.png" alt="Missing"></article>');
    } else { res.writeHead(404); res.end('Missing'); }
  });
  await assert.rejects(runSetup('create', [destination],
    terminal(['Blog', 'Author', '', '', '2', `${source}/missing`, 'yes'])), /HTTP 404/);
  assert(!fs.existsSync(destination));
  const partial = path.join(root, 'partial');
  const io = terminal(['Blog', 'Author', '', '', '2', `${source}/map.xml`, 'yes']);
  const result = await runSetup('create', [partial], io);
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.failures.length, 1);
  assert(io.text().includes('1 failures'));
  assert(io.text().includes('Setup finished with import errors'));
  assert.doesNotMatch(io.text(), /Setup complete!/);
  assert(fs.existsSync(path.join(partial, 'content', 'posts', 'story', 'index.md')));
});

test('fresh CLI setup, local engine installation and generated npm scripts work together', async (t) => {
  const { root, destination } = fixture(t);
  const engineFiles = ['siteseed.config.json', path.join('content', 'image-manifest.json'), path.join('public', 'search-index.json')];
  const before = engineFiles.map((file) => fs.existsSync(path.join(engine, file)) ? fs.readFileSync(path.join(engine, file)) : null);
  const answers = ['Fresh User Blog', 'New Writer', '', '', '', 'yes'].join('\n') + '\n';
  const result = await childRun(process.execPath, [cliPath, 'create', destination], root, answers);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Installing dependencies automatically/);
  assert.match(result.stdout, /Setup complete!/);
  const checked = await npm('run check', destination);
  assert.equal(checked.code, 0, checked.stderr);
  assert.match(checked.stdout, /0 error\(s\)/);
  assert(fs.existsSync(path.join(destination, 'package-lock.json')));
  const again = await npm('run setup', destination);
  assert.equal(again.code, 1);
  assert.match(again.stderr, /not empty/);
  const after = engineFiles.map((file) => fs.existsSync(path.join(engine, file)) ? fs.readFileSync(path.join(engine, file)) : null);
  assert.deepEqual(after, before);
});

test('setup uses the current directory without asking for or creating another folder', async (t) => {
  const { root } = fixture(t);
  const cwd = path.join(root, 'engine-checkout');
  fs.mkdirSync(cwd);
  const answers = ['Tech Blog', 'Author', '', '', '', 'yes'].join('\n') + '\n';
  const result = await childRun(process.execPath, [cliPath, 'setup'], cwd, answers);
  assert.equal(result.code, 0, result.stderr);
  assert(result.stdout.includes(`Blog directory: ${cwd}`));
  assert.doesNotMatch(result.stdout, /Blog folder|  cd /);
  assert.match(result.stdout, /start your blog in this directory/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(cwd, 'siteseed.config.json'))).title, 'Tech Blog');
  assert(!fs.existsSync(path.join(root, 'tech-blog')));
  assert(!fs.existsSync(path.join(cwd, 'tech-blog')));
});

test('setup still accepts an explicit separate destination', async (t) => {
  const { root, destination } = fixture(t);
  const answers = ['Techblog', 'Author', '', '', '', 'yes'].join('\n') + '\n';
  const result = await childRun(process.execPath, [cliPath, 'setup', '--root', destination], root, answers);
  assert.equal(result.code, 0, result.stderr);
  assert(result.stdout.includes(`Blog created at ${destination}`));
  assert.equal(JSON.parse(fs.readFileSync(path.join(destination, 'siteseed.config.json'))).title, 'Techblog');
});

test('a destination populated during review is left untouched', async (t) => {
  const { destination } = fixture(t);
  const io = terminal(['Blog', 'Author', '', '', '', 'yes']);
  io.output = new Writable({
    write(chunk, encoding, callback) {
      if (chunk.toString().includes('Create this blog?')) {
        fs.mkdirSync(destination);
        fs.writeFileSync(path.join(destination, 'keep.txt'), 'created during review');
      }
      callback();
    },
  });
  await assert.rejects(runSetup('create', [destination], io), /not empty/);
  assert.deepEqual(fs.readdirSync(destination), ['keep.txt']);
  assert.equal(fs.readFileSync(path.join(destination, 'keep.txt'), 'utf8'), 'created during review');
});

test('Ctrl+C during media downloads cancels the whole setup instead of leaving a partial blog', async (t) => {
  const { destination } = fixture(t);
  const source = await startServer(t, (req, res) => {
    if (req.url === '/map.xml') {
      res.setHeader('content-type', 'application/xml');
      res.end('<urlset><url><loc>/story/</loc></url></urlset>');
    } else if (req.url === '/story/') {
      res.setHeader('content-type', 'text/html');
      res.end('<article><h1>Story</h1><time datetime="2025-01-01"></time><p>Body</p><img src="/photo.png" alt="Photo"></article>');
    } else process.emit('SIGINT');
  });
  const result = await runSetup('create', [destination],
    terminal(['Blog', 'Author', '', '', '2', `${source}/map.xml`, 'yes']));
  assert.equal(result.cancelled, true);
  assert.equal(result.exitCode, 130);
  assert(!fs.existsSync(destination));
});

test('progress animates terminals, logs cleanly and stops on success, failure and cancellation', async () => {
  const terminalIo = terminal([]);
  terminalIo.output.isTTY = true;
  const io = createPrompts(terminalIo.input, terminalIo.output);
  try {
    assert.equal(await io.progress('Creating blog', async (log) => {
      log('One item created');
      await new Promise((resolve) => setTimeout(resolve, 220));
      return 42;
    }), 42);
    assert.match(terminalIo.text(), /\| Creating blog/);
    assert.match(terminalIo.text(), /\/ Creating blog/);
    assert.match(terminalIo.text(), /One item created/);
    assert.match(terminalIo.text(), /\[done\] Creating blog/);
    await assert.rejects(io.progress('Failed step', () => { throw new Error('Fixture failure'); }), /Fixture failure/);
    assert.match(terminalIo.text(), /\[failed\] Failed step/);
    await assert.rejects(io.progress('Cancelled step', () => {
      process.emit('SIGINT');
      io.signal.throwIfAborted();
    }), SetupCancelled);
    assert.match(terminalIo.text(), /\[cancelled\] Cancelled step/);
    const stopped = terminalIo.text();
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(terminalIo.text(), stopped);
  } finally { io.close(); }
  const piped = terminal([]);
  const plain = createPrompts(piped.input, piped.output);
  try { await plain.progress('Saving', async () => {}); }
  finally { plain.close(); }
  assert.match(piped.text(), /\[working\] Saving\n\[done\] Saving/);
  assert.doesNotMatch(piped.text(), /[\r\x1b]/);
});

test('installation failure preserves content and prints recovery rather than success', async (t) => {
  const { destination } = fixture(t);
  const io = terminal(['Blog', 'Author', '', '', '', 'yes']);
  await assert.rejects(runSetup('create', [destination], {
    ...io,
    install: async (directory, { signal }) => {
      assert.equal(directory, destination);
      assert.equal(signal.aborted, false);
      assert(fs.existsSync(path.join(directory, 'package.json')));
      throw new Error('Fixture installation failure');
    },
  }), /Fixture installation failure/);
  assert(fs.existsSync(path.join(destination, 'content', 'posts', 'welcome', 'index.md')));
  assert.match(io.text(), /Setup is incomplete/);
  assert.match(io.text(), /Do not rerun setup/);
  assert.match(io.text(), /npm install --offline/);
  assert.match(io.text(), /\[failed\] Installing dependencies/);
  assert.doesNotMatch(io.text(), /Setup complete!|No blog files were written/);
});

test('cancellation during installation keeps saved content and gives recovery instructions', async (t) => {
  const { destination } = fixture(t);
  const io = terminal(['Blog', 'Author', '', '', '', 'yes']);
  const result = await runSetup('create', [destination], {
    ...io,
    install: async (directory, { signal }) => {
      process.emit('SIGINT');
      signal.throwIfAborted();
    },
  });
  assert.equal(result.cancelled, true);
  assert.equal(result.exitCode, 130);
  assert(fs.existsSync(path.join(destination, 'content', 'posts', 'welcome', 'index.md')));
  assert.match(io.text(), /Setup is incomplete/);
  assert.match(io.text(), /\[cancelled\] Installing dependencies/);
  assert.doesNotMatch(io.text(), /Setup complete!|No blog files were written/);
});

test('npm runner uses the destination, reports failures and waits for aborted children', async (t) => {
  const { root, destination } = fixture(t);
  fs.mkdirSync(destination);
  const script = path.join(root, 'fake npm.cjs');
  const env = { ...process.env, npm_execpath: script };
  fs.writeFileSync(script, 'console.log(JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }));');
  const details = JSON.parse(await installDependencies(destination, { env }));
  assert.equal(details.cwd, destination);
  assert.deepEqual(details.args, ['install', '--offline', '--no-audit', '--no-fund']);
  fs.writeFileSync(script, 'console.error("Fixture npm error"); process.exitCode = 7;');
  await assert.rejects(installDependencies(destination, { env }), /exit 7[\s\S]*Fixture npm error/);
  fs.writeFileSync(script, 'setInterval(() => {}, 1000);');
  const controller = new AbortController();
  const reason = new SetupCancelled('Fixture abort', 130);
  const timer = setTimeout(() => controller.abort(reason), 150);
  try {
    await assert.rejects(installDependencies(destination, { env, signal: controller.signal }),
      (error) => error === reason);
  } finally { clearTimeout(timer); }
  await assert.rejects(installDependencies(destination, {
    env: { ...env, npm_execpath: path.join(root, 'missing npm.cjs') },
  }), /Dependency installation failed/);
});

test('a pages-only import explains why the homepage has no posts and links to a page', async (t) => {
  const { root, destination } = fixture(t);
  const exportPath = path.join(root, 'pages.json');
  fs.writeFileSync(exportPath, JSON.stringify({ db: [{ data: { posts: [
    { id: '1', slug: 'about', title: 'About', type: 'page', status: 'published', html: '<p>About this site.</p>' },
  ] } }] }));
  const io = terminal(['Blog', 'Author', '', '', '3', 'https://old.example', exportPath, 'yes']);
  const result = await runSetup('create', [destination], io);
  assert.equal(result.exitCode, 0);
  assert.match(io.text(), /Imported and published: 0 posts and 1 page/);
  assert.match(io.text(), /Pages have their own URLs/);
  assert.match(io.text(), /Open an imported page after starting: http:\/\/localhost:\d+\/about\//);
  assert.doesNotMatch(io.text(), /posts will appear on the homepage/);
});

test('fresh checkout setup writes in place and preserves engine files and custom settings', async (t) => {
  const { root, checkout, config, environment } = checkoutFixture(t);
  const protectedFiles = ['package.json', '.gitignore', 'app.js', path.join('public', 'styles.css'), path.join('public', 'custom.css'), 'keep.txt'];
  const before = protectedFiles.map((name) => fs.readFileSync(path.join(checkout, name)));
  const answers = ['In Place Blog', '', '', '', '', 'yes'].join('\n') + '\n';
  const result = await childRun(process.execPath, [path.join(checkout, 'bin', 'siteseed.js'), 'setup'],
    checkout, answers, environment);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Setup complete!/);
  assert.match(result.stdout, /start your blog in this directory/);
  assert.doesNotMatch(result.stdout, /Blog folder|  cd |Keep that engine folder/);
  assert.deepEqual(protectedFiles.map((name) => fs.readFileSync(path.join(checkout, name))), before);
  const manifest = JSON.parse(fs.readFileSync(path.join(checkout, 'package.json')));
  assert.equal(manifest.dependencies.siteseed, undefined);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(checkout, 'siteseed.config.json'))), { ...config, title: 'In Place Blog' });
  assert(fs.existsSync(path.join(checkout, 'content', 'posts', 'welcome', 'index.md')));
  assert(fs.existsSync(path.join(checkout, 'node_modules', 'express', 'package.json')));
  assert(!fs.existsSync(path.join(root, 'in-place-blog')));
  const checked = await npm('run check:content', checkout);
  assert.equal(checked.code, 0, checked.stderr);
  const origin = await startServer(t, createApp({ rootDirectory: checkout, env: { NODE_ENV: 'production' } }));
  assert.match(await (await fetch(origin)).text(), /In Place Blog/);
  assert.equal((await fetch(`${origin}/welcome/`)).status, 200);
  const again = await childRun(process.execPath, [path.join(checkout, 'bin', 'siteseed.js'), 'setup'], checkout);
  assert.equal(again.code, 1);
  assert.match(again.stderr, /content already exists/);
  assert.deepEqual(protectedFiles.map((name) => fs.readFileSync(path.join(checkout, name))), before);
});

test('checkout import publishes posts in its own content folder without moving the source export', async (t) => {
  const { checkout, environment } = checkoutFixture(t);
  const exportPath = path.join(checkout, 'ghost-backup.json');
  const exported = JSON.stringify({ db: [{ data: { posts: [
    { id: '1', slug: 'imported-story', title: 'Imported story', status: 'published',
      published_at: '2025-01-01', html: '<p>A story imported here.</p>' },
  ] } }] });
  fs.writeFileSync(exportPath, exported);
  const answers = ['Imported Blog', '', '', '', '3', 'https://old.example', exportPath, 'yes'].join('\n') + '\n';
  const result = await childRun(process.execPath, [path.join(checkout, 'bin', 'siteseed.js'), 'setup'],
    checkout, answers, environment);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Imported and published: 1 post and 0 pages/);
  assert.doesNotMatch(result.stdout, /  cd /);
  assert.equal(fs.readFileSync(exportPath, 'utf8'), exported);
  const { metadata } = parseFrontMatter(fs.readFileSync(path.join(checkout, 'content', 'posts', 'imported-story', 'index.md'), 'utf8'));
  assert.equal(metadata.draft, false);
  assert(!fs.existsSync(path.join(checkout, 'content', 'posts', 'welcome')));
  assert(fs.existsSync(path.join(checkout, 'import-preview.json')));
  const search = JSON.parse(fs.readFileSync(path.join(checkout, 'public', 'search-index.json')));
  assert.deepEqual(search.map((entry) => entry.slug), ['imported-story']);
  const origin = await startServer(t, createApp({ rootDirectory: checkout, env: { NODE_ENV: 'production' } }));
  assert.match(await (await fetch(origin)).text(), /href="\/imported-story\/"/);
  assert.equal((await fetch(`${origin}/imported-story/`)).status, 200);
});

test('checkout cancellation preserves every original file', async (t) => {
  const { checkout, config, environment } = checkoutFixture(t);
  const result = await childRun(process.execPath, [path.join(checkout, 'bin', 'siteseed.js'), 'setup'],
    checkout, ['Changed title', '', '', '', '', 'no'].join('\n') + '\n', environment);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /No blog files were written/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(checkout, 'siteseed.config.json'))), config);
  assert.deepEqual(fs.readdirSync(path.join(checkout, 'content')), ['image-manifest.json']);
  assert(!fs.existsSync(path.join(checkout, 'node_modules')));
});

test('checkout publishing rejects intervening edits and restores files after a write failure', async (t) => {
  const { root, checkout } = checkoutFixture(t);
  const staging = path.join(root, 'staging');
  fs.mkdirSync(path.join(staging, 'content', 'posts', 'new-post'), { recursive: true });
  fs.mkdirSync(path.join(staging, 'public'));
  fs.writeFileSync(path.join(staging, 'siteseed.config.json'), '{"title":"Changed"}\n');
  fs.writeFileSync(path.join(staging, 'content', 'image-manifest.json'), '{"changed":true}\n');
  fs.writeFileSync(path.join(staging, 'public', 'search-index.json'), '[{"slug":"new-post"}]\n');
  fs.writeFileSync(path.join(staging, 'content', 'posts', 'new-post', 'index.md'), 'New content');
  const initial = await inspectCheckout(checkout);
  const signal = new AbortController().signal;
  const configPath = path.join(checkout, 'siteseed.config.json');
  const config = fs.readFileSync(configPath);
  fs.writeFileSync(configPath, config.toString() + '\n');
  await assert.rejects(publishCheckout(staging, checkout, initial, signal), /changed during setup/);
  assert.equal(fs.readFileSync(configPath, 'utf8'), config.toString() + '\n');
  fs.writeFileSync(configPath, config);
  const refreshed = await inspectCheckout(checkout);
  const open = fs.promises.open;
  t.mock.method(fs.promises, 'open', async (target, ...args) => {
    if (target === configPath) throw new Error('Fixture write failure');
    return open(target, ...args);
  });
  await assert.rejects(publishCheckout(staging, checkout, refreshed, signal), /Fixture write failure/);
  assert.equal(fs.readFileSync(configPath, 'utf8'), config.toString());
  assert.equal(fs.readFileSync(path.join(checkout, 'content', 'image-manifest.json'), 'utf8'), '{}\n');
  assert.equal(fs.readFileSync(path.join(checkout, 'public', 'search-index.json'), 'utf8'), '[]\n');
  assert(!fs.existsSync(path.join(checkout, 'content', 'posts')));
  assert.equal(fs.readFileSync(path.join(checkout, 'keep.txt'), 'utf8'), 'Unrelated work');
  t.mock.restoreAll();
  const controller = new AbortController();
  t.mock.method(fs.promises, 'open', async (target, ...args) => {
    if (target === configPath) controller.abort(new SetupCancelled('Fixture cancellation during save', 130));
    return open(target, ...args);
  });
  await assert.rejects(publishCheckout(staging, checkout, refreshed, controller.signal), SetupCancelled);
  assert.equal(fs.readFileSync(configPath, 'utf8'), config.toString());
  assert.equal(fs.readFileSync(path.join(checkout, 'content', 'image-manifest.json'), 'utf8'), '{}\n');
  assert.equal(fs.readFileSync(path.join(checkout, 'public', 'search-index.json'), 'utf8'), '[]\n');
  assert(!fs.existsSync(path.join(checkout, 'content', 'posts')));
});

test('checkout setup refuses existing content, nonempty indexes and linked content directories', async (t) => {
  const { root, checkout } = checkoutFixture(t);
  const posts = path.join(checkout, 'content', 'posts');
  fs.mkdirSync(posts);
  fs.writeFileSync(path.join(posts, 'keep.md'), 'Existing content');
  await assert.rejects(inspectCheckout(checkout), /content already exists/);
  fs.unlinkSync(path.join(posts, 'keep.md'));
  fs.rmdirSync(posts);
  const outside = path.join(root, 'outside');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, posts, 'junction');
  await assert.rejects(inspectCheckout(checkout), /content already exists/);
  fs.unlinkSync(posts);
  fs.writeFileSync(path.join(checkout, 'public', 'search-index.json'), '[{"slug":"existing"}]');
  await assert.rejects(inspectCheckout(checkout), /Generated content already exists/);
  assert.deepEqual(fs.readdirSync(outside), []);
});
