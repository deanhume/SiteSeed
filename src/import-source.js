const domino = require('@mixmark-io/domino');
const sax = require('sax');
const { gunzipSync } = require('node:zlib');
const { createHash } = require('node:crypto');
const { createTurndown } = require('./import-markdown');

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const MAX_URLS = 5000;
const MAX_SITEMAPS = 100;
const mediaExtension = /\.(?:avif|gif|jpe?g|png|webp|pdf|mp3|mp4|ogg|wav|webm|zip|docx?|xlsx?|pptx?)(?:$|[?#])/i;

function httpUrl(value, base) {
  const url = new URL(value, base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error(`Expected an HTTP(S) URL without credentials: ${value}`);
  }
  url.hash = '';
  return url.href;
}

async function fetchResource(input, { origin, maxBytes = MAX_DOCUMENT_BYTES, signal: cancellationSignal } = {}) {
  let url = httpUrl(input);
  const timeout = AbortSignal.timeout(30000);
  const signal = cancellationSignal ? AbortSignal.any([cancellationSignal, timeout]) : timeout;
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (origin && new URL(url).origin !== origin) {
      throw new Error(`Refusing off-origin crawl: ${url}`);
    }
    const response = await fetch(url, {
      redirect: 'manual',
      signal,
      headers: { 'user-agent': 'SiteSeed-Importer/0.1', accept: '*/*' },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location) throw new Error(`Redirect without Location: ${url}`);
      url = httpUrl(location, url);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`HTTP ${response.status}: ${url}`);
    }
    if (Number(response.headers.get('content-length')) > maxBytes) {
      await response.body?.cancel();
      throw new Error(`Response exceeds ${maxBytes} bytes: ${url}`);
    }
    const chunks = [];
    let length = 0;
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > maxBytes) throw new Error(`Response exceeds ${maxBytes} bytes: ${url}`);
      chunks.push(chunk);
    }
    let bytes = Buffer.concat(chunks);
    // Fetch decodes Content-Encoding; .xml.gz files can also arrive as gzip bodies.
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      bytes = gunzipSync(bytes, { maxOutputLength: maxBytes });
    }
    return { url, bytes, type: response.headers.get('content-type') || '' };
  }
  throw new Error(`Too many redirects: ${input}`);
}

function parseSitemap(xml, base) {
  const parser = sax.parser(true, { xmlns: true });
  const stack = [];
  const records = [];
  let kind;
  let record;
  let rootNamespace;
  parser.ondoctype = () => { throw new Error('Sitemap doctypes are not supported.'); };
  parser.onopentag = (tag) => {
    stack.push(tag);
    if (stack.length === 1) {
      kind = tag.local;
      rootNamespace = tag.uri;
      if (!['urlset', 'sitemapindex'].includes(kind) ||
          !['', 'http://www.sitemaps.org/schemas/sitemap/0.9'].includes(rootNamespace)) {
        throw new Error('Expected a sitemap urlset or sitemapindex.');
      }
    }
    if (stack.length === 2 && tag.uri === rootNamespace &&
        tag.local === (kind === 'urlset' ? 'url' : 'sitemap')) record = {};
    if (record && stack.length === 3 && tag.uri === rootNamespace &&
        ['loc', 'lastmod'].includes(tag.local)) {
      if (Object.hasOwn(record, tag.local)) throw new Error(`Duplicate sitemap ${tag.local}.`);
      record[tag.local] = '';
    }
  };
  const text = (value) => {
    const tag = stack.at(-1);
    if (record && stack.length === 3 && tag.uri === rootNamespace &&
        ['loc', 'lastmod'].includes(tag.local)) record[tag.local] += value;
  };
  parser.ontext = text;
  parser.oncdata = text;
  parser.onclosetag = () => {
    if (stack.length === 2 && record) {
      if (!record.loc?.trim()) throw new Error('Sitemap entry is missing loc.');
      records.push({ url: httpUrl(record.loc.trim(), base), lastModified: record.lastmod?.trim() || '' });
      if (records.length > MAX_URLS) throw new Error(`Sitemap exceeds ${MAX_URLS} entries.`);
      record = null;
    }
    stack.pop();
  };
  parser.write(xml).close();
  if (!kind) throw new Error('Empty sitemap.');
  return { kind, records };
}

async function discoverPages(source, { signal } = {}) {
  signal?.throwIfAborted();
  const first = await fetchResource(source, { signal });
  const origin = new URL(first.url).origin;
  const failures = [];
  const maps = [];
  let xml = first.bytes.toString('utf8');
  if (/<(?:[\w-]+:)?(?:sitemapindex|urlset)\b/.test(xml)) {
    maps.push({ url: first.url, xml });
  } else {
    if (!/text\/html|application\/xhtml\+xml/i.test(first.type)) {
      throw new Error('Source is neither an HTML website nor an XML sitemap.');
    }
    try {
      const robots = await fetchResource(`${origin}/robots.txt`, { origin, signal });
      for (const match of robots.bytes.toString('utf8').matchAll(/^sitemap:\s*(\S+)/gim)) {
        maps.push({ url: httpUrl(match[1], origin) });
      }
    } catch (error) {
      signal?.throwIfAborted();
      failures.push({ url: `${origin}/robots.txt`, error: `${error.message}; trying /sitemap.xml.` });
    }
    if (!maps.length) maps.push({ url: `${origin}/sitemap.xml` });
  }
  const seenMaps = new Set();
  const pages = new Map();
  while (maps.length) {
    signal?.throwIfAborted();
    const map = maps.shift();
    if (seenMaps.has(map.url)) continue;
    if (seenMaps.size >= MAX_SITEMAPS) throw new Error(`Import exceeds ${MAX_SITEMAPS} sitemaps.`);
    seenMaps.add(map.url);
    try {
      if (new URL(map.url).origin !== origin) throw new Error(`Off-origin sitemap excluded: ${map.url}`);
      const resource = map.xml === undefined ? await fetchResource(map.url, { origin, signal }) : null;
      xml = resource ? resource.bytes.toString('utf8') : map.xml;
      const parsed = parseSitemap(xml, resource?.url || map.url);
      for (const record of parsed.records) {
        if (new URL(record.url).origin !== origin) {
          failures.push({ url: record.url, error: 'Off-origin URL excluded.' });
        } else if (parsed.kind === 'sitemapindex') {
          if (maps.length + seenMaps.size >= MAX_SITEMAPS && !seenMaps.has(record.url)) {
            throw new Error(`Import exceeds ${MAX_SITEMAPS} sitemap references.`);
          }
          if (!seenMaps.has(record.url)) maps.push(record);
        } else {
          if (!pages.has(record.url) && pages.size >= MAX_URLS) throw new Error(`Import exceeds ${MAX_URLS} pages.`);
          pages.set(record.url, record);
        }
      }
    } catch (error) {
      signal?.throwIfAborted();
      failures.push({ url: map.url, error: error.message });
    }
  }
  return { origin, records: [...pages.values()], failures };
}

function slugify(value) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100).replace(/-$/, '');
}

function sourceSlug(url) {
  const pathname = decodeURIComponent(new URL(url).pathname);
  return slugify(pathname.replace(/\.(?:html?|php)$/i, '')) ||
    `import-${createHash('sha256').update(url).digest('hex').slice(0, 12)}`;
}

function normalizeDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value.trim())) return '';
  value = value.trim();
  const day = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== value.slice(0, 10)) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function extractPage(html, url, { defaultAuthor = '', lastModified = '', fragment = false } = {}) {
  const document = domino.createDocument(fragment ? `<article>${html}</article>` : html);
  const warnings = [];
  const meta = (key) => Array.from(document.querySelectorAll('meta'))
    .find((node) => (node.getAttribute('property') || node.getAttribute('name') || '').toLowerCase() === key)
    ?.getAttribute('content')?.trim() || '';
  const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const structured = [];
  function visit(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 10) return;
    if (Array.isArray(value)) return value.forEach((child) => visit(child, depth + 1));
    const types = [].concat(value['@type'] || []);
    if (types.some((type) => ['Article', 'BlogPosting', 'NewsArticle'].includes(type))) structured.push(value);
    for (const key of ['@graph', 'mainEntity']) visit(value[key], depth + 1);
  }
  for (const node of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
    try { visit(JSON.parse(node.textContent)); }
    catch (error) { warnings.push(`Invalid structured metadata: ${error.message}`); }
  }
  const data = structured[0] || {};
  const articles = document.querySelectorAll('article');
  const root = articles.length === 1 ? articles[0] : document.querySelector('main, [role="main"]');
  if (!root) throw new Error('No unambiguous article or main content found; JavaScript is not executed.');
  if (articles.length > 1) warnings.push('Multiple articles found: likely an archive. Excluded by default.');
  else if (!articles.length) warnings.push('Used main content; check for navigation and other non-article text.');
  const title = cleanText(data.headline || meta('og:title') || root.querySelector('h1')?.textContent || document.title);
  const published = data.datePublished || meta('article:published_time') ||
    document.querySelector('[itemprop="datePublished"]')?.getAttribute('content') ||
    document.querySelector('time[itemprop="datePublished"], time[pubdate]')?.getAttribute('datetime');
  const fallbackTime = document.querySelector('time[datetime]')?.getAttribute('datetime');
  const date = normalizeDate(published || fallbackTime);
  if (!published && date) warnings.push('Publication date inferred from a time element; verify that it is not a modification date.');
  const updated = normalizeDate(data.dateModified || meta('article:modified_time') || lastModified);
  const authorData = Array.isArray(data.author) ? data.author : data.author ? [data.author] : [];
  if (authorData.length > 1) warnings.push('Multiple authors combined into one byline; author profiles are not imported.');
  const author = cleanText(authorData.map((item) => typeof item === 'string' ? item : item.name).filter(Boolean).join(', ') ||
    meta('author'));
  let description = cleanText(data.description || meta('description') || meta('og:description'));
  const imageData = Array.isArray(data.image) ? data.image[0] : data.image;
  const image = (typeof imageData === 'string' ? imageData : imageData?.url) || meta('og:image');
  const tags = [...new Set([
    ...Array.from(document.querySelectorAll('meta[property="article:tag"]'), (node) => node.getAttribute('content')),
    ...(Array.isArray(data.keywords) ? data.keywords : typeof data.keywords === 'string' ? data.keywords.split(',') : []),
  ].filter((value) => typeof value === 'string').map(cleanText).filter(Boolean))];
  let base = url;
  const baseHref = document.querySelector('base[href]')?.getAttribute('href');
  if (baseHref) base = httpUrl(baseHref, url);
  const media = new Set();
  for (const node of Array.from(root.querySelectorAll('script, style, noscript, nav, footer, form, aside, [role="navigation"]'))) {
    node.parentNode?.removeChild(node);
  }
  if (root.querySelector('iframe, video, audio, object, embed, svg, canvas')) {
    warnings.push('Embedded/interactive content needs review; supported media becomes links, unsupported elements are removed.');
  }
  for (const node of Array.from(root.querySelectorAll('object, embed, svg, canvas'))) node.parentNode?.removeChild(node);
  for (const node of Array.from(root.querySelectorAll('img'))) {
    const src = node.getAttribute('data-src') || node.getAttribute('data-lazy-src') || node.getAttribute('src') ||
      node.getAttribute('srcset')?.split(',')[0]?.trim().split(/\s+/)[0] ||
      node.parentNode.querySelector('source[srcset]')?.getAttribute('srcset')?.split(',')[0]?.trim().split(/\s+/)[0];
    if (src) node.setAttribute('src', src);
    else warnings.push('An image has no usable source URL.');
    node.removeAttribute('srcset');
  }
  for (const node of Array.from(root.querySelectorAll('[href], [src], [poster]'))) {
    for (const attribute of ['href', 'src', 'poster']) {
      const value = node.getAttribute(attribute);
      if (!value) continue;
      if (attribute === 'href' && /^(?:#|mailto:|tel:)/i.test(value)) continue;
      try {
        const target = httpUrl(value, base);
        const fragmentId = new URL(value, base).hash;
        node.setAttribute(attribute, target + fragmentId);
        if ((attribute !== 'href' && node.nodeName !== 'IFRAME') ||
            (attribute === 'href' && (mediaExtension.test(target) || node.hasAttribute('download')))) media.add(target);
      } catch (error) {
        warnings.push(`Removed unsupported ${attribute}: ${error.message}`);
        node.removeAttribute(attribute);
      }
    }
  }
  let featureImage = '';
  if (image) {
    try { featureImage = httpUrl(image, base); media.add(featureImage); }
    catch (error) { warnings.push(`Feature image: ${error.message}`); }
  }
  if (!description) {
    description = cleanText(root.querySelector('p')?.textContent).slice(0, 240);
    warnings.push('Description derived from the first paragraph; review it.');
  }
  const markdown = createTurndown().turndown(root.innerHTML).trim();
  if (!markdown) throw new Error('Extracted content is empty.');
  if (!title) warnings.push('Missing title; supply one before applying.');
  if (!date) warnings.push('Missing publication date; supply date before applying. Sitemap lastmod is not a publication date.');
  if (!updated) warnings.push('Missing modification date; applying will use the reviewed publication date.');
  if (!author) warnings.push('Missing author; using the configured blog author for review.');
  const archive = !fragment && (articles.length > 1 ||
    /^\/(?:$|(?:tag|tags|category|categories|author|authors|archive|archives|page)(?:\/|$))/i.test(new URL(url).pathname));
  if (archive && articles.length <= 1) warnings.push('Likely home/archive page; excluded by default.');
  return {
    url, selected: !archive, collection: 'posts', slug: sourceSlug(url),
    title, description, date, updated, author: author || defaultAuthor, tags,
    featureImage, featureImageAlt: meta('og:image:alt') || title,
    markdown, media: [...media], warnings,
  };
}

async function previewWebsite(blog, source, { signal } = {}) {
  const discovery = await discoverPages(httpUrl(source), { signal });
  if (!discovery.records.length && !discovery.failures.length) {
    discovery.failures.push({ url: source, error: 'No page URLs found in the sitemap.' });
  }
  const entries = [];
  const seen = new Set();
  for (const record of discovery.records) {
    signal?.throwIfAborted();
    try {
      const response = await fetchResource(record.url, { origin: discovery.origin, signal });
      if (!/text\/html|application\/xhtml\+xml/i.test(response.type)) throw new Error('URL did not return HTML.');
      if (seen.has(response.url)) {
        discovery.failures.push({ url: record.url, error: `Duplicate redirect destination: ${response.url}` });
        continue;
      }
      seen.add(response.url);
      const entry = extractPage(response.bytes.toString('utf8'), response.url, {
        defaultAuthor: blog.site.author.name, lastModified: record.lastModified,
      });
      entry.originalUrl = record.url;
      entry.warnings.push('Review posts/pages classification; website pages default to posts.');
      entries.push(entry);
    } catch (error) {
      signal?.throwIfAborted();
      discovery.failures.push({ url: record.url, error: error.message });
    }
  }
  return { version: 1, kind: 'website', source: httpUrl(source), entries, failures: discovery.failures };
}

module.exports = {
  httpUrl, fetchResource, parseSitemap, discoverPages, extractPage, previewWebsite,
  slugify, normalizeDate, MAX_MEDIA_BYTES,
};
