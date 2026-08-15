/* "Clear saved data" — wipes everything this site keeps in localStorage.
 *
 * Everything is stored under a cc_ prefix, so the reset is scoped to that rather
 * than calling localStorage.clear(): the site may share an origin with other
 * pages one day, and clearing their keys too would be a nasty surprise.
 *
 * This is irreversible and some of it exists nowhere else — base layouts and
 * their screenshots are only ever in the browser, and the OpenAI key is a
 * credential the user pasted in. So the confirmation names what will actually
 * go, counted from what is really present rather than from a fixed list.
 */
(function () {
"use strict";

const PREFIX = "cc_";

// What each key holds, in the user's terms. Anything unlisted still gets
// cleared — it is counted as "other saved settings" rather than named.
const LABELS = {
  cc_cwl_group:     "CWL group, roster and war-day assignments",
  cc_cwl_roster:    "CWL planner roster",
  cc_cwl_cart:      "CWL medal shopping list",
  cc_player:        "your analysed village",
  cc_bases:         "saved Legend base layouts",
  cc_openai_key:    "your OpenAI API key",
  cc_kb:            "cached coach knowledge base",
};

// Keys worth calling out separately: losing them costs more than a re-fetch.
const IRREPLACEABLE = new Set(["cc_bases", "cc_openai_key"]);

function savedKeys() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(PREFIX)) keys.push(k);
  }
  return keys;
}

function describe(keys) {
  const named = keys.filter((k) => LABELS[k]).map((k) => LABELS[k]);
  const extra = keys.length - named.length;
  if (extra > 0) named.push(`${extra} other saved setting${extra === 1 ? "" : "s"}`);
  return named;
}

function clearAll() {
  const keys = savedKeys();

  if (!keys.length) {
    alert("There is nothing saved in this browser to clear.");
    return;
  }

  const items = describe(keys);
  const warnings = keys
    .filter((k) => IRREPLACEABLE.has(k))
    .map((k) => k === "cc_bases"
      ? "Your base layouts and their screenshots exist only in this browser — clearing them cannot be undone."
      : "Your OpenAI key will be removed and you will need to paste it in again.");

  const message = "This will permanently delete everything Clash Companion has saved "
    + "in this browser:\n\n"
    + items.map((s) => "  • " + s).join("\n")
    + (warnings.length ? "\n\n" + warnings.join("\n") : "")
    + "\n\nNothing on the server is affected. Continue?";

  if (!confirm(message)) return;

  for (const k of keys) localStorage.removeItem(k);

  // Reload so every page drops the state it read at startup, rather than
  // continuing to render from variables that no longer have a backing store.
  location.reload();
}

function mount() {
  const nav = document.querySelector("nav");
  if (!nav || document.getElementById("clearDataBtn")) return;

  const btn = document.createElement("button");
  btn.id = "clearDataBtn";
  btn.type = "button";
  btn.className = "secondary small nav-clear";
  btn.textContent = "Clear saved data";
  btn.title = "Delete everything this site has saved in your browser";
  btn.addEventListener("click", clearAll);

  // Before the GitHub link when there is one, so the icon stays the last thing
  // in the bar on every page.
  const github = nav.querySelector(".github-link");
  if (github) nav.insertBefore(btn, github);
  else nav.appendChild(btn);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount);
} else {
  mount();
}

})();
