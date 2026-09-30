(() => {
  const dialog = document.querySelector('#search-dialog');
  const input = document.querySelector('#search-input');
  const results = document.querySelector('#search-results');
  const closeButton = document.querySelector('.search-close');
  const searchButtons = document.querySelectorAll('.search-button');
  let postsPromise;
  let opener;

  if (!dialog || !input || !results || !closeButton) return;

  function loadPosts() {
    postsPromise ||= fetch('/search-index.json')
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Search index returned ${response.status}`);
        }
        return response.json();
      })
      .catch((error) => {
        // A transient network failure should not disable search for the whole session.
        postsPromise = undefined;
        throw error;
      });
    return postsPromise;
  }

  function element(name, className, text) {
    const node = document.createElement(name);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function resultLink(url, title, excerpt, className = '') {
    const link = element('a', `search-result ${className}`.trim());
    link.href = url;
    link.append(element('h3', 'search-result-title', title));
    if (excerpt) link.append(element('p', 'search-result-excerpt', excerpt));
    return link;
  }

  function section(title, items) {
    if (!items.length) return null;
    const container = document.createDocumentFragment();
    container.append(element('h2', 'search-section-title', title));
    items.forEach((item) => container.append(item));
    return container;
  }

  function searchableText(post) {
    return [
      post.title,
      post.description,
      post.text,
      ...post.tags.flatMap((tag) => [tag.name, tag.slug]),
    ]
      .join(' ')
      .toLowerCase();
  }

  function matchingExcerpt(post, terms) {
    const source = post.description || post.text;
    const lower = source.toLowerCase();
    const matchIndex = terms
      .map((term) => lower.indexOf(term))
      .filter((index) => index >= 0)
      .sort((a, b) => a - b)[0];
    if (matchIndex == null || matchIndex < 80) return source.slice(0, 220);
    return `...${source.slice(matchIndex - 60, matchIndex + 160)}`;
  }

  async function render() {
    const query = input.value.trim().toLowerCase();
    results.replaceChildren();
    if (!query) return;

    const terms = query.split(/\s+/).filter(Boolean);
    try {
      const posts = await loadPosts();
      if (input.value.trim().toLowerCase() !== query) return;

      const matchingPosts = posts
        .filter((post) => terms.every((term) => searchableText(post).includes(term)))
        .sort((a, b) => {
          const aTitle = a.title.toLowerCase().includes(query) ? 1 : 0;
          const bTitle = b.title.toLowerCase().includes(query) ? 1 : 0;
          return bTitle - aTitle || new Date(b.date) - new Date(a.date);
        })
        .slice(0, 8);

      const tags = new Map();
      posts.forEach((post) => {
        post.tags.forEach((tag) => {
          if (
            terms.every((term) =>
              `${tag.name} ${tag.slug}`.toLowerCase().includes(term),
            )
          ) {
            tags.set(tag.slug, tag);
          }
        });
      });

      const tagSection = section(
        'Tags',
        [...tags.values()]
          .slice(0, 5)
          .map((tag) =>
            resultLink(`/tag/${tag.slug}/`, tag.name, '', 'search-tag'),
          ),
      );
      const postSection = section(
        'Posts',
        matchingPosts.map((post) =>
          resultLink(
            `/${post.slug}/`,
            post.title,
            matchingExcerpt(post, terms),
          ),
        ),
      );

      if (tagSection) results.append(tagSection);
      if (postSection) results.append(postSection);
      if (!tagSection && !postSection) {
        results.append(element('p', 'search-empty', 'No results found.'));
      }
    } catch (error) {
      console.error(error);
      results.append(
        element('p', 'search-empty', 'Search is temporarily unavailable.'),
      );
    }
  }

  searchButtons.forEach((button) => {
    button.addEventListener('click', () => {
      opener = button;
      dialog.showModal();
      button.setAttribute('aria-expanded', 'true');
      input.focus();
    });
  });

  closeButton.addEventListener('click', () => dialog.close());
  input.addEventListener('input', render);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    searchButtons.forEach((button) =>
      button.setAttribute('aria-expanded', 'false'),
    );
    input.value = '';
    results.replaceChildren();
    opener?.focus();
    opener = undefined;
  });
})();
