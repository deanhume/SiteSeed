const path = require('node:path');
const compression = require('compression');
const express = require('express');
const { loadSiteContent } = require('./src/content');
const { renderRss } = require('./src/rss');
const { createBlogContext, themeAssets } = require('./src/site');
const { createTemplates } = require('./src/templates');

function createApp(options = {}) {
  const blog = createBlogContext(options);
  const { siteUrl, author, authorPath } = blog.site;
  const {
    renderArchive,
    renderErrorPage,
    renderHome,
    renderPost,
    renderPage,
    renderTag,
  } = createTemplates(blog);

  const app = express();
  const { contentDirectory } = blog;
  const contentOptions = { defaultAuthor: author.name };
  // A deployed commit is immutable, so parsing every Markdown file once is enough.
  // Development keeps reloading content so edits appear immediately on refresh.
  const productionContent = blog.production
    ? loadSiteContent(contentDirectory, contentOptions)
    : null;
  const productionPreviewContent = blog.production
    ? loadSiteContent(contentDirectory, {
        ...contentOptions,
        includeDrafts: true,
        draftAssetBase: '/preview-assets/posts/',
        draftPageAssetBase: '/preview-assets/pages/',
      })
    : null;
  const renderedHtmlCache = blog.production ? new Map() : null;
  const renderedHtmlCacheStats = { hits: 0, misses: 0 };

  app.disable('x-powered-by');
  app.enable('strict routing');
  app.use(compression());
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-cache');
    next();
  });
  app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send(`User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`);
  });
  const publicStaticOptions = {
    index: false,
    maxAge: '1h',
    setHeaders(res, filePath) {
      if (/\.(?:woff2?|otf)$/i.test(filePath)) {
        res.set('Cache-Control', 'public, max-age=86400');
      } else {
        res.set('Cache-Control', 'public, max-age=3600');
      }
    },
  };
  app.use(express.static(blog.publicDirectory, publicStaticOptions));
  const serveThemeAsset = express.static(blog.themeDirectory, publicStaticOptions);
  app.use((req, res, next) =>
    themeAssets.includes(req.path.slice(1)) ? serveThemeAsset(req, res, next) : next(),
  );
  const contentStaticOptions = {
    fallthrough: true,
    index: false,
    maxAge: '1d',
    setHeaders(res) {
      res.set('Cache-Control', 'public, max-age=86400');
    },
  };

  function previewContent() {
    return (
      productionPreviewContent ||
      loadSiteContent(contentDirectory, {
        ...contentOptions,
        includeDrafts: true,
        draftAssetBase: '/preview-assets/posts/',
        draftPageAssetBase: '/preview-assets/pages/',
      })
    );
  }

  function decodedRequestPath(req) {
    try {
      return decodeURIComponent(req.path);
    } catch (error) {
      if (error instanceof URIError) return '';
      throw error;
    }
  }

  function requestedContentSlug(req) {
    return decodedRequestPath(req).split('/').filter(Boolean)[0] || '';
  }

  function isMarkdownRequest(req) {
    return path.extname(decodedRequestPath(req)).toLowerCase() === '.md';
  }

  for (const collection of ['posts', 'pages']) {
    const servePublishedAsset = express.static(
      path.join(contentDirectory, collection), contentStaticOptions,
    );
    app.use(`/content/${collection}`, (req, res, next) => {
      const slug = requestedContentSlug(req);
      const published = content()[collection].some((item) => item.slug === slug);
      if (!published || isMarkdownRequest(req)) return next();
      return servePublishedAsset(req, res, next);
    });
    const serveDraftAsset = express.static(path.join(contentDirectory, collection), {
      fallthrough: true,
      index: false,
      setHeaders(res) {
        res.set('Cache-Control', 'private, no-store').set('X-Robots-Tag', 'noindex, nofollow');
      },
    });
    app.use(`/preview-assets/${collection}`, (req, res, next) => {
      const slug = requestedContentSlug(req);
      const draft = previewContent()[collection].some((item) => item.draft && item.slug === slug);
      if (!draft || isMarkdownRequest(req)) return next();
      res.set('Cache-Control', 'private, no-store').set('X-Robots-Tag', 'noindex, nofollow');
      return serveDraftAsset(req, res, next);
    });
  }
  app.use(
    '/content/tags',
    express.static(path.join(contentDirectory, 'tags'), contentStaticOptions),
  );
  app.use(
    '/content/authors',
    express.static(path.join(contentDirectory, 'authors'), contentStaticOptions),
  );

  function content() {
    return productionContent || loadSiteContent(contentDirectory, contentOptions);
  }

  function renderHtml(cacheKey, render) {
    if (!renderedHtmlCache) return render();
    if (renderedHtmlCache.has(cacheKey)) {
      renderedHtmlCacheStats.hits += 1;
      return renderedHtmlCache.get(cacheKey);
    }

    const html = render();
    renderedHtmlCache.set(cacheKey, html);
    renderedHtmlCacheStats.misses += 1;
    return html;
  }

  app.locals.renderedHtmlCacheStats = () => ({
    enabled: Boolean(renderedHtmlCache),
    entries: renderedHtmlCache?.size || 0,
    hits: renderedHtmlCacheStats.hits,
    misses: renderedHtmlCacheStats.misses,
  });

  function redirectPermanent(req, res, destination) {
    const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    res.redirect(301, `${destination}${query}`);
  }

  function redirectToTrailingSlash(req, res) {
    redirectPermanent(req, res, `${req.path}/`);
  }

  function redirectLegacyPagination(destination) {
    return (req, res, next) => {
      if (!/^[1-9]\d*$/.test(req.params.page)) return next();
      return redirectPermanent(req, res, destination);
    };
  }

  function xmlEscape(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&apos;');
  }

  function sendUrlSet(res, entries) {
    const urls = entries
      .map(
        ({ location, lastModified }) =>
          `<url><loc>${xmlEscape(location)}</loc><lastmod>${xmlEscape(lastModified)}</lastmod></url>`,
      )
      .join('');

    res.type('application/xml').send(
      `<?xml version="1.0" encoding="UTF-8"?>` +
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
    );
  }

  app.get('/', (req, res) => {
    const { posts } = content();
    res.send(
      renderHtml('home', () =>
        renderHome({
          posts: posts.slice(0, 5),
          postCount: posts.length,
          canonicalUrl: `${siteUrl}/`,
        }),
      ),
    );
  });

  app.get(
    ['/page/:page', '/page/:page/'],
    redirectLegacyPagination(authorPath),
  );

  app.get(authorPath.slice(0, -1), redirectToTrailingSlash);
  app.get(authorPath, (req, res) => {
    const { posts } = content();
    res.send(
      renderHtml(`archive:${author.slug}`, () =>
        renderArchive({
          title: author.name,
          description: author.bio,
          posts,
          canonicalUrl: `${siteUrl}${authorPath}`,
        }),
      ),
    );
  });

  app.get(
    [`${authorPath}page/:page`, `${authorPath}page/:page/`],
    redirectLegacyPagination(authorPath),
  );

  app.get(
    ['/tag/:tag/page/:page', '/tag/:tag/page/:page/'],
    (req, res, next) => {
      if (!/^[1-9]\d*$/.test(req.params.page)) return next();
      const tag = content().tags.find(({ slug }) => slug === req.params.tag);
      if (!tag) return next();
      return redirectPermanent(req, res, `/tag/${tag.slug}/`);
    },
  );

  app.get('/tag/:tag', redirectToTrailingSlash);
  app.get('/tag/:tag/', (req, res, next) => {
    const { posts, tags } = content();
    const tag = tags.find(({ slug }) => slug === req.params.tag);
    if (!tag) return next();

    return res.send(
      renderHtml(`tag:${tag.slug}`, () =>
        renderTag({
          tag,
          posts: posts.filter((post) =>
            post.tags.some(({ slug }) => slug === tag.slug),
          ),
          canonicalUrl: `${siteUrl}/tag/${tag.slug}/`,
        }),
      ),
    );
  });

  app.get('/sitemap.xml', (req, res) => {
    const lastModified = content().lastModified;
    const maps = ['pages', 'posts', 'authors', 'tags']
      .map(
        (name) =>
          `<sitemap><loc>${siteUrl}/sitemap-${name}.xml</loc><lastmod>${lastModified}</lastmod></sitemap>`,
      )
      .join('');

    res
      .type('application/xml')
      .send(
        `<?xml version="1.0" encoding="UTF-8"?>` +
          `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${maps}</sitemapindex>`,
      );
  });

  app.get('/sitemap-pages.xml', (req, res) => {
    const { pages, lastModified } = content();
    sendUrlSet(res, [
      { location: `${siteUrl}/`, lastModified },
      ...pages.map((page) => ({
        location: `${siteUrl}/${page.slug}/`,
        lastModified: page.updated,
      })),
    ]);
  });

  app.get('/sitemap-posts.xml', (req, res) => {
    sendUrlSet(
      res,
      content().posts.map((post) => ({
        location: `${siteUrl}/${post.slug}/`,
        lastModified: post.updated,
      })),
    );
  });

  app.get('/sitemap-authors.xml', (req, res) => {
    sendUrlSet(res, [
      {
        location: `${siteUrl}${authorPath}`,
        lastModified: content().lastModified,
      },
    ]);
  });

  app.get('/sitemap-tags.xml', (req, res) => {
    const { tags } = content();
    sendUrlSet(
      res,
      tags.map((tag) => ({
        location: `${siteUrl}/tag/${tag.slug}/`,
        lastModified: tag.updated,
      })),
    );
  });

  app.get('/rss', redirectToTrailingSlash);
  app.get('/rss/', (req, res) => {
    const { posts, lastModified } = content();
    res
      .set('Cache-Control', 'public, max-age=300')
      .type('application/rss+xml')
      .send(
        renderRss({
          posts,
          site: blog.site,
          lastBuildDate: lastModified,
        }),
      );
  });

  app.get('/preview/:slug', redirectToTrailingSlash);
  app.get('/preview/:slug/', (req, res, next) => {
    try {
      const preview = previewContent();
      const page = preview.pages.find(({ draft, slug }) => draft && slug === req.params.slug);
      if (page) {
        return res
          .set('Cache-Control', 'private, no-store')
          .set('X-Robots-Tag', 'noindex, nofollow')
          .send(renderPage(page, `${siteUrl}/preview/${page.slug}/`, { robots: 'noindex, nofollow' }));
      }
      const post = preview.posts.find(
        ({ draft, slug }) => draft && slug === req.params.slug,
      );
      if (!post) return next();
      const recentPosts = content()
        .posts.filter(({ slug }) => slug !== post.slug)
        .slice(0, 4);
      return res
        .set('Cache-Control', 'private, no-store')
        .set('X-Robots-Tag', 'noindex, nofollow')
        .send(
          renderPost(
            post,
            `${siteUrl}/preview/${post.slug}/`,
            recentPosts,
            { robots: 'noindex, nofollow' },
          ),
        );
    } catch (error) {
      return next(error);
    }
  });

  app.get('/:slug', redirectToTrailingSlash);
  app.get('/:slug/', (req, res, next) => {
    try {
      const { posts, pages } = content();
      const page = pages.find(({ slug }) => slug === req.params.slug);
      if (page) {
        return res.send(
          renderHtml(`page:${page.slug}`, () =>
            renderPage(page, `${siteUrl}/${page.slug}/`),
          ),
        );
      }
      const post = posts.find(({ slug }) => slug === req.params.slug);
      if (!post) {
        const normalizedSlug = req.params.slug.replace(/-+/g, '-').replace(/-$/, '');
        const redirectSlug =
          posts.find(({ slug }) => slug === normalizedSlug)?.slug;
        if (redirectSlug) return redirectPermanent(req, res, `/${redirectSlug}/`);
      }
      if (!post) return next();
      const recentPosts = posts
        .filter(({ slug }) => slug !== post.slug)
        .slice(0, 4);
      return res.send(
        renderHtml(`post:${post.slug}`, () =>
          renderPost(post, `${siteUrl}/${post.slug}/`, recentPosts),
        ),
      );
    } catch (error) {
      return next(error);
    }
  });

  app.use((req, res) => {
    res
      .status(404)
      .send(
        renderHtml('error:404', () =>
          renderErrorPage(
            404,
            'Page not found',
            'The page you requested does not exist or may have moved.',
          ),
        ),
      );
  });

  app.use((error, req, res, next) => {
    console.error(error);
    if (res.headersSent) return next(error);
    return res
      .status(500)
      .send(
        renderErrorPage(
          500,
          'Something went wrong',
          'The site could not complete your request. Please try again later.',
        ),
      );
  });

  return app;
}

if (require.main === module) {
  const port = process.env.PORT || 3000;
  createApp().listen(port, () => {
    console.log(`Blog listening on http://localhost:${port}`);
  });
}

module.exports = { createApp };
