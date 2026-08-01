/* Legend Base Drops — localStorage-backed base library */

const $b = (id) => document.getElementById(id);
let pendingImage = null;

function loadBases() {
  try { return JSON.parse(localStorage.getItem("cc_bases") || "[]"); }
  catch { return []; }
}
function saveBases(list) {
  try {
    localStorage.setItem("cc_bases", JSON.stringify(list));
    return true;
  } catch (e) {
    // usually QuotaExceededError from large images
    alert("Couldn't save — storage is full. Try a smaller screenshot or remove old bases.");
    return false;
  }
}

function escB(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---- image handling: downscale to keep localStorage small ---- */
const dropZone = $b("dropZone");
const fileInput = $b("fileInput");

dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("dragover"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) handleFile(fileInput.files[0]);
});
$b("removeImg").addEventListener("click", () => {
  pendingImage = null;
  $b("previewWrap").style.display = "none";
  fileInput.value = "";
});

function handleFile(file) {
  if (!file.type.startsWith("image/")) return;
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    const maxW = 900;
    const scale = Math.min(1, maxW / img.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    pendingImage = canvas.toDataURL("image/jpeg", 0.75);
    $b("previewImg").src = pendingImage;
    $b("previewWrap").style.display = "block";
    URL.revokeObjectURL(url);
  };
  img.src = url;
}

/* ---- add base ---- */
$b("addBaseBtn").addEventListener("click", () => {
  const name = $b("baseName").value.trim();
  const link = $b("baseLink").value.trim();
  if (!name && !link && !pendingImage) {
    $b("baseMsg").textContent = "Give the base at least a name, a link, or a screenshot.";
    return;
  }
  if (link && !/^https:\/\/link\.clashofclans\.com\//i.test(link)) {
    $b("baseMsg").textContent = "That doesn't look like an official link.clashofclans.com copy link — saving anyway.";
  } else {
    $b("baseMsg").textContent = "";
  }

  const base = {
    id: Date.now(),
    name: name || "Unnamed base",
    link,
    th: $b("baseTH").value,
    tags: $b("baseTags").value.split(",").map(t => t.trim()).filter(Boolean),
    notes: $b("baseNotes").value.trim(),
    img: pendingImage,
    added: new Date().toISOString().slice(0, 10),
  };
  const list = loadBases();
  list.unshift(base);
  if (!saveBases(list)) return;

  ["baseName", "baseLink", "baseTags", "baseNotes"].forEach(id => $b(id).value = "");
  pendingImage = null;
  $b("previewWrap").style.display = "none";
  fileInput.value = "";
  $b("baseMsg").textContent = "Base added ✔";
  renderBases();
});

/* ---- render ---- */
$b("filterTH").addEventListener("change", renderBases);

function renderBases() {
  const filter = $b("filterTH").value;
  const list = loadBases().filter(b => filter === "all" || b.th === filter);
  const grid = $b("baseGrid");
  $b("emptyMsg").style.display = list.length ? "none" : "block";

  grid.innerHTML = list.map(b => `
    <div class="base-card">
      ${b.img ? `<img src="${b.img}" alt="${escB(b.name)}" />` : `<div class="no-img">TH${escB(b.th)} LAYOUT</div>`}
      <div class="body">
        <div class="row" style="justify-content:space-between">
          <h3 style="margin:0">${escB(b.name)}</h3>
          <span class="pill gold">TH${escB(b.th)}</span>
        </div>
        ${b.tags.length ? `<div class="row" style="gap:6px">${b.tags.map(t => `<span class="pill">${escB(t)}</span>`).join("")}</div>` : ""}
        ${b.notes ? `<p class="muted small">${escB(b.notes)}</p>` : ""}
        <div class="row" style="margin-top:auto; padding-top:8px">
          ${b.link ? `
            <a class="btn" style="text-decoration:none; font-size:.82rem; padding:8px 12px" href="${escB(b.link)}" target="_blank" rel="noopener">Open in game</a>
            <button class="secondary" style="font-size:.82rem; padding:8px 12px" data-copy="${escB(b.link)}">Copy link</button>` : ""}
          <button class="danger" style="font-size:.82rem; padding:8px 12px; margin-left:auto" data-del="${b.id}">Delete</button>
        </div>
        <div class="muted small">Added ${escB(b.added)}</div>
      </div>
    </div>`).join("");

  grid.querySelectorAll("[data-copy]").forEach(btn => {
    btn.addEventListener("click", async () => {
      await navigator.clipboard.writeText(btn.dataset.copy);
      btn.textContent = "Copied ✔";
      setTimeout(() => (btn.textContent = "Copy link"), 1500);
    });
  });
  grid.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", () => {
      if (!confirm("Delete this base?")) return;
      saveBases(loadBases().filter(b => b.id !== Number(btn.dataset.del)));
      renderBases();
    });
  });
}

renderBases();
