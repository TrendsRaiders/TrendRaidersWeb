// Canvas painter for the stage. The canvas backing store is the arena's CSS size; the stage is laid out from arena-relative
// fractions (so geometry never depends on the viewport), sprites are scaled by one whole-number factor with
// nearest-neighbour sampling and never stretched. Words (ROLLING / Usable / Too early ...) are DOM text, not canvas art.
import { footX, targetSpan, SHOTS } from './engine.js';
import {
  PALETTE as P, MONSTER, MONSTER_W, MONSTER_H, FERN, TREE, CAMERA, CLAPPER, BOOM, FAN_A, FAN_B, SANDWICH,
  GLYPHS, GLYPH_H, labelWidth, rasterize, actorScale,
} from './art.js';

export const REVEAL_MS = 2000; // the optional wide-set reveal; afterwards the static final frame stays
const WALK_FRAME_US = 180_000; // waddle frame length (decoration only)

/** @param {import('./art.js').SpriteDef} def */
function sheet(def) {
  const r = rasterize(def);
  const c = document.createElement('canvas');
  c.width = r.w; c.height = r.h;
  const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  ctx.putImageData(new ImageData(r.data, r.w, r.h), 0, 0);
  return c;
}

const ease = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

export function createRenderer(/** @type {HTMLCanvasElement} */ canvas) {
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  const sprites = new Map();
  const spr = (def) => { let s = sprites.get(def); if (!s) { s = sheet(def); sprites.set(def, s); } return s; };
  let W = 0; let H = 0; let S = 1;
  /** Geometry of the last drawn gameplay frame (tests read it through data attributes the controller mirrors). */
  let geo = { floorY: 0, bandTop: 0, bandH: 0, markerR: 0 };

  // rectangles snap by their EDGES, so neighbouring bands never leave a one-pixel gap
  const px = (x, y, w, h, c) => {
    const x0 = Math.round(x); const y0 = Math.round(y);
    ctx.fillStyle = c; ctx.fillRect(x0, y0, Math.max(0, Math.round(x + w) - x0), Math.max(0, Math.round(y + h) - y0));
  };
  function blit(def, x, y, scale = S) {
    const c = spr(def);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(c, Math.round(x), Math.round(y), c.width * scale, c.height * scale);
  }
  function text(str, x, y, scale, color) {
    let cx = x;
    for (const ch of str) {
      const g = GLYPHS[ch];
      if (!g) continue;
      g.forEach((row, j) => [...row].forEach((c, i) => { if (c === 'X') px(cx + i * scale, y + j * scale, scale, scale, color); }));
      cx += (g[0].length + 1) * scale;
    }
  }

  function resize(w, h) {
    W = Math.max(1, Math.round(w)); H = Math.max(1, Math.round(h));
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    S = actorScale(H, W);
    return { W, H, S };
  }

  function backdrop(floorY) {
    px(0, 0, W, floorY * 0.34, P.skyTop);
    px(0, floorY * 0.34, W, floorY * 0.33, P.skyMid);
    px(0, floorY * 0.67, W, floorY - floorY * 0.67, P.skyLow);
    if (H >= 260) { // painted clouds: flat pixel slabs
      const u = Math.max(2, S);
      for (const [cx, cy] of [[0.2, 0.1], [0.62, 0.17], [0.88, 0.07]]) {
        const x = Math.round(cx * W); const y = Math.round(cy * floorY);
        px(x, y + u, 8 * u, 2 * u, P.cloud); px(x + 2 * u, y, 4 * u, 3 * u, P.cloud);
      }
    }
    const tall = H >= 260;
    const trees = tall ? [0.1, 0.36, 0.62, 0.9] : [0.22, 0.78];
    const ts = Math.max(1, Math.round(S * 0.75));
    for (const f of trees) {
      const t = spr(TREE);
      const x = Math.round(f * W - (t.width * ts) / 2);
      blit(TREE, x, floorY - t.height * ts + ts, ts);
    }
    for (const f of tall ? [0.24, 0.52, 0.8] : [0.5]) {
      const t = spr(FERN);
      blit(FERN, f * W - (t.width * Math.max(1, S - 1)) / 2, floorY - t.height * Math.max(1, S - 1) + Math.max(1, S - 1), Math.max(1, S - 1));
    }
  }

  function floor(floorY) {
    px(0, floorY, W, H - floorY, P.floor);
    const u = Math.max(2, S);
    for (let y = floorY + 6 * u; y < H; y += 6 * u) px(0, y, W, 1, P.plank); // plywood seams
    px(0, floorY - 1, W, Math.max(3, Math.round(S * 0.75)), P.black); // THE floor line: all feet stand on it
  }

  /** The stage tape: bracketed usable strip [c-w, c+w] with a center tape, on the strip band below the feet line. */
  function tape(spanLeft, spanRight, spanCentre, g) {
    const x0 = Math.round(spanLeft * W); const x1 = Math.round(spanRight * W); const xc = Math.round(spanCentre * W);
    const y0 = g.bandTop; const h = g.bandH;
    // strip fill: tape yellow with darker diagonal stripes (the actual hit window, nothing decorative outside it)
    px(x0, y0, x1 - x0, h, P.tape);
    ctx.save();
    ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, h); ctx.clip();
    ctx.fillStyle = '#d9b82c';
    const step = Math.max(8, S * 3);
    for (let k = -h; k < x1 - x0; k += step) {
      ctx.beginPath(); ctx.moveTo(x0 + k, y0 + h); ctx.lineTo(x0 + k + step / 2, y0 + h); ctx.lineTo(x0 + k + h + step / 2, y0); ctx.lineTo(x0 + k + h, y0); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    // brackets: white posts with a black outline, serifs pointing in over the strip edges
    const pw = Math.max(3, S); const o = 1;
    const serif = Math.max(6, Math.min(S * 4, Math.round((x1 - x0) * 0.25)));
    const post = (x, dir) => {
      const px0 = dir < 0 ? x - pw : x;
      px(px0 - o, y0 - 5 - o, pw + 2 * o, h + 10 + 2 * o, P.black);
      px(px0, y0 - 5, pw, h + 10, P.white);
      const sx = dir < 0 ? x : x - serif;
      px(sx, y0 - 5 - o, serif, pw + 2 * o, P.black); px(sx, y0 - 5, serif, pw, P.white);
      px(sx, y0 + h + 5 - pw - o, serif, pw + 2 * o, P.black); px(sx, y0 + h + 5 - pw, serif, pw, P.white);
    };
    post(x0, -1); post(x1, 1);
    // center tape: solid black bar over the strip with white edges and an upward triangle under the band
    const cw = Math.max(4, S + 1);
    px(xc - cw / 2 - 1, y0, cw + 2, h, P.white);
    px(xc - cw / 2, y0, cw, h, P.black);
    const tb = y0 + h + 3; const th = Math.max(6, S * 2);
    ctx.fillStyle = P.black;
    ctx.beginPath(); ctx.moveTo(xc, tb); ctx.lineTo(xc + th, tb + th); ctx.lineTo(xc - th, tb + th); ctx.closePath(); ctx.fill();
    ctx.fillStyle = P.white;
    ctx.beginPath(); ctx.moveTo(xc, tb + 3); ctx.lineTo(xc + th - 4, tb + th - 1); ctx.lineTo(xc - th + 4, tb + th - 1); ctx.closePath(); ctx.fill();
  }

  function marker(x, g) {
    const r = g.markerR; const cy = g.floorY + 2 + r;
    ctx.fillStyle = P.black;
    ctx.beginPath(); ctx.moveTo(x, cy - r - 2); ctx.lineTo(x + r + 2, cy); ctx.lineTo(x, cy + r + 2); ctx.lineTo(x - r - 2, cy); ctx.closePath(); ctx.fill();
    ctx.fillStyle = P.white;
    ctx.beginPath(); ctx.moveTo(x, cy - r); ctx.lineTo(x + r, cy); ctx.lineTo(x, cy + r); ctx.lineTo(x - r, cy); ctx.closePath(); ctx.fill();
    ctx.fillStyle = P.marker;
    const q = Math.max(2, r - 3);
    ctx.beginPath(); ctx.moveTo(x, cy - q); ctx.lineTo(x + q, cy); ctx.lineTo(x, cy + q); ctx.lineTo(x - q, cy); ctx.closePath(); ctx.fill();
  }

  /** Photo frame around the frozen performer with a check or cross badge (shape + colour). */
  function photo(cx, g, kind, p) {
    const hw = Math.round(17 * S); const top = g.floorY - Math.round((MONSTER_H + 2) * S); const bot = g.floorY + 5;
    let x0 = Math.round(cx - hw); let x1 = Math.round(cx + hw);
    if (x0 < 3) { x1 += 3 - x0; x0 = 3; }
    if (x1 > W - 3) { x0 -= x1 - (W - 3); x1 = W - 3; }
    const t = Math.max(3, S);
    const ok = kind === 'usable';
    px(x0 - 1, top - 1, x1 - x0 + 2, t + 2, P.black); px(x0 - 1, bot - t - 1, x1 - x0 + 2, t + 2, P.black);
    px(x0 - 1, top - 1, t + 2, bot - top + 2, P.black); px(x1 - t - 1, top - 1, t + 2, bot - top + 2, P.black);
    px(x0, top, x1 - x0, t, P.white); px(x0, bot - t, x1 - x0, t, P.white);
    px(x0, top, t, bot - top, P.white); px(x1 - t, top, t, bot - top, P.white);
    // badge: circle with a check (usable) or cross (miss) that draws itself unless reduced motion
    const r = Math.max(11, Math.round(S * 3.2));
    const bx = x0 + 2; const by = top + 2; // straddles the frame corner so it never covers the performer
    ctx.fillStyle = P.black; ctx.beginPath(); ctx.arc(bx, by, r + 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = ok ? '#1c8c3c' : '#c2283c'; ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = P.white; ctx.lineWidth = Math.max(3, Math.round(r / 3)); ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
    const pts = [[-0.5, 0.05], [-0.15, 0.45], [0.55, -0.4]];
    ctx.beginPath();
    if (ok) {
      const seg = [pts[0], pts[1], pts[2]].map(([a, b]) => [bx + a * r, by + b * r]);
      const l1 = Math.hypot(seg[1][0] - seg[0][0], seg[1][1] - seg[0][1]); const l2 = Math.hypot(seg[2][0] - seg[1][0], seg[2][1] - seg[1][1]);
      const run = p * (l1 + l2);
      ctx.moveTo(seg[0][0], seg[0][1]);
      if (run <= l1) ctx.lineTo(seg[0][0] + ((seg[1][0] - seg[0][0]) * run) / l1, seg[0][1] + ((seg[1][1] - seg[0][1]) * run) / l1);
      else { ctx.lineTo(seg[1][0], seg[1][1]); const k = (run - l1) / l2; ctx.lineTo(seg[1][0] + (seg[2][0] - seg[1][0]) * k, seg[1][1] + (seg[2][1] - seg[1][1]) * k); }
    } else {
      const d = r * 0.45 * Math.min(1, p * 2);
      ctx.moveTo(bx - d, by - d); ctx.lineTo(bx + d, by + d);
      if (p > 0.5) { const e = r * 0.45 * Math.min(1, (p - 0.5) * 2); ctx.moveTo(bx + e, by - e); ctx.lineTo(bx - e, by + e); }
    }
    ctx.stroke();
    return { x0, x1, top, bot };
  }

  /** Gameplay stage. */
  function stage(v) {
    const floorY = Math.round(H * 0.62);
    const markerR = Math.max(9, Math.round(S * 2.4));
    const bandTop = floorY + 2 * markerR + 6;
    const bandH = Math.max(16, Math.round(H * 0.085));
    const g = { floorY, bandTop, bandH, markerR };
    geo = g;
    backdrop(floorY);
    floor(floorY);
    const idx = Math.min(SHOTS.length, Math.max(1, v.shot)) - 1;
    const span = targetSpan(idx);
    tape(span.left, span.right, span.centre, g);
    // foreground props, only when there is room below the tape
    const below = H - (bandTop + bandH + 3 * markerR);
    if (below > 14 * Math.max(1, S - 1)) {
      const ps = Math.max(1, S - 1);
      blit(CLAPPER, 6, H - spr(CLAPPER).height * ps - 4, ps);
      blit(CAMERA, W - spr(CAMERA).width * ps - 6, H - spr(CAMERA).height * ps - 4, ps);
    }
    // performer
    let tUs = 0; let sprite = MONSTER.stand;
    const walking = v.state === 'walking';
    if (walking) {
      tUs = v.phaseUs;
      sprite = v.reduced ? MONSTER.stand : Math.floor(tUs / WALK_FRAME_US) % 2 ? MONSTER.walkB : MONSTER.walkA;
    } else if ((v.state === 'shot_result' || v.state === 'won' || v.state === 'lost') && v.result) {
      tUs = Math.min(v.result.tUs, 3_200_000);
      sprite = v.result.kind === 'usable' ? MONSTER.pose : MONSTER.awkward;
    }
    const fx = footX(tUs) * W;
    const ax = Math.round(fx - (MONSTER_W / 2) * S);
    blit(sprite, ax, floorY - MONSTER_H * S, S);
    marker(Math.round(fx), g);
    /** @type {{x0:number,x1:number,top:number,bot:number}|null} */
    let frame = null;
    if (v.result && (v.state === 'shot_result' || v.state === 'won' || v.state === 'lost')) {
      frame = photo(fx, g, v.result.kind, v.reduced || v.state !== 'shot_result' ? 1 : Math.min(1, v.phaseUs / 160_000));
    }
    return { g, fx, span, frame };
  }

  /**
   * Wide-set reveal inside rect {x,y,w,h}: the camera widens on the cardboard set, a fan and boom mic appear, the monster
   * opens its hood and takes a sandwich beside the FOREST - FLAT PACK sign. ms >= REVEAL_MS (or reduced motion) = final frame.
   */
  function reveal(rect, ms, reduced) {
    const done = reduced || ms >= REVEAL_MS;
    const m = done ? REVEAL_MS : Math.max(0, ms);
    const LW = 120; const LH = 60;
    const rs = Math.max(1, Math.floor(Math.min(rect.w / LW, rect.h / LH)));
    const ox = Math.round(rect.x + (rect.w - LW * rs) / 2); const oy = Math.round(rect.y + (rect.h - LH * rs) / 2);
    const fl = 52; // floor line, logical rows
    const open = done ? 1 : ease(m / 700);
    const clipW = Math.round(LW * rs * (0.42 + 0.58 * open));
    ctx.save();
    ctx.beginPath(); ctx.rect(ox + Math.round((LW * rs - clipW) / 2), oy, clipW, LH * rs); ctx.clip();
    px(ox, oy, LW * rs, 17 * rs, P.skyTop); px(ox, oy + 17 * rs, LW * rs, 17 * rs, P.skyMid); px(ox, oy + 34 * rs, LW * rs, (fl - 34) * rs, P.skyLow);
    // two cardboard trees with visible wooden braces behind them: the set is flat
    for (const tx of [22, 76]) {
      px(ox + (tx + 8) * rs, oy + 38 * rs, 2 * rs, (fl - 38) * rs, P.cardDark);
      px(ox + (tx + 10) * rs, oy + 44 * rs, 5 * rs, 2 * rs, P.cardDark);
      blit(TREE, ox + tx * rs, oy + (fl - spr(TREE).height + 1) * rs, rs);
    }
    px(ox, oy + fl * rs, LW * rs, (LH - fl) * rs, P.floor);
    for (let y = fl + 3; y < LH; y += 4) px(ox, oy + y * rs, LW * rs, 1, P.plank);
    px(ox, oy + fl * rs - 1, LW * rs, Math.max(2, rs), P.black);
    // fan (left) and its wind lines
    const fan = !reduced && !done && Math.floor(m / 110) % 2 ? FAN_B : FAN_A;
    blit(fan, ox + 4 * rs, oy + (fl - 16) * rs, rs);
    for (const [wy, wl] of [[40, 6], [44, 8], [48, 5]]) px(ox + 19 * rs, oy + wy * rs, wl * rs, rs, P.white);
    // boom mic from the top, over the performer's head
    blit(BOOM, ox + 30 * rs, oy + 3 * rs, rs);
    // performer: hood closed, then thrown back
    const mx = ox + 36 * rs; const my = oy + (fl - MONSTER_H) * rs;
    const hood = done || m >= 900;
    blit(hood ? MONSTER.hood : MONSTER.stand, mx, my, rs);
    // sandwich slides in from the right to the right mitt (done: resting there)
    const sp = done ? 1 : ease((m - 1000) / 600);
    if (m >= 1000 || done) {
      const sx = (LW + 2) + ((68 - (LW + 2)) * sp);
      blit(SANDWICH, ox + Math.round(sx * rs), oy + 40 * rs, rs);
    }
    // sign: cardboard board on a post, text drawn with the 3x5 font
    const bx = 82; const by = 28; const bw = 38; const bh = 14;
    px(ox + (bx + bw / 2 - 1) * rs, oy + (by + bh) * rs, 2 * rs, (fl - by - bh) * rs, P.cardDark);
    px(ox + (bx - 1) * rs, oy + (by - 1) * rs, (bw + 2) * rs, (bh + 2) * rs, P.black);
    px(ox + bx * rs, oy + by * rs, bw * rs, bh * rs, P.card);
    const t1 = 'FOREST -'; const t2 = 'FLAT PACK';
    text(t1, ox + (bx + Math.floor((bw - labelWidth(t1)) / 2)) * rs, oy + (by + 2) * rs, rs, P.black);
    text(t2, ox + (bx + Math.floor((bw - labelWidth(t2)) / 2)) * rs, oy + (by + 2 + GLYPH_H + 1) * rs, rs, P.black);
    ctx.restore();
    return { rs, done, rect: { x: ox, y: oy, w: LW * rs, h: LH * rs } };
  }

  /** Contact-sheet thumbnail into a small canvas: a frozen performer on the backdrop colour. */
  function thumb(target, kind) {
    const c = /** @type {CanvasRenderingContext2D} */ (target.getContext('2d'));
    c.imageSmoothingEnabled = false;
    c.fillStyle = P.skyMid; c.fillRect(0, 0, target.width, target.height);
    c.fillStyle = P.floor; c.fillRect(0, target.height - 6, target.width, 6);
    if (kind === 'unused') return;
    const def = kind === 'usable' ? MONSTER.pose : MONSTER.awkward;
    const s = spr(def);
    c.drawImage(s, Math.round((target.width - s.width) / 2), target.height - s.height - 3);
  }

  /**
   * @param {{ state: string, shot: number, phaseUs: number, result: import('./engine.js').ShotResult|null, reduced: boolean,
   *   revealMs: number|null, revealRect: {x:number,y:number,w:number,h:number}|null }} v
   */
  function draw(v) {
    if (!W || !H) return null;
    ctx.imageSmoothingEnabled = false;
    if (v.revealMs !== null && v.revealRect) {
      px(0, 0, W, H, P.black);
      return { reveal: reveal(v.revealRect, v.revealMs, v.reduced) };
    }
    return stage(v);
  }

  return { resize, draw, thumb, get scale() { return S; }, get size() { return { W, H }; }, get geometry() { return geo; } };
}
