const fs = require('node:fs');
const path = require('node:path');
const { renderMarkdownDocument } = require('./markdown');

function parseValue(value) {
  const trimmed = value.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // Fall through for the simpler hand-written front matter format.
    }
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map((item) => item.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean);
  }
  return trimmed.replace(/^["']|["']$/g, '');
}

function parseFrontMatter(source, filePath) {
  // Some Windows editors add a UTF-8 BOM, which should not invalidate a post.
  const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    throw new Error(`Missing front matter in ${filePath}`);
  }

  const end = normalized.indexOf('\n---\n', 4);
  if (end === -1) {
    throw new Error(`Unclosed front matter in ${filePath}`);
  }

  const metadata = {};
  for (const line of normalized.slice(4, end).split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const separator = line.indexOf(':');
    if (separator === -1) {
      throw new Error(`Invalid front matter line in ${filePath}: ${line}`);
    }
    const key = line.slice(0, separator).trim();
    if (Object.hasOwn(metadata, key)) {
      throw new Error(`Duplicate front matter field in ${filePath}: ${key}`);
    }
    metadata[key] = parseValue(line.slice(separator + 1));
  }

  return {
    metadata,
    body: normalized.slice(end + 5).trim(),
  };
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function asIsoDate(value, fallback, field, filePath) {
  const date = new Date(value || fallback);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${field} in ${filePath}`);
  }
  return date.toISOString();
}

function readImageManifest(contentDirectory) {
  const manifestPath = path.join(contentDirectory, 'image-manifest.json');
  if (!fs.existsSync(manifestPath)) return {};
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function imageDetails(filename, type, entryName, assetBase, imageManifest) {
  if (!filename) {
    return {
      featureImage: '',
      featureImageSrcSet: '',
      featureImageWidth: null,
      featureImageHeight: null,
    };
  }

  const key = `${type}s/${entryName}/${filename}`.replaceAll('\\', '/');
  const image = imageManifest[key];
  const variants = image?.variants || [];
  const preferred = variants.at(-1);

  return {
    featureImage: `${assetBase}${preferred?.file || filename}`,
    featureImageSrcSet: variants
      .map(({ file, width }) => `${assetBase}${file} ${width}w`)
      .join(', '),
    featureImageWidth: preferred?.width || image?.width || null,
    featureImageHeight: preferred?.height || image?.height || null,
  };
}

function readCollection(
  collectionDirectory,
  type,
  imageManifest,
  { draftAssetBase = '', defaultAuthor = 'Author' } = {},
) {
  if (!fs.existsSync(collectionDirectory)) return [];

  return fs
    .readdirSync(collectionDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const filePath = path.join(collectionDirectory, entry.name, 'index.md');
      if (!fs.existsSync(filePath)) return null;

      const stats = fs.statSync(filePath);
      const { metadata, body } = parseFrontMatter(
        fs.readFileSync(filePath, 'utf8'),
        filePath,
      );
      const slug = metadata.slug || entry.name;

      if (!metadata.title) throw new Error(`Missing title in ${filePath}`);
      if (!/^[a-z0-9-]+$/.test(slug)) {
        throw new Error(`Invalid slug in ${filePath}: ${slug}`);
      }

      const tags = Array.isArray(metadata.tags)
        ? metadata.tags.map((name, index) => ({
            name,
            slug:
              (Array.isArray(metadata.tag_slugs) && metadata.tag_slugs[index]) ||
              slugify(name),
          }))
        : [];
      const date = asIsoDate(metadata.date, stats.birthtime, 'date', filePath);
      const updated = asIsoDate(metadata.updated, stats.mtime, 'updated', filePath);
      const draft = metadata.draft === true;
      const assetBase =
        draft && draftAssetBase
          ? `${draftAssetBase}${encodeURIComponent(entry.name)}/`
          : `/content/${type}s/${encodeURIComponent(entry.name)}/`;
      const featureImage = imageDetails(
        metadata.feature_image,
        type,
        entry.name,
        assetBase,
        imageManifest,
      );
      const cardImage = imageDetails(
        metadata.card_image || metadata.feature_image,
        type,
        entry.name,
        assetBase,
        imageManifest,
      );
      const document = renderMarkdownDocument(body, {
        assetBase,
        allowHtml: metadata.allow_html === true,
      });

      return {
        type,
        title: metadata.title,
        slug,
        description: metadata.description || '',
        author: metadata.author || defaultAuthor,
        date,
        updated,
        draft,
        tags,
        ...featureImage,
        featureImageAlt: metadata.feature_image_alt || metadata.title,
        cardImage: cardImage.featureImage,
        cardImageSrcSet: cardImage.featureImageSrcSet,
        cardImageWidth: cardImage.featureImageWidth,
        cardImageHeight: cardImage.featureImageHeight,
        cardImageAlt:
          metadata.card_image_alt ||
          metadata.feature_image_alt ||
          metadata.title,
        allowHtml: metadata.allow_html === true,
        html: document.html,
        headings: document.headings,
      };
    })
    .filter(Boolean);
}

function readTagMetadata(contentDirectory, imageManifest) {
  const tagsDirectory = path.join(contentDirectory, 'tags');
  if (!fs.existsSync(tagsDirectory)) return new Map();

  return new Map(
    fs
      .readdirSync(tagsDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const filePath = path.join(tagsDirectory, entry.name, 'index.json');
        if (!fs.existsSync(filePath)) return null;
        const metadata = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const assetBase = `/content/tags/${encodeURIComponent(entry.name)}/`;
        const localFeatureImage =
          metadata.featureImage && !/^https?:\/\//i.test(metadata.featureImage);
        const featureImage = localFeatureImage
          ? imageDetails(
              metadata.featureImage,
              'tag',
              entry.name,
              assetBase,
              imageManifest,
            )
          : {
              featureImage: metadata.featureImage || '',
              featureImageSrcSet: '',
              featureImageWidth: null,
              featureImageHeight: null,
            };
        return [
          metadata.slug || entry.name,
          {
            name: metadata.name,
            description: metadata.description || '',
            ...featureImage,
          },
        ];
      })
      .filter(Boolean),
  );
}

function loadSiteContent(
  contentDirectory,
  { includeDrafts = false, draftAssetBase = '', draftPageAssetBase = '', defaultAuthor = 'Author' } = {},
) {
  const imageManifest = readImageManifest(contentDirectory);
  const posts = readCollection(
    path.join(contentDirectory, 'posts'),
    'post',
    imageManifest,
    { draftAssetBase, defaultAuthor },
  )
    .filter(({ draft }) => includeDrafts || !draft)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  const pages = readCollection(
    path.join(contentDirectory, 'pages'),
    'page',
    imageManifest,
    { draftAssetBase: draftPageAssetBase, defaultAuthor },
  ).filter(({ draft }) => includeDrafts || !draft);
  const tagMetadata = readTagMetadata(contentDirectory, imageManifest);
  const tagMap = new Map();

  for (const post of posts) {
    for (const tag of post.tags) {
      const existing = tagMap.get(tag.slug);
      if (!existing || new Date(post.updated) > new Date(existing.updated)) {
        tagMap.set(tag.slug, {
          ...tag,
          ...tagMetadata.get(tag.slug),
          updated: post.updated,
        });
      }
    }
  }

  const dates = [...posts, ...pages].map(({ updated }) => new Date(updated).getTime());

  return {
    posts,
    pages,
    tags: [...tagMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    lastModified: new Date(dates.length ? Math.max(...dates) : Date.now()).toISOString(),
  };
}

module.exports = {
  loadSiteContent,
  parseFrontMatter,
};
