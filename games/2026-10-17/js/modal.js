// Blocking-dialog stack: focus containment, inert background, focus restore.

const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

function usable(el) {
  return !!el && el.isConnected && !el.closest('[inert], [hidden]') && el.getClientRects().length > 0;
}

export class ModalStack {
  /**
   * @param {{ page: HTMLElement, fallback: () => HTMLElement|null, onChange?: () => void }} o
   * page: element made inert while any dialog is open. fallback: logical focus target if the opener is gone.
   */
  constructor({ page, fallback, onChange = () => {} }) {
    this.page = page;
    this.fallback = fallback;
    this.onChange = onChange;
    /** @type {{ el: HTMLElement, opener: HTMLElement|null, initial: () => HTMLElement|null }[]} */
    this.stack = [];
    document.addEventListener('keydown', (e) => this.#trap(e), true);
  }

  get isOpen() { return this.stack.length > 0; }
  get top() { return this.stack.length ? this.stack[this.stack.length - 1].el : null; }
  has(el) { return this.stack.some((s) => s.el === el); }

  /** @param {HTMLElement} el @param {{ opener?: HTMLElement|null, initial?: () => HTMLElement|null }} [o] */
  open(el, { opener = /** @type {HTMLElement|null} */ (document.activeElement), initial } = {}) {
    if (this.has(el)) return;
    this.onChange();
    this.stack.push({ el, opener, initial: initial || (() => /** @type {HTMLElement|null} */ (el.querySelector('[data-modal-heading]'))) });
    el.hidden = false;
    this.#sync();
    const target = this.stack[this.stack.length - 1].initial();
    if (target) target.focus();
  }

  close(el) {
    const i = this.stack.findIndex((s) => s.el === el);
    if (i < 0) return;
    this.onChange();
    const [entry] = this.stack.splice(i, 1);
    el.hidden = true;
    this.#sync();
    if (i !== this.stack.length) return; // a non-top dialog was removed; focus stays put
    let target = entry.opener;
    if (!usable(target)) {
      const below = this.stack[this.stack.length - 1];
      target = below ? below.initial() : this.fallback();
    }
    if (target) target.focus();
  }

  closeAll() {
    while (this.stack.length) this.close(this.stack[this.stack.length - 1].el);
  }

  #sync() {
    this.page.inert = this.stack.length > 0;
    this.stack.forEach((s, i) => { s.el.inert = i !== this.stack.length - 1; });
  }

  #trap(e) {
    const top = this.top;
    if (!top || e.key !== 'Tab') return;
    const items = /** @type {HTMLElement[]} */ ([...top.querySelectorAll(FOCUSABLE)]).filter((n) => usable(n));
    const heading = top.querySelector('[data-modal-heading]');
    /** @type {HTMLElement[]} */
    const ring = [/** @type {HTMLElement} */ (heading), ...items].filter(Boolean);
    if (!ring.length) { e.preventDefault(); return; }
    const idx = ring.indexOf(/** @type {any} */ (document.activeElement));
    const next = e.shiftKey ? (idx <= 0 ? ring.length - 1 : idx - 1) : (idx < 0 || idx === ring.length - 1 ? 0 : idx + 1);
    e.preventDefault();
    ring[next].focus();
  }
}
