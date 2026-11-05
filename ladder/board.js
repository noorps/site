// ladder board: one component that both the demo page and the homepage mount.
// LadderBoard.create(data, opts) returns {mountBoard(el), mountSim(el)}; the board part holds
// the controls, stations, tray, metric tiles and comparison panel, the sim part the
// variability and buffer sliders with the paper-vs-simulated bars. all solver, metric and
// simulation logic is unchanged from the original single page script.
(function (root) {
  "use strict";

  function create(D, opts) {
    opts = opts || {};
    const TASKS = D.instance.tasks;                 // {id, time, preds}
    const N = TASKS.length;
    const byId = new Map(TASKS.map(t => [t.id, t]));
    const SUCCS = new Map(TASKS.map(t => [t.id, []]));
    TASKS.forEach(t => t.preds.forEach(p => SUCCS.get(p).push(t.id)));
    const STOPS = D.optimal.balances.map(b => b.cycle_time);
    const R = { board: null, sim: null };
    const q = name => (R.board && R.board.querySelector(`[data-r="${name}"]`)) || (R.sim && R.sim.querySelector(`[data-r="${name}"]`));

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
      if (S.mine) forgetMine();
      if (!quiet) {
        const L = loads();
        if (station != null && L[station] > S.c) say(`station ${station + 1} is now at ${L[station]} s, over the ${S.c} s takt`, false);
        else say("", true);
      }
      render();
      return true;
    }
    function say(text, ok) { const m = q("msg"); if (!m) return; m.textContent = text; m.classList.toggle("ok", !!ok); }
    function forgetMine() { S.mine = null; q("btn-mine").hidden = true; q("compare").classList.remove("show"); }
    function optimalFor(c) { return D.optimal.balances.find(b => b.cycle_time === c); }

    // ---- markup -----------------------------------------------------------------
    function boardHtml() {
      return `
  <div class="lb-controls">
    <div class="lb-ctl"><label>cycle time<input data-r="ct" type="range" min="0" max="3" step="1" value="2" aria-valuetext="41 seconds"></label><output data-r="ct-out" class="lb-num">41 s</output></div>
    <button data-r="btn-reset" type="button">reset</button>
    <button data-r="btn-rpw" type="button">balance it for me with rpw</button>
    <button data-r="btn-opt" type="button" class="primary">show me the optimum</button>
    <button data-r="btn-mine" type="button" hidden>back to my balance</button>
  </div>
  <p class="lb-msg" data-r="msg" role="status" aria-live="polite"></p>
  <div class="lb-board" data-r="board" aria-label="stations"></div>
  <div class="lb-tray" data-r="tray" aria-label="unassigned tasks"><span class="lb-label">unassigned tasks: drop them on a station</span></div>
  <p class="lb-legend">block height is task time. the dashed line is the takt (cycle time); a station over it turns red.</p>
  <div class="lb-tiles" aria-live="polite">
    <div class="lb-tile"><div class="k">stations used</div><div class="v" data-r="m-st">–</div><div class="s" data-r="m-st-s"></div></div>
    <div class="lb-tile"><div class="k">line efficiency</div><div class="v" data-r="m-eff">–</div><div class="s">total work / (stations × takt)</div></div>
    <div class="lb-tile"><div class="k">smoothness index</div><div class="v" data-r="m-si">–</div><div class="s">0 means every station equally loaded</div></div>
    <div class="lb-tile"><div class="k">theoretical rate</div><div class="v" data-r="m-uph">–</div><div class="s">units per hour at this takt</div></div>
  </div>
  <div class="lb-compare" data-r="compare" aria-live="polite">
    <p class="big" data-r="cmp-big"></p>
    <p data-r="cmp-detail"></p>
    <p class="small" data-r="cmp-note"></p>
  </div>`;
    }
    function simHtml() {
      return `
  <div class="lb-controls">
    <div class="lb-ctl"><label>variability (cv)<input data-r="cv" type="range" min="0" max="1" step="0.05" value="0.3"></label><output data-r="cv-out" class="lb-num">0.30</output></div>
    <div class="lb-ctl"><label>buffer between stations<input data-r="buf" type="range" min="0" max="8" step="1" value="0"></label><output data-r="buf-out" class="lb-num">0</output></div>
  </div>
  <div class="lb-bars">
    <div class="lb-bar"><span class="lbl">paper rate</span><span class="track"><span class="fill ref" data-r="b-paper" style="width:100%"></span></span><span class="val" data-r="v-paper">–</span></div>
    <div class="lb-bar"><span class="lbl">simulated</span><span class="track"><span class="fill" data-r="b-sim" style="width:0%"></span></span><span class="val" data-r="v-sim">–</span></div>
  </div>
  <p class="lb-small" data-r="sim-note"></p>`;
    }

    // ---- rendering -----------------------------------------------------------
    const COL_H = opts.columnHeight || 230;
    function pxPerSec() { return COL_H / (S.c * 1.22); }

    function taskEl(id, inTray) {
      const t = byId.get(id);
      const el = document.createElement("div");
      el.className = "lb-task";
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
      if (!R.board) return;
      const board = q("board");
      const L = loads();
      const m = Math.max(L.length + 1, 1);   // always one spare empty column to drop into
      board.innerHTML = "";
      board.style.setProperty("--colh", `${COL_H}px`);
      for (let k = 0; k < m; k++) {
        const st = document.createElement("div");
        st.className = "lb-station";
        st.dataset.station = k;
        const col = document.createElement("div");
        col.className = "lb-col";
        const load = L[k] || 0;
        if (load > S.c) col.classList.add("over");
        const takt = document.createElement("div");
        takt.className = "lb-takt";
        takt.style.bottom = `${S.c * pxPerSec()}px`;
        col.appendChild(takt);
        const stack = document.createElement("div");
        stack.className = "lb-stack";
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
        hdr.className = "lb-hdr" + (load > S.c ? " over" : "");
        hdr.innerHTML = `<b>${k + 1}</b><br>${load}/${S.c}`;
        st.appendChild(col);
        st.appendChild(hdr);
        board.appendChild(st);
      }
      const tray = q("tray");
      tray.querySelectorAll(".lb-task").forEach(e => e.remove());
      const un = TASKS.filter(t => !S.assign.has(t.id)).map(t => t.id);
      tray.querySelector(".lb-label").textContent = un.length ? `unassigned tasks (${un.length}): drop them on a station` : "every task is on a station";
      for (const id of un) tray.appendChild(taskEl(id, true));
      renderMetrics();
      scheduleSim();
    }

    function renderMetrics() {
      const M = metrics();
      const st = q("m-st");
      st.textContent = M.m || "–";
      st.classList.toggle("bad", M.over);
      q("m-st-s").textContent = !M.complete ? `${N - S.assign.size} task${N - S.assign.size === 1 ? "" : "s"} still unassigned`
        : M.over ? "a station is over the takt" : "all tasks placed, every station under the takt";
      q("m-eff").textContent = M.m ? `${(100 * M.efficiency).toFixed(1)}%` : "–";
      q("m-eff").classList.toggle("bad", M.over);
      q("m-si").textContent = M.m ? M.smoothness.toFixed(1) : "–";
      q("m-uph").textContent = `${M.uph.toFixed(1)}`;
      q("m-uph").classList.toggle("bad", M.over);
    }

    // ---- simulation ------------------------------------------------------------
    let simTimer = null;
    function scheduleSim() { clearTimeout(simTimer); simTimer = setTimeout(runSim, 60); }
    function runSim() {
      if (!R.sim) return;
      const M = metrics();
      const paper = 3600 / S.c;
      q("v-paper").textContent = `${paper.toFixed(1)} uph`;
      if (!M.complete || precedenceProblems().length) {
        q("b-sim").style.width = "0%";
        q("v-sim").textContent = "–";
        q("sim-note").textContent = M.complete ? "fix the precedence problem first" : "place every task first, then the line can run";
        return;
      }
      const r = root.LadderSim.simulate(M.loads, S.cv, S.buffer, 1, 300, 3000);
      const uph = 3600 * r.throughput;
      const mx = Math.max(...M.loads);
      const scale = Math.max(paper, uph);
      q("b-paper").style.width = `${100 * paper / scale}%`;
      q("b-sim").style.width = `${100 * uph / scale}%`;
      q("v-sim").textContent = `${uph.toFixed(1)} uph`;
      const worst = r.stations.map((s, i) => [s.starved + s.blocked, i]).sort((a, b) => b[0] - a[0])[0];
      let note = `${(100 * uph / paper).toFixed(1)}% of the paper rate at cv ${S.cv.toFixed(2)} with ${S.buffer === 0 ? "no buffer" : `a buffer of ${S.buffer}`}`;
      if (M.over) note += `. your busiest station is ${mx} s against a ${S.c} s takt, so the line cannot reach the paper rate even with no variability`;
      else if (S.cv > 0) note += `. station ${worst[1] + 1} loses the most time: ${(100 * r.stations[worst[1]].starved).toFixed(0)}% starved, ${(100 * r.stations[worst[1]].blocked).toFixed(0)}% blocked`;
      q("sim-note").textContent = note + ".";
    }

    // ---- drag and drop (pointer events, so touch works too) ---------------------
    let drag = null;
    function stationUnder(x, y) {
      const el = document.elementFromPoint(x, y);
      if (!el || !R.board.contains(el)) return undefined;
      if (el.closest(".lb-tray")) return null;
      const st = el.closest(".lb-station");
      return st ? Number(st.dataset.station) : undefined;
    }
    function clearTargets() { R.board.querySelectorAll(".target").forEach(e => e.classList.remove("target")); }
    function onDown(e) {
      const el = e.target.closest(".lb-task");
      if (!el || S.animating || e.button !== 0) return;
      const r = el.getBoundingClientRect();
      drag = { id: Number(el.dataset.id), el, dx: e.clientX - r.left, dy: e.clientY - r.top, ghost: null, moved: false, x0: e.clientX, y0: e.clientY };
      el.setPointerCapture(e.pointerId);
    }
    function onMove(e) {
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
      if (t === null) q("tray").classList.add("target");
      else if (t !== undefined) R.board.querySelector(`.lb-station[data-station="${t}"] .lb-col`).classList.add("target");
      e.preventDefault();
    }
    function onUp(e) {
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

    // ---- keyboard ----------------------------------------------------------------
    function onKey(e) {
      const el = e.target.closest && e.target.closest(".lb-task");
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
        const again = R.board.querySelector(`.lb-task[data-id="${id}"]`);
        if (again) again.focus();
      }
    }

    // ---- buttons --------------------------------------------------------------------
    function setAssign(map) { S.assign = new Map(map); render(); }
    function showOptimum() {
      if (S.animating) return;
      const before = metrics();
      S.mine = new Map(S.assign);
      const opt = optimalFor(S.c);
      const finish = () => {
        S.animating = false;
        q("btn-opt").disabled = false;
        q("btn-mine").hidden = false;
        showCompare(before, opt);
      };
      const reduced = root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduced) {
        S.assign = new Map(TASKS.map(t => [t.id, opt.assignment[t.id - 1] - 1]));
        render();
        finish();
        return;
      }
      const order = topoOrder();
      S.animating = true;
      q("btn-opt").disabled = true;
      say("placing the proven optimum", true);
      S.assign = new Map();
      render();
      let i = 0;
      const step = () => {
        if (i < order.length) {
          const id = order[i++];
          S.assign.set(id, opt.assignment[id - 1] - 1);
          render();
          setTimeout(step, 20);
        } else finish();
      };
      step();
    }
    function showCompare(before, opt) {
      const yours = before.m, best = opt.stations;
      let big, detail;
      if (!before.complete) {
        big = `you had ${yours} station${yours === 1 ? "" : "s"} with tasks still unassigned; the optimum is <span class="lb-num">${best}</span>.`;
        detail = "place every task and try again for a real comparison.";
      } else if (before.over) {
        big = `your ${yours} station balance was over the takt; the optimum is <span class="lb-num">${best}</span> stations, all under it.`;
        detail = "a station over the takt means the line cannot run at this cycle time at all.";
      } else if (yours === best) {
        big = `you matched the optimum: <span class="lb-num">${best}</span> stations.`;
        detail = `nobody can do better at a ${S.c} s takt, and that is proven, not guessed. your efficiency was ${(100 * before.efficiency).toFixed(1)}%, the optimum's is ${(100 * opt.line_efficiency).toFixed(1)}%`
          + (before.smoothness > opt.smoothness_index + 1e-9 ? `; the optimum is smoother (${opt.smoothness_index.toFixed(1)} against your ${before.smoothness.toFixed(1)})` : "") + ".";
      } else {
        const gap = yours - best;
        big = `you used <span class="lb-num">${yours}</span> stations, the optimum uses <span class="lb-num">${best}</span>: a gap of ${gap} station${gap === 1 ? "" : "s"} (${(100 * gap / best).toFixed(0)}%).`;
        detail = `at a ${S.c} s takt that is ${(100 * before.efficiency).toFixed(1)}% line efficiency against ${(100 * opt.line_efficiency).toFixed(1)}%, and ${gap} more operator${gap === 1 ? "" : "s"} for the same output.`;
      }
      q("cmp-big").innerHTML = big;
      q("cmp-detail").textContent = detail;
      q("cmp-note").textContent = `the optimum was proven by or-tools cp-sat; rpw gets ${opt.rpw_stations} stations at this takt. "back to my balance" restores yours.`;
      q("compare").classList.add("show");
      say("", true);
    }

    // ---- mounting -------------------------------------------------------------------
    function applyCycle() {
      const ct = q("ct");
      S.c = STOPS[Number(ct.value)];
      q("ct-out").textContent = `${S.c} s`;
      ct.setAttribute("aria-valuetext", `${S.c} seconds`);
      forgetMine();
      render();
    }
    function mountBoard(el) {
      el.classList.add("ladder-board");
      el.innerHTML = boardHtml();
      R.board = el;
      el.addEventListener("pointerdown", onDown);
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onUp);
      el.addEventListener("keydown", onKey);
      q("btn-reset").addEventListener("click", () => {
        if (S.animating) return;
        forgetMine();
        setAssign(firstFitInOrder(S.c));
        say("reset: tasks dropped into stations in numbering order, the unbalanced starting point", true);
      });
      q("btn-rpw").addEventListener("click", () => {
        if (S.animating) return;
        forgetMine();
        setAssign(rpw(S.c));
        const M = metrics();
        say(`ranked positional weight: ${M.m} stations, ${(100 * M.efficiency).toFixed(1)}% efficient. the proven optimum at this takt is ${optimalFor(S.c).stations}`, true);
      });
      q("btn-opt").addEventListener("click", showOptimum);
      q("btn-mine").addEventListener("click", () => {
        if (S.animating || !S.mine) return;
        const m = S.mine;
        forgetMine();
        setAssign(m);
        say("back to your balance", true);
      });
      q("ct").addEventListener("input", applyCycle);
      S.assign = firstFitInOrder(STOPS[Number(q("ct").value)]);
      applyCycle();
      return el;
    }
    function mountSim(el) {
      el.classList.add("ladder-board");
      el.innerHTML = simHtml();
      R.sim = el;
      q("cv").addEventListener("input", e => { S.cv = Number(e.target.value); q("cv-out").textContent = S.cv.toFixed(2); scheduleSim(); });
      q("buf").addEventListener("input", e => { S.buffer = Number(e.target.value); q("buf-out").textContent = String(S.buffer); scheduleSim(); });
      scheduleSim();
      return el;
    }
    return { mountBoard, mountSim, state: S };
  }

  root.LadderBoard = { create };
})(window);
