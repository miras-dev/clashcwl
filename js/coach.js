/* AI Coach — built-in KB coach, optionally OpenAI-powered via the OpenAI API */

const $c = (id) => document.getElementById(id);
const chat = $c("chatMsgs");
const history = []; // {role, content} for the OpenAI conversation

/* ---------- player context ---------- */
const player = loadPlayerData();
if (player) $c("playerStatus").style.display = "inline-block";

/* ---------- API key handling (OpenAI) ---------- */
function getKey() { return localStorage.getItem("cc_openai_key") || ""; }
function getModel() { return localStorage.getItem("cc_openai_model") || "gpt-5-mini"; }
function refreshKeyStatus() {
  $c("keyStatus").textContent = getKey()
    ? `OpenAI mode active (${getModel()})`
    : "Built-in coach active";
}
$c("apiKey").value = getKey();
$c("modelSelect").value = getModel();
refreshKeyStatus();

$c("saveKeyBtn").addEventListener("click", () => {
  const k = $c("apiKey").value.trim();
  if (k) localStorage.setItem("cc_openai_key", k);
  localStorage.setItem("cc_openai_model", $c("modelSelect").value);
  refreshKeyStatus();
});
$c("modelSelect").addEventListener("change", () => {
  localStorage.setItem("cc_openai_model", $c("modelSelect").value);
  refreshKeyStatus();
});
$c("clearKeyBtn").addEventListener("click", () => {
  localStorage.removeItem("cc_openai_key");
  $c("apiKey").value = "";
  refreshKeyStatus();
});

/* ---------- Game Release Data (KB) handling ---------- */
const kbJsonInput = $c("kbJsonInput");
const saveKbBtn = $c("saveKbBtn");
const resetKbBtn = $c("resetKbBtn");
const kbStatus = $c("kbStatus");

// Populate on load
if (kbJsonInput) {
  kbJsonInput.value = JSON.stringify(KB, null, 2);
}

if (saveKbBtn) {
  saveKbBtn.addEventListener("click", () => {
    try {
      const newKB = JSON.parse(kbJsonInput.value);
      
      // Simple validation to check that the structure is reasonable
      if (typeof newKB !== "object" || newKB === null) {
        throw new Error("Release data must be a JSON object.");
      }
      
      saveKB(newKB);
      kbStatus.textContent = "Release data saved! Reloading...";
      kbStatus.className = "success small";
      setTimeout(() => {
        location.reload();
      }, 1000);
    } catch (e) {
      kbStatus.textContent = "⚠️ Invalid JSON: " + e.message;
      kbStatus.className = "error small";
    }
  });
}

if (resetKbBtn) {
  resetKbBtn.addEventListener("click", () => {
    if (confirm("Are you sure you want to reset the release data to the default July 2026 values?")) {
      localStorage.removeItem("cc_kb");
      kbStatus.textContent = "Resetting to default... Reloading...";
      kbStatus.className = "muted small";
      setTimeout(() => {
        location.reload();
      }, 1000);
    }
  });
}

/* ---------- chat plumbing ---------- */
function addMsg(text, cls) {
  const div = document.createElement("div");
  div.className = "msg " + cls;
  div.textContent = text;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
  return div;
}

async function send(text) {
  text = text.trim();
  if (!text) return;
  addMsg(text, "user");
  history.push({ role: "user", content: text });
  $c("chatInput").value = "";
  $c("sendBtn").disabled = true;

  const thinking = addMsg("thinking…", "bot thinking");
  try {
    const answer = getKey() ? await askOpenAI() : answerLocally(text);
    thinking.remove();
    addMsg(answer, "bot");
    history.push({ role: "assistant", content: answer });
  } catch (e) {
    thinking.remove();
    addMsg("⚠️ " + e.message + (getKey() ? " — falling back to the built-in coach:\n\n" + answerLocally(text) : ""), "bot");
  } finally {
    $c("sendBtn").disabled = false;
    $c("chatInput").focus();
  }
}

$c("sendBtn").addEventListener("click", () => send($c("chatInput").value));
$c("chatInput").addEventListener("keydown", (e) => { if (e.key === "Enter") send($c("chatInput").value); });
document.querySelectorAll("#suggestions button").forEach(b =>
  b.addEventListener("click", () => send(b.textContent)));

/* ---------- OpenAI mode ---------- */
function buildSystemPrompt() {
  let sys = `You are an expert Clash of Clans coach. Today is July 2026. You MUST base every answer on the GAME KNOWLEDGE data below (it reflects the latest release: TH18, the Dragon Duke, the 41-piece equipment roster, the April 2026 Ranked rework, and the July 2026 balance changes) plus general Clash fundamentals. Do not rely on older meta knowledge from your training data when it conflicts with this data — this data wins. If the data doesn't cover something, say so briefly rather than guessing. Be concise, friendly and practical; use short paragraphs or bullet lists. If asked about things outside Clash of Clans, politely redirect.

=== GAME KNOWLEDGE (July 2026 release data) ===
${JSON.stringify(KB, null, 1)}
`;
  if (player) {
    sys += `\n=== THE USER'S VILLAGE (from official API JSON they provided) ===\n${JSON.stringify({
      name: player.name, tag: player.tag, townHallLevel: player.townHallLevel,
      trophies: player.trophies, warStars: player.warStars,
      heroes: (player.heroes || []).filter(h => !h.village || h.village === "home"),
      heroEquipment: (player.heroEquipment || []).filter(h => !h.village || h.village === "home"),
      troops: (player.troops || []).filter(t => !t.village || t.village === "home").slice(0, 60),
      spells: player.spells,
    }, null, 1)}\nTailor every answer to this village when relevant.`;
  }
  return sys;
}

async function askOpenAI() {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + getKey(),
    },
    body: JSON.stringify({
      model: getModel(),
      max_completion_tokens: 1024,
      messages: [
        { role: "system", content: buildSystemPrompt() },
        ...history,
      ],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error?.message || `API error ${res.status}`);
  }
  const data = await res.json();
  const answer = data.choices?.[0]?.message?.content;
  if (!answer) throw new Error("Empty answer from the model.");
  return answer;
}

/* ---------- built-in coach (keyword retrieval over KB) ---------- */
function answerLocally(q) {
  const s = q.toLowerCase();
  const th = player?.townHallLevel;

  // specific equipment mentioned?
  const eq = KB.equipment.find(e => s.includes(e.name.toLowerCase()));
  if (eq) {
    const owned = player?.heroEquipment?.find(x => x.name.toLowerCase() === eq.name.toLowerCase());
    return `${eq.name} (${eq.hero} · ${eq.rarity}, max L${eq.maxLevel}) — meta tier ${eq.tier}.\n\n${eq.note}\nKey breakpoint: ${eq.breakpoint}.` +
      (owned ? `\n\nYours is level ${owned.level}/${owned.maxLevel}${/L(\d+)/.test(eq.breakpoint) && owned.level < Number(/L(\d+)/.exec(eq.breakpoint)[1]) ? ` — push it to the breakpoint.` : " — nice, it's past the breakpoint."}` : "");
  }

  // specific hero mentioned?
  const hero = KB.heroes.find(h => s.includes(h.name.toLowerCase()) || (h.name === "Dragon Duke" && s.includes("duke")));
  if (hero) {
    const owned = player?.heroes?.find(x => x.name === hero.name);
    const best = KB.equipment.filter(e => e.hero === hero.name && ["SSS", "SS", "S"].includes(e.tier)).map(e => `${e.name} (${e.tier})`).join(", ");
    return `${hero.name} — unlocks at ${hero.unlock}, game max level ${hero.maxLevel}.\n\n${hero.role}\n\nBest equipment: ${best}.` +
      (owned ? `\n\nYours is level ${owned.level}/${owned.maxLevel} at your TH.` : "");
  }

  if (/(equipment|gear|ore|starry|glowy|shiny)/.test(s)) {
    return `Ore strategy (July 2026):\n\n• ${KB.ores.advice}\n• ${KB.ores.system}\n\nTop pieces to prioritise across the board: Action Figure (SSS), Spiky Ball, Magic Mirror, Eternal Tome, Healing Tome, Electro Boots, Dark Orb, Fire Heart.` +
      (player ? `\n\nRun the Analyzer page for a priority list personalised to your levels.` : "");
  }

  if (/(army|attack|comp|strategy|strategies|3 star|three star)/.test(s)) {
    const askedTH = /th\s?(\d{2})|town hall\s?(\d{2})/.exec(s);
    const target = askedTH ? Number(askedTH[1] || askedTH[2]) : (th >= 18 ? 18 : 17);
    const pool = KB.armies.filter(a => a.townHall === target);
    const chosen = pool.length ? pool : KB.armies.filter(a => a.townHall === 18);
    return `Top armies right now for TH${chosen[0].townHall}:\n\n` +
      chosen.map(a => `• ${a.name} (${a.difficulty}) — ${a.comp}. ${a.why}`).join("\n\n");
  }

  if (/(legend|ranked|trophy|trophies|push)/.test(s)) {
    const r = KB.ranked;
    return `Ranked & Legend League (2026 rework):\n\n• ${r.system}\n• ${r.legendTiers}\n• ${r.trophies}\n• ${r.inactivity}\n\nBase-building: ${r.baseTips}\n\nDrop your layouts on the Legend Bases page to build a rotation.`;
  }

  if (/(th18|town hall 18|guardian|super wizard|hero bell)/.test(s)) {
    const t = KB.townHall18;
    return `Town Hall 18 (${t.released}):\n\n• Guardians: ${t.guardians}\n• ${t.superWizardTower}\n• Craftables: ${t.craftables}\n• Max levels: ${t.keyMaxLevels}`;
  }

  if (/(update|patch|balance|new|season|july|2026|odyssey)/.test(s)) {
    return `Latest game state (July 2026):\n\n` + KB.updates2026.map(u => `• ${u}`).join("\n");
  }

  if (/(upgrade|next|priorit|what should i)/.test(s)) {
    if (!player) return `General upgrade order: heroes first (biggest power gain), then SS/SSS equipment to their breakpoints, then key army troops for your comp, then defenses. Paste your JSON on the Village Analyzer page and I'll give you a personalised list.`;
    const behind = (player.heroes || []).filter(h => (!h.village || h.village === "home") && h.level < h.maxLevel);
    return `Based on your village (TH${player.townHallLevel}):\n\n` +
      (behind.length
        ? `• Heroes below cap: ${behind.map(h => `${h.name} ${h.level}/${h.maxLevel}`).join(", ")} — heroes first, always. July's Summer Jam gives up to 40% off.\n`
        : `• Your heroes are maxed for your TH — great!\n`) +
      `• Check the Analyzer page's Upgrade Priorities for the equipment breakpoint list.\n• ${KB.ores.advice}`;
  }

  // fallback
  return `I can help with:\n\n• Equipment (ask about any of the 41 pieces, e.g. "Is Spiky Ball worth it?")\n• Heroes — including the new Dragon Duke\n• Army comps for TH17/TH18\n• The 2026 Ranked/Legend League rework\n• TH18 features and the July 2026 update\n• Upgrade & Ore priorities\n\nTip: connect an OpenAI API key in Coach settings for full conversational coaching.`;
}
