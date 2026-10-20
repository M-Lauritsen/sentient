import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createNavigationUI } from '../navigation-ui.mjs';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(t) {
  const dom = new JSDOM(html, { url: 'http://127.0.0.1:43187/' });
  t.after(() => dom.window.close());
  const { document } = dom.window;
  const helpDialog = document.getElementById('help-dialog');
  helpDialog.showModal = () => { helpDialog.open = true; };
  helpDialog.close = () => {
    helpDialog.open = false;
    helpDialog.dispatchEvent(new dom.window.Event('close'));
  };
  const ui = createNavigationUI({ document });
  const toggle = document.getElementById('application-menu-toggle');
  const menu = document.getElementById('application-menu');
  const items = [...menu.querySelectorAll('[role="menuitem"]')];
  const key = (target, value) => target.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
    key: value, bubbles: true, cancelable: true,
  }));
  return { dom, document, ui, toggle, menu, items, key, helpDialog };
}

test('shared menu opens upward with accurate state and wraps keyboard navigation', (t) => {
  const s = setup(t);
  assert.equal(s.toggle.getAttribute('aria-label'), 'Application menu');
  assert.equal(s.toggle.textContent.trim(), '');
  assert.deepEqual(s.items.map((item) => item.tabIndex), [-1, -1, -1, -1]);
  s.toggle.click();
  assert.equal(s.menu.hidden, false);
  assert.equal(s.toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(s.document.activeElement, s.items[0]);
  assert.deepEqual(s.items.map((item) => item.tabIndex), [0, -1, -1, -1]);

  s.key(s.items[0], 'ArrowUp');
  assert.equal(s.document.activeElement, s.items.at(-1));
  assert.deepEqual(s.items.map((item) => item.tabIndex), [-1, -1, -1, 0]);
  s.key(s.items.at(-1), 'ArrowDown');
  assert.equal(s.document.activeElement, s.items[0]);
  s.key(s.items[0], 'End');
  assert.equal(s.document.activeElement, s.items.at(-1));
  s.key(s.items.at(-1), 'Home');
  assert.equal(s.document.activeElement, s.items[0]);

  s.key(s.items[0], 'Escape');
  assert.equal(s.menu.hidden, true);
  assert.equal(s.toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(s.document.activeElement, s.toggle);
});

test('source bar reveals on hover and focus, pins on tap and dismisses outside', (t) => {
  const s = setup(t);
  const shell = s.document.getElementById('source-status');
  const toggle = s.document.getElementById('source-status-toggle');
  const pointer = (target, name, pointerType = 'mouse') => {
    const event = new s.dom.window.Event(name, { bubbles: true });
    Object.defineProperty(event, 'pointerType', { value: pointerType });
    target.dispatchEvent(event);
  };
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(shell.classList.contains('is-revealed'), false);
  pointer(shell, 'pointerenter');
  assert.equal(shell.classList.contains('is-revealed'), true);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  pointer(shell, 'pointerleave');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  toggle.focus();
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  s.toggle.focus();
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');

  pointer(shell, 'pointerenter', 'touch');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false', 'touch must not leave sticky hover state');
  toggle.click();
  pointer(shell, 'pointerleave', 'touch');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  pointer(s.document.body, 'pointerdown', 'touch');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
});

test('menu item activation keeps the original destination button and Help restores focus', (t) => {
  const s = setup(t);
  const library = s.document.getElementById('library-open');
  let activations = 0;
  library.addEventListener('click', () => activations++);
  s.toggle.click();
  library.click();
  assert.equal(activations, 1);
  assert.equal(library.getAttribute('aria-controls'), 'library-dialog');

  const help = s.document.getElementById('help-open');
  s.items.at(-1).focus();
  help.click();
  assert.equal(s.helpDialog.open, true);
  assert.equal(s.document.activeElement, s.document.getElementById('help-close'));
  assert.match(s.helpDialog.textContent, /coverage is not the same as no activity/i);
  s.document.getElementById('help-close').click();
  assert.equal(s.helpDialog.open, false);
  assert.equal(s.document.activeElement, help);
  assert.equal(s.menu.hidden, false);
  assert.equal(s.toggle.getAttribute('aria-expanded'), 'true');
});

test('Tab dismissal follows focus out and pointer dismissal updates expanded state', async (t) => {
  const s = setup(t);
  const elsewhere = s.document.createElement('button');
  s.document.body.append(elsewhere);
  s.toggle.click();
  s.key(s.items[0], 'Tab');
  elsewhere.focus();
  await tick();
  assert.equal(s.menu.hidden, true);
  assert.equal(s.toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(s.document.activeElement, elsewhere);

  s.toggle.click();
  elsewhere.click();
  assert.equal(s.menu.hidden, true);
  assert.equal(s.toggle.getAttribute('aria-expanded'), 'false');
});

test('closing the mobile workspace keeps its focus-return destination visible', (t) => {
  const s = setup(t);
  const workspaceOpen = s.document.getElementById('workspace-open');
  const mobileClose = s.document.createElement('button');
  mobileClose.className = 'workspace-mobile-close';
  mobileClose.addEventListener('click', () => {
    s.document.body.classList.remove('workspace-mobile-open');
    workspaceOpen.focus();
  });
  s.document.body.append(mobileClose);

  s.toggle.click();
  workspaceOpen.click();
  s.document.body.classList.add('workspace-mobile-open');
  mobileClose.click();

  assert.equal(s.menu.hidden, false);
  assert.equal(s.toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(s.document.activeElement, workspaceOpen);
});
