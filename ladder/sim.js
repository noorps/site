// ladder line simulator, browser side. mirrors ladder/sim.py exactly:
// mulberry32 streams seeded per station, box-muller normals, lognormal service times by
// mean and cv, finite buffers between stations, blocking and starving, warm-up discarded.
// the python simulator is the reference; tests/test_web_sim.py checks the two agree.
(function (root) {
  "use strict";

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function stationSeed(seed, k) {
    // python: (seed * 1000003 + 7919 * (k + 1)) & 0xFFFFFFFF, computed without overflow
    const hi = Math.imul(seed, 1000003) >>> 0;  // imul wraps mod 2^32, same as the mask
    return ((hi + 7919 * (k + 1)) >>> 0);
  }

  function lognormalDraw(mean, cv, seed) {
    if (cv <= 0) return function () { return mean; };
    const rnd = mulberry32(seed);
    const sigma = Math.sqrt(Math.log(1 + cv * cv));
    const mu = Math.log(mean) - 0.5 * sigma * sigma;
    return function () {
      let u1 = rnd();
      const u2 = rnd();
      if (u1 < 1e-12) u1 = 1e-12;
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      return Math.exp(mu + sigma * z);
    };
  }

  const STARVED = 0, BUSY = 1, BLOCKED = 2;

  // loads: nominal time per station (all > 0). returns throughput in units per time unit
  // measured over `units` completions after `warmup` completions, plus per-station fractions.
  function simulate(loads, cv, buffer, seed, warmup, units) {
    const m = loads.length;
    const draw = loads.map((l, k) => lognormalDraw(l, cv, stationSeed(seed, k)));
    const buf = new Array(Math.max(m - 1, 0)).fill(0);
    const state = new Array(m).fill(STARVED);
    const since = new Array(m).fill(0);
    const acc = loads.map(() => [0, 0, 0]);
    const finish = new Array(m).fill(Infinity);   // service end time while busy
    const holding = new Array(m).fill(false);     // finished a unit, waiting to push it
    let now = 0, completed = 0, tWarm = null;
    const target = warmup + units;

    function setState(k, s) {
      acc[k][state[k]] += now - since[k];
      state[k] = s;
      since[k] = now;
    }
    function startService(k) {
      setState(k, BUSY);
      finish[k] = now + draw[k]();
    }
    function hasRoom(k) { return buf[k] < buffer || state[k + 1] === STARVED; }

    // settle every hand-off possible at the current time until nothing changes
    function settle() {
      let changed = true;
      while (changed) {
        changed = false;
        for (let k = m - 1; k >= 0; k--) {
          if (holding[k]) {
            if (k === m - 1) {
              holding[k] = false;
              completed += 1;
              if (completed === warmup) {
                tWarm = now;
                for (let j = 0; j < m; j++) { acc[j] = [0, 0, 0]; since[j] = now; }
              }
              if (completed === target) return true;
              changed = true;
            } else if (hasRoom(k)) {
              holding[k] = false;
              buf[k] += 1;
              changed = true;
            } else if (state[k] !== BLOCKED) {
              setState(k, BLOCKED);
            }
          }
          if (!holding[k] && state[k] !== BUSY) {
            if (k === 0) {
              startService(k);
              changed = true;
            } else if (buf[k - 1] > 0) {
              buf[k - 1] -= 1;
              startService(k);
              changed = true;
            } else if (state[k] !== STARVED) {
              setState(k, STARVED);
              changed = true;
            }
          }
        }
      }
      return false;
    }

    settle();
    for (;;) {
      // next service completion
      let k = -1, t = Infinity;
      for (let j = 0; j < m; j++) if (state[j] === BUSY && finish[j] < t) { t = finish[j]; k = j; }
      now = t;
      finish[k] = Infinity;
      holding[k] = true;
      // the station is done with the unit; its state becomes blocked or it hands off in settle()
      acc[k][BUSY] += now - since[k];
      since[k] = now;
      state[k] = BLOCKED;
      if (settle()) break;
    }
    for (let j = 0; j < m; j++) setState(j, state[j]);
    const span = now - tWarm;
    return {
      throughput: units / span,
      span: span,
      tWarm: tWarm,
      stations: acc.map(a => ({ busy: a[BUSY] / span, starved: a[STARVED] / span, blocked: a[BLOCKED] / span })),
    };
  }

  const api = { mulberry32, stationSeed, lognormalDraw, simulate };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.LadderSim = api;
})(typeof window !== "undefined" ? window : globalThis);
