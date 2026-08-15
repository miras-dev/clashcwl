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

## Ranked battle logs

`GET /players/{tag}/battlelog` returns a player's recent battles including their
Ranked/Legend attacks and defenses — stars, destruction and opponent per battle.
**It is not in the published Swagger docs**, but it is live on the official API and
answers with a normal key. Being undocumented, it is unversioned and could change
without notice, so everything that knows its shape is confined to `js/battlelog.js`.

Two things the endpoint does not do for you:

- `trophyChange` comes back `null` on every row. The trophy delta is derived from
  stars + destruction with the game's own formula, ported from
  [ClashPerk](https://github.com/clashperk/clashperk) (MIT).
- The log is a rolling buffer of ~50 battles of **all** types mixed together, not a
  time window. An active player's ranked history can fall off the end in under four
  days. Read `windowStart`/`windowEnd` off the summary rather than assuming a period.

Legend I players return `battleType: "legend"`; Legend II/III and below return
`"ranked"`. Both must be read, or whole tiers silently vanish. Some accounts return
HTTP 500 reproducibly, so per-player failure is normal and never sinks a clan batch.

Endpoints: `/api/battlelog?tag=` for one player, `/api/clan-battlelogs?tag=` for a
whole clan (batched in waves, ~20s for 40 members, cached for 10 minutes).

```bash
node test/battlelog.test.js
```

The test fixtures are real API responses, and the expected trophy values were read
off ClashPerk's `/legend days` output for the same player at the same moment — the
only external check available, since the API itself never returns the number.

## CWL eligibility scoring

`js/eligibility.js` ranks clan members on who should play Clan War League, using
**recent Ranked form only** — attacks used, trophies per attack, and triple rate.

Town Hall, hero levels and war stars are deliberately **not** scored. They reward
accumulation rather than current form, and would let a maxed account parked at a
lower Town Hall farming war stars outrank someone who is genuinely attacking now.
What predicts a good CWL attack is recent attacking.

The cost is honest: a player with no readable battle log gets no score at all.
They are listed as **unrated**, kept out of the suggested roster, and left for you
to include by judgement — never scored on potential we cannot see.

The important part is that form is measured **against the player's own league**.
Ranked applies [Battle Modifiers](https://supercell.com/en/games/clashofclans/blog/news/balance-changes-4/)
that buff defences and defending heroes while penalising the attacker's heroes,
and they get harsher the higher you climb. Measured across one clan, 29 players
with 3+ attacks each:

| League | Avg trophies/attack | Triple rate | Avg destruction |
| --- | --- | --- | --- |
| Dragon League 30 | +38.7 | 87% | 99.2% |
| Electro League 33 | +37.8 | 84% | 98.1% |
| Legend III | +36.8 | 75% | 97.0% |
| Legend II | +32.6 | 53% | 91.8% |
| Legend I | +28.1 | 13% | 89.5% |

Scoring raw averages would rank the clan's strongest attackers **last** — they
post the worst numbers precisely because they compete where it is hardest. So
each player's average is divided by their tier's par, and a small bonus rewards
competing high. CWL itself has no modifiers, so what transfers is the player's
skill, not the trophies their league happens to yield.

Tier order comes from the game's own `GET /leaguetiers` — 37 rungs from Unranked
to Legend I, where `id - 105000000` is the ladder position.

Two cases are handled explicitly rather than silently. A player with no readable
battle log is unrated. A player whose log shows zero attacks scores 0 — and sorts
*below* the unrated ones, because proven inactivity is worse evidence than no
evidence: the unrated player might still turn up. Both are stated in the row.

```bash
node test/eligibility.test.js
```

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
