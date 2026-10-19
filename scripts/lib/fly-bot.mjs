// Scripted player for Fly the Simulation: reads the page's data attributes and holds ArrowUp/ArrowDown to follow the
// reference route (engine.routeTarget). Automation only: it proves the course is winnable and drives screenshots;
// it is NOT human play evidence. Works with a Playwright fake clock (runFor) or real time (waitForTimeout).
import { routeTarget, CFG } from '../../games/2026-10-18/js/engine.js';

export const readSim = (page) => page.evaluate(() => {
  const g = document.getElementById('game');
  if (!g) return null;
  return { state: g.dataset.state, armed: g.dataset.armed, tUs: Number(g.dataset.tUs), y: Number(g.dataset.flyY), cleared: Number(g.dataset.cleared), held: g.dataset.held, pausedBy: g.dataset.pausedBy };
});

/** Create a bot. `tick(sim)` presses/releases keys so the fly heads for the route target; `release()` lets go of both. */
export function createBot(page, { deadband = 0.012, target = routeTarget } = {}) {
  let down = null; // 'ArrowUp' | 'ArrowDown' | null
  const set = async (key) => {
    if (key === down) return;
    if (down) await page.keyboard.up(down);
    if (key) await page.keyboard.down(key);
    down = key;
  };
  return {
    async tick(sim) {
      const want = target(sim.tUs);
      const d = want - sim.y;
      // lead the target by half a step so we do not oscillate around it
      await set(Math.abs(d) <= deadband ? null : d < 0 ? 'ArrowUp' : 'ArrowDown');
    },
    release: () => set(null),
    get holding() { return down; },
  };
}

/** Drive on the fake clock until the given state(s) are reached. Returns the last sim reading. */
export async function playFake(page, { until = ['won', 'lost'], stepMs = 16, maxSteps = 1800, hook = /** @type {any} */ (null), bot = createBot(page) } = {}) {
  let sim = await readSim(page);
  for (let i = 0; i < maxSteps && sim && !until.includes(sim.state); i++) {
    await bot.tick(sim);
    await page.clock.runFor(stepMs);
    sim = await readSim(page);
    if (hook) await hook(sim, i);
  }
  await bot.release();
  return sim;
}

/** Same on real time (hosted verification). */
export async function playReal(page, { until = ['won', 'lost'], timeoutMs = 40000, bot = createBot(page) } = {}) {
  const t0 = Date.now();
  let sim = await readSim(page);
  while (sim && !until.includes(sim.state) && Date.now() - t0 < timeoutMs) {
    await bot.tick(sim);
    await page.waitForTimeout(12);
    sim = await readSim(page);
  }
  await bot.release();
  return sim;
}
export { CFG };
