const crypto = require('node:crypto');
const fs = require('node:fs');
const { escapeHtml } = require('./markdown');
const { publicAssetPath } = require('./site');

function createTemplates(blog) {
  const {
    siteName,
    siteDescription,
    siteLogo,
    siteImage,
    navigation,
    author,
    authorPath,
    latestPostsTitle,
    locale,
    timezone,
    googleAnalyticsId,
  } = blog.site;
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: timezone,
  });
  const assetVersions = new Map();
  if (
    googleAnalyticsId &&
    !/^G-[A-Z0-9]+$/.test(googleAnalyticsId)
  ) {
    throw new Error(
      'GA4_MEASUREMENT_ID must be a valid Google Analytics measurement ID (G-...).',
    );
  }
  const currentYear = new Date().getUTCFullYear();

  function publicAsset(filename) {
    const normalized = filename.replace(/^\//, '');
    const cached = assetVersions.get(normalized);
    if (cached && blog.production) return cached.url;

    const filePath = publicAssetPath(blog, normalized);
    const stats = fs.statSync(filePath);
    if (
      cached &&
      cached.modified === stats.mtimeMs &&
      cached.size === stats.size
    ) {
      return cached.url;
    }

    const version = crypto
      .createHash('sha256')
      .update(fs.readFileSync(filePath))
      .digest('hex')
      .slice(0, 8);
    const asset = {
      modified: stats.mtimeMs,
      size: stats.size,
      url: `/${normalized}?v=${version}`,
    };
    assetVersions.set(normalized, asset);
    return asset.url;
  }

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

  function text(value) {
    return escapeHtml(decodeHtmlEntities(value));
  }

  function formatDate(value) {
    return dateFormatter.format(new Date(value));
  }

  function absoluteUrl(value, canonicalUrl) {
    if (!value || !canonicalUrl) return '';
    return new URL(value, canonicalUrl).toString();
  }

  function jsonLd(value) {
    return JSON.stringify(value)
      .replaceAll('&', '\\u0026')
      .replaceAll('<', '\\u003c')
      .replaceAll('>', '\\u003e');
  }

  function personSchema(canonicalUrl, name = author.name) {
    return {
      '@type': 'Person',
      name,
      url: absoluteUrl(authorPath, canonicalUrl),
    };
  }

  function layout({
    title,
    description = siteDescription,
    canonicalUrl,
    body,
    scripts = [],
    showLogo = true,
    robots = '',
    socialType = 'website',
    socialImage = '',
    socialImageAlt = '',
    twitterCard = '',
    articleMetadata = null,
    structuredData = null,
  }) {
    const pageTitle = title === siteName ? title : `${title} | ${siteName}`;
    const imageUrl = absoluteUrl(socialImage, canonicalUrl);
    const cardType = twitterCard || (imageUrl ? 'summary_large_image' : 'summary');
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${text(pageTitle)}</title>
  <meta name="description" content="${text(description)}">
  ${robots ? `<meta name="robots" content="${escapeHtml(robots)}">` : ''}
  ${canonicalUrl ? `<link rel="canonical" href="${escapeHtml(canonicalUrl)}">` : ''}
  <meta property="og:site_name" content="${text(siteName)}">
  <meta property="og:type" content="${escapeHtml(socialType)}">
  <meta property="og:title" content="${text(title)}">
  <meta property="og:description" content="${text(description)}">
  ${canonicalUrl ? `<meta property="og:url" content="${escapeHtml(canonicalUrl)}">` : ''}
  ${imageUrl ? `<meta property="og:image" content="${escapeHtml(imageUrl)}">` : ''}
  ${imageUrl && socialImageAlt ? `<meta property="og:image:alt" content="${text(socialImageAlt)}">` : ''}
  <meta name="twitter:card" content="${cardType}">
  <meta name="twitter:title" content="${text(title)}">
  <meta name="twitter:description" content="${text(description)}">
  ${imageUrl ? `<meta name="twitter:image" content="${escapeHtml(imageUrl)}">` : ''}
  ${imageUrl && socialImageAlt ? `<meta name="twitter:image:alt" content="${text(socialImageAlt)}">` : ''}
  ${
      articleMetadata
        ? `<meta property="article:published_time" content="${escapeHtml(articleMetadata.published)}">
  <meta property="article:modified_time" content="${escapeHtml(articleMetadata.modified)}">
  <meta property="article:author" content="${escapeHtml(articleMetadata.authorUrl)}">
  ${articleMetadata.tags
      .map((tag) => `<meta property="article:tag" content="${text(tag)}">`)
      .join('\n  ')}`
        : ''
    }
  ${structuredData ? `<script type="application/ld+json">${jsonLd(structuredData)}</script>` : ''}
  ${siteLogo ? `<link rel="icon" href="${text(siteLogo)}"${siteLogo.endsWith('.svg') ? ' type="image/svg+xml" sizes="any"' : ''}>` : ''}
  <link rel="alternate" type="application/rss+xml" title="${text(siteName)}" href="/rss/">
  <link rel="stylesheet" href="${publicAsset('styles.css')}">
  ${googleAnalyticsId ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${googleAnalyticsId}"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', '${googleAnalyticsId}');
  </script>` : ''}
</head>
<body>
  <header class="site-header${showLogo ? ' has-logo' : ''}">
    <div class="header-inner">
      ${showLogo ? `<a class="header-logo" href="/" aria-label="${text(siteName)} home">${text(siteName)}</a>` : ''}
      <nav id="site-navigation" aria-label="Main navigation">
        ${navigation.map(({ label, url }) => `<a href="${text(url)}">${text(label)}</a>`).join('\n        ')}
      </nav>
      <div class="header-actions">
        <button class="search-button" type="button" aria-label="Search this site" aria-controls="search-dialog" aria-expanded="false">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5"></circle>
            <path d="m16 16 4 4"></path>
          </svg>
        </button>
        <button class="menu-button" type="button" aria-label="Menu" aria-controls="site-navigation" aria-expanded="false">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16"></path>
          </svg>
        </button>
      </div>
    </div>
  </header>
  <dialog class="search-dialog" id="search-dialog" aria-labelledby="search-dialog-title">
    <div class="search-panel">
      <h2 class="visually-hidden" id="search-dialog-title">Search this site</h2>
      <div class="search-input-row">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5"></circle>
          <path d="m16 16 4 4"></path>
        </svg>
        <input id="search-input" type="search" placeholder="Search posts and tags" autocomplete="off" aria-label="Search posts and tags">
        <button class="search-close" type="button" aria-label="Close search">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18"></path>
          </svg>
        </button>
      </div>
      <div class="search-results" id="search-results" aria-live="polite"></div>
    </div>
  </dialog>
  <main>${body}</main>
  <footer class="site-footer">
    <div class="footer-meta">
      <nav aria-label="Footer">
        <a href="${authorPath}">Browse all articles</a>
        ${navigation.filter(({ url }) => url !== '/').map(({ label, url }) => `<a href="${text(url)}">${text(label)}</a>`).join('\n        ')}
        <a href="/rss/">RSS</a>
      </nav>
      <span>&copy; ${currentYear} ${text(siteName)}</span>
    </div>
    <a class="footer-wordmark" href="/" aria-label="${text(siteName)} home">${text(siteName)}</a>
  </footer>
  <script src="${publicAsset('search.js')}" defer></script>
  <script src="${publicAsset('navigation.js')}" defer></script>
  ${scripts.map((script) => `<script src="${publicAsset(script)}" defer></script>`).join('\n  ')}
</body>
</html>`;
  }

  function articleList(posts) {
    if (!posts.length) return '<p>No articles have been published here yet.</p>';
    return `<div class="post-list">${posts
      .map(
        (post) => `<article class="post-card">
  <p class="eyebrow">${formatDate(post.date)}</p>
  <h2><a href="/${escapeHtml(post.slug)}/">${text(post.title)}</a></h2>
  ${post.description ? `<p>${text(post.description)}</p>` : ''}
</article>`,
      )
      .join('')}</div>`;
  }

  function readingTime(html) {
    const words = html.replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean);
    return Math.max(1, Math.ceil(words.length / 220));
  }

  function imageAttributes(
    post,
    {
      loading = 'lazy',
      fetchPriority = '',
      sizes = '(max-width: 640px) calc(100vw - 3rem), 800px',
      source = 'feature',
    } = {},
  ) {
    const image =
      source === 'card' && post.cardImage
        ? {
            url: post.cardImage,
            srcSet: post.cardImageSrcSet,
            width: post.cardImageWidth,
            height: post.cardImageHeight,
          }
        : {
            url: post.featureImage,
            srcSet: post.featureImageSrcSet,
            width: post.featureImageWidth,
            height: post.featureImageHeight,
          };

    return [
      `src="${escapeHtml(image.url)}"`,
      image.srcSet ? `srcset="${escapeHtml(image.srcSet)}"` : '',
      image.srcSet ? `sizes="${escapeHtml(sizes)}"` : '',
      image.width ? `width="${image.width}"` : '',
      image.height ? `height="${image.height}"` : '',
      `loading="${loading}"`,
      fetchPriority ? `fetchpriority="${fetchPriority}"` : '',
      loading === 'lazy' ? 'decoding="async"' : '',
    ]
      .filter(Boolean)
      .join(' ');
  }

  function placeholderGradient(slug) {
    let hash = 0;
    for (const character of slug) {
      hash = (hash * 31 + character.codePointAt(0)) >>> 0;
    }

    const startHue = hash % 360;
    const endHue = (startHue + 45 + ((hash >>> 8) % 90)) % 360;
    return `--gradient-start:hsl(${startHue} 78% 62%);--gradient-end:hsl(${endHue} 72% 48%)`;
  }

  function renderHomePostList(posts, { prioritizeFirst = false } = {}) {
    if (!posts.length) return '<p>No articles have been published here yet.</p>';

    return `<div class="home-post-list">${posts
      .map(
        (post, index) => `<article class="home-post-card">
  <a class="home-post-image-link" href="/${escapeHtml(post.slug)}/">
    ${
        post.cardImage || post.featureImage
          ? `<img class="home-post-image" ${imageAttributes(post, {
              loading: prioritizeFirst && index === 0 ? 'eager' : 'lazy',
              fetchPriority: prioritizeFirst && index === 0 ? 'high' : '',
              sizes:
                '(max-width: 640px) calc(100vw - 3rem), (max-width: 1248px) 60vw, 720px',
              source: 'card',
            })} alt="${text(post.cardImageAlt || post.featureImageAlt)}">`
          : `<span class="home-post-image home-post-placeholder" style="${placeholderGradient(post.slug)}" aria-hidden="true"></span>`
      }
  </a>
  <div class="home-post-content">
    <a class="home-post-content-link" href="/${escapeHtml(post.slug)}/">
      ${
          post.tags.length
            ? `<p class="home-post-tag">${text(post.tags[0].name)}</p>`
            : ''
        }
      <h2>${text(post.title)}</h2>
      ${post.description ? `<p class="home-post-excerpt">${text(post.description)}</p>` : ''}
    </a>
    <footer class="home-post-meta">
      <time datetime="${escapeHtml(post.date)}">${formatDate(post.date)}</time>
      <span>${readingTime(post.html)} min read</span>
    </footer>
  </div>
</article>`,
      )
      .join('')}</div>`;
  }

  function renderArchive({ title, description, posts, canonicalUrl }) {
    return layout({
      title,
      description,
      canonicalUrl,
      structuredData: {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: title,
        description,
        url: canonicalUrl,
      },
      body: `<div class="content-width"><header class="page-heading"><h1>${text(title)}</h1><p>${text(description)}</p></header>${articleList(posts)}</div>`,
    });
  }

  function renderHome({
    posts,
    postCount = posts.length,
    canonicalUrl,
  }) {
    const description = siteDescription;
    return layout({
      title: siteName,
      description,
      canonicalUrl,
      socialImage: siteImage,
      socialImageAlt: siteName,
      twitterCard: 'summary',
      structuredData: {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: siteName,
        description,
        url: canonicalUrl,
        author: personSchema(canonicalUrl),
      },
      showLogo: false,
      body: `<section class="site-header-content outer left-aligned no-content">
  <div class="site-header-inner inner">
    ${siteLogo ? `<img class="site-logo" src="${text(siteLogo)}" alt="${text(siteName)}" width="150" height="150">` : ''}
    <h1 class="home-title">${text(siteName)}</h1>
    <p class="site-description">${text(description)}</p>
    <div class="latest-work-header">
      <h2 class="latest-work-title">${text(latestPostsTitle)}</h2>
      <div class="latest-work-actions">
        <a href="${authorPath}">Browse all ${postCount} articles</a>
        <a href="/rss/">RSS</a>
      </div>
    </div>
  </div>
</section>
<div class="content-width home-posts">
  ${renderHomePostList(posts, { prioritizeFirst: true })}
</div>`,
    });
  }

  function renderReadMore(posts) {
    if (!posts.length) return '';

    return `<section class="read-more" aria-labelledby="read-more-heading">
  <h2 id="read-more-heading">READ MORE</h2>
  ${renderPostCardGrid(posts, 'read-more-grid')}
</section>`;
  }

  function renderPostCardGrid(posts, className) {
    return `<div class="${className}">
    ${posts
        .map(
          (post) => `<article class="read-more-card">
      <a class="read-more-image" href="/${escapeHtml(post.slug)}/">
        ${
            post.cardImage || post.featureImage
              ? `<img ${imageAttributes(post, {
                  sizes:
                    '(max-width: 640px) calc(100vw - 3rem), (max-width: 960px) 50vw, 33vw',
                  source: 'card',
                })} alt="${text(post.cardImageAlt || post.featureImageAlt)}">`
              : `<span class="read-more-placeholder" style="${placeholderGradient(post.slug)}" aria-hidden="true"></span>`
          }
      </a>
      <p class="eyebrow">${formatDate(post.date)}</p>
      <h3><a href="/${escapeHtml(post.slug)}/">${text(post.title)}</a></h3>
      ${post.description ? `<p>${text(post.description)}</p>` : ''}
    </article>`,
        )
        .join('')}
  </div>`;
  }

  function renderTag({ tag, posts, canonicalUrl }) {
    const description = tag.description || `Articles tagged ${tag.name}.`;
    const descriptionHtml = description
      .split(/\n\s*\n/)
      .filter(Boolean)
      .map((paragraph) => `<p>${text(paragraph)}</p>`)
      .join('');

    return layout({
      title: tag.name,
      description,
      canonicalUrl,
      socialImage: tag.featureImage,
      socialImageAlt: tag.name,
      structuredData: {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: tag.name,
        description,
        url: canonicalUrl,
        image: absoluteUrl(tag.featureImage, canonicalUrl) || undefined,
      },
      body: `<section class="tag-header">
  <div class="tag-header-copy">
    <h1>${text(tag.name)}</h1>
    <div class="tag-description">${descriptionHtml}</div>
  </div>
  ${
      tag.featureImage
        ? `<figure class="tag-feature-image"><img ${imageAttributes(tag, {
            loading: 'eager',
            fetchPriority: 'high',
            sizes: '(max-width: 960px) calc(100vw - 3rem), 50vw',
          })} alt="${text(tag.name)}"></figure>`
        : ''
    }
</section>
<section class="tag-posts" aria-label="${text(tag.name)} posts">
  ${renderPostCardGrid(posts, 'tag-post-grid')}
</section>`,
    });
  }

  function renderTableOfContents(headings = []) {
    if (headings.length < 2) return '';

    return `<nav class="table-of-contents" aria-labelledby="table-of-contents-heading">
  <h2 id="table-of-contents-heading">On this page</h2>
  <ol>
    ${headings
        .map(
          ({ level, id, label }) =>
            `<li class="toc-level-${level}"><a href="#${escapeHtml(id)}">${text(label)}</a></li>`,
        )
        .join('\n    ')}
  </ol>
</nav>`;
  }

  function renderArticleUtilities(canonicalUrl) {
    return `<footer class="article-utilities" aria-label="Article utilities">
  <p class="article-utilities-label">Enjoyed this article?</p>
  <div class="article-utility-actions">
    <button type="button" data-copy-article-link data-article-url="${text(canonicalUrl)}">Copy link</button>
    <button type="button" data-share-article data-article-url="${text(canonicalUrl)}" hidden>Share</button>
    <a href="#article-top">Back to top <span aria-hidden="true">↑</span></a>
  </div>
  <p class="article-utility-status" data-article-utility-status aria-live="polite"></p>
</footer>`;
  }

  function renderPost(
    post,
    canonicalUrl,
    recentPosts = [],
    { robots = '' } = {},
  ) {
    const description = post.description || siteDescription;
    const imageUrl = absoluteUrl(post.featureImage, canonicalUrl);
    const author = personSchema(canonicalUrl, post.author);
    const tags = post.tags.map(({ name }) => name);
    return layout({
      title: post.title,
      description,
      canonicalUrl,
      robots,
      socialType: 'article',
      socialImage: post.featureImage,
      socialImageAlt: post.featureImageAlt,
      articleMetadata: {
        published: post.date,
        modified: post.updated || post.date,
        authorUrl: author.url,
        tags,
      },
      structuredData: {
        '@context': 'https://schema.org',
        '@type': 'BlogPosting',
        headline: post.title,
        description,
        url: canonicalUrl,
        mainEntityOfPage: {
          '@type': 'WebPage',
          '@id': canonicalUrl,
        },
        image: imageUrl ? [imageUrl] : undefined,
        datePublished: post.date,
        dateModified: post.updated || post.date,
        author,
        publisher: {
          '@type': 'Organization',
          name: siteName,
          url: absoluteUrl('/', canonicalUrl),
          logo: siteImage ? {
            '@type': 'ImageObject',
            url: absoluteUrl(siteImage, canonicalUrl),
          } : undefined,
        },
        keywords: tags,
      },
      showLogo: true,
      body: `<div class="reading-progress" aria-hidden="true"><span data-reading-progress-bar></span></div>
<div class="content-width"><article class="prose" id="article-top" data-reading-progress>
  <header class="article-heading">
    <p class="eyebrow">${formatDate(post.date)} · ${text(post.author)}</p>
    <h1>${text(post.title)}</h1>
  </header>
  ${
      post.featureImage
        ? `<img class="feature-image" ${imageAttributes(post, {
            loading: 'eager',
            fetchPriority: 'high',
            sizes: '(max-width: 760px) calc(100vw - 3rem), 760px',
          })} alt="${text(post.featureImageAlt)}">`
        : ''
    }
  ${renderTableOfContents(post.headings)}
  ${post.html}
  ${renderArticleUtilities(canonicalUrl)}
</article></div>
${renderReadMore(recentPosts)}`,
      scripts: ['/article.js'],
    });
  }

  function renderPage(page, canonicalUrl, { robots = '' } = {}) {
    const description = page.description || siteDescription;
    return layout({
      title: page.title,
      description,
      canonicalUrl,
      robots,
      socialImage: page.featureImage,
      socialImageAlt: page.featureImageAlt,
      structuredData: {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: page.title,
        description,
        url: canonicalUrl,
        image: absoluteUrl(page.featureImage, canonicalUrl) || undefined,
      },
      body: `<div class="content-width"><article class="prose"><header class="article-heading"><h1>${text(page.title)}</h1></header>${page.html}</article></div>`,
    });
  }

  function renderErrorPage(status, title, message) {
    return layout({
      title,
      body: `<div class="content-width"><section class="error-page"><p class="error-code">${status}</p><h1>${text(title)}</h1><p>${text(message)}</p><p><a href="/">Return home</a></p></section></div>`,
    });
  }

  return {
    renderArchive,
    renderErrorPage,
    renderHome,
    renderPage,
    renderPost,
    renderTag,
  };
}

module.exports = { createTemplates };
