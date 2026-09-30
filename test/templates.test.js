const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { createBlogContext } = require('../src/site');
const { createTemplates } = require('../src/templates');
const fixtureRoot = path.join(__dirname, 'fixtures', 'blog');
const blog = createBlogContext({ rootDirectory: fixtureRoot, env: {} });
const {
  renderArchive,
  renderHome,
  renderPost,
  renderTag,
} = createTemplates(blog);

test('renders decoded metadata without a post standfirst', () => {
  const html = renderPost(
    {
      title: 'Example',
      description: "I&#x27;ve written a description.",
      author: 'Alex Example',
      date: '2026-09-15',
      updated: '2026-09-16',
      tags: [{ name: 'Technical Leadership', slug: 'leadership' }],
      featureImage: '/content/posts/example/hero.jpg',
      featureImageAlt: 'Example hero',
      html: '<p>Article body.</p>',
    },
    'https://example.com/example/',
  );

  assert.match(
    html,
    /<meta name="description" content="I&#39;ve written a description\.">/,
  );
  assert.doesNotMatch(html, /I&amp;#x27;ve/);
  assert.doesNotMatch(html, /standfirst/);
  assert.doesNotMatch(html, /#Technical Leadership|class="tags"/);
  assert.match(html, /<meta property="og:type" content="article">/);
  assert.match(
    html,
    /<meta property="og:image" content="https:\/\/example\.com\/content\/posts\/example\/hero\.jpg">/,
  );
  assert.match(
    html,
    /<meta name="twitter:card" content="summary_large_image">/,
  );
  assert.match(
    html,
    /<meta name="twitter:image:alt" content="Example hero">/,
  );
  assert.match(
    html,
    /<meta property="article:modified_time" content="2026-09-16">/,
  );
  assert.match(
    html,
    /<meta property="article:tag" content="Technical Leadership">/,
  );
  const structuredData = JSON.parse(
    html.match(
      /<script type="application\/ld\+json">([^<]+)<\/script>/,
    )[1],
  );
  assert.equal(structuredData['@type'], 'BlogPosting');
  assert.equal(structuredData.headline, 'Example');
  assert.equal(structuredData.datePublished, '2026-09-15');
  assert.equal(structuredData.dateModified, '2026-09-16');
  assert.deepEqual(structuredData.keywords, ['Technical Leadership']);
  assert.deepEqual(structuredData.image, [
    'https://example.com/content/posts/example/hero.jpg',
  ]);
  assert.equal(
    structuredData.author.url,
    'https://example.com/author/alex/',
  );
  assert.match(
    html,
    /<button class="search-button" type="button" aria-label="Search this site"/,
  );
  assert.match(html, /<dialog class="search-dialog" id="search-dialog"/);
  assert.match(
    html,
    /<link rel="alternate" type="application\/rss\+xml" title="Example Blog" href="\/rss\/">/,
  );
  assert.match(
    html,
    /<link rel="icon" href="\/example-logo\.svg" type="image\/svg\+xml" sizes="any">/,
  );
  assert.doesNotMatch(html, /googletagmanager|gtag\(/);
  assert.match(html, /<title>Example \| Example Blog<\/title>/);
  assert.match(html, /<meta property="og:site_name" content="Example Blog">/);
  assert.doesNotMatch(html, /@example|name="twitter:site"/);
  assert.equal(structuredData.author.name, 'Alex Example');
  assert.equal(structuredData.publisher.name, 'Example Blog');
  assert.equal(structuredData.publisher['@type'], 'Organization');
  assert.match(html, /<script src="\/search\.js\?v=[a-f0-9]{8}" defer><\/script>/);
  assert.match(
    html,
    /<script src="\/navigation\.js\?v=[a-f0-9]{8}" defer><\/script>/,
  );
  assert.match(
    html,
    /<nav id="site-navigation" aria-label="Main navigation">/,
  );
  assert.match(
    html,
    /<button class="menu-button" type="button" aria-label="Menu" aria-controls="site-navigation" aria-expanded="false">/,
  );
  assert.doesNotMatch(html, /class="site-title"/);
  assert.doesNotMatch(html, /footer-wordmark/);
  assert.match(
    html,
    /<nav aria-label="Footer">\s*<a href="\/author\/alex\/">Browse all articles<\/a>\s*<a href="\/about\/">About<\/a>\s*<a href="\/tag\/guides\/">Guides<\/a>\s*<a href="\/rss\/">RSS<\/a>\s*<\/nav>/,
  );
  assert.match(
    html,
    new RegExp(`&copy; ${new Date().getUTCFullYear()} Example Blog`),
  );
  assert.match(
    html,
    /<a class="header-logo" href="\/" aria-label="Example Blog home">Example Blog<\/a>/,
  );
  assert.match(html, /<header class="site-header has-logo">/);
});

test('does not render post tags in archive cards', () => {
  const html = renderArchive({
    title: 'Articles',
    description: 'All articles.',
    posts: [
      {
        title: 'Tagged post',
        slug: 'tagged-post',
        description: 'Post description.',
        date: '2026-09-15',
        tags: [{ name: 'Game Development', slug: 'game-development' }],
      },
    ],
    canonicalUrl: 'https://example.com/author/alex/',
  });

  assert.doesNotMatch(html, /#Game Development|class="tags"/);
});

test('safely serializes structured metadata', () => {
  const html = renderPost(
    {
      title: 'Example </script><script>alert("metadata")</script>',
      description: 'A description with "quotes" & markup.',
      author: 'Alex Example',
      date: '2026-09-15',
      updated: '2026-09-16',
      tags: [],
      featureImage: '',
      featureImageAlt: '',
      html: '<p>Article body.</p>',
    },
    'https://example.com/safe-metadata/',
  );
  const serialized = html.match(
    /<script type="application\/ld\+json">([^<]+)<\/script>/,
  )[1];

  assert.match(serialized, /\\u003c\/script\\u003e/);
  assert.equal(
    JSON.parse(serialized).headline,
    'Example </script><script>alert("metadata")</script>',
  );
});

test('renders recent posts with their feature images', () => {
  const html = renderPost(
    {
      title: 'Current post',
      description: '',
      author: 'Alex Example',
      date: '2026-09-15',
      tags: [],
      featureImage: '',
      html: '<p>Article body.</p>',
    },
    'https://example.com/current-post/',
    Array.from({ length: 4 }, (_, index) => ({
      title: `Recent post ${index + 1}`,
      slug: `recent-post-${index + 1}`,
      description: `Description ${index + 1}`,
      date: `2026-09-${14 - index}`,
      featureImage: `/content/posts/recent-post-${index + 1}/hero.jpg`,
      featureImageAlt: `Recent image ${index + 1}`,
    })),
  );

  assert.match(html, /<h2 id="read-more-heading">READ MORE<\/h2>/);
  assert.equal((html.match(/class="read-more-card"/g) || []).length, 4);
  assert.equal((html.match(/class="read-more-image"/g) || []).length, 4);
  assert.match(
    html,
    /src="\/content\/posts\/recent-post-1\/hero\.jpg"/,
  );
});

test('renders article navigation and reading progress for headed posts', () => {
  const html = renderPost(
    {
      title: 'Structured post',
      description: '',
      author: 'Alex Example',
      date: '2026-09-15',
      tags: [],
      featureImage: '',
      headings: [
        { level: 2, id: 'first-section', label: 'First section' },
        { level: 3, id: 'details', label: 'Details' },
      ],
      html:
        '<h2 id="first-section">First section</h2><h3 id="details">Details</h3>',
    },
    'https://example.com/structured-post/',
  );

  assert.match(html, /class="reading-progress"/);
  assert.match(
    html,
    /<article class="prose" id="article-top" data-reading-progress>/,
  );
  assert.match(html, /aria-labelledby="table-of-contents-heading"/);
  assert.match(html, /class="toc-level-3"><a href="#details">Details<\/a>/);
  assert.match(
    html,
    /<footer class="article-utilities" aria-label="Article utilities">/,
  );
  assert.match(
    html,
    /data-copy-article-link data-article-url="https:\/\/example\.com\/structured-post\/">Copy link/,
  );
  assert.match(html, /data-share-article[^>]+hidden>Share<\/button>/);
  assert.match(html, /<a href="#article-top">Back to top/);
  assert.match(html, /data-article-utility-status aria-live="polite"/);
  assert.match(
    html,
    /<script src="\/article\.js\?v=[a-f0-9]{8}" defer><\/script>/,
  );
});

test('renders the configured homepage introduction and logo', () => {
  const html = renderHome({
    posts: [
      {
        title: 'A recent article',
        slug: 'a-recent-article',
        description: 'A recent article description.',
        date: '2026-09-15',
        tags: [{ name: 'Leadership', slug: 'leadership' }],
        featureImage: '/content/posts/a-recent-article/hero.jpg',
        featureImageAlt: 'Article hero',
        cardImage: '/content/posts/a-recent-article/card.svg',
        cardImageAlt: 'Article card',
        html: '<p>Article body.</p>',
      },
    ],
    postCount: 210,
    canonicalUrl: 'https://example.com/',
  });

  assert.match(
    html,
    /class="site-header-content outer left-aligned no-content"/,
  );
  assert.match(html, /src="\/example-logo\.svg"/);
  assert.match(html, /<h1 class="home-title">Example Blog<\/h1>/);
  assert.match(
    html,
    /Notes on writing and learning\./,
  );
  assert.match(html, /Latest articles/);
  assert.match(html, /<title>Example Blog<\/title>/);
  assert.match(html, /href="\/author\/alex\/">Browse all 210 articles<\/a>/);
  assert.match(html, /href="\/rss\/">RSS<\/a>/);
  assert.match(html, /<meta property="og:type" content="website">/);
  assert.match(html, /<meta name="twitter:card" content="summary">/);
  assert.match(
    html,
    /<meta property="og:image" content="https:\/\/example\.com\/example-logo\.png">/,
  );
  assert.match(html, /"@type":"WebSite"/);
  assert.match(html, /class="home-post-card"/);
  assert.match(
    html,
    /class="home-post-image" src="\/content\/posts\/a-recent-article\/card\.svg"/,
  );
  assert.doesNotMatch(html, /card\.svg" srcset=/);
  assert.match(html, /loading="eager"/);
  assert.match(html, /fetchpriority="high"/);
  assert.match(html, /Leadership/);
  assert.match(html, /1 min read/);
  assert.doesNotMatch(html, /class="header-logo"/);
});

test('shows five homepage posts with a link to the full archive', () => {
  const posts = Array.from({ length: 7 }, (_, index) => ({
    title: `Article ${index + 1}`,
    slug: `article-${index + 1}`,
    description: `Description ${index + 1}.`,
    date: `2026-09-${String(15 - index).padStart(2, '0')}`,
    tags: [],
    featureImage: '',
    featureImageAlt: '',
    html: '<p>Article body.</p>',
  }));
  const html = renderHome({
    posts: posts.slice(0, 5),
    postCount: posts.length,
    canonicalUrl: 'https://example.com/',
  });

  assert.equal((html.match(/class="home-post-card"/g) || []).length, 5);
  assert.equal(
    (
      html.match(
        /class="home-post-image home-post-placeholder" style="--gradient-start:/g,
      ) || []
    ).length,
    5,
  );
  assert.match(html, /<a href="\/author\/alex\/">Browse all 7 articles<\/a>/);
  assert.doesNotMatch(html, /see-all-label|remaining-posts|posts-fragment/);
  assert.doesNotMatch(html, /home-posts\.js/);
});

test('renders a tag header and post card grid', () => {
  const html = renderTag({
    tag: {
      name: 'Technical Leadership',
      description: 'What does it mean to be a technical leader?',
      featureImage: '/content/tags/leadership/leadership.jpg',
    },
    posts: [
      {
        title: 'Leadership post',
        slug: 'leadership-post',
        description: 'Post description.',
        date: '2026-09-15',
        featureImage: '/content/posts/leadership-post/hero.jpg',
        featureImageAlt: 'Leadership post',
      },
    ],
    canonicalUrl: 'https://example.com/tag/leadership/',
  });

  assert.match(html, /class="tag-header"/);
  assert.match(html, /What does it mean to be a technical leader\?/);
  assert.match(html, /src="\/content\/tags\/leadership\/leadership\.jpg"/);
  assert.match(html, /class="tag-post-grid"/);
  assert.match(html, /class="read-more-card"/);
  assert.match(
    html,
    /<meta property="og:image" content="https:\/\/example\.com\/content\/tags\/leadership\/leadership\.jpg">/,
  );
  assert.match(html, /"@type":"CollectionPage"/);
  assert.match(
    html,
    /<a class="header-logo" href="\/" aria-label="Example Blog home">Example Blog<\/a>/,
  );
});

test('gives each missing read-more image a stable gradient', () => {
  const posts = ['first-post', 'second-post'].map((slug) => ({
    title: slug,
    slug,
    description: '',
    date: '2026-09-15',
    featureImage: '',
    featureImageAlt: '',
  }));
  const html = renderTag({
    tag: {
      name: 'Examples',
      description: '',
      featureImage: '',
    },
    posts,
    canonicalUrl: 'https://example.com/tag/examples/',
  });
  const gradients = [
    ...html.matchAll(/class="read-more-placeholder" style="([^"]+)"/g),
  ].map((match) => match[1]);
  const repeatedHtml = renderTag({
    tag: {
      name: 'Examples',
      description: '',
      featureImage: '',
    },
    posts,
    canonicalUrl: 'https://example.com/tag/examples/',
  });
  const repeatedGradients = [
    ...repeatedHtml.matchAll(
      /class="read-more-placeholder" style="([^"]+)"/g,
    ),
  ].map((match) => match[1]);

  assert.equal(gradients.length, 2);
  assert.notEqual(gradients[0], gradients[1]);
  assert.deepEqual(gradients, repeatedGradients);
});

test('accepts arbitrary valid analytics IDs and emits both scripts together', () => {
  for (const id of ['G-EXAMPLE01', 'G-ANOTHER02']) {
    const { renderHome } = createTemplates(createBlogContext({
      rootDirectory: fixtureRoot,
      env: { GA4_MEASUREMENT_ID: id },
    }));
    const html = renderHome({ posts: [], canonicalUrl: 'https://example.com/' });
    assert(html.includes(`<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>`));
    assert(html.includes(`gtag('config', '${id}');`));
    assert.equal((html.match(/gtag\('config'/g) || []).length, 1);
  }
});

test('rejects malformed analytics IDs', () => {
  for (const id of ["G-TEST');alert(1);//", 'UA-123456-1', 'G-', 'G-lowercase']) {
    assert.throws(() => createTemplates(createBlogContext({
      rootDirectory: fixtureRoot,
      env: { GA4_MEASUREMENT_ID: id },
    })), /GA4_MEASUREMENT_ID must be a valid Google Analytics measurement ID/);
  }
});

test('omits optional artwork and does not invent footer navigation', () => {
  const { renderHome } = createTemplates({
    ...blog,
    site: { ...blog.site, siteLogo: '', siteImage: '', navigation: [] },
  });
  const html = renderHome({ posts: [], canonicalUrl: 'https://example.com/' });
  assert.doesNotMatch(html, /rel="icon"|class="site-logo"|property="og:image"|href="\/about\/"/);
  assert.match(html, /No articles have been published here yet/);
});
