const { escapeHtml } = require('./markdown');

function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function cdata(value) {
  return `<![CDATA[${String(value).replaceAll(']]>', ']]]]><![CDATA[>')}]]>`;
}

function absoluteUrl(value, siteUrl) {
  return new URL(value, `${siteUrl}/`).toString();
}

function decodeHtmlAttribute(value) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

function absoluteHtml(html, baseUrl) {
  return html.replace(
    /\b(src|href|poster)="([^"]+)"/gi,
    (match, attribute, value) => {
      if (/^(?:data:|mailto:|tel:|#)/i.test(value)) return match;
      const url = new URL(decodeHtmlAttribute(value), baseUrl).toString();
      return `${attribute}="${escapeHtml(url)}"`;
    },
  );
}

function feedHtml(html) {
  return html.replace(
    /<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi,
    '',
  );
}

function renderItem(post, siteUrl) {
  const link = `${siteUrl}/${post.slug}/`;
  const featureImage = post.featureImage
    ? absoluteUrl(post.featureImage, siteUrl)
    : '';
  const featureMarkup = featureImage
    ? `<img src="${escapeHtml(featureImage)}" alt="${escapeHtml(post.featureImageAlt)}">`
    : '';
  const content = `${featureMarkup}${absoluteHtml(feedHtml(post.html), link)}`;
  const categories = post.tags
    .map(({ name }) => `<category>${cdata(name)}</category>`)
    .join('');

  return `<item>` +
    `<title>${cdata(post.title)}</title>` +
    `<description>${cdata(post.description)}</description>` +
    `<link>${xmlEscape(link)}</link>` +
    `<guid isPermaLink="false">${xmlEscape(link)}</guid>` +
    categories +
    `<dc:creator>${cdata(post.author)}</dc:creator>` +
    `<pubDate>${new Date(post.date).toUTCString()}</pubDate>` +
    (featureImage
      ? `<media:content url="${xmlEscape(featureImage)}" medium="image"/>`
      : '') +
    `<content:encoded>${cdata(content)}</content:encoded>` +
    `</item>`;
}

function renderRss({ posts, site, lastBuildDate }) {
  const {
    siteUrl,
    siteName: feedTitle,
    siteDescription: feedDescription,
    siteImage,
  } = site;
  const feedUrl = `${siteUrl}/rss/`;
  const items = posts.slice(0, 15).map((post) => renderItem(post, siteUrl)).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<rss xmlns:dc="http://purl.org/dc/elements/1.1/" ` +
    `xmlns:content="http://purl.org/rss/1.0/modules/content/" ` +
    `xmlns:atom="http://www.w3.org/2005/Atom" version="2.0" ` +
    `xmlns:media="http://search.yahoo.com/mrss/">` +
    `<channel>` +
    `<title>${cdata(feedTitle)}</title>` +
    `<description>${cdata(feedDescription)}</description>` +
    `<link>${xmlEscape(`${siteUrl}/`)}</link>` +
    (siteImage ? `<image><url>${xmlEscape(absoluteUrl(siteImage, siteUrl))}</url>` +
    `<title>${xmlEscape(feedTitle)}</title>` +
    `<link>${xmlEscape(`${siteUrl}/`)}</link></image>` : '') +
    `<generator>SiteSeed</generator>` +
    `<lastBuildDate>${new Date(lastBuildDate).toUTCString()}</lastBuildDate>` +
    `<atom:link href="${xmlEscape(feedUrl)}" rel="self" type="application/rss+xml"/>` +
    `<ttl>60</ttl>` +
    items +
    `</channel></rss>`;
}

module.exports = {
  renderRss,
};
