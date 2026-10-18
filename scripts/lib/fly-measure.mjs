// Layout/geometry measurements for Fly the Simulation, shared by the browser tests, the evidence capture and the hosted
// verifier. Everything is measured from the live page (bounding boxes, computed fonts), never assumed.

/** Euclidean distance between two rectangles {x,y,right,bottom}; 0 when they touch or overlap. */
export function rectGap(a, b) {
  const dx = Math.max(0, a.x - b.right, b.x - a.right);
  const dy = Math.max(0, a.y - b.bottom, b.y - a.bottom);
  return Math.hypot(dx, dy);
}

export const measureLayout = (page) => page.evaluate(() => {
  const box = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
  };
  const fs = (sel) => { const el = document.querySelector(sel); return el ? parseFloat(getComputedStyle(el).fontSize) : null; };
  const vis = (sel) => { const el = /** @type {HTMLElement|null} */ (document.querySelector(sel)); return !!el && !el.hidden && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const hit = (sel) => {
    // the hit rectangle is the button box; nothing extends it (no pseudo-element or padding hacks are used), which we assert
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const before = getComputedStyle(el, '::before').content; const after = getComputedStyle(el, '::after').content;
    return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom, pseudo: (before !== 'none' && before !== 'normal') || (after !== 'none' && after !== 'normal') };
  };
  const docEl = document.documentElement;
  const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('scene'));
  return {
    vw: window.innerWidth, vh: window.innerHeight, scrollW: docEl.scrollWidth, scrollH: docEl.scrollHeight, scrollY: window.scrollY,
    header: box('.site-header'), strip: box('#strip'), arena: box('#arena'), steer: box('#steer'), utils: box('#utils'), news: box('#news'),
    up: hit('#btn-up'), down: hit('#btn-down'), pause: hit('#btn-pause'), restart: hit('#btn-restart'),
    start: box('#btn-start'), intro: box('#panel-intro'), paused: box('#panel-paused'), result: box('#panel-result'),
    introVisible: vis('#panel-intro'),
    fonts: { goal: fs('#intro-goal'), keys: fs('#intro-keys'), touch: fs('#intro-touch'), start: fs('#btn-start'), seams: fs('.seams'), cue: fs('#cue-text'), pause: fs('#btn-pause .u-txt'), ctl: fs('#btn-up'), tag: fs('#tag-old') },
    introLines: { goal: vis('#intro-goal'), keys: vis('#intro-keys'), touch: vis('#intro-touch'), start: vis('#btn-start') },
    canvas: { w: canvas.width, h: canvas.height, scale: Number(canvas.dataset.scale) },
    active: document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : null,
  };
});

/** Named viewports from the spec. kind: desktop | portrait | landscape. */
export const VIEWPORTS = [
  { name: '1280x800', width: 1280, height: 800, kind: 'desktop', touch: false },
  { name: '320x568', width: 320, height: 568, kind: 'portrait', touch: true },
  { name: '390x844', width: 390, height: 844, kind: 'portrait', touch: true },
  { name: '568x320', width: 568, height: 320, kind: 'landscape', touch: true },
  { name: '844x390', width: 844, height: 390, kind: 'landscape', touch: true },
];

const inView = (r, vw, vh) => r.x >= -0.5 && r.y >= -0.5 && r.right <= vw + 0.5 && r.bottom <= vh + 0.5;
const inBox = (a, b) => a.x >= b.x - 0.5 && a.y >= b.y - 0.5 && a.right <= b.right + 0.5 && a.bottom <= b.bottom + 0.5;

/** Spec geometry rules as [name, pass, detail] rows for a measureLayout() result. phase: 'intro' | 'active'. */
export function geometryChecks(vp, m, phase) {
  const rows = [];
  const add = (name, pass, detail = '') => rows.push([`${vp.name} ${phase}: ${name}`, !!pass, pass ? '' : String(detail)]);
  add('no horizontal overflow', m.scrollW <= m.vw, `${m.scrollW} > ${m.vw}`);
  if (phase === 'intro') {
    add('Intro (goal, relevant controls, Start) visible inside the arena', m.introVisible && m.introLines.goal && m.introLines.start && (vp.touch ? m.introLines.touch : m.introLines.keys) && inBox(m.intro, m.arena), JSON.stringify(m.introLines));
    add('Intro and Start visible without scrolling', inView(m.intro, m.vw, m.vh) && inView(m.start, m.vw, m.vh) && m.scrollY === 0, JSON.stringify(m.intro));
    add('Intro text >= 16px, Start >= 44px high', m.fonts.goal >= 16 && m.fonts.start >= 16 && m.start.h >= 44, JSON.stringify(m.fonts));
  } else {
    for (const k of ['arena', 'strip', 'up', 'down', 'pause', 'restart']) add(`${k} inside the viewport (no scroll needed)`, inView(m[k], m.vw, m.vh), JSON.stringify(m[k]));
    const gaps = [m.pause, m.restart].flatMap((u) => [m.up, m.down].map((s) => rectGap(u, s)));
    add('utility targets >= 44x44, no pseudo hit areas', [m.pause, m.restart].every((u) => u.w >= 44 && u.h >= 44 && !u.pseudo), JSON.stringify([m.pause, m.restart]));
    add('>= 24px between every utility and steering rectangle', Math.min(...gaps) >= 24, String(Math.min(...gaps)));
    add('utilities below the arena, steering not over the arena', [m.pause, m.restart].every((u) => u.y >= m.arena.bottom) && [m.up, m.down].every((s) => s.y >= m.arena.bottom || s.x >= m.arena.right), '');
    add('compact HUD/utility text >= 14px, steering label >= 16px', m.fonts.seams >= 14 && m.fonts.pause >= 14 && m.fonts.ctl >= 16, JSON.stringify(m.fonts));
    add('one whole-number sprite scale; canvas = arena size', Number.isInteger(m.canvas.scale) && m.canvas.w === Math.round(m.arena.w) && m.canvas.h === Math.round(m.arena.h), JSON.stringify(m.canvas));
    if (vp.kind === 'portrait') {
      add('steering >= 96x56, one row; utilities in a separate row >= 24px lower', [m.up, m.down].every((s) => s.w >= 96 && s.h >= 56) && Math.abs(m.up.y - m.down.y) < 1 && m.pause.y >= m.up.bottom + 23.5, '');
      add('arena fills the width and most of the panel height', m.arena.w >= m.vw - 32 && m.arena.h >= 0.55 * m.vh, `${m.arena.w}x${m.arena.h}`);
      add('header one compact row (<= 52px), strip <= 32px', m.header.h <= 52 && m.strip.h <= 32, `${m.header.h}/${m.strip.h}`);
      if (vp.width === 320) add('arena >= 270px high at 320x568', m.arena.h >= 270, String(m.arena.h));
    }
    if (vp.kind === 'landscape') {
      add('right rail >= 88 wide, stacked controls >= 56 high; utility strip below the arena and clear of the rail', [m.up, m.down].every((s) => s.w >= 88 && s.h >= 56 && s.x >= m.arena.right) && m.up.bottom <= m.down.y && m.pause.right <= m.up.x - 23.5, '');
      add('header <= 36px', m.header.h <= 36, String(m.header.h));
      if (vp.width === 568) add('arena >= 180px high at 568x320', m.arena.h >= 180, String(m.arena.h));
    }
    if (vp.kind === 'desktop') {
      add('column <= 1100 wide; arena 60-70% of the viewport height; header ~40-48; strip <= 32', m.arena.w <= 1101 && m.arena.h >= 0.6 * m.vh && m.arena.h <= 0.7 * m.vh && m.header.h >= 40 && m.header.h <= 48 && m.strip.h <= 32, `${m.arena.w}x${m.arena.h} hdr ${m.header.h}`);
      add('News below the game', m.news.y > m.arena.bottom, '');
    }
  }
  return rows;
}
