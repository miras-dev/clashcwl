/* Clash Companion — Clash of Clans API proxy (AWS Lambda).
 *
 * Fronted by API Gateway at https://api.clashcwl.com. The browser never talks
 * to Supercell directly: the official API sends no CORS headers and needs an
 * IP-locked key that must stay server-side.
 *
 * Requests go through the RoyaleAPI proxy, so the key is locked to that
 * service's IP (45.79.218.79) rather than to any host of ours. Lambda has no
 * stable egress IP, so calling api.clashofclans.com directly would fail.
 *
 * Setup — set COC_API_KEY in the function's environment variables.
 */
import https from "node:https";

// Trimmed: a key pasted into the console with a stray newline or tab would
// otherwise fail as "Invalid character in header content".
const API_KEY = (process.env.COC_API_KEY || "").trim();
const COC_HOST = process.env.COC_API_HOST || "cocproxy.royaleapi.dev";

// Browsers only need this from our own origins; the API Gateway usage plan is
// what actually limits abuse, since a non-browser client ignores CORS entirely.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS
  || "https://clashcwl.com,https://www.clashcwl.com").split(",").map(s => s.trim());

// Cache lives on the warm container. Clan and war data moves slowly, so even a
// short TTL collapses a burst of requests into one upstream call — which is
// what keeps us inside the key's throttling tier.
const cache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function getCached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) return entry.data;
  if (entry) cache.delete(key);
  return null;
}

function setCached(key, data) {
  cache.set(key, { timestamp: Date.now(), data });
  // Bound the map: a container that sees many distinct tags would otherwise
  // grow until the sandbox runs out of memory.
  if (cache.size > 500) {
    for (const [k, v] of cache) {
      if (Date.now() - v.timestamp >= CACHE_TTL) cache.delete(k);
    }
    if (cache.size > 500) cache.delete(cache.keys().next().value);
  }
}

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Vary": "Origin",
  };
}

function cocGet(apiPath) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: COC_HOST,
        path: "/v1" + apiPath,
        method: "GET",
        headers: { Authorization: "Bearer " + API_KEY, Accept: "application/json" },
        timeout: 15000,
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try { resolve({ status: res.statusCode, json: JSON.parse(body || "{}") }); }
          catch { resolve({ status: res.statusCode, json: { reason: "badResponse", raw: body.slice(0, 400) } }); }
        });
      }
    );
    req.on("timeout", () => { req.destroy(); reject(new Error("CoC API timeout")); });
    req.on("error", reject);
    req.end();
  });
}

export const handler = async (event) => {
  // Off by default: the event carries the caller's IP and user-agent, and at
  // production volume logging every one of them costs money for no benefit.
  // Set DEBUG=1 in the function's environment to turn it back on.
  if (process.env.DEBUG) console.log("EVENT:", JSON.stringify(event));

  // Works under both the HTTP API (v2) and REST API (v1) payload formats.
  const method = event.requestContext?.http?.method || event.httpMethod || "GET";
  const query = event.queryStringParameters || {};
  const origin = (event.headers?.origin) || (event.headers?.Origin) || "";
  const headers = corsHeaders(origin);

  // Under the ANY /api/{proxy+} route, API Gateway resolves the path for us.
  // The fallback covers direct invokes (console tests) and strips the stage
  // prefix that the default execute-api domain adds but a custom domain doesn't.
  const path = event.pathParameters?.proxy
    ? "/" + event.pathParameters.proxy
    : (event.rawPath || event.path || "")
        .replace(/^\/[^/]+/, "")
        .replace(/^\/api/, "")
        .replace(/\/$/, "") || "/";

  const reply = (statusCode, obj) => ({
    statusCode,
    headers,
    body: JSON.stringify(obj),
  });

  if (method === "OPTIONS") return { statusCode: 204, headers, body: "" };

  if (path === "/status") return reply(200, { ok: true, hasKey: !!API_KEY });

  if (!API_KEY) {
    return reply(503, {
      error: "no_key",
      message: "COC_API_KEY is not set on the function. Add it in the Lambda console under Configuration > Environment variables.",
    });
  }

  const tag = (query.tag || "").trim().toUpperCase().replace(/^#/, "");

  // Deep clan profile: clan plus every member's war stars / league / preference.
  // Batched here so the browser makes one request instead of ~50.
  if (path === "/clan-deep") {
    if (!tag) return reply(400, { error: "bad_request" });

    const cacheKey = `clan-deep-${tag}`;
    const cached = getCached(cacheKey);
    if (cached) return reply(200, cached);

    try {
      const clanRes = await cocGet(`/clans/%23${encodeURIComponent(tag)}`);
      if (clanRes.status !== 200) return reply(clanRes.status, clanRes.json);
      const clan = clanRes.json;
      const list = clan.memberList || [];

      const players = [];
      const WAVE = 8;
      for (let i = 0; i < list.length; i += WAVE) {
        const wave = await Promise.all(list.slice(i, i + WAVE).map(async (m) => {
          try {
            const p = await cocGet(`/players/%23${encodeURIComponent(m.tag.replace(/^#/, ""))}`);
            if (p.status !== 200) return null;
            const d = p.json;
            const heroSum = (d.heroes || [])
              .filter(h => !h.village || h.village === "home")
              .reduce((a, h) => a + (h.level || 0), 0);
            return {
              tag: d.tag, name: d.name, role: m.role,
              thLevel: d.townHallLevel || 0,
              expLevel: d.expLevel || 0,
              warStars: d.warStars || 0,
              warPreference: d.warPreference || "unknown",
              trophies: d.trophies || 0,
              bestTrophies: d.bestTrophies || 0,
              leagueTier: d.leagueTier ? d.leagueTier.name : null,
              heroSum,
              donations: m.donations || 0,
            };
          } catch { return null; }
        }));
        players.push(...wave.filter(Boolean));
      }

      const responseBody = {
        tag: clan.tag, name: clan.name, level: clan.clanLevel,
        warWins: clan.warWins || 0, warTies: clan.warTies || 0, warLosses: clan.warLosses || 0,
        winStreak: clan.warWinStreak || 0,
        warLeague: clan.warLeague ? clan.warLeague.name : null,
        isWarLogPublic: !!clan.isWarLogPublic,
        clanPoints: clan.clanPoints || 0,
        requiredTownhallLevel: clan.requiredTownhallLevel || 0,
        location: clan.location ? clan.location.name : null,
        badge: clan.badgeUrls ? clan.badgeUrls.small : null,
        memberCount: clan.members || list.length,
        players,
      };

      setCached(cacheKey, responseBody);
      return reply(200, responseBody);
    } catch (e) {
      return reply(502, { error: "upstream", message: e.message });
    }
  }

  // Ranked/Legend battle logs for a whole clan — who is actually using their
  // attacks, and how well. See js/battlelog.js for what the endpoint does and
  // does not return; the scoring that consumes this lives in js/eligibility.js.
  //
  // This is the most expensive route here: one upstream call per member, and
  // API Gateway hangs up at 29s no matter what the function's own timeout is.
  // So it works to a wall-clock budget and returns what it has, marking the rest
  // as unfetched — a partial ranking the page can explain beats a 504 it cannot.
  if (path === "/clan-battlelogs") {
    if (!tag) return reply(400, { error: "bad_request" });

    const cacheKey = `clan-battlelogs-${tag}`;
    const cached = getCached(cacheKey);
    if (cached) return reply(200, cached);

    // Leaves room for the clan fetch, JSON serialisation and Gateway overhead
    // inside the 29s ceiling.
    const BUDGET_MS = 20000;
    const startedAt = Date.now();

    try {
      const clanRes = await cocGet(`/clans/%23${encodeURIComponent(tag)}`);
      if (clanRes.status !== 200) return reply(clanRes.status, clanRes.json);
      const list = clanRes.json.memberList || [];

      // Keep only ranked/legend battles, and only the fields the scoring reads.
      // A raw clan of 40 is ~2.5MB against API Gateway's hard 6MB response
      // limit; nearly 60% of that is homeVillage battles and loot totals nothing
      // downstream looks at. Must stay in step with js/battlelog.js.
      const leanLog = (json) => ({
        items: (json.items || [])
          .filter((b) => b.battleType === "ranked" || b.battleType === "legend")
          .map((b) => ({
            battleType: b.battleType,
            attack: b.attack,
            stars: b.stars,
            destructionPercentage: b.destructionPercentage,
            battleTimestamp: b.battleTimestamp,
            opponentName: b.opponentName,
            opponentPlayerTag: b.opponentPlayerTag,
            opponentTownHallLevel: b.opponentTownHallLevel,
          })),
      });

      const fetchOne = async (m) => {
        const memberTag = encodeURIComponent(m.tag.replace(/^#/, ""));
        // One retry: timeouts here are transient far more often than they are a
        // real failure for that player. A non-200 is the API's verdict, not a
        // fault, so it is not retried.
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const r = await cocGet(`/players/%23${memberTag}/battlelog`);
            if (r.status === 200) return { tag: m.tag, name: m.name, battlelog: leanLog(r.json), error: null };
            return { tag: m.tag, name: m.name, battlelog: null, error: `HTTP ${r.status}` };
          } catch (e) {
            if (attempt === 1) return { tag: m.tag, name: m.name, battlelog: null, error: e.message };
          }
        }
      };

      const members = [];
      let truncated = false;
      const WAVE = 8;
      for (let i = 0; i < list.length; i += WAVE) {
        if (Date.now() - startedAt > BUDGET_MS) {
          // Out of time. Report the rest as unfetched rather than dropping them:
          // a missing member must not read as an inactive one.
          truncated = true;
          for (const m of list.slice(i)) {
            members.push({ tag: m.tag, name: m.name, battlelog: null, error: "not_fetched" });
          }
          break;
        }
        // allSettled, not all: one timeout must not discard the whole clan's work.
        const wave = await Promise.allSettled(list.slice(i, i + WAVE).map(fetchOne));
        members.push(...wave.map((r, j) => r.status === "fulfilled" ? r.value : {
          tag: list[i + j].tag, name: list[i + j].name, battlelog: null,
          error: r.reason ? String(r.reason.message || r.reason) : "unknown",
        }));
      }

      const responseBody = {
        tag: clanRes.json.tag, name: clanRes.json.name,
        fetchedAt: new Date().toISOString(),
        truncated,
        members,
      };
      // A truncated result is still worth caching — it spares the next caller the
      // same 20 seconds — but not for the full TTL, so the gaps fill in sooner.
      if (!truncated) setCached(cacheKey, responseBody);
      return reply(200, responseBody);
    } catch (e) {
      return reply(502, { error: "upstream", message: e.message });
    }
  }

  // Which players each clan in the group has actually fielded, round by round.
  // The roster on paper says little — this is who they put in a war, with the
  // Town Hall levels, so you can see a clan's real CWL line-up and how much it
  // rotates before deciding who to field against them.
  if (path === "/cwl-rounds") {
    if (!tag) return reply(400, { error: "bad_request" });

    const cacheKey = `cwl-rounds-${tag}`;
    const cached = getCached(cacheKey);
    if (cached) return reply(200, cached);

    try {
      const grpRes = await cocGet(`/clans/%23${encodeURIComponent(tag)}/currentwar/leaguegroup`);
      if (grpRes.status !== 200) return reply(grpRes.status, grpRes.json);
      const group = grpRes.json;

      // '#0' marks a round that hasn't been drawn yet.
      const rounds = (group.rounds || []).map(r => (r.warTags || []).filter(t => t && t !== "#0"));
      const flat = rounds.flatMap((tags, i) => tags.map(t => ({ round: i + 1, warTag: t })));

      const wars = [];
      const WAVE = 6;
      for (let i = 0; i < flat.length; i += WAVE) {
        const wave = await Promise.all(flat.slice(i, i + WAVE).map(async ({ round, warTag }) => {
          // A finished war is immutable, so it is worth caching on its own key
          // and for far longer than the group summary around it.
          const wk = `war-${warTag}`;
          const hit = getCached(wk);
          if (hit) return { round, war: hit };
          try {
            const w = await cocGet(`/clanwarleagues/wars/%23${encodeURIComponent(warTag.replace(/^#/, ""))}`);
            if (w.status !== 200) return null;
            const lean = ["clan", "opponent"].map(side => {
              const c = w.json[side] || {};
              return {
                tag: c.tag, name: c.name,
                stars: c.stars || 0,
                destruction: c.destructionPercentage || 0,
                members: (c.members || []).map(m => {
                  // In CWL each player gets one attack, but sum defensively in
                  // case a war ever grants more.
                  const atk = m.attacks || [];
                  return {
                    tag: m.tag, name: m.name, th: m.townhallLevel, pos: m.mapPosition,
                    attacks: atk.length,
                    stars: atk.reduce((a, x) => a + (x.stars || 0), 0),
                    destruction: atk.reduce((a, x) => a + (x.destructionPercentage || 0), 0),
                  };
                }),
              };
            });
            const war = { state: w.json.state, teamSize: w.json.teamSize, sides: lean };
            if (w.json.state === "warEnded") setCached(wk, war);
            return { round, war };
          } catch { return null; }
        }));
        wars.push(...wave.filter(Boolean));
      }

      // Re-key by clan: for each clan, which rounds it played and who it fielded.
      const byClan = {};
      for (const { round, war } of wars) {
        for (const side of war.sides) {
          if (!side.tag) continue;
          const e = byClan[side.tag] || (byClan[side.tag] = { tag: side.tag, name: side.name, rounds: [] });
          const foe = war.sides.find(s => s.tag && s.tag !== side.tag);
          e.rounds.push({
            round, state: war.state, teamSize: war.teamSize,
            stars: side.stars, destruction: side.destruction,
            // Who this clan actually faced in this round. The war schedule is
            // fixed by the game and is not the same as any strength ordering.
            opponentTag: foe?.tag || null,
            opponentName: foe?.name || null,
            opponentStars: foe?.stars ?? null,
            lineup: side.members.sort((a, b) => a.pos - b.pos),
          });
        }
      }

      for (const e of Object.values(byClan)) {
        e.rounds.sort((a, b) => a.round - b.round);
        // Appearance count per player — a 5/5 is a fixture, a 1/5 is a fill-in.
        const seen = new Map();
        for (const r of e.rounds) {
          for (const m of r.lineup) {
            const p = seen.get(m.tag) || {
              tag: m.tag, name: m.name, th: m.th,
              appearances: 0, stars: 0, attacks: 0, destruction: 0,
            };
            p.appearances += 1; p.th = m.th;
            p.stars += m.stars || 0;
            p.attacks += m.attacks || 0;
            p.destruction += m.destruction || 0;
            seen.set(m.tag, p);
          }
        }
        // A player fielded in a war that has not started yet has no attack to
        // judge, so average over attacks used rather than rounds appeared.
        for (const p of seen.values()) {
          p.avgStars = p.attacks ? +(p.stars / p.attacks).toFixed(2) : null;
          p.avgDestruction = p.attacks ? Math.round(p.destruction / p.attacks) : null;
        }
        e.roundsPlayed = e.rounds.length;
        e.players = [...seen.values()].sort((a, b) =>
          b.stars - a.stars || b.appearances - a.appearances || b.th - a.th);
        e.totalStars = e.players.reduce((a, p) => a + p.stars, 0);
        e.totalAttacks = e.players.reduce((a, p) => a + p.attacks, 0);
        // TH mix of the most recent line-up — what they are fielding right now.
        const last = e.rounds[e.rounds.length - 1];
        e.currentThMix = last ? last.lineup.reduce((m, p) => (m[p.th] = (m[p.th] || 0) + 1, m), {}) : {};
      }

      const responseBody = {
        state: group.state,
        season: group.season,
        totalRounds: rounds.length,
        roundsAvailable: rounds.filter(r => r.length).length,
        clans: Object.values(byClan),
      };

      setCached(cacheKey, responseBody);
      return reply(200, responseBody);
    } catch (e) {
      return reply(502, { error: "upstream", message: e.message });
    }
  }

  try {
    let apiPath = null;
    if (path === "/clan" && tag) apiPath = `/clans/%23${encodeURIComponent(tag)}`;
    else if (path === "/clan-members" && tag) apiPath = `/clans/%23${encodeURIComponent(tag)}/members`;
    else if (path === "/player" && tag) apiPath = `/players/%23${encodeURIComponent(tag)}`;
    // Undocumented but live on the official API — see js/battlelog.js.
    else if (path === "/battlelog" && tag) apiPath = `/players/%23${encodeURIComponent(tag)}/battlelog`;
    else if (path === "/warlog" && tag) apiPath = `/clans/%23${encodeURIComponent(tag)}/warlog?limit=20`;
    else if (path === "/cwl-group" && tag) apiPath = `/clans/%23${encodeURIComponent(tag)}/currentwar/leaguegroup`;

    if (!apiPath) return reply(400, { error: "bad_request", message: "Unknown endpoint or missing ?tag=" });

    const cacheKey = `${path}-${tag}`;
    const cached = getCached(cacheKey);
    if (cached) return reply(200, cached);

    const { status, json } = await cocGet(apiPath);
    if (status === 200) setCached(cacheKey, json);
    return reply(status, json);
  } catch (e) {
    return reply(502, { error: "upstream", message: e.message });
  }
};
