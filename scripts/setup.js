const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createBlogContext } = require('../src/site');
const { createPrompts, SetupCancelled } = require('../src/setup-prompts');
const { projectManifest, writeStarter, prepareSetupImport } = require('../src/setup-content');
const { installDependencies, installCommand } = require('../src/setup-install');
const { inspectCheckout, publishCheckout } = require('../src/setup-checkout');
const { previewWebsite, slugify, httpUrl } = require('../src/import-source');
const { applyPreview, validatePreview } = require('../src/import-write');
const { buildImages } = require('./build-images');
const { buildSearchIndex } = require('./build-search-index');
const { checkContent } = require('./check-content');

const engineDirectory = path.join(__dirname, '..');
const help = `SiteSeed setup

  siteseed setup                    Set up a blog in the current directory
  siteseed setup --root <directory> Use an explicit directory instead
  siteseed create <directory>       Create a new blog using the same wizard

Choose starter content, website import, or a Ghost export.
Publish all extracted content in the new blog; confirm once before writing.
Missing metadata uses flagged placeholders for later editing.
Type cancel at any prompt or press Ctrl+C. Existing blog content is protected.
In a fresh checkout, keep engine files and configure the blog in place.
Setup installs dependencies automatically, then shows how to start your blog.
It does not start a server or deploy your blog.
`;
const required = (value) => value.trim() ? '' : 'Please enter a value.';

function parseSetupArguments(command, args) {
  if (command === 'create') {
    if (args.length === 1 && args[0].trim() && !args[0].startsWith('-')) return path.resolve(args[0]);
    throw new Error(`Expected create <directory>.\n${help}`);
  }
  if (!args.length) return undefined;
  if (args.length === 2 && args[0] === '--root' && args[1].trim() && !args[1].startsWith('-')) {
    return path.resolve(args[1]);
  }
  throw new Error(`Expected setup [--root <directory>].\n${help}`);
}

async function inspectDestination(destination) {
  let stat;
  try { stat = await fs.lstat(destination); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Choose an ordinary, empty directory: ${destination}`);
  if ((await fs.readdir(destination)).length) {
    throw new Error(`Destination is not empty: ${destination}\nChoose a new folder. To change an existing blog, edit its siteseed.config.json; setup never overwrites it.`);
  }
  return stat;
}

async function publishStaged(staging, destination, initialStat, signal) {
  signal.throwIfAborted();
  const current = await inspectDestination(destination);
  if (initialStat && (!current || initialStat.ino !== current.ino || initialStat.dev !== current.dev)) {
    throw new Error('Destination changed during setup. Please rerun setup.');
  }
  if (!initialStat && current) throw new Error('Destination was created during setup. Please rerun setup.');
  let createdDirectory = false;
  const owned = [];
  try {
    if (!current) {
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.mkdir(destination);
      createdDirectory = true;
    }
    for (const entry of await fs.readdir(staging, { withFileTypes: true })) {
      signal.throwIfAborted();
      const target = path.join(destination, entry.name);
      const source = path.join(staging, entry.name);
      if (entry.isDirectory()) {
        await fs.mkdir(target);
        owned.push({ target, directory: true });
        await fs.cp(source, target, { recursive: true, force: false, errorOnExist: true });
      } else {
        await fs.copyFile(source, target, require('node:fs').constants.COPYFILE_EXCL);
        owned.push({ target, directory: false });
      }
    }
    signal.throwIfAborted();
  } catch (error) {
    for (const item of owned.reverse()) await fs.rm(item.target, { recursive: item.directory, force: true });
    if (createdDirectory) await fs.rmdir(destination);
    throw error;
  }
}

async function runSetup(command, args, {
  input = process.stdin, output = process.stdout, install = installDependencies,
} = {}) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) { output.write(help); return; }
  const explicitRoot = parseSetupArguments(command, args);
  const io = createPrompts(input, output);
  let staging;
  const destination = explicitRoot || process.cwd();
  const inCheckout = path.relative(engineDirectory, destination) === '';
  const changeDirectory = path.relative(process.cwd(), destination) !== '';
  let written = false;
  const quotePath = (value) => process.platform === 'win32'
    ? `'${value.replaceAll("'", "''")}'` : `'${value.replaceAll("'", "'\\''")}'`;
  try {
    if (inCheckout && engineDirectory.split(path.sep).includes('node_modules')) {
      throw new Error('Run setup from your blog directory, not inside the installed engine in node_modules.');
    }
    io.write(`Welcome to SiteSeed.\nBlog directory: ${destination}\nType cancel at any prompt. Existing blog content is protected.`);
    const initialStat = inCheckout ? await inspectCheckout(destination) : await inspectDestination(destination);
    const existingConfig = inCheckout && initialStat.files.has('siteseed.config.json')
      ? createBlogContext({ rootDirectory: destination, env: {} }).config : {};
    const title = await io.ask('Blog name', { defaultValue: existingConfig.title || 'My blog', validate: required });
    const name = await io.ask('Your name', { defaultValue: existingConfig.author?.name || '', validate: required });
    const description = await io.ask('Short description', { defaultValue: existingConfig.description || 'Notes and stories.', validate: required });
    const url = await io.ask('Website URL (Enter for local development)', {
      defaultValue: existingConfig.url || 'http://localhost:3000',
      validate: (value) => {
        try {
          const parsed = new URL(httpUrl(value));
          return new URL(value).hash || parsed.pathname !== '/' || parsed.search
            ? 'Enter an HTTP(S) origin without a path, query or fragment.' : '';
        } catch (error) { return error.message; }
      },
    });
    io.write('\nStart with:\n  1. Starter content (welcome post, example draft, About page)\n  2. Import a website or sitemap\n  3. Import a Ghost export');
    const choice = await io.ask('Choose 1, 2 or 3', {
      defaultValue: '1', validate: (value) => /^[123]$/.test(value) ? '' : 'Enter 1, 2 or 3.',
    });
    const config = {
      ...existingConfig, title, description, url: new URL(url).origin,
      author: {
        ...existingConfig.author, name,
        slug: name === existingConfig.author?.name ? existingConfig.author.slug : slugify(name) || 'author',
        bio: existingConfig.author?.bio || '',
      },
      navigation: existingConfig.navigation ?? [{ label: 'Home', url: '/' }, ...(choice === '1' ? [{ label: 'About', url: '/about/' }] : [])],
    };
    staging = await fs.mkdtemp(path.join(os.tmpdir(), 'siteseed-setup-'));
    await fs.writeFile(path.join(staging, 'siteseed.config.json'), JSON.stringify(config, null, 2) + '\n', { flag: 'wx' });
    const blog = createBlogContext({ rootDirectory: staging, env: {} });
    let preview;
    if (choice !== '1') {
      io.write('Only import content you own or have permission to migrate. Setup publishes all imported content in your new blog, including source drafts and scheduled posts. Nothing is deployed.');
      const source = await io.ask(choice === '2' ? 'Website or sitemap URL' : 'Old website URL', {
        validate: (value) => { try { httpUrl(value); return ''; } catch (error) { return error.message; } },
      });
      let exportPath;
      if (choice === '3') exportPath = path.resolve(await io.ask('Ghost export file', { validate: required }));
      preview = await io.progress('Reading source and discovering content', async () => choice === '2'
        ? await previewWebsite(blog, source, { signal: io.signal })
        : await require('./import-ghost').createGhostImporter(blog, { source, exportPath }).main());
      io.signal.throwIfAborted();
      for (const warning of preview.warnings || []) io.write(`Note: ${warning}`);
      for (const failure of preview.failures) io.write(`Failed ${failure.url || failure.slug}: ${failure.error}`);
      preview = prepareSetupImport(blog, preview);
      validatePreview(blog, preview);
      const adjusted = preview.entries.filter((entry) => entry.importNotes.length).length;
      io.write(`Keeping all ${preview.entries.length} extracted items as published content, including possible archive pages.`);
      io.write(`${adjusted} items have import notes. Placeholder dates use the import time, not an inferred original date.`);
      io.write('Review or delete content locally before deploying. Metadata adjustments are flagged in import_notes and the import report.');
    }
    const manifest = inCheckout ? null : projectManifest(title, destination, engineDirectory);
    io.write(`\nCreate blog at: ${destination}\nName: ${title}\nAuthor: ${name}\nDescription: ${description}\nWebsite: ${config.url}`);
    io.write(preview
      ? `Content: all ${preview.entries.length} extracted items published (draft: false); no starter content.`
      : 'Content: published welcome post and About page, plus an example draft.');
    io.write(inCheckout
      ? 'Use this checkout in place. Keep package.json, the engine, theme assets and unrelated files unchanged.'
      : `Engine dependency: ${manifest.dependencies.siteseed}`);
    io.write(`Dependencies will be installed automatically with ${installCommand}.`);
    io.write((inCheckout
      ? 'Update siteseed.config.json with the settings above; keep other settings. Write content and rebuild the empty image/search indexes.'
      : 'Files: siteseed.config.json, package.json, .gitignore, content and public.') +
      (preview ? '\nAlso saving import-preview.json and the import report.' : ''));
    io.write('Draft previews are not password-protected, including in production. Review locally.');
    if (!await io.confirm('Create this blog?')) throw new SetupCancelled();
    let report;
    await io.progress(preview ? 'Creating blog content and downloading media' : 'Creating starter content', async (log) => {
      if (preview) {
        await fs.writeFile(path.join(staging, 'import-preview.json'), JSON.stringify(preview, null, 2) + '\n', { flag: 'wx' });
        ({ report } = await applyPreview(blog, preview, { signal: io.signal, publish: true, log }));
      } else await writeStarter(blog);
    });
    io.signal.throwIfAborted();
    if (!inCheckout) {
      await fs.writeFile(path.join(staging, 'package.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
      await fs.writeFile(path.join(staging, '.gitignore'),
        'node_modules/\n.env\nghost-backup.json\nimport-preview.json\ncontent/import-report-*.json\n', { flag: 'wx' });
    }
    await io.progress('Building images, search and checking content', async (log) => {
      await buildImages(blog, { log });
      buildSearchIndex(blog, { log });
      checkContent(blog, { log });
    });
    io.signal.throwIfAborted();
    await io.progress('Saving your blog', async () => {
      if (inCheckout) await publishCheckout(staging, destination, initialStat, io.signal);
      else await publishStaged(staging, destination, initialStat, io.signal);
      written = true;
    });
    await io.progress('Installing dependencies automatically', async (log) => {
      const details = await install(destination, { signal: io.signal });
      if (details) log(details);
    });
    io.signal.throwIfAborted();
    io.write(report?.failures.length
      ? '\nSetup finished with import errors. Blog files and dependencies are ready; see the report below.'
      : '\nSetup complete! Your blog and dependencies are ready.');
    io.write(`Blog created at ${destination}.`);
    const localUrl = `http://localhost:${process.env.PORT || 3000}`;
    if (preview) {
      const posts = report.imported.filter((entry) => entry.collection === 'posts');
      const pages = report.imported.filter((entry) => entry.collection === 'pages');
      io.write(`Imported and published: ${posts.length} post${posts.length === 1 ? '' : 's'} and ${pages.length} page${pages.length === 1 ? '' : 's'}.`);
      io.write(posts.length
        ? 'Your imported posts will appear on the homepage when you start the server.'
        : 'This import contains only pages. Pages have their own URLs and do not appear in the homepage post list.');
      io.write(`Open an imported ${posts.length ? 'post' : 'page'} after starting: ${localUrl}${(posts[0] || pages[0]).destination}`);
      io.write(`Review content/import-report-*.json: ${report.failures.length} failures and ${report.warnings.length} warnings.`);
      io.write('Check import_notes for placeholder metadata before deploying. Set draft: true to hide any unwanted post or page.');
    } else io.write(`Created: 1 published welcome post, 1 About page and 1 example draft.\nExample draft after starting: ${localUrl}/preview/example-draft/`);
    io.write('Edit Markdown in content/posts or content/pages. Run npm run check before deploying.');
    if (!inCheckout && require('../package.json').private) io.write('This pre-release blog uses the local engine. Keep that engine folder and its installed dependencies available.');
    io.write(`\nNext: start your blog${changeDirectory ? '' : ' in this directory'} (the server is not running yet).\n` +
      `${changeDirectory ? `  cd ${quotePath(destination)}\n` : ''}  npm run dev\n\n` +
      `Then open ${localUrl} in your browser (or the URL printed by the server).\n` +
      'Keep that terminal open while browsing. Press Ctrl+C to stop the server. Nothing has been deployed online.');
    return { destination, report, exitCode: report?.failures.length ? 1 : 0 };
  } catch (error) {
    if (written) {
      io.write(`Setup is incomplete, but your blog files are saved at ${destination}.\n` +
        `Do not rerun setup. Retry dependency installation without recreating your blog.\n` +
        `To retry:\n${changeDirectory ? `  cd ${quotePath(destination)}\n` : ''}  ${installCommand}\n  npm run dev\n` +
        'After installation succeeds and the server starts, open the URL it prints.');
    }
    if (error instanceof SetupCancelled) {
      io.write(`${error.message}${written ? '' : ' No blog files were written.'}`);
      return { cancelled: true, exitCode: error.exitCode };
    }
    throw error;
  } finally {
    io.close();
    if (staging) await fs.rm(staging, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

module.exports = { runSetup, parseSetupArguments };
