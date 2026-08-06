/* ZapQuake planner — "can I kill this with the spells I actually have?"
 *
 * The answer people want is yes/no plus a reason, not a grid of every
 * combination that theoretically works. So this leads with one recommendation
 * against the player's own spell levels and shows the arithmetic behind it.
 *
 * ── DATA ACCURACY ───────────────────────────────────────────────────────────
 * The Clash API exposes a player's spell LEVELS but no balance data — there is
 * no endpoint for spell damage or building hitpoints (/spells, /buildings and
 * /defenses all 404). Every number below is therefore hand-entered and must be
 * checked against the game after each balance patch. A wrong value here tells
 * someone a combo works when it does not, which costs them a war attack, so
 * VERIFIED is flipped to true only once a human has confirmed the tables.
 */

const ZQ_VERIFIED = false; // ← set true only after checking every value in-game

// Damage of one Lightning Spell, by spell level.
const LIGHTNING_DMG = {
  1: 150, 2: 180, 3: 210, 4: 240, 5: 270, 6: 320, 7: 400,
  8: 480, 9: 560, 10: 600, 11: 640, 12: 680, 13: 720,
};

// Percentage of a building's max HP removed by one Earthquake Spell.
// Stacked quakes have diminishing returns — see quakeDamage() below.
const EARTHQUAKE_PCT = {
  1: 14, 2: 17, 3: 21, 4: 25, 5: 29, 6: 33, 7: 37, 8: 40,
};

// Hitpoints of the defences people actually zap, by building level.
const DEFENCE_HP = {
  "Air Defense":    { 9: 1400, 10: 1500, 11: 1600, 12: 1700, 13: 1800, 14: 1900 },
  "Inferno Tower":  { 7: 3000, 8: 3200, 9: 3400, 10: 3600, 11: 3800, 12: 4000 },
  "Eagle Artillery":{ 4: 4600, 5: 4900, 6: 5200, 7: 5500 },
  "Scattershot":    { 3: 4400, 4: 4700, 5: 5000, 6: 5300 },
  "Monolith":       { 1: 4500, 2: 4800, 3: 5100, 4: 5400 },
};

/* Each Earthquake after the first is worth less against the same building:
   the Nth quake deals its percentage divided by N. Four quakes is the
   practical ceiling — a fifth adds almost nothing. */
function quakeDamage(maxHp, quakeLevel, count) {
  const pct = EARTHQUAKE_PCT[quakeLevel] || 0;
  let total = 0;
  for (let n = 1; n <= count; n++) total += (maxHp * pct / 100) / n;
  return Math.min(total, maxHp);
}

/* Cheapest combo that kills the target, searching quakes first because they
   scale with the building's size while lightning is flat. Housing space is the
   real currency in an army, so "cheapest" means fewest total spell slots. */
function solveZapQuake(maxHp, lightningLevel, quakeLevel, opts = {}) {
  const maxL = opts.maxLightning ?? 12;
  const maxQ = opts.maxQuake ?? 4;
  const lDmg = LIGHTNING_DMG[lightningLevel] || 0;
  if (!lDmg || !maxHp) return null;

  const options = [];
  for (let q = 0; q <= maxQ; q++) {
    const afterQuake = maxHp - quakeDamage(maxHp, quakeLevel, q);
    const needed = Math.ceil(afterQuake / lDmg);
    if (needed < 0 || needed > maxL) continue;
    options.push({
      lightning: needed,
      quake: q,
      // Lightning and Earthquake both take 1 housing space per spell.
      slots: needed + q,
      hpBefore: maxHp,
      hpAfterQuake: Math.max(0, Math.round(afterQuake)),
      quakeRemoved: Math.round(quakeDamage(maxHp, quakeLevel, q)),
      lightningDamage: needed * lDmg,
    });
  }
  if (!options.length) return null;
  options.sort((a, b) => a.slots - b.slots || a.quake - b.quake);
  return { best: options[0], alternatives: options.slice(1, 4) };
}

/* Read the player's own spell levels — the whole point is answering against
   what they have, not against a hypothetical maxed account. */
function playerSpellLevels() {
  const p = typeof loadPlayerData === "function" ? loadPlayerData() : null;
  const find = (n) => (p?.spells || []).find(s =>
    s.name === n && (!s.village || s.village === "home"));
  return {
    lightning: find("Lightning Spell")?.level || null,
    quake: find("Earthquake Spell")?.level || null,
    townHall: p?.townHallLevel || null,
    hasVillage: !!p,
  };
}

function zqEsc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderZapQuake() {
  const host = document.getElementById("zapquakeBody");
  if (!host) return;
  const lv = playerSpellLevels();

  if (!lv.hasVillage || !lv.lightning) {
    host.innerHTML = `<p class="muted small">
      Analyze your village above and this will use your own Lightning and
      Earthquake levels — no setup needed.</p>`;
    return;
  }

  const targetSel = document.getElementById("zqTarget");
  const levelSel = document.getElementById("zqLevel");
  const target = targetSel?.value || "Air Defense";
  const levels = DEFENCE_HP[target] || {};
  const lvlKeys = Object.keys(levels).map(Number).sort((a, b) => a - b);

  // Keep the level dropdown in step with the chosen defence.
  if (levelSel && levelSel.dataset.for !== target) {
    levelSel.innerHTML = lvlKeys.map(l =>
      `<option value="${l}">Level ${l}</option>`).join("");
    levelSel.value = String(lvlKeys[lvlKeys.length - 1]);
    levelSel.dataset.for = target;
  }

  const bLevel = Number(levelSel?.value) || lvlKeys[lvlKeys.length - 1];
  const maxHp = levels[bLevel];
  const res = solveZapQuake(maxHp, lv.lightning, lv.quake || 1);

  const yourSpells = `<span class="muted small">Using your
    <strong>Lightning L${lv.lightning}</strong>${lv.quake ? ` and <strong>Earthquake L${lv.quake}</strong>` : ""}</span>`;

  if (!res) {
    host.innerHTML = `
      <div class="card" style="background:var(--bg2);text-align:center;padding:20px">
        <div style="font-size:1.1rem;font-weight:800;color:var(--red)">Not worth zapping</div>
        <p class="muted small" style="margin-top:6px">
          A level ${bLevel} ${zqEsc(target)} (${maxHp.toLocaleString()} HP) needs more spells
          than an army can carry at your levels.</p>
        ${yourSpells}
      </div>`;
    return;
  }

  const b = res.best;
  const chip = (n, label, cls) =>
    `<span class="player-chip" style="font-size:.95rem"><span class="th" style="${cls}">×${n}</span>${label}</span>`;

  // The recommendation first and large; the reasoning under it; alternatives last.
  host.innerHTML = `
    <div class="card" style="background:var(--bg2);padding:18px">
      <div class="muted small">Bring</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:8px 0 4px">
        ${b.lightning ? chip(b.lightning, "Lightning", "color:var(--accent)") : ""}
        ${b.quake ? chip(b.quake, "Earthquake", "color:var(--gold)") : ""}
      </div>
      <div class="muted small">${b.slots} spell slot${b.slots === 1 ? "" : "s"} · ${yourSpells}</div>
    </div>

    <details class="card" style="padding:14px 16px;margin-top:10px" open>
      <summary><strong>Why this works</strong></summary>
      <div style="margin-top:10px" class="small">
        <p>A level ${bLevel} ${zqEsc(target)} has <strong>${b.hpBefore.toLocaleString()} HP</strong>.</p>
        ${b.quake ? `<p style="margin-top:6px">
          ${b.quake} Earthquake${b.quake === 1 ? " strips" : "s strip"}
          <strong>${b.quakeRemoved.toLocaleString()} HP</strong> — quakes hit for a
          percentage, so they do the heavy lifting on big buildings. That leaves
          <strong>${b.hpAfterQuake.toLocaleString()} HP</strong>.</p>` : ""}
        <p style="margin-top:6px">
          ${b.lightning} Lightning at L${lv.lightning} deals
          <strong>${b.lightningDamage.toLocaleString()}</strong> — enough to finish it.</p>
        ${b.quake ? `<p class="muted" style="margin-top:8px">
          Drop the Earthquakes first. Each extra quake on the same building is worth
          less than the last, which is why ${b.quake} is the sweet spot rather than more.</p>` : ""}
      </div>
    </details>

    ${res.alternatives.length ? `
    <details class="card" style="padding:14px 16px;margin-top:10px">
      <summary><strong>Other combos that also work</strong> <span class="muted small">(${res.alternatives.length})</span></summary>
      <table style="margin-top:10px"><thead><tr>
        <th>Lightning</th><th>Earthquake</th><th>Slots</th>
      </tr></thead><tbody>
        ${res.alternatives.map(a => `<tr>
          <td>×${a.lightning}</td><td>${a.quake ? "×" + a.quake : "—"}</td><td>${a.slots}</td>
        </tr>`).join("")}
      </tbody></table>
    </details>` : ""}

    ${!ZQ_VERIFIED ? `<p class="muted small" style="margin-top:10px">
      ⚠️ Spell and building values are still being verified against the current
      game version — double-check before relying on this in a war attack.</p>` : ""}`;
}

document.addEventListener("DOMContentLoaded", () => {
  const t = document.getElementById("zqTarget");
  const l = document.getElementById("zqLevel");
  if (t) t.addEventListener("change", renderZapQuake);
  if (l) l.addEventListener("change", renderZapQuake);
  renderZapQuake();
});
