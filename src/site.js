const fs = require('node:fs');
const path = require('node:path');

const themeDirectory = path.join(__dirname, '..', 'public');
const themeAssets = Object.freeze([
  'styles.css',
  'search.js',
  'navigation.js',
  'article.js',
  'jost.woff2',
  'inter-latin.woff2',
  'inter-latin-ext.woff2',
  'inter-italic-latin.woff2',
  'inter-italic-latin-ext.woff2',
  'INTER-LICENSE.txt',
]);

function blogDirectory(rootDirectory, env = process.env) {
  const root = rootDirectory ?? env.SITESEED_ROOT ?? process.cwd();
  if (typeof root !== 'string' || !root.trim()) {
    throw new Error('Blog directory must be a non-empty path.');
  }
  return path.resolve(root);
}

function createBlogContext({ rootDirectory, env = process.env } = {}) {
  const root = blogDirectory(rootDirectory, env);
  const configPath = path.join(root, 'siteseed.config.json');
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new Error(`Cannot read blog configuration ${configPath}: ${error.message}`, {
      cause: error,
    });
  }

  function invalid(field, message) {
    throw new Error(`${configPath}: ${field} ${message}`);
  }

  function object(value, field) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      invalid(field, 'must be an object.');
    }
    return value;
  }

  function string(value, field, fallback) {
    const result = value === undefined ? fallback : value;
    if (typeof result !== 'string' || !result.trim()) {
      invalid(field, 'must be a non-empty string.');
    }
    return result.trim();
  }

  function optionalString(value, field) {
    if (value === undefined) return '';
    if (typeof value !== 'string') invalid(field, 'must be a string.');
    return value.trim();
  }

  function assetUrl(value, field) {
    const result = optionalString(value, field);
    if (result && (!/^\/(?!\/)/.test(result) || /[\\\s<>"?#]/.test(result))) {
      invalid(field, 'must be a root-relative asset URL, such as /logo.svg.');
    }
    return result;
  }

  object(config, 'configuration');
  const siteName = string(config.title, 'title');
  const siteDescription = string(config.description, 'description');
  let origin;
  try {
    origin = new URL(string(env.SITE_URL ?? config.url, 'url', 'http://localhost:3000'));
  } catch {
    invalid('url', 'must be an absolute HTTP(S) origin.');
  }
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.username || origin.password || origin.search || origin.hash ||
    origin.pathname !== '/'
  ) {
    invalid('url', 'must be an HTTP(S) origin without credentials, a path, query, or fragment.');
  }
  const siteUrl = origin.origin;
  const authorConfig = object(config.author, 'author');
  const author = {
    ...authorConfig,
    name: string(authorConfig.name, 'author.name'),
    slug: string(authorConfig.slug, 'author.slug'),
    bio: optionalString(authorConfig.bio, 'author.bio'),
  };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(author.slug)) {
    invalid('author.slug', 'must contain lowercase letters, numbers, and single hyphens.');
  }
  const navigationConfig = config.navigation === undefined ? [
    { label: 'Home', url: '/' },
    { label: 'About', url: '/about/' },
  ] : config.navigation;
  if (!Array.isArray(navigationConfig)) invalid('navigation', 'must be an array.');
  const navigation = navigationConfig.map((entry, index) => {
    const field = `navigation[${index}]`;
    object(entry, field);
    const label = string(entry.label, `${field}.label`);
    const value = string(entry.url, `${field}.url`);
    if (!/^(?:\/(?!\/)|https?:\/\/)/i.test(value) || /[\\\s]/.test(value)) {
      invalid(`${field}.url`, 'must be a root-relative or absolute HTTP(S) URL.');
    }
    let url;
    try {
      url = new URL(value, siteUrl);
    } catch {
      invalid(`${field}.url`, 'must be a valid URL.');
    }
    if (url.username || url.password) invalid(`${field}.url`, 'must not contain credentials.');
    return { label, url: url.origin === siteUrl ? `${url.pathname}${url.search}${url.hash}` : url.href };
  });
  const locale = string(config.locale, 'locale', 'en-GB');
  const timezone = string(config.timezone, 'timezone', 'UTC');
  try {
    if (!Intl.DateTimeFormat.supportedLocalesOf([locale]).length) {
      invalid('locale', 'must name a supported locale.');
    }
    new Intl.DateTimeFormat(locale, { timeZone: timezone });
  } catch {
    invalid('locale/timezone', 'must name a supported locale and timezone.');
  }

  return {
    rootDirectory: root,
    configPath,
    config,
    contentDirectory: path.join(root, 'content'),
    publicDirectory: path.join(root, 'public'),
    themeDirectory,
    production: env.NODE_ENV === 'production',
    site: {
      siteName,
      siteDescription,
      siteUrl,
      siteLogo: assetUrl(config.logo, 'logo'),
      siteImage: assetUrl(config.image, 'image'),
      latestPostsTitle: string(config.latestPostsTitle, 'latestPostsTitle', 'Latest articles'),
      locale,
      timezone,
      navigation,
      author,
      authorPath: `/author/${author.slug}/`,
      googleAnalyticsId: optionalString(env.GA4_MEASUREMENT_ID, 'GA4_MEASUREMENT_ID'),
    },
  };
}

function publicAssetPath(blog, filename) {
  const normalized = filename.replace(/^\//, '');
  const local = path.resolve(blog.publicDirectory, normalized);
  const relative = path.relative(blog.publicDirectory, local);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error(`Public asset must stay inside the blog public directory: ${filename}`);
  }
  if (fs.existsSync(local)) return local;
  if (themeAssets.includes(normalized)) return path.join(themeDirectory, normalized);
  throw new Error(`Missing public asset in ${blog.publicDirectory}: ${filename}`);
}

module.exports = { blogDirectory, createBlogContext, publicAssetPath, themeAssets };
