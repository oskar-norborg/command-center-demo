// Tiny DOM builder shared by every page module. No framework, no bundler
// (SPEC.md §2) — this is the entire "templating layer."
//
// `html` is trusted ONLY for state.json's pre-sanitised Markdown sections
// (built by lib/markdown.js at build time, SPEC.md §2/§3.7). Every other
// string — ticker names, level conditions, front-matter prose — goes
// through `text`/textContent, so a stray "<" typed into a YAML file on
// GitHub mobile can never execute as HTML.

/** Build one element. opts: { class, text, html, attrs }. children: Node[]|falsy[]. */
export function el(tag, opts = {}, children = []) {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text != null) node.textContent = opts.text;
  if (opts.html != null) node.innerHTML = opts.html;
  if (opts.attrs) {
    for (const [key, value] of Object.entries(opts.attrs)) node.setAttribute(key, value);
  }
  for (const child of children) {
    if (child) node.appendChild(child);
  }
  return node;
}

/** Shorthand for el(tag, { text: content, ...opts }). */
export function text(tag, content, opts = {}) {
  return el(tag, { ...opts, text: content });
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Wraps a wide element (a data table) so it scrolls sideways within itself rather than the page (SPEC.md mobile
 * rule: no horizontal page scroll — docs/phase3-visual-plan.md §1a item 3/V3). Its own scroll region, same idea
 * as .topnav's (V2) — the content keeps its natural size and format (a price never breaks mid-digit to fit),
 * it just isn't all visible without scrolling the strip on a narrow phone. */
export function scrollWrap(node) {
  return el('div', { class: 'grid-scroll' }, [node]);
}

/**
 * Desktop main-column + right-rail layout (docs/design-system.md "Layout", layout pass option A). `items` are
 * [node, 'main' | 'rail' | 'full'] in the page's SPEC.md order; anything already in `container` (the h1 or
 * dossier header) stays above them. 'rail' panels share one wrapper, inserted where the first of them falls, so
 * the DOM stays close to the phone's reading order; 'full' items (a dossier footer) span both columns below.
 *
 * Below the 900px breakpoint the rail is `display: contents` and every item carries its SPEC.md position as its
 * flex `order`, so the phone's single column reads exactly as before regardless of which wrapper a panel sits in.
 * At and above it the grid gets one auto row per main panel plus a final `1fr` row the rail also spans — a
 * spanning item that crosses a flexible track only grows that track, so a rail taller than the main column
 * (a bad day's long Triggers list) adds space under the main column, never gaps between its panels.
 */
export function splitLayout(container, items) {
  container.classList.add('layout-split');
  const rail = el('div', { class: 'layout-rail' });
  let mainCount = 0;
  items.forEach(([node, slot], i) => {
    node.style.order = String(i + 1);
    if (slot === 'rail') {
      if (!rail.parentNode) container.appendChild(rail);
      rail.appendChild(node);
      return;
    }
    if (slot === 'main') mainCount += 1;
    else node.classList.add('layout-full');
    container.appendChild(node);
  });
  container.style.gridTemplateRows = `auto repeat(${mainCount}, auto) 1fr`;
  rail.style.gridRow = `2 / span ${mainCount + 1}`;
  return container;
}

/** A labelled row, e.g. for a definition-list-style panel. */
export function row(label, value) {
  return el('div', { class: 'row' }, [
    text('span', label, { class: 'row-label' }),
    text('span', value, { class: 'row-value' }),
  ]);
}
