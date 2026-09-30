const fs = require('node:fs');
const path = require('node:path');
const { loadSiteContent, parseFrontMatter } = require('./content');
const { createTemplates } = require('./templates');
const { createBlogContext } = require('./site');
const { renderMarkdownDocument } = require('./markdown');

const assetExtensions =
  /\.(?:avif|docx?|gif|html?|jpe?g|m4a|mov|mp3|mp4|ogg|pdf|png|pptx?|svg|txt|wav|webm|webp|xlsx?|zip)$/i;

function addIssue(issues, severity, filePath, message) {
  issues.push({ severity, filePath, message });
}

function validDate(value) {
  return value && !Number.isNaN(new Date(value).getTime());
}

function localTarget(target) {
  const withoutTitle = target.trim().split(/\s+["']/)[0];
  if (
    !withoutTitle ||
    withoutTitle.startsWith('/') ||
    withoutTitle.startsWith('#') ||
    withoutTitle.startsWith('//') ||
    /^[a-z][a-z0-9+.-]*:/i.test(withoutTitle)
  ) {
    return null;
  }

  const clean = withoutTitle.split(/[?#]/)[0].replace(/^\.\//, '');
  try {
    return decodeURIComponent(clean);
  } catch {
    return clean;
  }
}

function validateLocalAsset(target, directory, relativeFile, issues) {
  const resolved = path.resolve(directory, target);
  const directoryPrefix = `${path.resolve(directory)}${path.sep}`;
  if (resolved !== path.resolve(directory) && !resolved.startsWith(directoryPrefix)) {
    addIssue(
      issues,
      'error',
      relativeFile,
      `Local asset escapes its post folder: ${target}`,
    );
    return;
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    addIssue(issues, 'error', relativeFile, `Missing local asset: ${target}`);
  }
}

function validateLocalAssets(body, directory, relativeFile, issues, options) {
  const links = body.matchAll(/(!?)\[([^\]]*)\]\(([^)]+)\)/g);

  for (const match of links) {
    const isImage = match[1] === '!';
    const alt = match[2].trim();
    const target = localTarget(match[3]);
    if (!target || (!isImage && !assetExtensions.test(target))) continue;

    validateLocalAsset(target, directory, relativeFile, issues);
    if (isImage && !alt) {
      addIssue(issues, 'warning', relativeFile, `Image has no alt text: ${target}`);
    }
  }
  let document;
  try {
    document = renderMarkdownDocument(body, options);
  } catch (error) {
    addIssue(issues, 'error', relativeFile, error.message);
    return;
  }
  for (const bookmark of document.bookmarks) {
    for (const field of ['icon', 'thumbnail']) {
      const target = localTarget(bookmark[field] || '');
      if (target) validateLocalAsset(target, directory, relativeFile, issues);
    }
  }
}

function validateContent(rootDirectory, { now = new Date(), blog } = {}) {
  const contentDirectory = path.join(rootDirectory, 'content');
  const issues = [];
  const slugs = new Map();

  for (const type of ['posts', 'pages']) {
    const collectionDirectory = path.join(contentDirectory, type);
    if (!fs.existsSync(collectionDirectory)) continue;

    const directories = fs
      .readdirSync(collectionDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory());

    for (const entry of directories) {
      const filePath = path.join(collectionDirectory, entry.name, 'index.md');
      const relativeFile = path.relative(rootDirectory, filePath);
      if (!fs.existsSync(filePath)) {
        addIssue(
          issues,
          'warning',
          relativeFile,
          'Folder has no index.md and will not be published',
        );
        continue;
      }

      let parsed;
      try {
        parsed = parseFrontMatter(fs.readFileSync(filePath, 'utf8'), filePath);
      } catch (error) {
        addIssue(issues, 'error', relativeFile, error.message);
        continue;
      }

      const { metadata, body } = parsed;
      const slug = metadata.slug || entry.name;
      const requiredFields =
        type === 'posts'
          ? ['title', 'description', 'date', 'updated']
          : ['title'];

      for (const field of requiredFields) {
        if (!metadata[field]) {
          addIssue(issues, 'error', relativeFile, `Missing ${field} front matter`);
        }
      }

      if (!/^[a-z0-9-]+$/.test(slug)) {
        addIssue(issues, 'error', relativeFile, `Invalid slug: ${slug}`);
      }
      if (slug !== entry.name) {
        addIssue(
          issues,
          'error',
          relativeFile,
          `Slug "${slug}" does not match folder "${entry.name}"`,
        );
      }
      if (slugs.has(slug)) {
        addIssue(
          issues,
          'error',
          relativeFile,
          `Duplicate slug also used by ${slugs.get(slug)}`,
        );
      } else {
        slugs.set(slug, relativeFile);
      }

      for (const field of ['date', 'updated']) {
        if (metadata[field] && !validDate(metadata[field])) {
          addIssue(issues, 'error', relativeFile, `Invalid ${field}: ${metadata[field]}`);
        }
      }
      if (
        type === 'posts' &&
        validDate(metadata.date) &&
        new Date(metadata.date).getTime() > now.getTime()
      ) {
        addIssue(issues, 'error', relativeFile, `Publication date is in the future`);
      }
      if (type === 'posts' && typeof metadata.draft !== 'boolean') {
        addIssue(issues, 'error', relativeFile, 'draft must be true or false');
      }
      if (
        metadata.allow_html !== undefined &&
        typeof metadata.allow_html !== 'boolean'
      ) {
        addIssue(issues, 'error', relativeFile, 'allow_html must be true or false');
      }

      const tags = metadata.tags || [];
      const tagSlugs = metadata.tag_slugs || [];
      if (!Array.isArray(tags) || !Array.isArray(tagSlugs)) {
        addIssue(issues, 'error', relativeFile, 'tags and tag_slugs must be arrays');
      } else if (tags.length !== tagSlugs.length) {
        addIssue(
          issues,
          'error',
          relativeFile,
          'tags and tag_slugs must contain the same number of entries',
        );
      }

      if (!body.trim()) {
        addIssue(issues, 'error', relativeFile, 'Post body is empty');
      }
      if ((body.match(/^```/gm) || []).length % 2 !== 0) {
        addIssue(issues, 'error', relativeFile, 'Code fence is not closed');
      }
      if (/^#{1,6}\s*$/m.test(body)) {
        addIssue(issues, 'error', relativeFile, 'Heading has no text');
      }

      for (const [field, altField, label] of [
        ['feature_image', 'feature_image_alt', 'Feature image'],
        ['card_image', 'card_image_alt', 'Card image'],
      ]) {
        if (!metadata[field]) continue;
        const entryDirectory = path.resolve(collectionDirectory, entry.name);
        const image = path.resolve(entryDirectory, metadata[field]);
        const entryPrefix = `${entryDirectory}${path.sep}`;
        if (
          path.isAbsolute(metadata[field]) ||
          (image !== entryDirectory && !image.startsWith(entryPrefix))
        ) {
          addIssue(
            issues,
            'error',
            relativeFile,
            `${field} must stay inside the post folder`,
          );
        } else if (!fs.existsSync(image) || !fs.statSync(image).isFile()) {
          addIssue(
            issues,
            'error',
            relativeFile,
            `Missing ${label.toLowerCase()}: ${metadata[field]}`,
          );
        }
        if (!metadata[altField]) {
          addIssue(issues, 'warning', relativeFile, `${label} has no alt text`);
        }
      }

      validateLocalAssets(
        body,
        path.join(collectionDirectory, entry.name),
        relativeFile,
        issues,
        { allowHtml: metadata.allow_html === true },
      );

    }
  }

  if (!issues.some(({ severity }) => severity === 'error')) {
    try {
      const context = blog || createBlogContext({ rootDirectory });
      const { siteUrl } = context.site;
      const { renderHome, renderPage, renderPost, renderTag } = createTemplates(context);
      const site = loadSiteContent(contentDirectory, {
        defaultAuthor: context.site.author.name,
      });
      renderHome({ posts: site.posts, canonicalUrl: `${siteUrl}/` });
      site.pages.forEach((page) =>
        renderPage(page, `${siteUrl}/${page.slug}/`),
      );
      site.posts.forEach((post) =>
        renderPost(post, `${siteUrl}/${post.slug}/`, []),
      );
      site.tags.forEach((tag) =>
        renderTag({
          tag,
          posts: site.posts.filter((post) =>
            post.tags.some(({ slug }) => slug === tag.slug),
          ),
          canonicalUrl: `${siteUrl}/tag/${tag.slug}/`,
        }),
      );

      const searchPath = path.join(rootDirectory, 'public', 'search-index.json');
      const searchPosts = JSON.parse(fs.readFileSync(searchPath, 'utf8'));
      const searchSlugs = new Set(searchPosts.map(({ slug }) => slug));
      for (const post of site.posts) {
        if (!searchSlugs.has(post.slug)) {
          addIssue(
            issues,
            'error',
            path.relative(rootDirectory, searchPath),
            `Published post missing from search index: ${post.slug}`,
          );
        }
      }
      if (searchSlugs.size !== site.posts.length) {
        addIssue(
          issues,
          'error',
          path.relative(rootDirectory, searchPath),
          `Search index has ${searchSlugs.size} entries but ${site.posts.length} posts are published`,
        );
      }
    } catch (error) {
      addIssue(issues, 'error', 'content', `Site rendering failed: ${error.message}`);
    }
  }

  return issues;
}

module.exports = {
  validateContent,
};
