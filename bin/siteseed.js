#!/usr/bin/env node
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createBlogContext } = require('../src/site');
const { parseRootArguments } = require('../src/command-line');

const commands = ['setup', 'create', 'start', 'dev', 'build', 'build:images', 'build:search', 'check', 'import:website', 'import:ghost'];
const help = `SiteSeed

Usage: siteseed <command> [--root <blog-directory>]

  setup         Set up a new blog interactively
  create <dir>  Set up a new blog in an empty directory
  start         Refresh search and start the blog
  dev           Build once and start with Node's code watcher
  build         Build responsive images and search
  build:images  Build responsive images
  build:search  Build the search index
  check         Build and validate blog content
  import:website Preview a website/sitemap, or apply reviewed drafts
  import:ghost   Preview a Ghost export, or apply reviewed drafts

Use siteseed import:website --help for import options.

Blog directory: --root, then SITESEED_ROOT, then the current directory.
Run setup or create first; other commands require siteseed.config.json.
`;

async function build(blog) {
  await require('../scripts/build-images').buildImages(blog);
  require('../scripts/build-search-index').buildSearchIndex(blog);
}

async function main(args = process.argv.slice(2)) {
  const [command, ...options] = args;
  if (!command || (['--help', '-h'].includes(command) && !options.length)) {
    console.log(help);
    return;
  }
  if (!commands.includes(command)) throw new Error(`Unknown command "${command}".\n${help}`);
  if (command === 'setup' || command === 'create') {
    const result = await require('../scripts/setup').runSetup(command, options);
    if (result?.exitCode) process.exitCode = result.exitCode;
    return;
  }
  if (command.startsWith('import:')) {
    return require('../scripts/import-site').runImport(command.slice('import:'.length), options);
  }
  const blog = createBlogContext({ rootDirectory: parseRootArguments(options) });

  switch (command) {
    case 'build':
      await build(blog);
      break;
    case 'build:images':
      await require('../scripts/build-images').buildImages(blog);
      break;
    case 'build:search':
      require('../scripts/build-search-index').buildSearchIndex(blog);
      break;
    case 'check':
      await build(blog);
      require('../scripts/check-content').checkContent(blog);
      break;
    case 'start': {
      require('../scripts/build-search-index').buildSearchIndex(blog);
      const port = process.env.PORT || 3000;
      const app = require('../app').createApp({ rootDirectory: blog.rootDirectory });
      const server = app.listen(port, () => {
        console.log(`Blog listening on http://localhost:${server.address().port}`);
      });
      server.on('error', (error) => {
        console.error(error.message);
        process.exitCode = 1;
      });
      break;
    }
    case 'dev': {
      await build(blog);
      const child = spawn(process.execPath, ['--watch', path.join(__dirname, '..', 'app.js')], {
        stdio: 'inherit',
        env: { ...process.env, SITESEED_ROOT: blog.rootDirectory },
      });
      const stop = () => child.kill();
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
      try {
        await new Promise((resolve, reject) => {
          child.once('error', reject);
          child.once('exit', (code, signal) => {
            if (code === 0 || signal === 'SIGINT' || signal === 'SIGTERM') resolve();
            else reject(new Error(`Development server exited with ${signal || `code ${code}`}.`));
          });
        });
      } finally {
        process.removeListener('SIGINT', stop);
        process.removeListener('SIGTERM', stop);
      }
      break;
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { main };
