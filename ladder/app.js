// ladder demo: drag tasks between stations, live metrics, optimum comparison, browser simulation.
(function () {
  "use strict";
  const D = window.LADDER_DATA;
  const TASKS = D.instance.tasks;                 // {id, time, preds}
  const N = TASKS.length;
  const byId = new Map(TASKS.map(t => [t.id, t]));
  const SUCCS = new Map(TASKS.map(t => [t.id, []]));
  TASKS.forEach(t => t.preds.forEach(p => SUCCS.get(p).push(t.id)));
  const TOTAL = TASKS.reduce((s, t) => s + t.time, 0);
  const STOPS = D.optimal.balances.map(b => b.cycle_time);
  const $ = id => document.getElementById(id);

  // ---- state -------------------------------------------------------------
  const S = {
    c: STOPS[2],
    assign: new Map(),       // task id -> station index (0-based), absent = unassigned
    cv: 0.3, buffer: 0,
    mine: null,              // snapshot of the visitor's balance while the optimum is shown
    animating: false,
  };

  // ---- graph helpers -----------------------------------------------------
  function topoOrder() {
    const indeg = new Map(TASKS.map(t => [t.id, t.preds.length]));
    const ready = TASKS.filter(t => t.preds.length === 0).map(t => t.id).sort((a, b) => a - b);
    const out = [];
    while (ready.length) {
      const i = ready.shift();
      out.push(i);
      for (const s of SUCCS.get(i)) {
        indeg.set(s, indeg.get(s) - 1);
        if (indeg.get(s) === 0) { ready.push(s); ready.sort((a, b) => a - b); }
      }
    }
    return out;
  }
  const allSuccs = new Map();
  (function () {
    const order = topoOrder().slice().reverse();
    for (const i of order) {
      const acc = new Set();
      for (const s of SUCCS.get(i)) { acc.add(s); allSuccs.get(s).forEach(x => acc.add(x)); }
      allSuccs.set(i, acc);
    }
  })();

  function firstFitInOrder(c) {
    const a = new Map();
    let k = 0, room = c;
    for (const id of topoOrder()) {
      const t = byId.get(id).time;
      if (t > room) { k += 1; room = c; }
      a.set(id, k);
      room -= t;
    }
    return a;
  }

  function rpw(c) {
    const w = new Map(TASKS.map(t => [t.id, t.time + [...allSuccs.get(t.id)].reduce((s, j) => s + byId.get(j).time, 0)]));
    const ranked = TASKS.map(t => t.id).sort((x, y) => (w.get(y) - w.get(x)) || (x - y));
    const a = new Map();
    const left = new Set(ranked);
    let k = 0, room = c;
    while (left.size) {
      let placed = false;
      for (const id of ranked) {
        if (!left.has(id)) continue;
        const t = byId.get(id);
        if (t.time <= room && t.preds.every(p => a.has(p))) { a.set(id, k); room -= t.time; left.delete(id); placed = true; break; }
      }
      if (!placed) { k += 1; room = c; }
    }
    return a;
  }

  // ---- evaluation ----------------------------------------------------------
  function loads() {
    const m = S.assign.size ? Math.max(...S.assign.values()) + 1 : 0;
    const L = new Array(m).fill(0);
    S.assign.forEach((k, id) => { L[k] += byId.get(id).time; });
    return L;
  }
  function compactLoads() { return loads().filter(x => x > 0); }
  function precedenceProblems() {
    const out = [];
    for (const t of TASKS) {
      if (!S.assign.has(t.id)) continue;
      for (const p of t.preds) if (S.assign.has(p) && S.assign.get(p) > S.assign.get(t.id)) out.push([t.id, p]);
    }
    return out;
  }
  function metrics() {
    const L = compactLoads();
    const m = L.length;
    const placedTime = [...S.assign.keys()].reduce((s, id) => s + byId.get(id).time, 0);
    const complete = S.assign.size === N;
    const over = L.some(x => x > S.c);
    const mx = m ? Math.max(...L) : 0;
    const si = m ? Math.sqrt(L.reduce((s, x) => s + (mx - x) ** 2, 0)) : 0;
    return { m, loads: L, complete, over, placedTime,
      efficiency: m ? placedTime / (m * S.c) : 0, smoothness: si, uph: 3600 / S.c,
      feasible: complete && !over && precedenceProblems().length === 0 };
  }

  // the rule every move goes through. returns null or the reason it cannot happen.
  function why(id, station) {
    const t = byId.get(id);
    if (station == null) return null;  // back to the tray is always fine
    for (const p of t.preds) {
      if (S.assign.has(p) && S.assign.get(p) > station)
        return `task ${id} can't go to station ${station + 1}: its predecessor task ${p} is downstream at station ${S.assign.get(p) + 1}`;
    }
    for (const s of SUCCS.get(id)) {
      if (S.assign.has(s) && S.assign.get(s) < station)
        return `task ${id} can't go to station ${station + 1}: task ${s} depends on it and is upstream at station ${S.assign.get(s) + 1}`;
    }
    return null;
  }
  function move(id, station, quiet) {
    const r = why(id, station);
    if (r) { say(r, false); return false; }
    if (station == null) S.assign.delete(id); else S.assign.set(id, station);
    if (S.mine) { S.mine = null; $("btn-mine").hidden = true; $("compare").classList.remove("show"); }
    if (!quiet) {
      const L = loads();
      if (station != null && L[station] > S.c) say(`station ${station + 1} is now at ${L[station]} s, over the ${S.c} s takt`, false);
      else say("", true);
    }
    render();
    return true;
  }

  // ---- rendering -----------------------------------------------------------
  const COL_H = 230;
  function pxPerSec() { return COL_H / (S.c * 1.22); }
  function say(text, ok) { const m = $("msg"); m.textContent = text; m.classList.toggle("ok", !!ok); }

  function taskEl(id, inTray) {
    const t = byId.get(id);
    const el = document.createElement("div");
    el.className = "task";
    el.dataset.id = id;
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    const where = inTray ? "unassigned" : `station ${S.assign.get(id) + 1}`;
    el.setAttribute("aria-label", `task ${id}, ${t.time} seconds, ${where}. arrow keys move it between stations, delete sends it to the tray`);
    el.innerHTML = `<span>${id}</span><span class="t">${t.time}s</span>`;
    if (!inTray) el.style.setProperty("--h", `${t.time * pxPerSec()}px`);
    return el;
  }

  function render() {
    const board = $("board");
    const L = loads();
    const m = Math.max(L.length + 1, 1);   // always one spare empty column to drop into
    board.innerHTML = "";
    board.style.setProperty("--colh", `${COL_H}px`);
    for (let k = 0; k < m; k++) {
      const st = document.createElement("div");
      st.className = "station";
      st.dataset.station = k;
      const col = document.createElement("div");
      col.className = "col";
      const load = L[k] || 0;
      if (load > S.c) col.classList.add("over");
      const takt = document.createElement("div");
      takt.className = "takt";
      takt.style.bottom = `${S.c * pxPerSec()}px`;
      col.appendChild(takt);
      const stack = document.createElement("div");
      stack.className = "stack";
      const ids = [...S.assign.entries()].filter(([, s]) => s === k).map(([id]) => id).sort((a, b) => a - b);
      let running = 0;
      for (const id of ids) {
        const el = taskEl(id, false);
        running += byId.get(id).time;
        if (running > S.c) el.classList.add("over");
        stack.appendChild(el);
      }
      col.appendChild(stack);
      const hdr = document.createElement("div");
      hdr.className = "hdr" + (load > S.c ? " over" : "");
      hdr.innerHTML = `<b>${k + 1}</b><br>${load}/${S.c}`;
      st.appendChild(col);
      st.appendChild(hdr);
      board.appendChild(st);
    }
    const tray = $("tray");
    tray.querySelectorAll(".task").forEach(e => e.remove());
    const un = TASKS.filter(t => !S.assign.has(t.id)).map(t => t.id);
    tray.querySelector(".label").textContent = un.length ? `unassigned tasks (${un.length}): drop them on a station` : "every task is on a station";
    for (const id of un) tray.appendChild(taskEl(id, true));
    renderMetrics();
    scheduleSim();
  }

  function renderMetrics() {
    const M = metrics();
    const st = $("m-st");
    st.textContent = M.m || "–";
    st.classList.toggle("bad", M.over);
    $("m-st-s").textContent = !M.complete ? `${N - S.assign.size} task${N - S.assign.size === 1 ? "" : "s"} still unassigned`
      : M.over ? "a station is over the takt" : "all tasks placed, every station under the takt";
    $("m-eff").textContent = M.m ? `${(100 * M.efficiency).toFixed(1)}%` : "–";
    $("m-eff").classList.toggle("bad", M.over);
    $("m-si").textContent = M.m ? M.smoothness.toFixed(1) : "–";
    $("m-uph").textContent = `${M.uph.toFixed(1)}`;
    $("m-uph").classList.toggle("bad", M.over);
  }

  // ---- simulation ------------------------------------------------------------
  let simTimer = null;
  function scheduleSim() { clearTimeout(simTimer); simTimer = setTimeout(runSim, 60); }
  function runSim() {
    const M = metrics();
    const paper = 3600 / S.c;
    $("v-paper").textContent = `${paper.toFixed(1)} uph`;
    if (!M.complete || precedenceProblems().length) {
      $("b-sim").style.width = "0%";
      $("v-sim").textContent = "–";
      $("sim-note").textContent = M.complete ? "fix the precedence problem first" : "place every task first, then the line can run";
      return;
    }
    const r = window.LadderSim.simulate(M.loads, S.cv, S.buffer, 1, 300, 3000);
    const uph = 3600 * r.throughput;
    const mx = Math.max(...M.loads);
    const scale = Math.max(paper, uph);
    $("b-paper").style.width = `${100 * paper / scale}%`;
    $("b-sim").style.width = `${100 * uph / scale}%`;
    $("v-sim").textContent = `${uph.toFixed(1)} uph`;
    const worst = r.stations.map((s, i) => [s.starved + s.blocked, i]).sort((a, b) => b[0] - a[0])[0];
    let note = `${(100 * uph / paper).toFixed(1)}% of the paper rate at cv ${S.cv.toFixed(2)} with ${S.buffer === 0 ? "no buffer" : `a buffer of ${S.buffer}`}`;
    if (M.over) note += `. your busiest station is ${mx} s against a ${S.c} s takt, so the line cannot reach the paper rate even with no variability`;
    else if (S.cv > 0) note += `. station ${worst[1] + 1} loses the most time: ${(100 * r.stations[worst[1]].starved).toFixed(0)}% starved, ${(100 * r.stations[worst[1]].blocked).toFixed(0)}% blocked`;
    $("sim-note").textContent = note + ".";
  }

  // ---- drag and drop (pointer events, so touch works too) ---------------------
  let drag = null;
  function stationUnder(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return undefined;
    if (el.closest("#tray")) return null;
    const st = el.closest(".station");
    return st ? Number(st.dataset.station) : undefined;
  }
  function clearTargets() { document.querySelectorAll(".target").forEach(e => e.classList.remove("target")); }
  document.addEventListener("pointerdown", e => {
    const el = e.target.closest(".task");
    if (!el || S.animating || e.button !== 0) return;
    const r = el.getBoundingClientRect();
    drag = { id: Number(el.dataset.id), el, dx: e.clientX - r.left, dy: e.clientY - r.top, ghost: null, moved: false, x0: e.clientX, y0: e.clientY };
    el.setPointerCapture(e.pointerId);
  });
  document.addEventListener("pointermove", e => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 4) return;
    if (!drag.ghost) {
      drag.moved = true;
      const g = drag.el.cloneNode(true);
      g.classList.add("ghost");
      g.style.width = `${drag.el.offsetWidth}px`;
      g.style.height = `${drag.el.offsetHeight}px`;
      document.body.appendChild(g);
      drag.ghost = g;
      drag.el.classList.add("dragging");
    }
    drag.ghost.style.left = `${e.clientX - drag.dx}px`;
    drag.ghost.style.top = `${e.clientY - drag.dy}px`;
    clearTargets();
    const t = stationUnder(e.clientX, e.clientY);
    if (t === null) $("tray").classList.add("target");
    else if (t !== undefined) document.querySelector(`.station[data-station="${t}"] .col`).classList.add("target");
    e.preventDefault();
  });
  function endDrag(e) {
    if (!drag) return;
    const d = drag; drag = null;
    clearTargets();
    if (d.ghost) d.ghost.remove();
    d.el.classList.remove("dragging");
    if (!d.moved) return;
    const t = stationUnder(e.clientX, e.clientY);
    if (t === undefined) { say(`task ${d.id} dropped outside the board, it stays where it was`, false); return; }
    if (t === (S.assign.has(d.id) ? S.assign.get(d.id) : null)) return;
    move(d.id, t);
  }
  document.addEventListener("pointerup", endDrag);
  document.addEventListener("pointercancel", endDrag);

  // ---- keyboard ----------------------------------------------------------------
  document.addEventListener("keydown", e => {
    const el = e.target.closest && e.target.closest(".task");
    if (!el || S.animating) return;
    const id = Number(el.dataset.id);
    const cur = S.assign.has(id) ? S.assign.get(id) : null;
    const maxSt = loads().length;  // the spare column
    let to;
    if (e.key === "ArrowRight") to = cur === null ? 0 : Math.min(cur + 1, maxSt);
    else if (e.key === "ArrowLeft") to = cur === null ? null : (cur === 0 ? null : cur - 1);
    else if (e.key === "Delete" || e.key === "Backspace") to = null;
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = maxSt;
    else return;
    e.preventDefault();
    if (to === cur) return;
    if (move(id, to)) {
      const again = document.querySelector(`.task[data-id="${id}"]`);
      if (again) again.focus();
    }
  });

  // ---- buttons and sliders ------------------------------------------------------
  function setAssign(map) { S.assign = new Map(map); render(); }
  function forgetMine() { S.mine = null; $("btn-mine").hidden = true; $("compare").classList.remove("show"); }
  function optimalFor(c) { return D.optimal.balances.find(b => b.cycle_time === c); }
  $("btn-reset").addEventListener("click", () => {
    if (S.animating) return;
    forgetMine();
    setAssign(firstFitInOrder(S.c));
    say("reset: tasks dropped into stations in numbering order, the unbalanced starting point", true);
  });
  $("btn-rpw").addEventListener("click", () => {
    if (S.animating) return;
    forgetMine();
    setAssign(rpw(S.c));
    const M = metrics();
    say(`ranked positional weight: ${M.m} stations, ${(100 * M.efficiency).toFixed(1)}% efficient. the proven optimum at this takt is ${optimalFor(S.c).stations}`, true);
  });
  $("btn-opt").addEventListener("click", () => {
    if (S.animating) return;
    const before = metrics();
    S.mine = new Map(S.assign);
    const opt = optimalFor(S.c);
    const order = topoOrder();
    S.animating = true;
    S.assign = new Map();
    render();
    let i = 0;
    const step = () => {
      if (i < order.length) {
        const id = order[i++];
        S.assign.set(id, opt.assignment[id - 1] - 1);
        render();
        setTimeout(step, 45);
      } else {
        S.animating = false;
        $("btn-mine").hidden = false;
        showCompare(before, opt);
      }
    };
    step();
  });
  $("btn-mine").addEventListener("click", () => {
    if (S.animating || !S.mine) return;
    const m = S.mine;
    forgetMine();
    setAssign(m);
    say("back to your balance", true);
  });
  function showCompare(before, opt) {
    const yours = before.m, best = opt.stations;
    let big, detail;
    if (!before.complete) {
      big = `you had ${yours} station${yours === 1 ? "" : "s"} with tasks still unassigned; the optimum is <span class="num">${best}</span>.`;
      detail = "place every task and try again for a real comparison.";
    } else if (before.over) {
      big = `your ${yours} station balance was over the takt; the optimum is <span class="num">${best}</span> stations, all under it.`;
      detail = "a station over the takt means the line cannot run at this cycle time at all.";
    } else if (yours === best) {
      big = `you matched the optimum: <span class="num">${best}</span> stations.`;
      detail = `nobody can do better at a ${S.c} s takt, and that is proven, not guessed. your efficiency was ${(100 * before.efficiency).toFixed(1)}%, the optimum's is ${(100 * opt.line_efficiency).toFixed(1)}%`
        + (before.smoothness > opt.smoothness_index + 1e-9 ? `; the optimum is smoother (${opt.smoothness_index.toFixed(1)} against your ${before.smoothness.toFixed(1)})` : "") + ".";
    } else {
      const gap = yours - best;
      big = `you used <span class="num">${yours}</span> stations, the optimum uses <span class="num">${best}</span>: a gap of ${gap} station${gap === 1 ? "" : "s"} (${(100 * gap / best).toFixed(0)}%).`;
      detail = `at a ${S.c} s takt that is ${(100 * before.efficiency).toFixed(1)}% line efficiency against ${(100 * opt.line_efficiency).toFixed(1)}%, and ${gap} more operator${gap === 1 ? "" : "s"} for the same output.`;
    }
    $("cmp-big").innerHTML = big;
    $("cmp-detail").textContent = detail;
    $("cmp-note").textContent = `the optimum was proven by or-tools cp-sat; rpw gets ${opt.rpw_stations} stations at this takt. "back to my balance" restores yours.`;
    $("compare").classList.add("show");
    say("", true);
  }

  const ct = $("ct");
  function applyCycle() {
    S.c = STOPS[Number(ct.value)];
    $("ct-out").textContent = `${S.c} s`;
    ct.setAttribute("aria-valuetext", `${S.c} seconds`);
    forgetMine();
    render();
  }
  ct.addEventListener("input", applyCycle);
  $("cv").addEventListener("input", e => { S.cv = Number(e.target.value); $("cv-out").textContent = S.cv.toFixed(2); scheduleSim(); });
  $("buf").addEventListener("input", e => { S.buffer = Number(e.target.value); $("buf-out").textContent = String(S.buffer); scheduleSim(); });

  // ---- start ------------------------------------------------------------------
  S.assign = firstFitInOrder(STOPS[Number(ct.value)]);
  applyCycle();
})();
