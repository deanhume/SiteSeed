const fs = require('node:fs/promises');
const path = require('node:path');
const { createBlogContext } = require('../src/site');
const { previewWebsite } = require('../src/import-source');
const { applyPreview } = require('../src/import-write');

const help = `Import an existing website or a Ghost export as reviewed drafts.

  siteseed import:website --source <website-or-sitemap-url> --output <preview.json> [--root <blog>]
  siteseed import:ghost --source <old-site-url> --export <export.json> --output <preview.json> [--root <blog>]
  siteseed import:website --apply <preview.json> [--root <blog>]
  siteseed import:ghost --apply <preview.json> [--root <blog>]

Preview does not write content or download media. Without --output it prints JSON.
Review selected, collection (posts/pages), slug, metadata, markdown and media URLs.
Set selected:false to exclude an entry. Missing dates must be supplied before applying.
Apply never overwrites content or settings. All imported content is draft.
Only import websites and exports you own or have permission to migrate.
`;

function parseImportArguments(args, kind) {
  const result = {};
  const allowed = new Set(['root', 'source', 'output', 'apply', ...(kind === 'ghost' ? ['export'] : [])]);
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].slice(2);
    if (!args[i].startsWith('--') || !allowed.has(key) || Object.hasOwn(result, key) ||
        !args[i + 1]?.trim() || args[i + 1].startsWith('--')) throw new Error(`Invalid import arguments.\n${help}`);
    result[key] = args[i + 1];
  }
  if (result.apply) {
    if (result.source || result.output || result.export) throw new Error('--apply cannot be combined with source/export/output.');
  } else if (!result.source || (kind === 'ghost' && !result.export)) {
    throw new Error(`A source URL${kind === 'ghost' ? ' and export path are' : ' is'} required.\n${help}`);
  }
  return result;
}

async function runImport(kind, args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) { console.log(help); return; }
  const options = parseImportArguments(args, kind);
  const blog = createBlogContext({ rootDirectory: options.root });
  if (options.apply) {
    const preview = JSON.parse(await fs.readFile(path.resolve(options.apply), 'utf8'));
    if (preview.kind !== kind) throw new Error(`Expected a ${kind} preview.`);
    const { report, reportPath } = await applyPreview(blog, preview);
    await require('./build-images').buildImages(blog);
    require('./build-search-index').buildSearchIndex(blog);
    console.log(`Imported ${report.imported.length} drafts. Report: ${reportPath}`);
    console.log(`Recorded ${report.failures.length} failures and ${report.warnings.length} warnings. Review before publishing.`);
    if (report.failures.length) process.exitCode = 1;
    return { report, reportPath };
  }
  if (options.output) {
    try {
      await fs.lstat(path.resolve(options.output));
      throw new Error(`Preview output already exists: ${options.output}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const preview = kind === 'website'
    ? await previewWebsite(blog, options.source)
    : await require('./import-ghost').createGhostImporter(blog, {
      source: options.source, exportPath: path.resolve(options.export),
    }).main();
  const json = JSON.stringify(preview, null, 2) + '\n';
  if (options.output) {
    await fs.writeFile(path.resolve(options.output), json, { flag: 'wx' });
    console.table(preview.entries.map(({ selected, collection, slug, title, date, warnings }) => ({
      selected, collection, slug, title, date: date || 'MISSING', warnings: warnings.length,
    })));
    console.log(`Preview: ${path.resolve(options.output)}. Edit it, then use --apply. No content has been imported.`);
    for (const warning of preview.warnings || []) console.warn(warning);
    for (const failure of preview.failures) console.error(`${failure.url || failure.slug}: ${failure.error}`);
  } else console.log(json);
  if (preview.failures.length || !preview.entries.length) process.exitCode = 1;
  return preview;
}

if (require.main === module) {
  runImport('website', process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { runImport, parseImportArguments };
