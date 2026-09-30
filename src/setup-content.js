const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { slugify, normalizeDate } = require('./import-source');
const { reservedImportSlugs } = require('./import-write');
const engine = require('../package.json');

function prepareSetupImport(blog, preview, now = new Date()) {
  if (!preview.entries.length) {
    throw new Error('No importable content was found. No blog was created. Check the source or choose starter content.');
  }
  const occupied = new Set(reservedImportSlugs);
  const importedAt = now.toISOString();
  const entries = preview.entries.map((source) => {
    const entry = {
      ...source, selected: true, warnings: [...source.warnings],
      importNotes: source.warnings.filter((warning) =>
        /^(Missing author|Description derived|Publication date inferred)/.test(warning)),
      adjustments: [],
    };
    function adjust(field, replacement, reason) {
      entry.adjustments.push({ field, original: entry[field] ?? null, replacement, reason });
      entry[field] = replacement;
      entry.importNotes.push(reason);
      entry.warnings.push(reason);
    }
    const base = slugify(entry.slug || entry.title || '') || 'imported-post';
    let slug = base;
    for (let suffix = 2; occupied.has(slug); suffix++) {
      const ending = `-${suffix}`;
      slug = base.slice(0, 100 - ending.length).replace(/-$/, '') + ending;
    }
    occupied.add(slug);
    if (slug !== entry.slug) adjust('slug', slug, `Import renamed the slug to "${slug}" to keep a safe, unique destination.`);
    if (!entry.title?.trim()) adjust('title', `Imported content: ${slug}`, 'Placeholder title: replace it before deploying.');
    if (!entry.description?.trim()) adjust('description', `Imported content from ${entry.url}.`, 'Placeholder description: replace it before deploying.');
    if (!entry.author?.trim()) adjust('author', blog.site.author.name, 'Placeholder author: using the configured blog author; verify before deploying.');
    const date = normalizeDate(entry.date);
    if (!date || new Date(date) > now) {
      adjust('date', importedAt, 'Placeholder publication date: using the import time, not the original publication date. Correct it before deploying.');
    }
    if (!normalizeDate(entry.updated)) {
      adjust('updated', entry.date, 'Placeholder modification date: using the publication date. Verify before deploying.');
    }
    if (!['posts', 'pages'].includes(entry.collection)) {
      adjust('collection', 'posts', 'Placeholder content type: imported as a post; verify before deploying.');
    }
    const tags = (entry.tags || []).filter((tag) => typeof tag === 'string' && tag.trim());
    if (tags.length !== entry.tags?.length) adjust('tags', tags, 'Import removed empty or invalid tag names; original values are recorded in the report.');
    const tagSlugs = tags.map((tag) => slugify(tag) ||
      `tag-${createHash('sha256').update(tag).digest('hex').slice(0, 12)}`);
    if (tags.some((tag) => !slugify(tag))) {
      adjust('tagSlugs', tagSlugs, 'Import generated safe tag slugs while preserving the original tag names.');
    }
    if (!source.selected) {
      const note = 'Setup kept this item even though extraction marked it as a possible home/archive page. Delete it later if unwanted.';
      entry.importNotes.push(note);
      entry.warnings.push(note);
    }
    return entry;
  });
  return { ...preview, entries };
}

function projectManifest(title, destination, engineDirectory) {
  const relativeEngine = path.relative(destination, engineDirectory).split(path.sep).join('/');
  return {
    name: `${slugify(title) || 'my'}-blog`,
    version: '1.0.0',
    private: true,
    scripts: {
      setup: 'siteseed setup --root .',
      start: 'siteseed start',
      dev: 'siteseed dev',
      build: 'siteseed build',
      'build:images': 'siteseed build:images',
      'build:search': 'siteseed build:search',
      check: 'siteseed check',
      'check:content': 'siteseed check',
      'import:website': 'siteseed import:website',
      'import:ghost': 'siteseed import:ghost',
    },
    engines: engine.engines,
    dependencies: {
      siteseed: engine.private ? `file:${relativeEngine}` : engine.version,
    },
  };
}

async function writeStarter(blog, now = new Date()) {
  const date = now.toISOString().slice(0, 10);
  const metadata = {
    description: 'Getting started with your new blog.',
    date, updated: date, author: blog.site.author.name, tags: [], tag_slugs: [], draft: false,
  };
  async function write(collection, slug, fields, body) {
    const directory = path.join(blog.contentDirectory, collection, slug);
    await fs.mkdir(directory, { recursive: true });
    const frontMatter = { ...metadata, title: fields.title, slug, ...fields };
    await fs.writeFile(path.join(directory, 'index.md'),
      `---\n${Object.entries(frontMatter).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n')}\n---\n\n${body}\n`,
      { flag: 'wx' });
    return directory;
  }
  await write('posts', 'welcome', { title: `Welcome to ${blog.site.siteName}` },
    'Your blog is ready. Replace this welcome post with your own introduction.\n\n' +
    '## Write your next post\n\n' +
    'Each post lives in its own folder under `content/posts`, with an `index.md` file and any images beside it. ' +
    'Start with the example draft and preview it at `/preview/example-draft/`.\n\n' +
    '## Publish when ready\n\n' +
    'Change `draft: true` to `draft: false`, then run `npm run check`. ' +
    'Refresh your local homepage to see the published post. Deploy separately when you are ready to share your blog.');
  const draftDirectory = await write('posts', 'example-draft', {
    title: 'Your next post',
    description: 'An example draft showing Markdown, images, and tables.',
    tags: ['Writing'], tag_slugs: ['writing'], draft: true,
    feature_image: 'example.svg', feature_image_alt: 'A simple green seed illustration.',
  }, 'This is a draft. Edit this file and refresh its preview to see your changes.\n\n' +
    '## Tell your story\n\n' +
    'Write paragraphs with **bold**, *emphasis*, and `inline code`.\n\n' +
    '- Keep images beside this Markdown file.\n- Give each image useful alternative text.\n\n' +
    '![A simple green seed illustration](example.svg)\n\n' +
    '## Add a table\n\n| Step | What to do |\n| --- | --- |\n| Write | Edit index.md |\n| Check | Run npm run check |\n' +
    '| Publish | Set draft to false |\n\n' +
    '> Draft previews are not password-protected. Do not put confidential content in a draft.');
  await fs.writeFile(path.join(draftDirectory, 'example.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">' +
    '<rect width="960" height="540" fill="#e8f3e8"/><path d="M480 410V230" stroke="#24583b" stroke-width="16"/>' +
    '<ellipse cx="420" cy="240" rx="90" ry="45" transform="rotate(30 420 240)" fill="#4e9562"/>' +
    '<ellipse cx="540" cy="180" rx="90" ry="45" transform="rotate(-30 540 180)" fill="#6bb77b"/></svg>\n',
    { flag: 'wx' });
  await write('pages', 'about', {
    title: 'About', description: `About ${blog.site.siteName}.`,
  }, 'Welcome to my blog. Replace this text with a short introduction: who you are, ' +
    'what you write about, and why readers might want to follow along.');
}

module.exports = { projectManifest, writeStarter, prepareSetupImport };
