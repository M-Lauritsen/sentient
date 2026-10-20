export function createNavigationUI({
  document,
  navigation = document.getElementById('application-navigation'),
  toggle = document.getElementById('application-menu-toggle'),
  menu = document.getElementById('application-menu'),
  helpButton = document.getElementById('help-open'),
  helpDialog = document.getElementById('help-dialog'),
  helpClose = document.getElementById('help-close'),
}) {
  if (!navigation || !toggle || !menu || !helpButton || !helpDialog || !helpClose) {
    throw new Error('Application navigation elements are missing.');
  }
  const items = [...menu.querySelectorAll('[role="menuitem"]')];
  if (items.length === 0) throw new Error('Application navigation menu has no destinations.');
  for (const item of items) item.tabIndex = -1;

  const statusShell = document.getElementById('source-status');
  const statusToggle = document.getElementById('source-status-toggle');
  if (statusShell && statusToggle) {
    let hovering = false;
    let pinned = false;
    function syncStatus() {
      const open = pinned || hovering || statusShell.contains(document.activeElement);
      statusShell.classList.toggle('is-revealed', open);
      statusToggle.setAttribute('aria-expanded', String(open));
    }
    statusShell.addEventListener('pointerenter', (event) => {
      if (event.pointerType === 'touch') return;
      hovering = true;
      syncStatus();
    });
    statusShell.addEventListener('pointerleave', () => {
      hovering = false;
      syncStatus();
    });
    statusShell.addEventListener('focusin', syncStatus);
    statusShell.addEventListener('focusout', (event) => {
      const open = pinned || hovering || statusShell.contains(event.relatedTarget);
      statusShell.classList.toggle('is-revealed', open);
      statusToggle.setAttribute('aria-expanded', String(open));
    });
    statusToggle.addEventListener('click', () => {
      pinned = !pinned;
      syncStatus();
    });
    document.addEventListener('pointerdown', (event) => {
      if (statusShell.contains(event.target)) return;
      pinned = false;
      if (statusShell.contains(document.activeElement)) document.activeElement.blur();
      syncStatus();
    });
  }

  function setMenuOpen(open, { restoreFocus = false } = {}) {
    menu.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (restoreFocus) toggle.focus({ preventScroll: true });
  }

  function focusItem(index) {
    items.forEach((item, itemIndex) => { item.tabIndex = itemIndex === index ? 0 : -1; });
    items[index].focus({ preventScroll: true });
  }

  toggle.addEventListener('click', () => {
    const opening = menu.hidden;
    setMenuOpen(opening);
    if (opening) focusItem(0);
  });
  toggle.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setMenuOpen(true);
      focusItem(event.key === 'ArrowUp' ? items.length - 1 : 0);
    }
  });

  menu.addEventListener('keydown', (event) => {
    const index = items.indexOf(event.target.closest('[role="menuitem"]'));
    if (index < 0) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      setMenuOpen(false, { restoreFocus: true });
      return;
    }

    let nextIndex;
    if (event.key === 'ArrowDown') nextIndex = (index + 1) % items.length;
    else if (event.key === 'ArrowUp') nextIndex = (index + items.length - 1) % items.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = items.length - 1;
    else if (event.key === 'Tab') {
      document.defaultView.setTimeout(() => {
        if (!navigation.contains(document.activeElement)) setMenuOpen(false);
      });
      return;
    } else return;

    event.preventDefault();
    focusItem(nextIndex);
  });

  document.addEventListener('click', (event) => {
    if (event.target.closest('dialog')) return;
    if (document.querySelector('dialog[open]') ||
        document.body.classList.contains('workspace-mobile-open') ||
        event.target.closest('.workspace-mobile-close')) return;
    if (!navigation.contains(event.target)) setMenuOpen(false);
  });

  helpButton.addEventListener('click', () => {
    if (helpDialog.open || document.querySelector('dialog[open]')) return;
    helpDialog.showModal();
    helpClose.focus({ preventScroll: true });
  });
  helpClose.addEventListener('click', () => helpDialog.close());
  helpDialog.addEventListener('close', () => helpButton.focus({ preventScroll: true }));
  helpDialog.addEventListener('keydown', (event) => event.stopPropagation());
  for (const name of ['pointerdown', 'pointerup', 'pointermove', 'wheel', 'keyup']) {
    helpDialog.addEventListener(name, (event) => event.stopPropagation());
  }

  return {
    close() { setMenuOpen(false); },
    isOpen() { return !menu.hidden; },
  };
}
