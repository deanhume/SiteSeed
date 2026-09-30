(() => {
  const article = document.querySelector('[data-reading-progress]');
  const bar = document.querySelector('[data-reading-progress-bar]');
  let frame;

  if (!article || !bar) return;

  function update() {
    const start = article.offsetTop;
    const distance = Math.max(article.offsetHeight - window.innerHeight, 1);
    const progress = Math.min(Math.max((window.scrollY - start) / distance, 0), 1);
    bar.style.transform = `scaleX(${progress})`;
    frame = undefined;
  }

  function requestUpdate() {
    if (frame == null) frame = requestAnimationFrame(update);
  }

  document.addEventListener('scroll', requestUpdate, { passive: true });
  window.addEventListener('resize', requestUpdate);
  window.addEventListener('load', requestUpdate);
  update();
})();

(() => {
  const copyButton = document.querySelector('[data-copy-article-link]');
  const shareButton = document.querySelector('[data-share-article]');
  const status = document.querySelector('[data-article-utility-status]');
  let statusTimer;

  function showStatus(message) {
    if (!status) return;
    status.textContent = message;
    window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => {
      status.textContent = '';
    }, 3000);
  }

  if (copyButton) {
    copyButton.addEventListener('click', async () => {
      const url = copyButton.dataset.articleUrl;
      if (!url || !navigator.clipboard?.writeText) {
        showStatus('Copying is not supported in this browser.');
        return;
      }

      try {
        await navigator.clipboard.writeText(url);
        showStatus('Link copied.');
      } catch {
        showStatus('The link could not be copied.');
      }
    });
  }

  if (shareButton && navigator.share) {
    shareButton.hidden = false;
    shareButton.addEventListener('click', async () => {
      const url = shareButton.dataset.articleUrl;
      if (!url) return;

      try {
        await navigator.share({ title: document.title, url });
      } catch (error) {
        if (error.name !== 'AbortError') {
          showStatus('The article could not be shared.');
        }
      }
    });
  }
})();
