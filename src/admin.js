const grid = document.querySelector("#admin-grid");
const count = document.querySelector("#library-count");
const search = document.querySelector("#search-input");
const setFilter = document.querySelector("#set-filter");
const fileInput = document.querySelector("#file-input");
const dropZone = document.querySelector("#drop-zone");
const progress = document.querySelector("#upload-progress");
const removedToggle = document.querySelector("#removed-toggle");
const removedGrid = document.querySelector("#removed-grid");
const removedCount = document.querySelector("#removed-count");
const dialog = document.querySelector("#edit-dialog");
const form = document.querySelector("#edit-form");
const toast = document.querySelector("#admin-toast");
const selectVisibleButton = document.querySelector("#select-visible");
const bulkBar = document.querySelector("#bulk-bar");
const selectedCount = document.querySelector("#selected-count");
const clearSelectionButton = document.querySelector("#clear-selection");
const bulkHideButton = document.querySelector("#bulk-hide");

let photos = [];
let hiddenPhotos = [];
let selectedMedia = "all";
const selectedKeys = new Set();
let toastTimer;

function notify(message, error = false) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `admin-toast visible${error ? " error" : ""}`;
  toastTimer = setTimeout(() => { toast.className = "admin-toast"; }, 3200);
}

async function api(path, options) {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

function collectionLabel(collection) {
  return { fujifilm: "Fujifilm", "archive-1": "Added photographs", motion: "Other motion", "motion-fuji": "Fuji motion", uploads: "Photo upload", "motion-uploads": "Video upload" }[collection] || collection;
}

function filteredPhotos() {
  const query = search.value.trim().toLowerCase();
  const selectedSet = setFilter.value;
  return photos.filter((photo) => {
    const matchesSet = selectedSet === "all" || photo.collection === selectedSet;
    const matchesMedia = selectedMedia === "all" || (selectedMedia === "video" ? photo.type === "video" : photo.type !== "video");
    const haystack = [photo.source, photo.title, photo.location, photo.camera, photo.lens, ...(photo.tags || [])].filter(Boolean).join(" ").toLowerCase();
    return matchesSet && matchesMedia && (!query || haystack.includes(query));
  });
}

function updateSelection() {
  selectedCount.textContent = selectedKeys.size;
  bulkBar.hidden = selectedKeys.size === 0;
  const visible = filteredPhotos();
  const allVisibleSelected = visible.length > 0 && visible.every((photo) => selectedKeys.has(photo.sourceKey));
  selectVisibleButton.textContent = allVisibleSelected ? "Unselect visible" : "Select visible";
  document.querySelectorAll(".admin-card").forEach((card) => {
    const checked = selectedKeys.has(card.dataset.sourceKey);
    card.classList.toggle("selected", checked);
    const checkbox = card.querySelector(".card-selector input");
    if (checkbox) checkbox.checked = checked;
  });
}

function createCard(photo) {
  const isVideo = photo.type === "video";
  const article = document.createElement("article");
  article.className = `admin-card${isVideo ? " admin-video-card" : ""}`;
  article.dataset.sourceKey = photo.sourceKey;
  const figure = document.createElement("figure");
  const image = document.createElement("img");
  image.src = photo.images[640];
  image.loading = "lazy";
  image.alt = photo.title || photo.source;
  image.addEventListener("load", () => image.classList.add("loaded"), { once: true });
  if (image.complete) image.classList.add("loaded");
  let preview;
  if (isVideo) {
    preview = document.createElement("video");
    preview.className = "admin-video-preview";
    preview.muted = true;
    preview.loop = true;
    preview.playsInline = true;
    preview.preload = "none";
    preview.poster = photo.images[640];
    preview.setAttribute("aria-hidden", "true");
    const mark = document.createElement("span");
    mark.className = "admin-motion-mark";
    mark.textContent = `▶ ${photo.durationLabel}`;
    figure.append(preview, mark);
    article.addEventListener("pointerenter", () => {
      if (!preview.src) preview.src = photo.videos.preview;
      preview.play().then(() => article.classList.add("previewing"), () => {});
    });
    article.addEventListener("pointerleave", () => {
      preview.pause();
      if (preview.currentSrc) preview.currentTime = 0;
      article.classList.remove("previewing");
    });
  }
  const caption = document.createElement("figcaption");
  caption.textContent = [isVideo ? `Motion ${photo.durationLabel}` : null, photo.location, photo.date?.slice(0, 10), photo.camera].filter(Boolean).join(" · ") || "Metadata not recorded";
  const selector = document.createElement("label");
  selector.className = "card-selector";
  selector.title = `Select ${photo.source}`;
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = selectedKeys.has(photo.sourceKey);
  checkbox.setAttribute("aria-label", `Select ${photo.source}`);
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) selectedKeys.add(photo.sourceKey);
    else selectedKeys.delete(photo.sourceKey);
    updateSelection();
  });
  selector.append(checkbox, document.createElement("i"));
  figure.append(image, caption, selector);
  const actions = document.createElement("div");
  actions.className = "card-actions";
  const edit = document.createElement("button");
  edit.type = "button";
  edit.textContent = photo.title || photo.source.replace(/\.[^.]+$/, "");
  edit.title = `Edit ${photo.source}`;
  edit.addEventListener("click", () => openEditor(photo));
  const hide = document.createElement("button");
  hide.type = "button";
  hide.textContent = "Hide";
  hide.setAttribute("aria-label", `Hide ${photo.source} from the gallery`);
  hide.addEventListener("click", () => hidePhoto(photo));
  actions.append(edit, hide);
  if (photo.collection === "uploads" || photo.collection === "motion-uploads") {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "delete-button";
    remove.textContent = "Delete";
    remove.setAttribute("aria-label", `Permanently delete ${photo.source}`);
    remove.addEventListener("click", () => deleteUpload(photo));
    actions.append(remove);
  }
  article.append(figure, actions);
  return article;
}

function renderPhotos() {
  const visible = filteredPhotos();
  grid.replaceChildren(...visible.map(createCard));
  if (!visible.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No media matches this view.";
    grid.append(empty);
  }
  grid.setAttribute("aria-busy", "false");
  const motionCount = photos.filter((item) => item.type === "video").length;
  count.textContent = `${visible.length} shown · ${photos.length} in gallery · ${motionCount} motion`;
  document.querySelector("#all-media-count").textContent = photos.length;
  document.querySelector("#photo-media-count").textContent = photos.length - motionCount;
  document.querySelector("#video-media-count").textContent = motionCount;
  updateSelection();
}

function renderHidden() {
  removedCount.textContent = hiddenPhotos.length;
  removedGrid.replaceChildren(...hiddenPhotos.map((photo) => {
    const card = document.createElement("article");
    card.className = "restore-card";
    const image = document.createElement("img");
    image.src = photo.images?.[640] || "";
    image.alt = photo.source;
    image.loading = "lazy";
    if (photo.type === "video") {
      const mark = document.createElement("span");
      mark.className = "restore-motion-mark";
      mark.textContent = `▶ ${photo.durationLabel || "Motion"}`;
      card.append(mark);
    }
    const actions = document.createElement("div");
    actions.className = "restore-actions";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Restore";
    button.addEventListener("click", () => restorePhoto(photo));
    actions.append(button);
    if (photo.collection === "uploads" || photo.collection === "motion-uploads") {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "delete-button";
      remove.textContent = "Delete";
      remove.addEventListener("click", () => deleteUpload(photo));
      actions.append(remove);
    }
    card.append(image, actions);
    return card;
  }));
  if (!hiddenPhotos.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Nothing has been removed.";
    removedGrid.append(empty);
  }
}

async function loadGallery() {
  const data = await api("/api/admin/gallery");
  photos = data.photos.sort((a, b) => (b.date || "").localeCompare(a.date || "") || a.source.localeCompare(b.source));
  hiddenPhotos = data.hiddenPhotos;
  for (const key of [...selectedKeys]) if (!photos.some((photo) => photo.sourceKey === key)) selectedKeys.delete(key);
  renderPhotos();
  renderHidden();
}

function openEditor(photo) {
  document.querySelector("#edit-source-key").value = photo.sourceKey;
  document.querySelector("#edit-title-field").value = photo.title || "";
  document.querySelector("#edit-date").value = photo.date?.slice(0, 16) || "";
  document.querySelector("#edit-location").value = photo.location || "";
  document.querySelector("#edit-latitude").value = Number.isFinite(photo.latitude) ? photo.latitude : "";
  document.querySelector("#edit-longitude").value = Number.isFinite(photo.longitude) ? photo.longitude : "";
  document.querySelector("#edit-tags").value = (photo.tags || []).join(", ");
  document.querySelector("#edit-image").src = photo.images[1280];
  document.querySelector("#edit-technical").textContent = [collectionLabel(photo.collection), photo.type === "video" ? `Motion ${photo.durationLabel}` : null, photo.dimensions, photo.camera, photo.lens].filter(Boolean).join(" · ");
  dialog.showModal();
}

async function hidePhoto(photo) {
  if (!window.confirm(`Remove “${photo.title || photo.source}” from the gallery?\n\nThe original file will not be deleted.`)) return;
  try {
    await api("/api/admin/hide", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceKey: photo.sourceKey }) });
    notify("Gallery item hidden. You can restore it below.");
    await loadGallery();
  } catch (error) { notify(error.message, true); }
}

async function restorePhoto(photo) {
  try {
    await api("/api/admin/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceKey: photo.sourceKey }) });
    notify("Gallery item restored.");
    await loadGallery();
  } catch (error) { notify(error.message, true); }
}

async function deleteUpload(photo) {
  if (!window.confirm(`Permanently delete “${photo.title || photo.source}”?\n\nThis removes the Admin-uploaded original and cannot be undone.`)) return;
  try {
    await api("/api/admin/delete-upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceKey: photo.sourceKey }) });
    notify("Admin upload permanently deleted.");
    await loadGallery();
  } catch (error) { notify(error.message, true); }
}

async function hideSelected() {
  const keys = [...selectedKeys];
  if (!keys.length) return;
  if (!window.confirm(`Hide ${keys.length} selected ${keys.length === 1 ? "item" : "items"}?\n\nThey can all be restored from the Hidden section.`)) return;
  bulkHideButton.disabled = true;
  bulkHideButton.textContent = "Hiding…";
  try {
    const result = await api("/api/admin/hide-many", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceKeys: keys }) });
    selectedKeys.clear();
    await loadGallery();
    notify(`${result.hidden} ${result.hidden === 1 ? "item" : "items"} hidden.`);
  } catch (error) { notify(error.message, true); }
  finally { bulkHideButton.disabled = false; bulkHideButton.textContent = "Hide selected"; }
}

async function upload(files) {
  const media = [...files].filter((file) => /^(image|video)\//.test(file.type) || /\.(jpe?g|png|webp|tiff?|mp4|mov|m4v|webm|mkv)$/i.test(file.name));
  if (!media.length) { notify("Choose one or more supported media files.", true); return; }
  progress.hidden = false;
  for (let index = 0; index < media.length; index += 1) {
    const file = media[index];
    progress.querySelector("p").textContent = `Preparing ${file.name} · ${index + 1} of ${media.length}`;
    progress.querySelector("span").style.width = `${(index / media.length) * 100}%`;
    try {
      await api("/api/admin/upload", { method: "POST", headers: { "X-File-Name": encodeURIComponent(file.name), "X-Defer-Rebuild": index < media.length - 1 ? "1" : "0", "Content-Type": file.type || "application/octet-stream" }, body: file });
    } catch (error) {
      progress.hidden = true;
      notify(error.message, true);
      return;
    }
  }
  progress.querySelector("span").style.width = "100%";
  progress.querySelector("p").textContent = `${media.length} ${media.length === 1 ? "item" : "items"} added`;
  fileInput.value = "";
  await loadGallery();
  notify("Gallery updated.");
  setTimeout(() => { progress.hidden = true; }, 1400);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const save = document.querySelector("#save-button");
  save.disabled = true;
  save.textContent = "Saving…";
  const changes = {
    title: document.querySelector("#edit-title-field").value,
    date: document.querySelector("#edit-date").value,
    location: document.querySelector("#edit-location").value,
    latitude: document.querySelector("#edit-latitude").value,
    longitude: document.querySelector("#edit-longitude").value,
    tags: document.querySelector("#edit-tags").value.split(",")
  };
  try {
    await api("/api/admin/update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceKey: document.querySelector("#edit-source-key").value, changes }) });
    dialog.close();
    await loadGallery();
    notify("Frame details updated.");
  } catch (error) { notify(error.message, true); }
  finally { save.disabled = false; save.textContent = "Save changes"; }
});

fileInput.addEventListener("change", () => upload(fileInput.files));
for (const eventName of ["dragenter", "dragover"]) dropZone.addEventListener(eventName, (event) => { event.preventDefault(); dropZone.classList.add("dragging"); });
for (const eventName of ["dragleave", "drop"]) dropZone.addEventListener(eventName, (event) => { event.preventDefault(); dropZone.classList.remove("dragging"); });
dropZone.addEventListener("drop", (event) => upload(event.dataTransfer.files));
search.addEventListener("input", renderPhotos);
setFilter.addEventListener("change", renderPhotos);
document.querySelector("#media-kind").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-media]");
  if (!button) return;
  selectedMedia = button.dataset.media;
  search.value = "";
  setFilter.value = "all";
  document.querySelectorAll("#media-kind button").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
  selectedKeys.clear();
  renderPhotos();
});
selectVisibleButton.addEventListener("click", () => {
  const visible = filteredPhotos();
  const allSelected = visible.length > 0 && visible.every((photo) => selectedKeys.has(photo.sourceKey));
  visible.forEach((photo) => allSelected ? selectedKeys.delete(photo.sourceKey) : selectedKeys.add(photo.sourceKey));
  updateSelection();
});
clearSelectionButton.addEventListener("click", () => { selectedKeys.clear(); updateSelection(); });
bulkHideButton.addEventListener("click", hideSelected);
removedToggle.addEventListener("click", () => {
  const expanded = removedToggle.getAttribute("aria-expanded") === "true";
  removedToggle.setAttribute("aria-expanded", String(!expanded));
  removedGrid.hidden = expanded;
});

loadGallery().catch((error) => { count.textContent = "Could not load gallery"; notify(`${error.message}. Restart the local server to enable admin.`, true); });
