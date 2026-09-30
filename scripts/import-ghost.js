const fs = require('node:fs/promises');
const path = require('node:path');
const { createTurndown } = require('../src/import-markdown');
const { extractPage, httpUrl, normalizeDate } = require('../src/import-source');

function createGhostImporter(blog, { source = blog.site.siteUrl, exportPath = path.join(blog.rootDirectory, 'ghost-backup.json') } = {}) {
  const siteUrl = httpUrl(source).replace(/\/$/, '');
  const hostname = new URL(siteUrl).hostname.replace(/^www\./i, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const legacy = new RegExp(`(?:https?:\\/\\/(?:www\\.)?${hostname})?\\/Home\\/BlogPost\\/([^/"'<>\\s?#]+)\\/\\d+`, 'gi');

  function normalizeGhostHtml(html) {
    return html.replaceAll('__GHOST_URL__', siteUrl)
      .replace(legacy, `${siteUrl}/$1/`)
      .replace(/https:\/\/storage\.ghost\.io\/c\/(?:[^/"']+\/){3}(content\/(?:images|media)\/[^"'<>\s)]+)/gi, `${siteUrl}/$1`);
  }

  function isDownloadableUrl(value, attribute) {
    if (!value || value.startsWith('data:')) return false;
    return ['src', 'poster', 'srcset', 'style'].includes(attribute) ||
      /\.(?:avif|bmp|docx?|gif|ico|jpe?g|m4a|mov|mp3|mp4|ogg|pdf|png|pptx?|svg|webm|webp|wav|xlsx?|zip)(?:$|[?#])/i.test(value) ||
      new RegExp(`^(?:https?:\\/\\/(?:www\\.)?${hostname})?\\/content\\/`, 'i').test(value);
  }

  async function main() {
    let json;
    try { json = await fs.readFile(exportPath, 'utf8'); }
    catch (error) {
      if (error.code === 'ENOENT') throw new Error(`Ghost export not found: ${exportPath}`);
      throw error;
    }
    const data = JSON.parse(json).db?.[0]?.data;
    if (!data || !Array.isArray(data.posts)) throw new Error('Unsupported Ghost export structure.');
    const tags = new Map((data.tags || []).map((tag) => [tag.id, tag]));
    const authors = new Map((data.users || []).map((author) => [author.id, author]));
    const entries = [];
    const failures = [];
    for (const post of data.posts) {
      try {
        if (!['published', 'draft', 'scheduled'].includes(post.status)) {
          throw new Error(`Unsupported post status: ${post.status}`);
        }
        if (typeof post.html !== 'string' || !post.html.trim()) {
          throw new Error('No HTML body in export; editor-only records are not supported.');
        }
        if (typeof post.slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(post.slug)) {
          throw new Error(`Unsupported Ghost slug: ${post.slug}`);
        }
        const url = httpUrl(`${siteUrl}/${post.slug}/`);
        const entry = extractPage(normalizeGhostHtml(post.html), url, {
          defaultAuthor: blog.site.author.name, fragment: true,
        });
        const linkedAuthors = (data.posts_authors || [])
          .filter((link) => link.post_id === post.id).map((link) => authors.get(link.author_id)?.name).filter(Boolean);
        entry.title = post.title || entry.title;
        entry.slug = post.slug;
        entry.description = post.custom_excerpt || entry.description;
        entry.date = normalizeDate(post.published_at);
        entry.updated = normalizeDate(post.updated_at);
        entry.author = linkedAuthors.join(', ') || blog.site.author.name;
        entry.collection = post.type === 'page' ? 'pages' : 'posts';
        entry.tags = (data.posts_tags || []).filter((link) => link.post_id === post.id)
          .map((link) => tags.get(link.tag_id)).filter((tag) => tag && tag.visibility !== 'internal')
          .map((tag) => tag.name);
        entry.featureImage = post.feature_image ? httpUrl(normalizeGhostHtml(post.feature_image), url) : '';
        entry.featureImageAlt = post.feature_image_alt || entry.title;
        entry.warnings = entry.warnings.filter((warning) => !/^Missing (title|publication date|modification date|author)/.test(warning));
        if (!entry.date) entry.warnings.push('Missing publication date; supply date before applying.');
        if (!entry.updated) entry.warnings.push('Missing modification date; applying will use the reviewed publication date.');
        if (!linkedAuthors.length) entry.warnings.push('Missing author; using the configured blog author as a placeholder.');
        else if (linkedAuthors.length > 1) entry.warnings.push('Author profiles are not imported; review the combined byline.');
        if (post.status !== 'published') entry.warnings.push(`Source status is ${post.status}; imported content remains draft.`);
        entries.push(entry);
      } catch (error) {
        failures.push({ slug: post.slug, error: error.message });
      }
    }
    return {
      version: 1, kind: 'ghost', source: siteUrl, entries, failures,
      warnings: ['Site settings, navigation, tag artwork, and author profiles are not imported or overwritten.'],
    };
  }

  return { main, createTurndown, isDownloadableUrl, normalizeGhostHtml };
}

if (require.main === module) {
  require('./import-site').runImport('ghost', process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { createGhostImporter };
