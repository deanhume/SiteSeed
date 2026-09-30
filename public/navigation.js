(() => {
  const header = document.querySelector('.site-header');
  const button = document.querySelector('.menu-button');
  const navigation = document.querySelector('#site-navigation');

  if (!header || !button || !navigation) return;

  function closeMenu({ restoreFocus = false } = {}) {
    navigation.classList.remove('is-open');
    button.setAttribute('aria-expanded', 'false');
    if (restoreFocus) button.focus();
  }

  button.addEventListener('click', () => {
    const open = button.getAttribute('aria-expanded') === 'true';
    if (open) {
      closeMenu();
    } else {
      navigation.classList.add('is-open');
      button.setAttribute('aria-expanded', 'true');
    }
  });

  navigation.addEventListener('click', (event) => {
    if (event.target.closest('a')) closeMenu();
  });

  document.addEventListener('click', (event) => {
    if (!header.contains(event.target)) closeMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && navigation.classList.contains('is-open')) {
      closeMenu({ restoreFocus: true });
    }
  });
})();
