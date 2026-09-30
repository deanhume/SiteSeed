const fs = require('node:fs');
const path = require('node:path');
const { loadSiteContent } = require('../src/content');
const { createBlogContext } = require('../src/site');
const { parseRootArguments } = require('../src/command-line');

function decodeHtmlEntities(value) {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&#(\d+);/g, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 10)),
    )
    .replaceAll('&apos;', "'")
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function plainText(html) {
  return decodeHtmlEntities(html)
    .replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi, ' ')
    .replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildSearchIndex(blog, { log = console.log } = {}) {
  const { rootDirectory, contentDirectory, publicDirectory } = blog;
  const outputPath = path.join(publicDirectory, 'search-index.json');
  const { posts } = loadSiteContent(contentDirectory, {
    defaultAuthor: blog.site.author.name,
  });
  const index = posts.map((post) => ({
    title: decodeHtmlEntities(post.title),
    slug: post.slug,
    description: decodeHtmlEntities(post.description),
    text: plainText(post.html).slice(0, 1500),
    date: post.date,
    tags: post.tags,
  }));

  fs.mkdirSync(publicDirectory, { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(index)}\n`);
  log(`Wrote ${index.length} posts to ${path.relative(rootDirectory, outputPath)}`);
}

if (require.main === module) {
  try {
    buildSearchIndex(createBlogContext({
      rootDirectory: parseRootArguments(process.argv.slice(2)),
    }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { buildSearchIndex };
