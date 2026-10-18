// Canvas painter for the arena. The canvas backing store is the arena's CSS size, so wall edges and openings land on
// the exact normalized bounds (rounded to one CSS pixel); sprites are scaled by one whole-number factor with
// nearest-neighbour sampling and never stretched. Texts (NEXT GAP / OLD / WORLD UPDATED) are DOM tags, not canvas art.
import { CFG } from './engine.js';
import {
  FLY_A, FLY_B, FLY_BODY, BANANA, ARROW_UP, ARROW_DOWN, BURST, THEMES, THEME_ORDER, ICON, ICON_BITTEN, ICON_W, ICON_H,
  GLYPHS, GLYPH_H, labelWidth, ICON_LABEL, rasterize, spriteScale,
} from './art.js';

export const REVEAL_MS = 1700; // 1.5-2 s reveal; after this the static final frame stays
const DASH_A = '#ffe14a';
const DASH_B = '#14141f';

/** @param {import('./art.js').SpriteDef} def */
function sheet(def) {
  const r = rasterize(def);
  const c = document.createElement('canvas');
  c.width = r.w; c.height = r.h;
  const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  ctx.putImageData(new ImageData(r.data, r.w, r.h), 0, 0);
  return c;
}

export function createRenderer(/** @type {HTMLCanvasElement} */ canvas) {
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  const sprites = new Map();
  const patterns = new Map();
  const spr = (def) => { let s = sprites.get(def); if (!s) { s = sheet(def); sprites.set(def, s); } return s; };
  let W = 0; let H = 0; let S = 1;

  /** Pre-scaled tile pattern (whole-number scale, nearest neighbour). */
  function pattern(def, scale, key) {
    const k = `${key}@${scale}`;
    let p = patterns.get(k);
    if (!p) {
      const src = sheet(def);
      const big = document.createElement('canvas');
      big.width = src.width * scale; big.height = src.height * scale;
      const b = /** @type {CanvasRenderingContext2D} */ (big.getContext('2d'));
      b.imageSmoothingEnabled = false;
      b.drawImage(src, 0, 0, big.width, big.height);
      p = ctx.createPattern(big, 'repeat');
      patterns.set(k, p);
    }
    return p;
  }
  function fillPattern(pat, x, y, w, h, ox, oy) {
    if (w <= 0 || h <= 0) return;
    pat.setTransform(new DOMMatrix().translate(ox, oy));
    ctx.fillStyle = pat;
    ctx.fillRect(x, y, w, h);
  }
  function blit(def, x, y, scale = S, flipY = false) {
    const c = spr(def);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(c, Math.round(x), Math.round(y), c.width * scale, c.height * (flipY ? scale / 2 : scale));
  }
  /** Fly (or banana) drawn so the body block's centre sits on (cx, cy) in CSS px. */
  function flyAt(def, cx, cy, scale = S) {
    const x = cx - (FLY_BODY.x + FLY_BODY.w / 2) * scale;
    const y = cy - (FLY_BODY.y + FLY_BODY.h / 2) * scale;
    blit(def, x, y, scale);
  }

  function resize(w, h) {
    W = Math.max(1, Math.round(w)); H = Math.max(1, Math.round(h));
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    S = spriteScale(W, H);
    return { W, H, S };
  }

  function background(theme, driftPx) {
    const t = THEMES[theme];
    const bgScale = S * 2;
    const pat = pattern(t.bg, bgScale, `bg-${theme}`);
    const tile = 8 * bgScale;
    fillPattern(pat, 0, 0, W, H, -(((driftPx % tile) + tile) % tile), 0);
  }

  function wall(view, theme, themeIndex) {
    const t = THEMES[theme];
    const x0 = Math.round((view.x - CFG.wallHalf) * W);
    const x1 = Math.round((view.x + CFG.wallHalf) * W);
    const gapTop = Math.round((view.center - CFG.gapHalf) * H);
    const gapBot = Math.round((view.center + CFG.gapHalf) * H);
    const pat = pattern(t.wall, S, `wall-${theme}`);
    const w = x1 - x0;
    fillPattern(pat, x0, 0, w, gapTop, x0, 0);
    fillPattern(pat, x0, gapBot, w, H - gapBot, x0, gapBot);
    // lips: bright caps inside the solid part, so the opening itself stays exactly [gapTop, gapBot]
    const lip = Math.max(2, S);
    ctx.fillStyle = t.edge;
    ctx.fillRect(x0, gapTop - lip, w, lip);
    ctx.fillRect(x0, gapBot, w, lip);
    ctx.fillStyle = t.shade;
    ctx.fillRect(x0, gapTop - lip - 1, w, 1);
    ctx.fillRect(x0, gapBot + lip, w, 1);
    ctx.fillRect(x0, 0, 1, gapTop - lip);
    ctx.fillRect(x1 - 1, 0, 1, gapTop - lip);
    ctx.fillRect(x0, gapBot + lip, 1, H - gapBot - lip);
    ctx.fillRect(x1 - 1, gapBot + lip, 1, H - gapBot - lip);
    return { x0, x1, gapTop, gapBot };
  }

  /** Future opening of a recompile seam: hatched, two-tone dashed edges and an arrow from the old to the new opening. */
  function ghostGap(view, theme) {
    const pad = Math.round(S * 1.5);
    const x0 = Math.round((view.x - CFG.wallHalf) * W) - pad;
    const x1 = Math.round((view.x + CFG.wallHalf) * W) + pad;
    const y0 = Math.round((view.newCenter - CFG.gapHalf) * H);
    const y1 = Math.round((view.newCenter + CFG.gapHalf) * H);
    // hatch (opaque two-tone diagonal stripes)
    ctx.save();
    ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip();
    ctx.fillStyle = '#26324f'; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.fillStyle = '#7f8fc4';
    const step = Math.max(6, S * 3);
    for (let k = -(y1 - y0); k < x1 - x0; k += step) {
      ctx.beginPath(); ctx.moveTo(x0 + k, y1); ctx.lineTo(x0 + k + step / 2, y1); ctx.lineTo(x0 + k + (y1 - y0) + step / 2, y0); ctx.lineTo(x0 + k + (y1 - y0), y0); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    // dashed border, alternating yellow / near-black dashes so it reads on every scenery palette
    const th = Math.max(2, S);
    const dash = Math.max(6, S * 3);
    const seg = (x, y, w, h, horizontal) => {
      const len = horizontal ? w : h;
      for (let k = 0, i = 0; k < len; k += dash, i++) {
        ctx.fillStyle = i % 2 ? DASH_B : DASH_A;
        const d = Math.min(dash, len - k);
        if (horizontal) ctx.fillRect(x + k, y, d, h); else ctx.fillRect(x, y + k, w, d);
      }
    };
    seg(x0, y0, x1 - x0, th, true); seg(x0, y1 - th, x1 - x0, th, true);
    seg(x0, y0, th, y1 - y0, false); seg(x1 - th, y0, th, y1 - y0, false);
    // arrow inside the future opening, pointing in the direction of travel from the old opening to the new one
    const down = view.newCenter > view.oldCenter;
    const mid = Math.round(view.newCenter * H);
    const a = spr(down ? ARROW_DOWN : ARROW_UP);
    const sc = Math.max(1, Math.min(S, 4));
    ctx.drawImage(a, Math.round((view.x * W) - (a.width * sc) / 2), Math.round(mid - (a.height * sc) / 2), a.width * sc, a.height * sc);
    return { ghost: { x0, x1, y0, y1 }, mid };
  }

  /** Static or animated banana.png reveal inside rect {x,y,w,h}; ms >= REVEAL_MS draws the final frame. */
  function reveal(rect, ms, reduced) {
    const done = reduced || ms >= REVEAL_MS;
    const m = done ? REVEAL_MS : ms;
    const rs = Math.max(1, Math.min(6, Math.floor(Math.min(rect.w / 86, rect.h / 34))));
    const lw = labelWidth(ICON_LABEL);
    const winW = 32; const winH = 22; const gap = 10;
    const totalW = winW + gap + Math.max(ICON_W, lw);
    const ox = Math.round(rect.x + (rect.w - totalW * rs) / 2);
    const oy = Math.round(rect.y + (rect.h - (ICON_H + 2 + GLYPH_H) * rs) / 2);
    const iconX = ox + (winW + gap + Math.max(0, (lw - ICON_W) / 2)) * rs;
    const iconY = oy;
    const winX = ox; const winY = oy + (ICON_H - winH + 2) * rs;
    const labelX = ox + (winW + gap + Math.max(0, (ICON_W - lw) / 2)) * rs;
    const labelY = oy + (ICON_H + 2) * rs;
    const px = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };

    // 1. the banana sits where the icon will be; it squashes flat, then becomes the picture file
    const bsprite = spr(BANANA);
    if (m < 300) {
      ctx.drawImage(bsprite, Math.round(iconX + 1 * rs), Math.round(iconY + 2 * rs), bsprite.width * rs, bsprite.height * rs);
    } else if (m < 600) {
      const h2 = Math.round((bsprite.height * rs) / 2);
      ctx.drawImage(bsprite, Math.round(iconX + 1 * rs), Math.round(iconY + 2 * rs + (bsprite.height * rs - h2)), bsprite.width * rs, h2);
    }
    const iconDef = m >= 1400 ? ICON_BITTEN : ICON;
    if (m >= 600) blit(iconDef, iconX, iconY, rs);
    // label (own 3x5 glyphs)
    if (m >= 700) {
      px(labelX - 2 * rs, labelY - rs, (lw + 4) * rs, (GLYPH_H + 2) * rs, '#14141f');
      let cx = labelX;
      for (const ch of ICON_LABEL) {
        const g = GLYPHS[ch];
        g.forEach((row, j) => [...row].forEach((c, i) => { if (c === 'X') px(cx + i * rs, labelY + j * rs, rs, rs, '#ffffff'); }));
        cx += (g[0].length + 1) * rs;
      }
    }
    // 2. the miniature game window (a fake, drawn window: not a real popup or dialog)
    if (m >= 800) {
      px(winX, winY, winW * rs, winH * rs, '#14141f');
      px(winX + rs, winY + rs, (winW - 2) * rs, 4 * rs, '#1e2f9c');
      px(winX + (winW - 5) * rs, winY + 2 * rs, 2 * rs, 2 * rs, '#ff5d5d');
      px(winX + 2 * rs, winY + 2 * rs, 6 * rs, 1 * rs, '#dcdce6');
      px(winX + rs, winY + 5 * rs, (winW - 2) * rs, (winH - 6) * rs, '#7fc4ff');
      px(winX + 10 * rs, winY + 5 * rs, 4 * rs, 5 * rs, '#2e7d39');
      px(winX + 10 * rs, winY + 14 * rs, 4 * rs, (winH - 15) * rs, '#2e7d39');
    }
    // 3. the fly crawls out of the window to the icon, then takes the bite
    if (m >= 900) {
      const p = Math.min(1, (m - 900) / 500);
      const fx = winX + (winW - 3) * rs + p * ((iconX - 5 * rs) - (winX + (winW - 3) * rs));
      const fy = winY + (winH - 5) * rs - p * (winH - ICON_H + 6) * rs * 0.2;
      const frame = !reduced && !done && Math.floor(m / 90) % 2 ? FLY_B : FLY_A;
      flyAt(frame, fx, fy, Math.max(1, Math.round(rs * 0.6)));
    }
    return { rs, done, icon: { x: iconX, y: iconY, w: ICON_W * rs, h: ICON_H * rs }, window: { x: winX, y: winY, w: winW * rs, h: winH * rs } };
  }

  /**
   * @param {{ sim: import('./engine.js').Sim, reduced: boolean, revealMs: number|null, revealRect: {x:number,y:number,w:number,h:number}|null }} v
   */
  function draw(v) {
    if (!W || !H) return null;
    const sim = v.sim;
    ctx.imageSmoothingEnabled = false;
    const themeIndex = sim.paletteIndex;
    const theme = v.revealMs !== null && v.revealRect ? 'desktop' : THEME_ORDER[themeIndex]; // the reveal happens on the desktop
    const revealing = v.revealMs !== null && !!v.revealRect;
    const drift = v.reduced || revealing ? 0 : (sim.tUs / 1e6) * 0.05 * W; // the payoff frame never drifts
    background(theme, drift);
    /** @type {any} */
    const info = { S, W, H, walls: [] };

    if (v.revealMs !== null && v.revealRect) {
      info.reveal = reveal(v.revealRect, v.revealMs, v.reduced);
      return info;
    }
    for (const view of sim.seamViews()) {
      if (!view.visible) continue;
      const geo = wall(view, theme, themeIndex);
      /** @type {any} */ let extra = null;
      if (view.previewing) extra = ghostGap(view, theme);
      info.walls.push({ n: view.n, ...geo, ...(extra || {}), previewing: view.previewing });
    }
    // encounter marker: thin dotted line at the fly's x, behind the fly so it never hides it
    const fx = CFG.flyX * W;
    ctx.fillStyle = '#ffffff';
    for (let y = 0; y < H; y += 8) ctx.fillRect(Math.round(fx) - 1, y, 2, 4);
    ctx.fillStyle = '#14141f';
    for (let y = 4; y < H; y += 8) ctx.fillRect(Math.round(fx) - 1, y, 2, 4);

    const ban = sim.banana();
    if (ban.visible) {
      const c = spr(BANANA);
      ctx.drawImage(c, Math.round(ban.x * W - (c.width * S) / 2), Math.round(ban.y * H - (c.height * S) / 2), c.width * S, c.height * S);
    }
    const frame = !v.reduced && sim.status === 'running' && Math.floor(sim.tUs / 80_000) % 2 ? FLY_B : FLY_A;
    flyAt(frame, fx, sim.y * H);
    if (sim.collision) {
      // burst at the actual contact point: the wall face that the fly core touched
      const c = sim.collision;
      const face = c.wallX >= c.flyX ? c.wallX - CFG.wallHalf : c.wallX + CFG.wallHalf;
      const bs = spr(BURST);
      const sc = Math.max(1, Math.round(S * 0.8));
      const bx = Math.round(Math.min(W - bs.width * sc, Math.max(0, face * W - (bs.width * sc) / 2)));
      const by = Math.round(Math.min(H - bs.height * sc, Math.max(0, c.flyY * H - (bs.height * sc) / 2)));
      ctx.drawImage(bs, bx, by, bs.width * sc, bs.height * sc);
      info.burst = { x: bx, y: by, w: bs.width * sc, h: bs.height * sc };
    }
    return info;
  }

  return { resize, draw, get scale() { return S; }, get size() { return { W, H }; } };
}
