const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { fetchResource, httpUrl, slugify, normalizeDate, MAX_MEDIA_BYTES } = require('./import-source');
const { renderMarkdownDocument } = require('./markdown');
const { validateContent } = require('./content-validator');

const reservedImportSlugs = Object.freeze([
  'rss', 'con', 'prn', 'aux', 'nul',
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

const mediaTypes = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif',
  'image/webp': '.webp', 'image/avif': '.avif',
  'application/pdf': '.pdf', 'application/zip': '.zip',
  'audio/mpeg': '.mp3', 'audio/ogg': '.ogg', 'audio/wav': '.wav',
  'video/mp4': '.mp4', 'video/webm': '.webm',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
};

function assertDirectory(directory) {
  let stat;
  try { stat = fs.lstatSync(directory); }
  catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Import destination must be an ordinary directory: ${directory}`);
  }
}

function validatePreview(blog, preview) {
  if (preview?.version !== 1 || !['website', 'ghost'].includes(preview.kind) || !Array.isArray(preview.entries)) {
    throw new Error('Unsupported import preview. Create a new preview first.');
  }
  if (!Array.isArray(preview.failures)) throw new Error('Import preview must include failures.');
  assertDirectory(blog.contentDirectory);
  const occupied = new Set(reservedImportSlugs);
  for (const collection of ['posts', 'pages']) {
    const directory = path.join(blog.contentDirectory, collection);
    assertDirectory(directory);
    if (fs.existsSync(directory)) {
      for (const name of fs.readdirSync(directory)) occupied.add(name.toLowerCase());
    }
  }
  const selected = [];
  for (const entry of preview.entries) {
    if (typeof entry.selected !== 'boolean') throw new Error('Each entry must have boolean selected.');
    if (!entry.selected) continue;
    if (entry.error) throw new Error(`Cannot select a failed entry: ${entry.url}`);
    if (!['posts', 'pages'].includes(entry.collection) || typeof entry.slug !== 'string' ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.slug) || entry.slug.length > 100) {
      throw new Error(`Invalid collection or slug: ${entry.slug}`);
    }
    if (occupied.has(entry.slug)) throw new Error(`Destination conflict or reserved slug: ${entry.slug}`);
    occupied.add(entry.slug);
    for (const field of ['title', 'description', 'author', 'markdown']) {
      if (typeof entry[field] !== 'string' || !entry[field].trim()) {
        throw new Error(`${entry.slug}: supply ${field} in the preview before applying.`);
      }
    }
    if (!normalizeDate(entry.date) || new Date(entry.date) > new Date()) {
      throw new Error(`${entry.slug}: supply a valid, non-future publication date before applying.`);
    }
    if (entry.updated && !normalizeDate(entry.updated)) throw new Error(`${entry.slug}: invalid updated date.`);
    if (!Array.isArray(entry.tags) || entry.tags.some((tag) => typeof tag !== 'string' || !tag.trim())) {
      throw new Error(`${entry.slug}: tags must be names with usable slugs.`);
    }
    const tagSlugs = entry.tagSlugs ?? entry.tags.map(slugify);
    if (!Array.isArray(tagSlugs) || tagSlugs.length !== entry.tags.length ||
        tagSlugs.some((slug) => typeof slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))) {
      throw new Error(`${entry.slug}: tags must have matching usable slugs.`);
    }
    if (entry.importNotes !== undefined &&
        (!Array.isArray(entry.importNotes) || entry.importNotes.some((note) => typeof note !== 'string'))) {
      throw new Error(`${entry.slug}: invalid import notes.`);
    }
    if (!Array.isArray(entry.media) || entry.media.length > 500 ||
        entry.media.some((url) => typeof url !== 'string')) throw new Error(`${entry.slug}: invalid media list.`);
    for (const url of [entry.url, ...entry.media, ...(entry.featureImage ? [entry.featureImage] : [])]) httpUrl(url);
    if (entry.originalUrl) httpUrl(entry.originalUrl);
    if (!Array.isArray(entry.warnings) || entry.warnings.some((warning) => typeof warning !== 'string')) {
      throw new Error(`${entry.slug}: invalid warnings.`);
    }
    renderMarkdownDocument(entry.markdown);
    selected.push(entry);
  }
  if (!selected.length) throw new Error('No entries selected. Review the preview before applying.');
  return selected;
}

function replaceUrls(markdown, replacements) {
  const protectedCode = [];
  markdown = markdown.replace(
    /(^(`{3,})[^\n]*\n[\s\S]*?^\2[ \t]*$)|(`+)[^\n]*?\3/gm,
    (code) => {
      if (/^```bookmark\r?\n/.test(code)) return code;
      protectedCode.push(code);
      return `\u0000import-code-${protectedCode.length - 1}\u0000`;
    },
  );
  for (const [url, target] of [...replacements].sort(([a], [b]) => b.length - a.length)) {
    for (const spelling of new Set([url, url.replace(/[()]/g, '\\$&')])) {
      const escaped = spelling.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      markdown = markdown.replace(new RegExp(`${escaped}(?=[)#\\s"'<>]|$)`, 'g'), () => target);
    }
  }
  return markdown.replace(/\u0000import-code-(\d+)\u0000/g, (_, index) => protectedCode[Number(index)]);
}

function serializeEntry(entry, markdown, featureImage, draft) {
  const metadata = {
    title: entry.title, slug: entry.slug, description: entry.description,
    date: normalizeDate(entry.date), updated: normalizeDate(entry.updated || entry.date),
    author: entry.author, tags: entry.tags, tag_slugs: entry.tagSlugs ?? entry.tags.map(slugify),
    ...(featureImage ? { feature_image: featureImage, feature_image_alt: entry.featureImageAlt || entry.title } : {}),
    draft,
    ...(entry.importNotes?.length ? { import_notes: entry.importNotes } : {}),
  };
  return `---\n${Object.entries(metadata).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n')}\n---\n\n${markdown}\n`;
}

async function applyPreview(blog, preview, { signal, publish = false, log = console.log } = {}) {
  if (typeof publish !== 'boolean') throw new Error('Import publish option must be boolean.');
  signal?.throwIfAborted();
  const selected = validatePreview(blog, preview);
  const report = {
    version: 1, kind: preview.kind, source: preview.source, importedAt: new Date().toISOString(),
    imported: [], failures: [...preview.failures], warnings: [...(preview.warnings || [])],
  };
  const routeMap = new Map();
  for (const entry of selected) {
    signal?.throwIfAborted();
    for (const url of [entry.url, entry.originalUrl].filter(Boolean)) routeMap.set(url, `/${entry.slug}/`);
  }
  await fsp.mkdir(blog.contentDirectory, { recursive: true });
  const staging = await fsp.mkdtemp(path.join(blog.contentDirectory, '.siteseed-import-'));
  const ownedTargets = [];
  try {
    await fsp.copyFile(blog.configPath, path.join(staging, 'siteseed.config.json'));
    await fsp.mkdir(path.join(staging, 'public'));
    await fsp.writeFile(path.join(staging, 'public', 'search-index.json'), '[]\n');
    for (const entry of selected) {
      const directory = path.join(staging, 'content', entry.collection, entry.slug);
      await fsp.mkdir(directory, { recursive: true });
      const replacements = new Map(routeMap);
      let featureImage = '';
      for (const url of new Set([...entry.media, ...(entry.featureImage ? [entry.featureImage] : [])])) {
        let resource;
        let extension;
        try {
          resource = await fetchResource(url, { maxBytes: MAX_MEDIA_BYTES, signal });
          const type = resource.type.split(';')[0].trim().toLowerCase();
          extension = mediaTypes[type];
          if (!extension) throw new Error(`Unsupported media type "${type || 'missing'}"; left remote.`);
          if (!resource.bytes.length) throw new Error('Empty media response.');
          if (type.startsWith('image/')) await require('sharp')(resource.bytes).metadata();
          if (url === entry.featureImage && !type.startsWith('image/')) {
            throw new Error('Feature image did not return a supported image.');
          }
        } catch (error) {
          signal?.throwIfAborted();
          // Network/conversion failures are retained in the durable report, never hidden.
          report.failures.push({ url, slug: entry.slug, error: error.message });
          continue;
        }
        const filename = `media-${createHash('sha256').update(url).digest('hex').slice(0, 16)}${extension}`;
        await fsp.writeFile(path.join(directory, filename), resource.bytes, { flag: 'wx' });
        replacements.set(url, filename);
        if (url === entry.featureImage) featureImage = filename;
      }
      const markdown = replaceUrls(entry.markdown, replacements);
      await fsp.writeFile(path.join(directory, 'index.md'), serializeEntry(entry, markdown, featureImage, !publish), { flag: 'wx' });
      report.warnings.push(...entry.warnings.map((warning) => ({ slug: entry.slug, warning })));
      report.imported.push({
        url: entry.originalUrl || entry.url, destination: `/${entry.slug}/`, collection: entry.collection,
        slug: entry.slug, draft: !publish,
        ...(entry.adjustments?.length ? { adjustments: entry.adjustments } : {}),
      });
    }
    if (publish) {
      require('../scripts/build-search-index').buildSearchIndex(
        require('./site').createBlogContext({ rootDirectory: staging, env: {} }), { log },
      );
    }
    const validation = validateContent(staging);
    const errors = validation.filter((issue) => issue.severity === 'error');
    if (errors.length) throw new Error(`Imported content failed validation:\n${errors.map((issue) => `${issue.filePath}: ${issue.message}`).join('\n')}`);
    report.warnings.push(...validation.filter((issue) => issue.severity === 'warning'));
    // Recheck after downloads, then reserve each destination with non-recursive mkdir.
    validatePreview(blog, preview);
    for (const entry of selected) {
      signal?.throwIfAborted();
      const collection = path.join(blog.contentDirectory, entry.collection);
      await fsp.mkdir(collection, { recursive: true });
      assertDirectory(collection);
      const target = path.join(collection, entry.slug);
      await fsp.mkdir(target);
      ownedTargets.push(target);
      await fsp.cp(path.join(staging, 'content', entry.collection, entry.slug), target, {
        recursive: true, force: false, errorOnExist: true,
      });
    }
    const reportPath = path.join(blog.contentDirectory, `import-report-${path.basename(staging).slice('.siteseed-import-'.length)}.json`);
    signal?.throwIfAborted();
    await fsp.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    return { report, reportPath };
  } catch (error) {
    for (const target of ownedTargets) await fsp.rm(target, { recursive: true, force: true });
    throw error;
  } finally {
    await fsp.rm(staging, { recursive: true, force: true });
  }
}

module.exports = { applyPreview, validatePreview, replaceUrls, reservedImportSlugs };
