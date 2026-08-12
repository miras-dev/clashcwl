/* Ore & Equipment calculator.
 *
 * Costs live in js/data.js (KB.ores.costs) together with oreCost(), because the
 * analyzer and the coach both reason about Ore too and should not each carry
 * their own copy of the numbers.
 *
 * The breakpoint levels come from the same knowledge base that drives the
 * analyzer's tier advice, so "cost to breakpoint" here and "push it to its
 * breakpoint" there always mean the same level. */

const $o = (id) => document.getElementById(id);
const KBO = loadKB();

function escO(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const fmt = (n) => Number(n).toLocaleString();

/* Breakpoints in the KB are prose ("L21 (18,000+ HP giant figure)", "—"), since
   they are written to be read. Pull the first level number out, or fall back to
   the piece's max when a piece has no meaningful breakpoint. */
function breakpointLevel(eq) {
  const m = String(eq.breakpoint || "").match(/L\s*(\d+)/i);
  if (m) return Math.min(Number(m[1]), eq.maxLevel);
  return eq.maxLevel;
}

function oreChips(cost) {
  const bits = [
    cost.shiny  ? `<span class="ore-chip ore-shiny">✨ ${fmt(cost.shiny)}<span class="muted small"> Shiny</span></span>` : "",
    cost.glowy  ? `<span class="ore-chip ore-glowy">🔷 ${fmt(cost.glowy)}<span class="muted small"> Glowy</span></span>` : "",
    cost.starry ? `<span class="ore-chip ore-starry">⭐ ${fmt(cost.starry)}<span class="muted small"> Starry</span></span>` : "",
  ].filter(Boolean).join("");
  return bits || `<span class="muted small">No cost — already at that level.</span>`;
}

/* ---------------- single-piece calculator ---------------- */

function currentEquipment() {
  return KBO.equipment.find(e => e.name === $o("eqSelect").value) || KBO.equipment[0];
}

/* Keep the level inputs inside the selected piece's range. A common piece
   stops at 18, so a 27 left over from an epic would otherwise silently
   over-count. */
function clampInputs(eq, { resetTo = false } = {}) {
  const from = $o("fromLvl"), to = $o("toLvl");
  from.max = eq.maxLevel; to.max = eq.maxLevel;
  from.value = Math.max(1, Math.min(Number(from.value) || 1, eq.maxLevel));
  if (resetTo) to.value = eq.maxLevel;
  to.value = Math.max(1, Math.min(Number(to.value) || eq.maxLevel, eq.maxLevel));
  if (Number(to.value) < Number(from.value)) to.value = from.value;
}

function renderCalc() {
  const eq = currentEquipment();
  clampInputs(eq);
  const from = Number($o("fromLvl").value);
  const to = Number($o("toLvl").value);
  const cost = oreCost(eq.rarity, from, to);
  const bp = breakpointLevel(eq);

  const toMax = oreCost(eq.rarity, to, eq.maxLevel);
  const remaining = (toMax.shiny || toMax.glowy || toMax.starry)
    ? `<p class="muted small" style="margin-bottom:0">
         From level ${to} to max (${eq.maxLevel}) would cost a further
         ${fmt(toMax.shiny)} Shiny${toMax.glowy ? ` · ${fmt(toMax.glowy)} Glowy` : ""}${toMax.starry ? ` · ${fmt(toMax.starry)} Starry` : ""}.
       </p>`
    : `<p class="muted small" style="margin-bottom:0">That is this piece maxed.</p>`;

  $o("calcResult").innerHTML = `
    <div class="ore-total">
      <div class="row" style="justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap">
        <div>
          <strong>${escO(eq.name)}</strong>
          <span class="pill ${tierClass(eq.tier)}" style="margin-left:6px">${escO(eq.tier)}</span>
          <div class="muted small">${escO(eq.hero)} · ${escO(eq.rarity)} · level ${from} → ${to}</div>
        </div>
        <div class="muted small">${cost.levels} level${cost.levels === 1 ? "" : "s"}</div>
      </div>
      <div class="ore-chips">${oreChips(cost)}</div>
      ${eq.breakpoint && eq.breakpoint !== "—"
        ? `<p class="muted small" style="margin:8px 0 0">
             Meta breakpoint: <strong>${escO(eq.breakpoint)}</strong>${
               to < bp ? ` — you are ${bp - to} level${bp - to === 1 ? "" : "s"} short of it.` : ""}
           </p>`
        : ""}
      ${remaining}
    </div>`;
}

/* ---------------- your equipment ---------------- */

function renderMine() {
  const player = loadPlayerData();
  const owned = player?.heroEquipment || [];
  const has = owned.length > 0;

  $o("mineCard").style.display = has ? "block" : "none";
  $o("noVillageCard").style.display = has ? "none" : "block";
  if (!has) return;

  const mode = $o("mineTarget").value;
  const rows = [];
  const total = { shiny: 0, glowy: 0, starry: 0 };

  owned.forEach(item => {
    const eq = kbFindEquipment(item.name);
    // Equipment the knowledge base does not know (a piece released after this
    // build) has no rarity or breakpoint, so it cannot be priced.
    if (!eq) return;
    const lvl = Number(item.level) || 1;
    // Never ask for a target below where the piece already is — a piece past
    // its breakpoint is done, not due a downgrade.
    const target = Math.max(lvl, mode === "max" ? eq.maxLevel : breakpointLevel(eq));
    const cost = oreCost(eq.rarity, lvl, target);
    total.shiny += cost.shiny; total.glowy += cost.glowy; total.starry += cost.starry;
    const done = lvl >= target;
    rows.push({ eq, lvl, target, cost, done });
  });

  // Most expensive first — that is the decision the page exists to inform.
  rows.sort((a, b) =>
    (b.cost.starry - a.cost.starry) || (b.cost.shiny - a.cost.shiny) || a.eq.name.localeCompare(b.eq.name));

  const body = rows.map(r => `<tr${r.done ? ' class="ore-done"' : ""}>
    <td><strong>${escO(r.eq.name)}</strong><div class="muted small">${escO(r.eq.hero)}</div></td>
    <td><span class="pill ${tierClass(r.eq.tier)}">${escO(r.eq.tier)}</span></td>
    <td>${r.lvl} → ${r.target}</td>
    <td>${r.done ? '<span class="muted small">done</span>' : fmt(r.cost.shiny)}</td>
    <td>${r.done ? "" : (r.cost.glowy ? fmt(r.cost.glowy) : "—")}</td>
    <td>${r.done ? "" : (r.cost.starry ? `<strong style="color:var(--gold)">${fmt(r.cost.starry)}</strong>` : "—")}</td>
  </tr>`).join("");

  const pending = rows.filter(r => !r.done).length;
  $o("mineSub").innerHTML = `${owned.length} piece${owned.length === 1 ? "" : "s"} loaded from your village · ` +
    `${pending} still short of ${mode === "max" ? "max" : "breakpoint"}`;

  $o("mineResult").innerHTML = `
    <div class="ore-total" style="margin-bottom:12px">
      <div class="muted small" style="margin-bottom:6px">Total to bring every piece to ${mode === "max" ? "max" : "its breakpoint"}</div>
      <div class="ore-chips">${oreChips(total)}</div>
    </div>
    <table>
      <thead><tr><th>Equipment</th><th>Tier</th><th>Level</th><th>Shiny</th><th>Glowy</th><th>Starry</th></tr></thead>
      <tbody>${body || `<tr><td colspan="6" class="muted">None of your equipment is in the knowledge base.</td></tr>`}</tbody>
    </table>`;

  labelTableCells($o("mineResult"));
}

/* ---------------- builder potions ----------------
   A Builder Potion runs every Builder at 10x for one hour, so each Builder
   completes 10 hours of work in 1 hour of real time — 9 net hours banked.

   The catch that makes a naive "potions x 6 x 9" wrong: a Builder only banks
   the full 9 if its current job has at least 10 hours left. One with 3 hours
   remaining finishes early and idles out the rest of the potion, so it
   contributes its remaining time, not 9 hours. Idle Builders contribute
   nothing at all.

   Hammer Jam does not change the potion's multiplier. It halves build times,
   which cuts both ways: the same potion still buys 9 Builder-hours, but those
   hours now clear twice as much work — while also making it likelier a job has
   under 10 hours left and wastes the boost. */
const POTION_HOURS = 9;      // net hours banked per builder
const POTION_MEDALS = 30;    // CWL shop price, matches SHOP_ITEMS in cwl.js
const MAX_BUILDERS = 6;

function potionMath({ builders, potions, shortJobs, hammerJam, medals }) {
  const working = Math.max(0, Math.min(builders, MAX_BUILDERS));
  const short = Math.max(0, Math.min(shortJobs, working));
  const full = working - short;

  // Builders on a long job bank the full 9h. Ones on a short job bank only
  // what is left of that job — assume half the window on average, since the
  // real figure depends on each individual timer.
  const perPotionFull = full * POTION_HOURS;
  const perPotionShort = short * (POTION_HOURS / 2);
  const perPotion = perPotionFull + perPotionShort;

  const totalHours = perPotion * potions;
  // Hammer Jam halves build times, so a banked hour clears two hours of the
  // work you would have faced outside the event.
  const effectiveHours = hammerJam ? totalHours * 2 : totalHours;

  const affordable = medals > 0 ? Math.floor(medals / POTION_MEDALS) : 0;
  const spent = affordable * POTION_MEDALS;

  return {
    working, short, full, perPotion, totalHours, effectiveHours,
    idle: MAX_BUILDERS - working,
    wasted: potions * (short * (POTION_HOURS / 2) + (MAX_BUILDERS - working) * POTION_HOURS),
    affordable, spent, leftover: medals - spent,
    affordableHours: affordable * perPotion * (hammerJam ? 2 : 1),
  };
}

const hrs = (h) => {
  const n = Math.round(h * 10) / 10;
  if (n < 24) return `${n}h`;
  const d = Math.floor(n / 24), r = Math.round(n % 24);
  return r ? `${d}d ${r}h` : `${d}d`;
};

function renderPotions() {
  const m = potionMath({
    builders: Number($o("builderCount").value) || 0,
    potions: Number($o("potionCount").value) || 0,
    shortJobs: Number($o("shortJobs").value) || 0,
    hammerJam: $o("hammerJam").checked,
    medals: Number($o("medalBudget").value) || 0,
  });

  // Keep the short-job input from exceeding the builder count.
  $o("shortJobs").max = m.working;
  if (Number($o("shortJobs").value) > m.working) $o("shortJobs").value = m.working;

  const jam = $o("hammerJam").checked;

  $o("potionResult").innerHTML = `
    <div class="ore-total">
      <div class="muted small" style="margin-bottom:6px">
        ${m.working} builder${m.working === 1 ? "" : "s"} × ${hrs(m.perPotion / Math.max(m.working, 1))} avg
        = <strong>${hrs(m.perPotion)}</strong> per potion
      </div>
      <div class="ore-chips">
        <span class="ore-chip ore-starry">⏱ ${hrs(m.effectiveHours)}<span class="muted small"> ${jam ? "of normal build time" : "saved"}</span></span>
        ${jam ? `<span class="ore-chip ore-glowy">🔨 ${hrs(m.totalHours)}<span class="muted small"> builder-hours</span></span>` : ""}
      </div>
      ${m.wasted > 0 ? `<p class="muted small" style="margin:10px 0 0">
        <strong style="color:var(--red)">${hrs(m.wasted)} left on the table</strong> —
        ${m.short ? `${m.short} builder${m.short === 1 ? " is" : "s are"} on a job under 10h` : ""}${m.short && m.idle ? ", and " : ""}${m.idle ? `${m.idle} of your ${MAX_BUILDERS} builder${m.idle === 1 ? " has" : "s have"} no upgrade running` : ""}.
        A potion boosts every builder at once, so put a long upgrade on each one before drinking.
      </p>` : `<p class="muted small" style="margin:10px 0 0">
        Every builder is on a long job — this is the full value of the potion.
      </p>`}
      ${jam ? `<p class="muted small" style="margin:8px 0 0">
        Hammer Jam halves build times, so those ${hrs(m.totalHours)} of builder time clear
        ${hrs(m.effectiveHours)} of the work you would face outside the event.
      </p>` : ""}
    </div>

    ${m.affordable > 0 ? `<div class="ore-total" style="margin-top:12px">
      <div class="muted small" style="margin-bottom:6px">CWL medals</div>
      <div>
        <strong>${m.affordable} potion${m.affordable === 1 ? "" : "s"}</strong> for ${fmt(m.spent)} medals
        — worth <strong>${hrs(m.affordableHours)}</strong>${jam ? " of normal build time" : ""}.
        <div class="muted small" style="margin-top:4px">
          ${fmt(m.leftover)} medals left over · ${POTION_MEDALS} medals each
        </div>
      </div>
    </div>` : ""}`;
}

/* ---------------- reference tables ---------------- */

function renderTable(hostId, rarity) {
  const table = KB.ores.costs[rarity];
  let cShiny = 0, cGlowy = 0, cStarry = 0;
  const rows = table.map((c, lvl) => {
    if (!c || lvl === 0) return "";
    cShiny += c.shiny; cGlowy += c.glowy; cStarry += c.starry;
    const milestone = c.glowy || c.starry;
    return `<tr${milestone ? ' class="ore-milestone"' : ""}>
      <td><strong>${lvl}</strong></td>
      <td>${c.shiny ? fmt(c.shiny) : "—"}</td>
      <td>${c.glowy ? fmt(c.glowy) : "—"}</td>
      <td>${rarity === "epic" ? (c.starry ? `<strong style="color:var(--gold)">${fmt(c.starry)}</strong>` : "—") : "—"}</td>
      <td class="muted">${fmt(cShiny)}</td>
      <td class="muted">${fmt(cGlowy)}</td>
      ${rarity === "epic" ? `<td class="muted">${fmt(cStarry)}</td>` : "<td class='muted'>—</td>"}
    </tr>`;
  }).join("");

  $o(hostId).innerHTML = `<table>
    <thead><tr>
      <th>Level</th><th>Shiny</th><th>Glowy</th><th>Starry</th>
      <th>Σ Shiny</th><th>Σ Glowy</th><th>Σ Starry</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
  labelTableCells($o(hostId));
}

/* ---------------- init ---------------- */

(function init() {
  // Group the picker by hero so it reads like the in-game Blacksmith.
  const byHero = {};
  KBO.equipment.forEach(e => (byHero[e.hero] = byHero[e.hero] || []).push(e));
  $o("eqSelect").innerHTML = Object.entries(byHero).map(([hero, list]) =>
    `<optgroup label="${escO(hero)}">${list
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(e => `<option value="${escO(e.name)}">${escO(e.name)} — ${escO(e.rarity)}</option>`)
      .join("")}</optgroup>`).join("");

  // Open on the best piece in the game rather than whatever sorts first.
  const preferred = KBO.equipment.find(e => e.name === "Action Figure") || KBO.equipment[0];
  $o("eqSelect").value = preferred.name;
  clampInputs(preferred, { resetTo: true });

  $o("eqSelect").addEventListener("change", () => {
    clampInputs(currentEquipment(), { resetTo: true });
    renderCalc();
  });
  ["fromLvl", "toLvl"].forEach(id => $o(id).addEventListener("input", renderCalc));

  document.querySelectorAll("[data-jump]").forEach(btn => {
    btn.addEventListener("click", () => {
      const eq = currentEquipment();
      $o("toLvl").value = btn.dataset.jump === "max" ? eq.maxLevel : breakpointLevel(eq);
      renderCalc();
    });
  });

  $o("mineTarget").addEventListener("change", renderMine);

  ["builderCount", "potionCount", "shortJobs", "medalBudget"].forEach(id =>
    $o(id).addEventListener("input", renderPotions));
  $o("hammerJam").addEventListener("change", renderPotions);

  renderCalc();
  renderMine();
  renderPotions();
  renderTable("epicTable", "epic");
  renderTable("commonTable", "common");
})();
