# ⚔️ Clash Companion

A three-page web app for Clash of Clans players, built with the **July 2026** game state
(TH18 meta, Dragon Duke, the 41-piece equipment roster, and the April 2026 Ranked rework).

## Pages

1. **Village Analyzer** (`index.html`) — paste your village JSON in either format:
   - **Official API** (`developer.clashofclans.com` → `GET /players/%23YOURTAG`), or
   - **In-game village export** with numeric IDs (`{"data":28000000,"lvl":92}`) — auto-detected;
     names/icons are resolved via `js/idmap.js`, 0-indexed levels are adjusted, and
     buildings/traps are shown grouped with levels.

   It breaks down heroes, all hero equipment vs. the current meta tier list,
   troops/spells progress, and generates a personalised upgrade-priority list.
   Data is saved in `localStorage` for the coach.

2. **Legend Bases** (`bases.html`) — drop Legend League base layouts: in-game copy link,
   screenshot (auto-downscaled), TH tag, style tags, notes. Filter by Town Hall,
   copy links, open directly in game. Stored locally in your browser.

3. **AI Coach** (`coach.html`) — chat coach with two modes:
   - **Built-in** (default, offline): instant answers from the embedded July 2026
     knowledge base (equipment tiers/breakpoints, armies, Ranked system, updates).
   - **OpenAI-powered** (optional): paste your own OpenAI API key in Coach settings
     (model selectable: gpt-5-mini / gpt-5 / gpt-4.1 / gpt-4o). The key stays in your
     browser and calls `api.openai.com` directly. Every request is grounded in the
     embedded knowledge base (`js/data.js`) plus your analyzed village (localStorage),
     and the system prompt instructs the model to prefer this data over its training data.

## Run it

Any static server works:

```bash
python3 -m http.server 8642 --directory clash-companion
```

Then open http://localhost:8642.

4. **CWL Helper** (`cwl-group.html`) — season planner for Clan War Leagues. Enter the 8 clan
   tags in your group; the page fetches each clan's level, war wins/losses, win streak and
   roster, scores every clan's strength (avg Town Hall dominant, plus clan level, win rate,
   streak), ranks the group, and runs a 6,000-season Monte-Carlo simulation for your
   **promotion probability** (top 2 promote), win-outright chance, and demotion risk.
   Then it auto-assigns your players across the 7 war days — strongest attackers against the
   toughest opponents — with per-day manual overrides. Season state persists in `localStorage`.

## Live clan data (optional)

The CWL Helper works fully in **manual mode** with no setup. For live fetching, the official
CoC API can't be called from a browser (no CORS, IP-locked keys), so `server.js` proxies it:

```bash
export COC_API_KEY="your-key-from-developer.clashofclans.com"   # whitelist your IP there
node server.js                                                  # → http://localhost:8642
```

Without the key the server still serves the app and the page falls back to manual entry.

## Assets & ID mapping

`assets/` holds 168 entity icons (heroes, equipment, troops, spells, sieges, pets,
defenses, traps) and `js/idmap.js` maps every village-export numeric ID to its name,
icon and max level. Both are generated from the community
[`clash-of-clans-data`](https://github.com/chiefpansancolt/clash-of-clans-data) npm
package by the `build-assets.js` script — re-run it after a game update to refresh
names/levels/icons. Game imagery © Supercell, used under their Fan Content Policy
(non-commercial fan tool).

## Knowledge base

All game data is initialized in `js/data.js` (`KB` object) and stored/loaded from `localStorage` (`cc_kb`). It covers heroes and max levels, all 41 equipment pieces with rarity/tier/breakpoints, TH17+TH18 meta armies, TH18 features, the 2026 Ranked/Legend system, Ore strategy, and the 2026 update timeline. You can view, edit, and reset this release data JSON directly in the AI Coach settings panel — every page (including the OpenAI system prompt) reads from it.
