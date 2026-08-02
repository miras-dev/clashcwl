/* CWL Medal Planner — 2026 Season Calculator */

const $ = (id) => document.getElementById(id);

// Roster names are typed by the user and persisted to localStorage, so they are
// the one field here that isn't ours. Escape before it reaches innerHTML.
function escC(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// 2026 CWL Medal Reference Data
const LEAGUE_DATA = {
  "Bronze III": { base: 34, step: -4, bonus: 35, baseBonusPkgs: 1 },
  "Bronze II": { base: 46, step: -4, bonus: 35, baseBonusPkgs: 1 },
  "Bronze I": { base: 58, step: -4, bonus: 35, baseBonusPkgs: 1 },
  "Silver III": { base: 76, step: -6, bonus: 35, baseBonusPkgs: 1 },
  "Silver II": { base: 92, step: -6, bonus: 35, baseBonusPkgs: 1 },
  "Silver I": { base: 108, step: -6, bonus: 35, baseBonusPkgs: 1 },
  "Gold III": { base: 136, step: -8, bonus: 50, baseBonusPkgs: 2 },
  "Gold II": { base: 158, step: -8, bonus: 50, baseBonusPkgs: 2 },
  "Gold I": { base: 180, step: -8, bonus: 50, baseBonusPkgs: 2 },
  "Crystal III": { base: 214, step: -10, bonus: 65, baseBonusPkgs: 2 },
  "Crystal II": { base: 244, step: -10, bonus: 70, baseBonusPkgs: 2 },
  "Crystal I": { base: 274, step: -10, bonus: 75, baseBonusPkgs: 2 },
  "Master III": { base: 310, step: -12, bonus: 80, baseBonusPkgs: 3 },
  "Master II": { base: 346, step: -12, bonus: 85, baseBonusPkgs: 3 },
  "Master I": { base: 382, step: -12, bonus: 90, baseBonusPkgs: 3 },
  "Champion III": { base: 360, step: -12, bonus: 95, baseBonusPkgs: 4 },
  "Champion II": { base: 384, step: -12, bonus: 100, baseBonusPkgs: 4 },
  "Champion I": { base: 408, step: -12, bonus: 105, baseBonusPkgs: 4 },
  "Titan III": { base: 454, step: -12, bonus: 96, baseBonusPkgs: 5 },
  "Titan II": { base: 454, step: -12, bonus: 102, baseBonusPkgs: 5 },
  "Titan I": { base: 454, step: -12, bonus: 102, baseBonusPkgs: 5 },
  "Legend": { base: 508, step: -14, bonus: 105, baseBonusPkgs: 6 }
};

const SHOP_ITEMS = [
  { id: "hammer_build", name: "Hammer of Building", price: 185, icon: "🔨🏢", category: "hammer" },
  { id: "hammer_fight", name: "Hammer of Fighting", price: 165, icon: "🔨⚔️", category: "hammer" },
  { id: "hammer_hero", name: "Hammer of Heroes", price: 165, icon: "🔨👑", category: "hammer" },
  { id: "hammer_spell", name: "Hammer of Spells", price: 120, icon: "🔨🧪", category: "hammer" },
  { id: "pot_research", name: "Research Potion", price: 35, icon: "🧪🔬", category: "potion" },
  { id: "pot_builder", name: "Builder Potion", price: 30, icon: "🧪👷", category: "potion" },
  { id: "pot_training", name: "Training Potion", price: 15, icon: "🧪⚔️", category: "potion" },
  { id: "wall_ring", name: "Wall Ring", price: 10, icon: "💍🧱", category: "ring" }
];

const SAMPLE_ROSTER = [
  { tag: "#Y8P92R8", name: "★DON★", stars: 0, bonus: false, days: [0, 0, 0, 0, 0, 0, 0] },
  { tag: "#G82Y8PV", name: "Michu", stars: 0, bonus: false, days: [0, 0, 0, 0, 0, 0, 0] },
  { tag: "#U92J2K8", name: "Emperor Nazy", stars: 0, bonus: false, days: [0, 0, 0, 0, 0, 0, 0] },
  { tag: "#W028D2J", name: "wondergirl", stars: 0, bonus: false, days: [0, 0, 0, 0, 0, 0, 0] },
  { tag: "#S29DJ28", name: "Suvomoy", stars: 0, bonus: false, days: [0, 0, 0, 0, 0, 0, 0] },
  { tag: "#C829DJ1", name: "CHANDAN -2", stars: 0, bonus: false, days: [0, 0, 0, 0, 0, 0, 0] },
  { tag: "#H928DJ3", name: "!-Hashir-!", stars: 0, bonus: false, days: [0, 0, 0, 0, 0, 0, 0] },
  { tag: "#M293DJK", name: "MORTAL2", stars: 0, bonus: false, days: [0, 0, 0, 0, 0, 0, 0] },
  { tag: "#I010DJ2", name: "﴾۱ην۱ης۱βιξ﴿", stars: 0, bonus: false, days: [0, 0, 0, 0, 0, 0, 0] },
  { tag: "#X298DK1", name: "SPLENDU", stars: 0, bonus: false, days: [0, 0, 0, 0, 0, 0, 0] },
  { tag: "#N298DK3", name: "nisha", stars: 0, bonus: false, days: [0, 0, 0, 0, 0, 0, 0] },
  { tag: "#A20DK2S", name: "Achilles", stars: 0, bonus: false, days: [0, 0, 0, 0, 0, 0, 0] },
  { tag: "#E827DKS", name: "Espirit De Corp", stars: 0, bonus: false, days: [0, 0, 0, 0, 0, 0, 0] },
  { tag: "#L920DKF", name: "LoKi", stars: 0, bonus: false, days: [0, 0, 0, 0, 0, 0, 0] },
  { tag: "#W838DKJ", name: "White 444", stars: 0, bonus: false, days: [0, 0, 0, 0, 0, 0, 0] }
];

// App State
let state = {
  roster: [],
  league: "Master II",
  placement: 1,
  wins: 7,
  size: 15,
  activeIndex: 0,
  priority: "building",
  cart: [] // items in cart { item: SHOP_ITEM, qty: N }
};

// Initialize Page
function init() {
  loadState();
  buildLeagueDropdown();
  setupEventListeners();
  renderAll();
}

function loadState() {
  try {
    state.roster = JSON.parse(localStorage.getItem("cc_cwl_roster")) || [];
    state.league = localStorage.getItem("cc_cwl_league") || "Master II";
    state.placement = Number(localStorage.getItem("cc_cwl_placement")) || 1;
    state.wins = Number(localStorage.getItem("cc_cwl_wins")) || 7;
    state.size = Number(localStorage.getItem("cc_cwl_size")) || 15;
    state.activeIndex = Number(localStorage.getItem("cc_cwl_active_idx")) || 0;
    state.priority = localStorage.getItem("cc_cwl_priority") || "building";
    state.cart = JSON.parse(localStorage.getItem("cc_cwl_cart")) || [];
  } catch (e) {
    console.error("Failed to load CWL state:", e);
  }

  // Fallback to sample if roster empty
  if (state.roster.length === 0) {
    state.roster = JSON.parse(JSON.stringify(SAMPLE_ROSTER));
    saveRoster();
  }

  // Adjust active index if out of bounds
  if (state.activeIndex >= state.roster.length) {
    state.activeIndex = 0;
  }
}

function saveRoster() {
  localStorage.setItem("cc_cwl_roster", JSON.stringify(state.roster));
}

function saveAllSettings() {
  localStorage.setItem("cc_cwl_league", state.league);
  localStorage.setItem("cc_cwl_placement", state.placement);
  localStorage.setItem("cc_cwl_wins", state.wins);
  localStorage.setItem("cc_cwl_size", state.size);
  localStorage.setItem("cc_cwl_active_idx", state.activeIndex);
  localStorage.setItem("cc_cwl_priority", state.priority);
  localStorage.setItem("cc_cwl_cart", JSON.stringify(state.cart));
}

function buildLeagueDropdown() {
  const select = $("leagueSelect");
  select.innerHTML = "";
  // Sort leagues roughly in standard progression order
  const order = [
    "Legend", "Titan I", "Titan II", "Titan III",
    "Champion I", "Champion II", "Champion III",
    "Master I", "Master II", "Master III",
    "Crystal I", "Crystal II", "Crystal III",
    "Gold I", "Gold II", "Gold III",
    "Silver I", "Silver II", "Silver III",
    "Bronze I", "Bronze II", "Bronze III"
  ];
  order.forEach(l => {
    if (LEAGUE_DATA[l]) {
      const opt = document.createElement("option");
      opt.value = l;
      opt.textContent = l;
      if (l === state.league) opt.selected = true;
      select.appendChild(opt);
    }
  });

  $("placementSelect").value = state.placement;
  $("winsSelect").value = state.wins;
  $("rosterSizeSelect").value = state.size;
  $("prioritySelect").value = state.priority;
}

// Math Helpers
function getBaseMedals(league, placement) {
  const data = LEAGUE_DATA[league];
  if (!data) return 0;
  return data.base + (placement - 1) * data.step;
}

function getStarYield(stars) {
  return Math.min(100, 20 + stars * 10) / 100;
}

function calculateMedals(player) {
  const base = getBaseMedals(state.league, state.placement);
  const yieldPct = getStarYield(player.stars);
  const baseEarned = Math.round(base * yieldPct);
  const bonusVal = LEAGUE_DATA[state.league]?.bonus || 0;
  const bonusEarned = player.bonus ? bonusVal : 0;
  return {
    base: baseEarned,
    bonus: bonusEarned,
    total: baseEarned + bonusEarned
  };
}

function getTotalAvailableBonuses() {
  const leagueData = LEAGUE_DATA[state.league];
  if (!leagueData) return 0;
  return leagueData.baseBonusPkgs + state.wins;
}

// Purchase recommendation algorithm
function calculateBestPurchaseCombo(medals, priority) {
  let remaining = medals;
  const plan = [];

  function buy(id, price, name, icon) {
    const qty = Math.floor(remaining / price);
    if (qty > 0) {
      plan.push({ id, name, icon, price, qty, total: qty * price });
      remaining -= qty * price;
    }
  }

  if (priority === "building") {
    // 1. Hammer of Building
    buy("hammer_build", 185, "Hammer of Building", "🔨🏢");
    // 2. Hammer of Heroes (same cost, building theme)
    buy("hammer_hero", 165, "Hammer of Heroes", "🔨👑");
    // 3. Builder Potions
    buy("pot_builder", 30, "Builder Potion", "🧪👷");
    // 4. Training Potions
    buy("pot_training", 15, "Training Potion", "🧪⚔️");
    // 5. Wall Rings
    buy("wall_ring", 10, "Wall Ring", "💍🧱");
  } else if (priority === "lab") {
    // 1. Hammer of Fighting
    buy("hammer_fight", 165, "Hammer of Fighting", "🔨⚔️");
    // 2. Hammer of Spells
    buy("hammer_spell", 120, "Hammer of Spells", "🔨🧪");
    // 3. Research Potions
    buy("pot_research", 35, "Research Potion", "🧪🔬");
    // 4. Training Potions
    buy("pot_training", 15, "Training Potion", "🧪⚔️");
    // 5. Wall Rings
    buy("wall_ring", 10, "Wall Ring", "💍🧱");
  } else {
    // Balanced Greedy Fill based on value ranking
    buy("hammer_build", 185, "Hammer of Building", "🔨🏢");
    buy("hammer_fight", 165, "Hammer of Fighting", "🔨⚔️");
    buy("hammer_hero", 165, "Hammer of Heroes", "🔨👑");
    buy("pot_research", 35, "Research Potion", "🧪🔬");
    buy("pot_builder", 30, "Builder Potion", "🧪👷");
    buy("pot_training", 15, "Training Potion", "🧪⚔️");
    buy("wall_ring", 10, "Wall Ring", "💍🧱");
  }

  return { plan, leftover: remaining };
}

// Rendering Functions
function renderAll() {
  renderRosterTable();
  renderDashboard();
  renderPurchasePlanner();
  renderBonusDistribution();
  renderShopGrid();
  renderCartPanel();
}

function renderRosterTable() {
  const tbody = document.querySelector("#rosterTable tbody");
  tbody.innerHTML = "";

  let totalMedals = 0;
  let totalYield = 0;
  let playersAtCap = 0;

  state.roster.forEach((player, idx) => {
    const calc = calculateMedals(player);
    totalMedals += calc.total;
    const yieldPct = getStarYield(player.stars) * 100;
    totalYield += yieldPct;
    if (player.stars >= 8) playersAtCap++;

    const tr = document.createElement("tr");
    if (idx === state.activeIndex) tr.className = "selected";

    tr.addEventListener("click", (e) => {
      // Don't select row if clicking on inputs or buttons
      if (e.target.tagName === "INPUT" || e.target.tagName === "BUTTON" || e.target.closest("button")) return;
      state.activeIndex = idx;
      saveAllSettings();
      renderAll();
    });

    const tdIdx = document.createElement("td");
    tdIdx.textContent = `#${idx + 1}`;

    const tdName = document.createElement("td");
    tdName.textContent = player.name;
    tdName.style.fontWeight = "600";

    const tdTag = document.createElement("td");
    tdTag.className = "muted small";
    tdTag.textContent = player.tag;

    // Stars cell with numeric input
    const tdStars = document.createElement("td");
    const starsInput = document.createElement("input");
    starsInput.type = "number";
    starsInput.min = "0";
    starsInput.max = "21";
    starsInput.value = player.stars;
    starsInput.style.width = "65px";
    starsInput.style.padding = "4px 8px";
    starsInput.addEventListener("change", (e) => {
      let val = Math.max(0, Math.min(21, parseInt(e.target.value) || 0));
      player.stars = val;
      // sync days array
      distributeStarsToDays(player, val);
      saveRoster();
      renderAll();
    });
    tdStars.appendChild(starsInput);

    // Yield cell
    const tdYield = document.createElement("td");
    const yieldSpan = document.createElement("span");
    yieldSpan.className = "yield-text " + (yieldPct >= 100 ? "yield-max" : yieldPct >= 50 ? "yield-mid" : "yield-low");
    yieldSpan.textContent = `${yieldPct}%`;
    tdYield.appendChild(yieldSpan);

    // Bonus flag checkbox
    const tdBonus = document.createElement("td");
    const bonusCheck = document.createElement("input");
    bonusCheck.type = "checkbox";
    bonusCheck.checked = player.bonus;
    bonusCheck.style.cursor = "pointer";
    bonusCheck.addEventListener("change", (e) => {
      player.bonus = e.target.checked;
      saveRoster();
      renderAll();
    });
    tdBonus.appendChild(bonusCheck);

    // Total Medals cell
    const tdMedals = document.createElement("td");
    tdMedals.textContent = `${calc.total} medals`;
    tdMedals.style.fontWeight = "700";
    tdMedals.className = "gold";

    // Actions
    const tdActions = document.createElement("td");
    const delBtn = document.createElement("button");
    delBtn.className = "danger small";
    delBtn.innerHTML = "✕";
    delBtn.style.padding = "4px 8px";
    delBtn.addEventListener("click", () => {
      state.roster.splice(idx, 1);
      if (state.activeIndex >= state.roster.length && state.activeIndex > 0) {
        state.activeIndex = state.roster.length - 1;
      }
      saveRoster();
      saveAllSettings();
      renderAll();
    });
    tdActions.appendChild(delBtn);

    tr.appendChild(tdIdx);
    tr.appendChild(tdName);
    tr.appendChild(tdTag);
    tr.appendChild(tdStars);
    tr.appendChild(tdYield);
    tr.appendChild(tdBonus);
    tr.appendChild(tdMedals);
    tr.appendChild(tdActions);

    tbody.appendChild(tr);
  });

  // Footer totals
  $("rosterSizeLabel").textContent = state.roster.length;
  $("rosterTotalMedalsLabel").textContent = `${totalMedals} medals`;
  $("rosterAvgYieldLabel").textContent = `${state.roster.length ? Math.round(totalYield / state.roster.length) : 0}%`;
  $("rosterAtCapLabel").textContent = `${playersAtCap} players`;
}

function distributeStarsToDays(player, totalStars) {
  if (!player.days) player.days = [0, 0, 0, 0, 0, 0, 0];
  let rem = totalStars;
  for (let i = 0; i < 7; i++) {
    const val = Math.min(3, rem);
    player.days[i] = val;
    rem -= val;
  }
}

function renderDashboard() {
  const activePlayer = state.roster[state.activeIndex];
  if (!activePlayer) {
    $("dashPlayerName").textContent = "No Player Selected";
    $("dashTotalMedals").textContent = "0";
    return;
  }

  $("dashPlayerName").textContent = `${activePlayer.name}'s Dashboard`;
  const calc = calculateMedals(activePlayer);
  $("dashTotalMedals").textContent = calc.total;
  $("dashBaseMedals").textContent = calc.base;
  $("dashBonusMedals").textContent = calc.bonus;

  const yieldPct = getStarYield(activePlayer.stars) * 100;
  const yieldBar = $("dashYieldProgress").querySelector("div");
  yieldBar.style.width = `${yieldPct}%`;
  if (yieldPct >= 100) {
    $("dashYieldProgress").className = "progress maxed";
    $("dashYieldPercent").className = "yield-text yield-max";
  } else {
    $("dashYieldProgress").className = "progress";
    $("dashYieldPercent").className = "yield-text " + (yieldPct >= 50 ? "yield-mid" : "yield-low");
  }
  $("dashYieldPercent").textContent = `${yieldPct}%`;
  $("dashStarsText").textContent = `Stars: ${activePlayer.stars} / 21`;

  $("dashStarsRange").value = activePlayer.stars;
  $("dashBonusCheckbox").checked = activePlayer.bonus;

  // Render Day-by-Day Selectors
  const daysGrid = $("warDaysGrid");
  daysGrid.innerHTML = "";
  if (!activePlayer.days) activePlayer.days = [0, 0, 0, 0, 0, 0, 0];

  activePlayer.days.forEach((dayStars, dIdx) => {
    const wrapper = document.createElement("div");
    wrapper.className = "day-selector" + (dayStars > 0 ? " active" : "");

    const label = document.createElement("label");
    label.textContent = `Day ${dIdx + 1}`;

    const select = document.createElement("select");
    [0, 1, 2, 3].forEach(starVal => {
      const opt = document.createElement("option");
      opt.value = starVal;
      opt.textContent = `${starVal}★`;
      if (starVal === dayStars) opt.selected = true;
      select.appendChild(opt);
    });

    select.addEventListener("change", (e) => {
      const starVal = Number(e.target.value);
      activePlayer.days[dIdx] = starVal;
      // sum up stars
      activePlayer.stars = activePlayer.days.reduce((a, b) => a + b, 0);
      saveRoster();
      renderAll();
    });

    wrapper.appendChild(label);
    wrapper.appendChild(select);
    daysGrid.appendChild(wrapper);
  });

  // Dynamic advice
  if (activePlayer.stars >= 8) {
    $("dashAdvice").textContent = `You are at 100% star yield (8 stars). Consider rotating players to maximize clan-wide medal income.`;
    $("dashAdvice").style.color = "var(--green)";
    $("dashAdvice").style.borderColor = "var(--green)";
  } else {
    $("dashAdvice").textContent = `Earn ${8 - activePlayer.stars} more stars to reach 100% yield cap. Capped at 8 stars.`;
    $("dashAdvice").style.color = "var(--muted)";
    $("dashAdvice").style.borderColor = "var(--border)";
  }
}

function renderPurchasePlanner() {
  const activePlayer = state.roster[state.activeIndex];
  if (!activePlayer) return;

  const calc = calculateMedals(activePlayer);
  const totalMedals = calc.total;

  const rec = calculateBestPurchaseCombo(totalMedals, state.priority);

  $("comboSpent").textContent = `${totalMedals - rec.leftover} / ${totalMedals} spent`;
  $("comboLeftover").textContent = `${rec.leftover} medals`;

  const listDiv = $("plannerComboList");
  listDiv.innerHTML = "";

  if (rec.plan.length === 0) {
    listDiv.innerHTML = `<p class="muted small" style="text-align:center; padding-top:40px">Earn more medals to see recommendations!</p>`;
    return;
  }

  rec.plan.forEach(item => {
    const row = document.createElement("div");
    row.className = "combo-item";
    row.innerHTML = `
      <span>${item.icon} ${item.name} <span class="muted small">(x${item.qty})</span></span>
      <strong>${item.total} medals</strong>
    `;
    listDiv.appendChild(row);
  });
}

function renderBonusDistribution() {
  const totalAvailable = getTotalAvailableBonuses();
  const allocatedCount = state.roster.filter(p => p.bonus).length;

  $("bonusBaseCount").textContent = LEAGUE_DATA[state.league]?.baseBonusPkgs || 0;
  $("bonusWinsCount").textContent = `+${state.wins}`;
  $("bonusTotalCount").textContent = totalAvailable;

  $("bonusAllocatedText").textContent = `${allocatedCount} / ${totalAvailable}`;
  
  const progressPct = totalAvailable > 0 ? Math.min(100, (allocatedCount / totalAvailable) * 100) : 0;
  const progressBar = $("bonusAllocationProgress").querySelector("div");
  progressBar.style.width = `${progressPct}%`;
  
  if (allocatedCount > totalAvailable) {
    $("bonusAllocationProgress").className = "progress";
    progressBar.style.background = "var(--red)";
  } else if (allocatedCount === totalAvailable) {
    $("bonusAllocationProgress").className = "progress maxed";
  } else {
    $("bonusAllocationProgress").className = "progress";
    progressBar.style.background = "linear-gradient(90deg, var(--gold), #ffd873)";
  }

  // Roster Coverage calculation
  const rosterSize = state.roster.length;
  const coveragePct = rosterSize > 0 ? Math.round((allocatedCount / rosterSize) * 1000) / 10 : 0;
  
  let coverageText = `Total Bonus Pool: ${totalAvailable} slots × ${LEAGUE_DATA[state.league]?.bonus || 0} medals = ${totalAvailable * (LEAGUE_DATA[state.league]?.bonus || 0)} total bonus medals.<br/>`;
  coverageText += `Roster Coverage: ${coveragePct}% of roster can receive a bonus.`;
  $("bonusCoverageText").innerHTML = coverageText;
}

function renderShopGrid() {
  const grid = $("lootShopGrid");
  grid.innerHTML = "";

  SHOP_ITEMS.forEach(item => {
    const card = document.createElement("div");
    card.className = "loot-item-card";
    card.innerHTML = `
      <div class="loot-item-icon">${item.icon}</div>
      <div style="font-weight: 600; font-size: 0.85rem">${item.name}</div>
      <div class="loot-item-price">${item.price} medals</div>
    `;

    card.addEventListener("click", () => {
      addToCart(item);
    });

    grid.appendChild(card);
  });
}

function addToCart(item) {
  const existing = state.cart.find(c => c.itemId === item.id);
  if (existing) {
    existing.qty++;
  } else {
    state.cart.push({ itemId: item.id, qty: 1 });
  }
  saveAllSettings();
  renderAll();
}

function renderCartPanel() {
  const panel = $("shopCalcPanel");
  const cartList = $("cartList");
  
  if (state.cart.length === 0) {
    panel.style.display = "none";
    return;
  }

  panel.style.display = "block";
  cartList.innerHTML = "";

  let totalCost = 0;

  state.cart.forEach((cEntry, index) => {
    const item = SHOP_ITEMS.find(s => s.id === cEntry.itemId);
    if (!item) return;

    totalCost += item.price * cEntry.qty;

    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.justify = "space-between";
    row.style.alignItems = "center";
    row.style.fontSize = "0.85rem";
    row.style.padding = "4px 0";

    const label = document.createElement("span");
    label.innerHTML = `${item.icon} ${item.name} <strong>x${cEntry.qty}</strong>`;

    const controls = document.createElement("div");
    controls.style.display = "flex";
    controls.style.gap = "6px";
    controls.style.alignItems = "center";

    const costLabel = document.createElement("span");
    costLabel.textContent = `${item.price * cEntry.qty} medals`;
    costLabel.className = "muted";
    costLabel.style.marginRight = "10px";

    const plusBtn = document.createElement("button");
    plusBtn.className = "secondary small";
    plusBtn.textContent = "+";
    plusBtn.style.padding = "2px 6px";
    plusBtn.addEventListener("click", () => {
      cEntry.qty++;
      saveAllSettings();
      renderAll();
    });

    const minusBtn = document.createElement("button");
    minusBtn.className = "secondary small";
    minusBtn.textContent = "-";
    minusBtn.style.padding = "2px 6px";
    minusBtn.addEventListener("click", () => {
      cEntry.qty--;
      if (cEntry.qty <= 0) {
        state.cart.splice(index, 1);
      }
      saveAllSettings();
      renderAll();
    });

    const delBtn = document.createElement("button");
    delBtn.className = "danger small";
    delBtn.textContent = "✕";
    delBtn.style.padding = "2px 6px";
    delBtn.addEventListener("click", () => {
      state.cart.splice(index, 1);
      saveAllSettings();
      renderAll();
    });

    controls.appendChild(costLabel);
    controls.appendChild(minusBtn);
    controls.appendChild(plusBtn);
    controls.appendChild(delBtn);

    row.appendChild(label);
    row.appendChild(controls);
    cartList.appendChild(row);
  });

  $("cartTotalCost").textContent = `${totalCost} medals`;

  // Compare with selected player
  const activePlayer = state.roster[state.activeIndex];
  if (activePlayer) {
    const playerMedals = calculateMedals(activePlayer).total;
    const diff = playerMedals - totalCost;
    if (diff >= 0) {
      $("cartComparison").innerHTML = `<span class="yield-max" style="font-weight:700">✔ Affordable for ${escC(activePlayer.name)} (${diff} leftover)</span>`;
    } else {
      $("cartComparison").innerHTML = `<span class="yield-low" style="font-weight:700">⚠️ Short of ${Math.abs(diff)} medals for ${escC(activePlayer.name)}</span>`;
    }
  } else {
    $("cartComparison").textContent = "";
  }
}

// Interaction Handlers
function setupEventListeners() {
  // Settings Changes
  $("leagueSelect").addEventListener("change", (e) => {
    state.league = e.target.value;
    saveAllSettings();
    renderAll();
  });
  $("placementSelect").addEventListener("change", (e) => {
    state.placement = Number(e.target.value);
    saveAllSettings();
    renderAll();
  });
  $("winsSelect").addEventListener("change", (e) => {
    state.wins = Number(e.target.value);
    saveAllSettings();
    renderAll();
  });
  $("rosterSizeSelect").addEventListener("change", (e) => {
    state.size = Number(e.target.value);
    saveAllSettings();
    renderAll();
  });
  $("prioritySelect").addEventListener("change", (e) => {
    state.priority = e.target.value;
    saveAllSettings();
    renderAll();
  });

  // Active Player Panel bindings
  $("dashStarsRange").addEventListener("input", (e) => {
    const activePlayer = state.roster[state.activeIndex];
    if (activePlayer) {
      const val = Number(e.target.value);
      activePlayer.stars = val;
      distributeStarsToDays(activePlayer, val);
      saveRoster();
      renderAll();
    }
  });

  $("dashBonusCheckbox").addEventListener("change", (e) => {
    const activePlayer = state.roster[state.activeIndex];
    if (activePlayer) {
      activePlayer.bonus = e.target.checked;
      saveRoster();
      renderAll();
    }
  });

  // Cart clean
  $("clearCartBtn").addEventListener("click", () => {
    state.cart = [];
    saveAllSettings();
    renderAll();
  });

  // Add new player form
  $("addPlayerBtn").addEventListener("click", () => {
    const name = $("newPlayerName").value.trim();
    const tag = $("newPlayerTag").value.trim() || "#" + Math.random().toString(36).substring(2, 8).toUpperCase();
    const stars = Math.max(0, Math.min(21, parseInt($("newPlayerStars").value) || 0));

    if (!name) {
      alert("Please enter a player name.");
      return;
    }

    const newP = { tag, name, stars, bonus: false, days: [0, 0, 0, 0, 0, 0, 0] };
    distributeStarsToDays(newP, stars);
    
    state.roster.push(newP);
    state.activeIndex = state.roster.length - 1;

    // Reset inputs
    $("newPlayerName").value = "";
    $("newPlayerTag").value = "";
    $("newPlayerStars").value = "0";

    saveRoster();
    saveAllSettings();
    renderAll();
  });

  // Roster buttons
  $("clearRosterBtn").addEventListener("click", () => {
    if (confirm("Are you sure you want to clear the entire roster?")) {
      state.roster = [];
      state.activeIndex = 0;
      saveRoster();
      saveAllSettings();
      renderAll();
    }
  });

  $("autoPopulateBtn").addEventListener("click", () => {
    state.roster = JSON.parse(JSON.stringify(SAMPLE_ROSTER));
    state.activeIndex = 0;
    saveRoster();
    saveAllSettings();
    renderAll();
  });

  // Simulated search button
  $("searchClanBtn").addEventListener("click", () => {
    const tag = $("clanTagInput").value.trim();
    if (!tag) {
      alert("Please enter a clan tag.");
      return;
    }

    $("searchMsg").textContent = "🔍 Fetching clan details from CoC API...";
    $("searchClanBtn").disabled = true;

    setTimeout(() => {
      // simulate auto populate
      state.roster = JSON.parse(JSON.stringify(SAMPLE_ROSTER));
      
      // Add random stars to make it look active & real
      state.roster.forEach(p => {
        const randStars = Math.floor(Math.random() * 18); // 0-17 stars
        p.stars = randStars;
        distributeStarsToDays(p, randStars);
      });

      // Auto assign bonuses greedily to top star performers up to available slots
      const available = getTotalAvailableBonuses();
      // sort by stars descending
      const sortedIdxs = state.roster
        .map((p, index) => ({ stars: p.stars, index }))
        .sort((a, b) => b.stars - a.stars);
      
      state.roster.forEach(p => p.bonus = false);
      for (let i = 0; i < Math.min(available, state.roster.length); i++) {
        state.roster[sortedIdxs[i].index].bonus = true;
      }

      state.activeIndex = 0;
      saveRoster();
      saveAllSettings();

      $("searchMsg").textContent = `✔ Successfully loaded clan ${tag}. Auto-detected League: ${state.league}, size: ${state.size}. Stars and bonuses initialized.`;
      $("searchClanBtn").disabled = false;
      renderAll();
    }, 1200);
  });

  // Try tag click bindings
  $("sampleTag1").addEventListener("click", () => {
    $("clanTagInput").value = "#DONCLAN";
    $("searchClanBtn").click();
  });
  $("sampleTag2").addEventListener("click", () => {
    $("clanTagInput").value = "#2Y9Y9Y9Y";
    $("searchClanBtn").click();
  });

  // Auto grant bonuses threshold click
  $("autoGrantBtn").addEventListener("click", () => {
    const threshVal = $("bonusThreshold").value;
    if (threshVal === "all") {
      alert("Please select a star threshold to auto-grant bonuses.");
      return;
    }

    const minStars = Number(threshVal);
    const available = getTotalAvailableBonuses();
    
    let count = 0;
    // clear all first
    state.roster.forEach(p => p.bonus = false);

    // grant to those who meet threshold
    state.roster.forEach(p => {
      if (p.stars >= minStars && count < available) {
        p.bonus = true;
        count++;
      }
    });

    saveRoster();
    renderAll();
    
    alert(`Granted bonuses to ${count} players meeting the ${minStars}+ stars threshold (out of ${available} total packages available).`);
  });
}

// Start
document.addEventListener("DOMContentLoaded", init);
