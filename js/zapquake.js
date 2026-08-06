/* ZapQuake planner — "can I kill this with what I actually have?"
 *
 * Answers with one recommendation against the player's own spell and equipment
 * levels, then shows the arithmetic. The reasoning is the part people miss, so
 * it is on screen rather than hidden behind the result.
 *
 * All balance numbers come from js/zqdata.js, generated from the
 * clash-of-clans-data package — the game's own values, not hand-entered ones.
 */

/* Each Earthquake after the first is worth less against the same building: the
   Nth quake deals its percentage divided by N. Hero equipment that damages
   buildings by percentage (Earthquake Boots) stacks into the same sequence. */
function zqQuakeDamage(maxHp, pct, count) {
  let total = 0;
  for (let n = 1; n <= count; n++) total += (maxHp * pct / 100) / n;
  return Math.min(total, maxHp);
}

/* Cheapest combo that kills the target. Housing space is the real currency in
   an army, so "cheapest" is fewest spell slots — equipment is free by that
   measure, which is exactly why it is worth showing. */
function zqSolve(maxHp, lightningLevel, quakeLevel, equipment = []) {
  const lDmg = ZQ_LIGHTNING[lightningLevel] || 0;
  const qPct = ZQ_QUAKE[quakeLevel] || 0;
  if (!lDmg || !maxHp) return null;

  const flatEquip = equipment.filter(e => e.flat);
  const pctEquip = equipment.filter(e => e.pct);

  const options = [];
  // A hero ability fires once per attack and is usually committed elsewhere, so
  // it is never combined with another and never treated as the default plan.
  // Spells-only comes first; abilities are shown as a way to spend fewer slots.
  const equipSets = [[], ...flatEquip.map(e => [e])];

  for (const set of equipSets) {
    const flat = set.reduce((a, e) => a + e.flat, 0);
    for (let q = 0; q <= 4; q++) {
      // Percentage-based equipment counts as an extra quake in the stack.
      const pctCount = q + pctEquip.length;
      const removed = pctCount ? zqQuakeDamage(maxHp, qPct || pctEquip[0]?.pct || 0, pctCount) : 0;
      const afterPct = Math.max(0, maxHp - removed - flat);
      const needed = Math.ceil(afterPct / lDmg);
      if (needed > 12) continue;
      options.push({
        lightning: needed, quake: q, equipment: set,
        slots: needed + q,
        hpBefore: maxHp,
        removedByQuake: Math.round(removed),
        removedByEquip: flat,
        hpAfter: Math.round(afterPct),
        lightningDamage: needed * lDmg,
      });
    }
  }
  if (!options.length) return null;
  // Prefer a plan that needs no hero ability: spending one here means not having
  // it for the rest of the attack, which is a real cost the slot count misses.
  options.sort((a, b) =>
    a.equipment.length - b.equipment.length || a.slots - b.slots || a.quake - b.quake);
  // Drop duplicates that read identically to a user.
  const seen = new Set();
  const uniq = options.filter(o => {
    const k = `${o.lightning}-${o.quake}-${o.equipment.map(e => e.name).join()}`;
    if (seen.has(k)) return false; seen.add(k); return true;
  });
  return { best: uniq[0], alternatives: uniq.slice(1, 5) };
}

/* Read the player's own levels — the point is answering against what they own. */
function zqPlayer() {
  const p = typeof loadPlayerData === "function" ? loadPlayerData() : null;
  const home = (arr) => (arr || []).filter(x => !x.village || x.village === "home");
  const spell = (n) => home(p?.spells).find(s => s.name === n)?.level || null;

  const equipment = [];
  for (const [name, meta] of Object.entries(ZQ_EQUIPMENT)) {
    const owned = home(p?.heroEquipment).find(e => e.name === name);
    if (!owned) continue;
    const stat = meta.levels[owned.level];
    if (!stat) continue;
    equipment.push({ name, level: owned.level, icon: meta.icon, hero: meta.hero, ...stat });
  }

  return {
    lightning: spell("Lightning Spell"),
    quake: spell("Earthquake Spell"),
    townHall: p?.townHallLevel || null,
    equipment,
    hasVillage: !!p,
  };
}

function zqEsc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function zqImg(src, size = 34) {
  return `<img src="${zqEsc(src)}" alt="" loading="lazy"
    style="width:${size}px;height:${size}px;object-fit:contain;flex:none" />`;
}

/* A count badge over an icon — reads faster than "x6 Lightning" as text. */
function zqCountIcon(src, count, label, tint) {
  return `<div style="position:relative;display:flex;flex-direction:column;align-items:center;gap:4px;width:64px">
    <div style="position:relative">
      ${zqImg(src, 46)}
      <span style="position:absolute;bottom:-4px;right:-6px;background:var(--card);border:2px solid ${tint};
        color:${tint};border-radius:999px;padding:0 6px;font-size:.8rem;font-weight:800;line-height:1.4">×${count}</span>
    </div>
    <span class="muted" style="font-size:.66rem;text-align:center;line-height:1.2">${zqEsc(label)}</span>
  </div>`;
}

function zqBuildTargetOptions() {
  const sel = document.getElementById("zqTarget");
  if (!sel || sel.dataset.built) return;
  const th = zqPlayer().townHall || 18;
  const names = Object.keys(ZQ_DEFENCES)
    .filter(n => ZQ_DEFENCES[n].minTH <= th)
    .sort();
  sel.innerHTML = names.map(n => `<option value="${zqEsc(n)}">${zqEsc(n)}</option>`).join("");
  sel.value = names.includes("Inferno Tower") ? "Inferno Tower" : names[0];
  sel.dataset.built = "1";
}

function renderZapQuake() {
  const host = document.getElementById("zapquakeBody");
  if (!host || typeof ZQ_DEFENCES === "undefined") return;
  const lv = zqPlayer();

  if (!lv.hasVillage || !lv.lightning) {
    host.innerHTML = `<p class="muted small">
      Analyze your village above and this will use your own spell and equipment
      levels — nothing to set up.</p>`;
    return;
  }

  zqBuildTargetOptions();
  const target = document.getElementById("zqTarget")?.value || "Inferno Tower";
  const def = ZQ_DEFENCES[target];
  if (!def) return;

  const levelSel = document.getElementById("zqLevel");
  const lvlKeys = Object.keys(def.hp).map(Number).sort((a, b) => a - b);
  if (levelSel && levelSel.dataset.for !== target) {
    levelSel.innerHTML = lvlKeys.map(l => `<option value="${l}">Level ${l}</option>`).join("");
    levelSel.value = String(lvlKeys[lvlKeys.length - 1]);
    levelSel.dataset.for = target;
  }

  const bLevel = Number(levelSel?.value) || lvlKeys[lvlKeys.length - 1];
  const maxHp = def.hp[bLevel];
  const res = zqSolve(maxHp, lv.lightning, lv.quake || 0, lv.equipment);

  const targetCard = `
    <div class="row" style="gap:12px;align-items:center;margin-bottom:14px">
      ${zqImg(def.icon, 52)}
      <div>
        <div style="font-weight:800;font-size:1.05rem">${zqEsc(target)} <span class="muted">L${bLevel}</span></div>
        <div class="muted small">${maxHp.toLocaleString()} HP</div>
      </div>
    </div>`;

  if (!res) {
    host.innerHTML = targetCard + `
      <div class="card" style="background:var(--bg2);text-align:center;padding:20px">
        <div style="font-weight:800;color:var(--red)">Not worth zapping</div>
        <p class="muted small" style="margin-top:6px">
          This needs more spells than an army can carry at your levels.</p>
      </div>`;
    return;
  }

  const b = res.best;
  const LIGHT = "assets/spells/lightning-spell.png";
  const QUAKE = "assets/spells/earthquake-spell.png";

  const icons = [
    b.lightning ? zqCountIcon(LIGHT, b.lightning, "Lightning", "var(--accent)") : "",
    b.quake ? zqCountIcon(QUAKE, b.quake, "Earthquake", "var(--gold)") : "",
    ...b.equipment.map(e => zqCountIcon(e.icon, 1, e.name, "var(--purple)")),
  ].filter(Boolean).join("");

  host.innerHTML = targetCard + `
    <div class="card" style="background:var(--bg2);padding:18px">
      <div class="muted small" style="margin-bottom:10px">Bring</div>
      <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-start">${icons}</div>
      <div class="muted small" style="margin-top:12px">
        ${b.slots} spell slot${b.slots === 1 ? "" : "s"}${b.equipment.length ? ` · plus your ${b.equipment.map(e => `${zqEsc(e.hero)}'s ${zqEsc(e.name)}`).join(" + ")}` : ""}
        · using your <strong>Lightning L${lv.lightning}</strong>${lv.quake ? `, <strong>Earthquake L${lv.quake}</strong>` : ""}
      </div>
    </div>

    <details class="card" style="padding:14px 16px;margin-top:10px" open>
      <summary><strong>Why this works</strong></summary>
      <div class="small" style="margin-top:10px">
        <p>A level ${bLevel} ${zqEsc(target)} has <strong>${b.hpBefore.toLocaleString()} HP</strong>.</p>
        ${b.removedByQuake ? `<p style="margin-top:6px">
          ${b.quake ? `${b.quake} Earthquake${b.quake === 1 ? "" : "s"}` : "Percentage damage"}
          ${b.equipment.some(e => e.pct) ? " (with your Earthquake Boots)" : ""} strips
          <strong>${b.removedByQuake.toLocaleString()} HP</strong> — percentage damage does the
          heavy lifting on big buildings.</p>` : ""}
        ${b.removedByEquip ? `<p style="margin-top:6px">
          ${b.equipment.filter(e => e.flat).map(e => zqEsc(e.name)).join(" + ")} adds
          <strong>${b.removedByEquip.toLocaleString()}</strong> damage, saving spell slots — but
          that ability is then spent here rather than on the rest of the attack.</p>` : ""}
        ${b.lightning ? `<p style="margin-top:6px">
          ${b.lightning} Lightning at L${lv.lightning} deals
          <strong>${b.lightningDamage.toLocaleString()}</strong>, finishing the remaining
          ${b.hpAfter.toLocaleString()} HP.</p>` : ""}
        ${b.quake > 1 ? `<p class="muted" style="margin-top:8px">
          Drop the Earthquakes first. Each one on the same building is worth less than the
          last, which is why ${b.quake} is the sweet spot rather than more.</p>` : ""}
      </div>
    </details>

    ${res.alternatives.length ? `
    <details class="card" style="padding:14px 16px;margin-top:10px">
      <summary><strong>Other combos that work</strong> <span class="muted small">(${res.alternatives.length})</span></summary>
      <table style="margin-top:10px"><thead><tr>
        <th>Lightning</th><th>Earthquake</th><th>Equipment</th><th>Slots</th>
      </tr></thead><tbody>
        ${res.alternatives.map(a => `<tr>
          <td>${a.lightning ? `${zqImg(LIGHT, 22)} ×${a.lightning}` : "—"}</td>
          <td>${a.quake ? `${zqImg(QUAKE, 22)} ×${a.quake}` : "—"}</td>
          <td>${a.equipment.length ? a.equipment.map(e => zqImg(e.icon, 22)).join(" ") : "—"}</td>
          <td><strong>${a.slots}</strong></td>
        </tr>`).join("")}
      </tbody></table>
    </details>` : ""}

    ${lv.equipment.length ? "" : `<p class="muted small" style="margin-top:10px">
      Tip: Fireball, Giant Arrow or Earthquake Boots would cut the spell cost here — none
      were found in your village data.</p>`}`;
}

document.addEventListener("DOMContentLoaded", () => {
  ["zqTarget", "zqLevel"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", renderZapQuake);
  });
  renderZapQuake();
});
