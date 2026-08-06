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
          e.rounds.push({
            round, state: war.state, teamSize: war.teamSize,
            stars: side.stars, destruction: side.destruction,
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
