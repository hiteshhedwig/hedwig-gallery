const gallery = document.querySelector("#gallery");
const status = document.querySelector("#gallery-status");
const yearFilter = document.querySelector("#year-filter");
const locationFilter = document.querySelector("#location-filter");
const shuffleButton = document.querySelector("#shuffle-button");
const viewer = document.querySelector("#viewer");
const viewerImage = document.querySelector("#viewer-image");
const viewerVideo = document.createElement("video");
viewerVideo.id = "viewer-video";
viewerVideo.controls = true;
viewerVideo.playsInline = true;
viewerVideo.preload = "metadata";
viewerVideo.hidden = true;
viewerImage.after(viewerVideo);
const viewerLoading = document.querySelector("#viewer-loading");
const viewerStage = document.querySelector("#viewer-stage");
const floatCursor = document.querySelector("#float-cursor");
const featureStrip = document.querySelector("#feature-strip");
const ledgerMode = document.body.classList.contains("ledger-page");
const chromaticMode = document.body.classList.contains("chromatic-page");
const bookMode = document.body.classList.contains("book-page");
const wallMode = document.body.classList.contains("wall-page");
const rollsMode = document.body.classList.contains("rolls-page");
const timeMode = document.body.classList.contains("time-page");
const cameraFilter = document.querySelector("#camera-filter");
const collectionFilter = document.querySelector("#collection-filter");
const dynamicGridMode = ledgerMode || chromaticMode || wallMode || rollsMode || timeMode;
const colorRibbon = document.querySelector("#color-ribbon");
const wallMarkerCount = document.querySelector(".wall-marker small");
const gridScale = document.querySelector("#grid-scale");
const gridScaleValue = document.querySelector("#grid-scale-value");

let photos = [];
let visiblePhotos = [];
let activeIndex = 0;
let pointerStart = null;
let shuffledRanks = null;
let selectedTone = "all";
let timeScale = Number(gridScale?.value || 100) / 100;
let viewerZoom = 1;
let viewerPanX = 0;
let viewerPanY = 0;

const zoomControls = document.createElement("div");
zoomControls.className = "viewer-zoom-controls";
zoomControls.innerHTML = `<button id="zoom-out" type="button" aria-label="Zoom out" title="Zoom out (−)">−</button><button id="zoom-reset" type="button" aria-label="Reset zoom" title="Reset zoom (0)">100%</button><button id="zoom-in" type="button" aria-label="Zoom in" title="Zoom in (+)">+</button>`;
viewer.querySelector(".viewer-topbar > div").prepend(zoomControls);
const zoomOutButton = document.querySelector("#zoom-out");
const zoomResetButton = document.querySelector("#zoom-reset");
const zoomInButton = document.querySelector("#zoom-in");

function constrainViewerPan() {
  if (viewerZoom <= 1) { viewerPanX = 0; viewerPanY = 0; return; }
  const maximumX = viewerImage.clientWidth * (viewerZoom - 1) / 2;
  const maximumY = viewerImage.clientHeight * (viewerZoom - 1) / 2;
  viewerPanX = Math.max(-maximumX, Math.min(maximumX, viewerPanX));
  viewerPanY = Math.max(-maximumY, Math.min(maximumY, viewerPanY));
}

function applyViewerTransform() {
  constrainViewerPan();
  viewerImage.style.transform = `translate3d(${viewerPanX}px,${viewerPanY}px,0) scale(${viewerZoom})`;
  viewerStage.classList.toggle("viewer-zoomed", viewerZoom > 1.001);
  zoomResetButton.textContent = `${Math.round(viewerZoom * 100)}%`;
  zoomOutButton.disabled = viewerZoom <= 1.001;
  zoomInButton.disabled = viewerZoom >= 4;
}

function setViewerZoom(value, clientX, clientY) {
  const nextZoom = Math.max(1, Math.min(4, value));
  if (nextZoom === viewerZoom) return;
  const rect = viewerStage.getBoundingClientRect();
  const cursorX = Number.isFinite(clientX) ? clientX - rect.left - rect.width / 2 : 0;
  const cursorY = Number.isFinite(clientY) ? clientY - rect.top - rect.height / 2 : 0;
  const ratio = nextZoom / viewerZoom;
  viewerPanX = cursorX - ratio * (cursorX - viewerPanX);
  viewerPanY = cursorY - ratio * (cursorY - viewerPanY);
  viewerZoom = nextZoom;
  if (viewerZoom === 1) { viewerPanX = 0; viewerPanY = 0; }
  applyViewerTransform();
}

function resetViewerZoom() {
  viewerZoom = 1;
  viewerPanX = 0;
  viewerPanY = 0;
  applyViewerTransform();
}

function pictureMarkup(photo) {
  return `<img src="${photo.images[640]}"
    srcset="${photo.images[640]} 640w, ${photo.images[1280]} 1280w, ${photo.images[2200]} 2200w"
    sizes="(max-width: 560px) 50vw, (max-width: 900px) 33vw, 20vw"
    width="${photo.width}" height="${photo.height}" loading="lazy" decoding="async" alt="">`;
}

function populateFilters() {
  const years = [...new Set(photos.map((photo) => photo.date?.slice(0, 4)).filter(Boolean))].sort().reverse();
  const locations = [...new Set(photos.map((photo) => photo.location).filter(Boolean))].sort();
  yearFilter.insertAdjacentHTML("beforeend", years.map((year) => `<option value="${year}">${year}</option>`).join(""));
  locationFilter.insertAdjacentHTML("beforeend", locations.map((location) => `<option value="${location}">${location}</option>`).join(""));
  locationFilter.insertAdjacentHTML("beforeend", `<option value="unrecorded">Location not recorded</option>`);
  if (cameraFilter) {
    const cameras = [...new Set(photos.map((photo) => photo.camera).filter(Boolean))].sort();
    cameraFilter.insertAdjacentHTML("beforeend", cameras.map((camera) => `<option value="${camera}">${camera}</option>`).join(""));
    cameraFilter.insertAdjacentHTML("beforeend", `<option value="unrecorded">Camera not recorded</option>`);
  }
  if (collectionFilter) {
    const collections = [...new Set(photos.map((photo) => photo.collection))];
    collectionFilter.options[0].textContent = `All frames · ${photos.length}`;
    const labels = { fujifilm: "Fujifilm", "archive-1": "Added photographs", motion: "Motion", "motion-fuji": "Fuji motion" };
    collectionFilter.insertAdjacentHTML("beforeend", collections.map((collection) => {
      const count = photos.filter((photo) => photo.collection === collection).length;
      return `<option value="${collection}">${labels[collection] || collection} · ${count}</option>`;
    }).join(""));
  }
  const requestedLocation = new URLSearchParams(location.search).get("location");
  if (requestedLocation && [...locationFilter.options].some((option) => option.value === requestedLocation)) locationFilter.value = requestedLocation;
}

function createCard(photo, index) {
  const isVideo = photo.type === "video";
  const button = document.createElement("button");
  button.type = "button";
  button.className = `photo-card${isVideo ? " video-card" : ""}`;
  button.style.setProperty("--tilt", `${index % 2 ? ".28" : "-.28"}deg`);
  button.setAttribute("aria-label", `Open ${photo.source}, ${isVideo ? "video" : "photograph"} ${index + 1} of ${visiblePhotos.length}`);
  button.innerHTML = `${pictureMarkup(photo)}${isVideo ? `<video class="motion-preview" muted loop playsinline preload="none" poster="${photo.images[640]}" aria-hidden="true"></video><i class="motion-mark" aria-hidden="true">▶ <small>${photo.durationLabel}</small></i>` : ""}<span>${String(index + 1).padStart(3, "0")}</span>`;
  if (ledgerMode) {
    const sequence = ["wide", "pair", "pair", "third", "third", "third", "pair", "pair", "wide", "third", "third", "third"];
    const latitude = Number.isFinite(photo.latitude) ? `${Math.abs(photo.latitude).toFixed(2)}°${photo.latitude >= 0 ? "N" : "S"}` : "";
    const longitude = Number.isFinite(photo.longitude) ? `${Math.abs(photo.longitude).toFixed(2)}°${photo.longitude >= 0 ? "E" : "W"}` : "";
    const stamp = [photo.location, [latitude, longitude].filter(Boolean).join(" "), photo.date?.slice(0, 10)].filter(Boolean).join(" · ");
    button.classList.add(`ledger-${sequence[index % sequence.length]}`);
    button.insertAdjacentHTML("beforeend", `<small class="ledger-stamp">${stamp || "Unmarked frame"}</small>`);
  }
  if (chromaticMode) {
    button.style.setProperty("--photo-color", photo.color || "#777777");
    if (index % 17 === 8) button.classList.add("chromatic-wide");
  }
  if (bookMode) {
    const caption = [photo.date?.slice(0, 10), photo.location].filter(Boolean).join(" · ") || "Unmarked";
    button.insertAdjacentHTML("beforeend", `<small class="book-caption">${caption}</small>`);
  }
  if (wallMode) {
    const wallClass = index < 3 ? "wall-selected" : (index - 3) % 18 === 9 ? "wall-large" : [4, 13].includes((index - 3) % 18) ? "wall-wide" : "wall-standard";
    const caption = [photo.location, photo.date?.slice(0, 4)].filter(Boolean).join(" · ") || photo.source.replace(/\.[^.]+$/, "");
    button.classList.add(wallClass);
    button.insertAdjacentHTML("beforeend", `<small class="wall-caption">${caption}</small>`);
  }
  if (rollsMode) {
    const caption = [photo.location, photo.date?.slice(0, 10)].filter(Boolean).join(" · ") || photo.source.replace(/\.[^.]+$/, "");
    if (index % 16 === 10) button.classList.add("roll-feature");
    button.insertAdjacentHTML("beforeend", `<small class="roll-caption">${caption}</small>`);
  }
  if (timeMode) {
    const caption = [photo.date?.slice(0, 10), photo.location, photo.camera].filter(Boolean).join(" · ") || "Unrecorded frame";
    button.insertAdjacentHTML("beforeend", `<small class="time-caption">${caption}</small>`);
    button.style.viewTransitionName = `frame-${photo.id}`;
  }
  const image = button.querySelector("img");
  if (bookMode) image.sizes = "(max-width: 560px) 50vw, 32vw";
  if (wallMode) image.sizes = button.classList.contains("wall-large") ? "(max-width: 560px) 100vw, 50vw" : button.classList.contains("wall-standard") ? "(max-width: 560px) 50vw, 17vw" : "(max-width: 560px) 100vw, 34vw";
  if (rollsMode) image.sizes = button.classList.contains("roll-feature") ? "(max-width: 560px) 100vw, 38vw" : "(max-width: 560px) 50vw, 32vw";
  if (image.complete) image.classList.add("loaded");
  else image.addEventListener("load", () => {
    image.classList.add("loaded");
    layoutGalleryGrid();
  }, { once: true });
  button.addEventListener("click", () => openViewer(index));
  const preview = button.querySelector(".motion-preview");
  const previewAllowed = !matchMedia("(prefers-reduced-motion: reduce)").matches && !navigator.connection?.saveData;
  button.addEventListener("pointerenter", () => {
    if (chromaticMode) floatCursor.style.background = photo.color || "#111";
    floatCursor.classList.add("active");
    if (preview && previewAllowed) {
      if (!preview.src) preview.src = photo.videos.preview;
      preview.play().then(() => button.classList.add("previewing"), () => {});
    }
  });
  button.addEventListener("pointerleave", () => {
    floatCursor.classList.remove("active");
    if (preview) {
      preview.pause();
      if (preview.currentSrc) preview.currentTime = 0;
      button.classList.remove("previewing");
    }
  });
  return button;
}

function renderFeatureStrip() {
  if (!featureStrip) return;
  const landscape = photos.filter((photo) => photo.orientation === "landscape");
  const portrait = photos.filter((photo) => photo.orientation === "portrait");
  const featured = timeMode
    ? [landscape[2], landscape[10], landscape[18], landscape[26]]
    : ledgerMode ? [landscape[10]] : [landscape[2], portrait[4], landscape[10]];
  featureStrip.replaceChildren(...featured.map((photo, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "feature-photo";
    button.setAttribute("aria-label", `Open selected photograph ${index + 1}, ${photo.source}`);
    button.innerHTML = `${pictureMarkup(photo)}<span>0${index + 1}</span>`;
    const image = button.querySelector("img");
    image.sizes = "(max-width: 560px) 68vw, 42vw";
    image.loading = index === 0 ? "eager" : "lazy";
    image.addEventListener("load", () => image.classList.add("loaded"), { once: true });
    if (image.complete) image.classList.add("loaded");
    button.addEventListener("click", () => {
      yearFilter.value = "all";
      locationFilter.value = "all";
      if (cameraFilter) cameraFilter.value = "all";
      if (collectionFilter) collectionFilter.value = "all";
      renderGallery();
      openViewer(visiblePhotos.findIndex((candidate) => candidate.id === photo.id));
    });
    button.addEventListener("pointerenter", () => floatCursor.classList.add("active"));
    button.addEventListener("pointerleave", () => floatCursor.classList.remove("active"));
    return button;
  }));
}

let galleryLayoutFrame = 0;
function layoutTimeRows() {
  gallery.querySelectorAll(".time-row").forEach((row) => {
    const cards = [...row.children];
    const gap = Number.parseFloat(getComputedStyle(row).gap) || 3;
    const width = row.clientWidth;
    const baseTarget = (window.innerWidth <= 560 ? 148 : window.innerWidth <= 900 ? 190 : 255) * timeScale;
    const target = row.classList.contains("time-row-highlight") ? baseTarget * 1.32 : baseTarget;
    const ratios = cards.map((card) => Number(card.dataset.ratio) || 1);
    const ratioTotal = ratios.reduce((sum, ratio) => sum + ratio, 0);
    const isLast = row.classList.contains("time-row-last");
    const naturalHeight = (width - gap * Math.max(0, cards.length - 1)) / ratioTotal;
    const height = isLast ? Math.min(target, naturalHeight) : naturalHeight;
    cards.forEach((card, index) => {
      card.style.width = `${height * ratios[index]}px`;
      card.style.height = `${height}px`;
    });
  });
}

function layoutGalleryGrid() {
  if (!dynamicGridMode) return;
  cancelAnimationFrame(galleryLayoutFrame);
  galleryLayoutFrame = requestAnimationFrame(() => {
    if (timeMode) {
      layoutTimeRows();
      return;
    }
    const computed = getComputedStyle(gallery);
    const row = Number.parseFloat(computed.gridAutoRows) || 4;
    const gap = Number.parseFloat(computed.rowGap) || 0;
    const cards = gallery.querySelectorAll(".photo-card");
    cards.forEach((card) => { card.style.gridRowEnd = "auto"; });
    cards.forEach((card) => {
      const height = card.getBoundingClientRect().height;
      card.style.gridRowEnd = `span ${Math.ceil((height + gap) / (row + gap))}`;
    });
  });
}

function composeTimeRows(items, cards, container) {
  const gap = 3;
  const available = Math.max(280, container.clientWidth || gallery.clientWidth - 62);
  const target = (window.innerWidth <= 560 ? 148 : window.innerWidth <= 900 ? 190 : 255) * timeScale;
  const rows = [];
  let row = [];
  let ratioTotal = 0;
  cards.forEach((card, index) => {
    const photo = items[index];
    const ratio = photo.width / photo.height || 1;
    card.dataset.ratio = ratio;
    row.push(card);
    ratioTotal += ratio;
    const highlight = rows.length % 7 === 3;
    const rowTarget = highlight ? target * 1.32 : target;
    if (ratioTotal * rowTarget + gap * (row.length - 1) >= available) {
      rows.push({ cards: row, highlight });
      row = [];
      ratioTotal = 0;
    }
  });
  if (row.length) rows.push({ cards: row, highlight: false });
  return rows.map((entry, index) => {
    const rowElement = document.createElement("div");
    rowElement.className = `time-row${entry.highlight ? " time-row-highlight" : ""}${index === rows.length - 1 ? " time-row-last" : ""}`;
    rowElement.append(...entry.cards);
    return rowElement;
  });
}

function composeTimeIndex(cards) {
  const grouped = new Map();
  visiblePhotos.forEach((photo, index) => {
    const key = shuffledRanks ? "Mixed" : photo.date?.slice(0, 4) || "Undated";
    if (!grouped.has(key)) grouped.set(key, { photos: [], cards: [] });
    grouped.get(key).photos.push(photo);
    grouped.get(key).cards.push(cards[index]);
  });
  const sections = [];
  grouped.forEach((group, year) => {
    const section = document.createElement("section");
    section.className = "time-year";
    section.setAttribute("aria-labelledby", `time-${year.toLowerCase()}`);
    const marker = document.createElement("div");
    marker.className = "time-year-marker";
    marker.innerHTML = `<h3 id="time-${year.toLowerCase()}">${year}</h3><span>${String(group.photos.length).padStart(2, "0")}</span>`;
    const rows = document.createElement("div");
    rows.className = "time-rows";
    section.append(marker, rows);
    sections.push(section);
    gallery.append(section);
    rows.append(...composeTimeRows(group.photos, group.cards, rows));
  });
  return sections;
}

function averageColor(items) {
  if (!items.length) return "#777777";
  const channels = items.reduce((sum, photo) => {
    const value = photo.color?.replace("#", "") || "777777";
    return sum.map((channel, index) => channel + Number.parseInt(value.slice(index * 2, index * 2 + 2), 16));
  }, [0, 0, 0]);
  return `#${channels.map((channel) => Math.round(channel / items.length).toString(16).padStart(2, "0")).join("")}`;
}

function renderColorRibbon() {
  if (!colorRibbon) return;
  const tones = ["all", "warm", "cool", "muted", "monochrome", "vivid"];
  colorRibbon.replaceChildren(...tones.map((tone) => {
    const matches = tone === "all" ? photos : photos.filter((photo) => photo.tone === tone);
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.tone = tone;
    button.style.setProperty("--tone-color", averageColor(matches));
    button.setAttribute("aria-pressed", String(tone === selectedTone));
    button.innerHTML = `<i></i><span>${tone}</span><small>${matches.length}</small>`;
    button.addEventListener("click", () => {
      selectedTone = tone;
      colorRibbon.querySelectorAll("button").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
      renderGallery();
    });
    return button;
  }));
}

function composeBook(cards) {
  const patterns = [4, 5, 3, 6];
  const spreads = [];
  let cursor = 0;
  let spreadIndex = 0;
  while (cursor < cards.length) {
    const highlight = spreadIndex % 5 === 2;
    const count = highlight ? 1 : patterns[spreadIndex % patterns.length];
    const article = document.createElement("article");
    article.className = `book-spread book-count-${Math.min(count, cards.length - cursor)}${highlight ? " book-highlight" : ""}`;
    article.setAttribute("aria-label", `Pages ${spreadIndex * 2 + 1}–${spreadIndex * 2 + 2}`);
    const label = document.createElement("p");
    label.className = "book-page-number";
    label.textContent = `${String(spreadIndex * 2 + 1).padStart(2, "0")} / ${String(spreadIndex * 2 + 2).padStart(2, "0")}`;
    const page = document.createElement("div");
    page.className = "book-photos";
    const pageCards = cards.slice(cursor, cursor + count);
    if (highlight) {
      pageCards[0]?.classList.add("book-full-bleed");
      const image = pageCards[0]?.querySelector("img");
      if (image) image.sizes = "(max-width: 560px) 100vw, 82vw";
      page.append(...pageCards);
    } else {
      const left = document.createElement("div");
      const right = document.createElement("div");
      left.className = "book-leaf book-leaf-left";
      right.className = "book-leaf book-leaf-right";
      const leafCards = [[], []];
      const leafWeight = [0, 0];
      pageCards.forEach((card) => {
        const image = card.querySelector("img");
        const weight = Number(image?.getAttribute("height")) / Number(image?.getAttribute("width")) || 1;
        const target = leafWeight[0] <= leafWeight[1] ? 0 : 1;
        leafCards[target].push(card);
        leafWeight[target] += weight;
      });
      left.append(...leafCards[0]);
      right.append(...leafCards[1]);
      page.append(left, right);
    }
    article.append(label, page);
    spreads.push(article);
    cursor += count;
    spreadIndex += 1;
  }
  return spreads;
}

function composeRolls(cards) {
  const lanes = Array.from({ length: 3 }, (_, index) => {
    const lane = document.createElement("div");
    lane.className = `roll-lane roll-lane-${index + 1}`;
    lane.setAttribute("aria-label", `Roll ${String.fromCharCode(65 + index)}`);
    return lane;
  });
  cards.forEach((card, index) => lanes[index % lanes.length].append(card));
  return lanes;
}

function renderGallery() {
  const year = yearFilter.value;
  const location = locationFilter.value;
  const camera = cameraFilter?.value || "all";
  const collection = collectionFilter?.value || "all";
  visiblePhotos = photos.filter((photo) => {
    const matchesYear = year === "all" || photo.date?.startsWith(year);
    const matchesLocation = location === "all" || (location === "unrecorded" ? !photo.location : photo.location === location);
    const matchesTone = selectedTone === "all" || photo.tone === selectedTone;
    const matchesCamera = camera === "all" || (camera === "unrecorded" ? !photo.camera : photo.camera === camera);
    const matchesCollection = collection === "all" || photo.collection === collection;
    return matchesYear && matchesLocation && matchesTone && matchesCamera && matchesCollection;
  });
  if (shuffledRanks) visiblePhotos.sort((a, b) => shuffledRanks.get(a.id) - shuffledRanks.get(b.id));
  else if (timeMode) visiblePhotos.sort((a, b) => (b.date || "").localeCompare(a.date || "") || a.source.localeCompare(b.source));
  else if (chromaticMode) visiblePhotos.sort((a, b) => (a.colorHue ?? 0) - (b.colorHue ?? 0) || (a.colorSaturation ?? 0) - (b.colorSaturation ?? 0));
  if (wallMarkerCount) wallMarkerCount.textContent = `${String(Math.min(3, visiblePhotos.length)).padStart(2, "0")} ${visiblePhotos.length === 1 ? "frame" : "frames"}`;
  const cards = visiblePhotos.map(createCard);
  if (ledgerMode) {
    const nodes = [];
    const seenYears = new Set();
    cards.forEach((card, index) => {
      const year = visiblePhotos[index].date?.slice(0, 4) || "Undated";
      if (!seenYears.has(year)) {
        seenYears.add(year);
        const chapter = document.createElement("h3");
        chapter.className = "ledger-chapter";
        chapter.textContent = year;
        nodes.push(chapter);
      }
      nodes.push(card);
    });
    gallery.replaceChildren(...nodes);
  } else if (bookMode) gallery.replaceChildren(...composeBook(cards));
  else if (rollsMode) gallery.replaceChildren(...composeRolls(cards));
  else if (timeMode) {
    gallery.replaceChildren();
    composeTimeIndex(cards);
    layoutTimeRows();
  }
  else gallery.replaceChildren(...cards);
  gallery.setAttribute("aria-busy", "false");
  const spreadCount = gallery.querySelectorAll(".book-spread").length;
  status.textContent = bookMode
    ? `${visiblePhotos.length} ${visiblePhotos.length === 1 ? "frame" : "frames"} · ${spreadCount} ${spreadCount === 1 ? "spread" : "spreads"}${shuffledRanks ? " · rebound" : ""}`
    : `${visiblePhotos.length} ${visiblePhotos.length === 1 ? "frame" : "frames"}${shuffledRanks ? chromaticMode ? " · recomposed" : rollsMode ? " · respooled" : timeMode ? " · years mixed" : " · shuffled" : chromaticMode ? " · colour sequence" : timeMode ? " · newest first" : ""}`;
  const observer = new IntersectionObserver((entries, activeObserver) => {
    for (const entry of entries) if (entry.isIntersecting) {
      entry.target.classList.add("visible");
      activeObserver.unobserve(entry.target);
    }
  }, { rootMargin: "120px", threshold: .02 });
  gallery.querySelectorAll(".photo-card").forEach((card) => observer.observe(card));
  layoutGalleryGrid();
}

function updateViewer(direction = 0) {
  const photo = visiblePhotos[activeIndex];
  if (!photo) return;
  const isVideo = photo.type === "video";
  resetViewerZoom();
  viewer.classList.toggle("viewer-video-active", isVideo);
  zoomControls.hidden = isVideo;
  if (chromaticMode) viewer.style.setProperty("--viewer-accent", photo.color || "#777777");
  viewerImage.classList.remove("loaded");
  viewerLoading.classList.remove("hidden");
  viewerVideo.pause();
  if (isVideo) {
    viewerImage.hidden = true;
    viewerVideo.hidden = false;
    viewerVideo.poster = photo.images[1280];
    viewerVideo.src = photo.videos.full;
    viewerVideo.load();
    viewerVideo.play().catch(() => {});
  } else {
    viewerVideo.hidden = true;
    viewerVideo.removeAttribute("src");
    viewerVideo.removeAttribute("poster");
    viewerVideo.load();
    viewerImage.hidden = false;
    viewerImage.alt = `Photograph ${activeIndex + 1} of ${visiblePhotos.length}, ${photo.source}`;
    viewerImage.width = photo.width;
    viewerImage.height = photo.height;
    viewerImage.src = photo.images[2200];
  }
  document.querySelector("#viewer-position").textContent = `${String(activeIndex + 1).padStart(3, "0")} / ${String(visiblePhotos.length).padStart(3, "0")}`;
  document.querySelector("#meta-frame").textContent = photo.source.replace(/\.[^.]+$/, "");
  document.querySelector("#meta-camera").textContent = photo.camera || "Not recorded";
  document.querySelector("#meta-lens").textContent = isVideo ? `Motion · ${photo.durationLabel}` : [photo.lens, photo.focalLength].filter(Boolean).join(" · ") || "Not recorded";
  document.querySelector("#meta-exposure").textContent = isVideo ? `${photo.dimensions} · ${Math.round(photo.fps)} fps` : [photo.aperture, photo.shutterSpeed, photo.iso].filter(Boolean).join(" · ") || "Not recorded";
  document.querySelector("#meta-location").textContent = photo.location || "Not recorded";
  history.replaceState(null, "", `#photo=${photo.id}`);
  const neighbor = visiblePhotos[(activeIndex + (direction || 1) + visiblePhotos.length) % visiblePhotos.length];
  if (neighbor) new Image().src = neighbor.images[neighbor.type === "video" ? 1280 : 2200];
}

function openViewer(index) {
  activeIndex = index;
  if (!viewer.open) viewer.showModal();
  document.body.classList.add("viewer-open");
  floatCursor.classList.remove("active");
  updateViewer();
}

function navigate(direction) {
  activeIndex = (activeIndex + direction + visiblePhotos.length) % visiblePhotos.length;
  updateViewer(direction);
}

document.addEventListener("pointermove", (event) => {
  floatCursor.style.left = `${event.clientX}px`;
  floatCursor.style.top = `${event.clientY}px`;
});
viewerImage.addEventListener("load", () => { viewerLoading.classList.add("hidden"); viewerImage.classList.add("loaded"); });
viewerVideo.addEventListener("canplay", () => viewerLoading.classList.add("hidden"));
viewerImage.draggable = false;
viewerImage.addEventListener("dragstart", (event) => event.preventDefault());
document.querySelector("#prev-button").addEventListener("click", () => navigate(-1));
document.querySelector("#next-button").addEventListener("click", () => navigate(1));
document.querySelector("#close-button").addEventListener("click", () => viewer.close());
document.querySelector("#fullscreen-button").addEventListener("click", () => document.fullscreenElement ? document.exitFullscreen() : viewer.requestFullscreen?.());
viewer.addEventListener("close", () => {
  document.body.classList.remove("viewer-open");
  viewerVideo.pause();
  resetViewerZoom();
  history.replaceState(null, "", `${location.pathname}${location.search}`);
});
zoomOutButton.addEventListener("click", () => setViewerZoom(viewerZoom / 1.35));
zoomInButton.addEventListener("click", () => setViewerZoom(viewerZoom * 1.35));
zoomResetButton.addEventListener("click", resetViewerZoom);
viewerStage.addEventListener("wheel", (event) => {
  if (!viewerVideo.hidden) return;
  event.preventDefault();
  const factor = Math.exp(-event.deltaY * .0015);
  setViewerZoom(viewerZoom * factor, event.clientX, event.clientY);
}, { passive: false });
viewerStage.addEventListener("dblclick", (event) => {
  if (event.target.closest("button") || !viewerVideo.hidden) return;
  setViewerZoom(viewerZoom > 1.15 ? 1 : 2.5, event.clientX, event.clientY);
});
document.addEventListener("keydown", (event) => {
  if (!viewer.open) return;
  if (viewerZoom > 1 && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
    event.preventDefault();
    if (event.key === "ArrowLeft") viewerPanX += 45;
    if (event.key === "ArrowRight") viewerPanX -= 45;
    if (event.key === "ArrowUp") viewerPanY += 45;
    if (event.key === "ArrowDown") viewerPanY -= 45;
    applyViewerTransform();
  } else if (event.key === "ArrowLeft") { event.preventDefault(); navigate(-1); }
  else if (event.key === "ArrowRight") { event.preventDefault(); navigate(1); }
  if (viewerVideo.hidden && (event.key === "+" || event.key === "=")) { event.preventDefault(); setViewerZoom(viewerZoom * 1.35); }
  if (viewerVideo.hidden && (event.key === "-" || event.key === "_")) { event.preventDefault(); setViewerZoom(viewerZoom / 1.35); }
  if (viewerVideo.hidden && event.key === "0") { event.preventDefault(); resetViewerZoom(); }
  if (event.key.toLowerCase() === "f") document.querySelector("#fullscreen-button").click();
});
viewerStage.addEventListener("pointerdown", (event) => {
  if (event.target.closest("button, video") || event.button !== 0) return;
  pointerStart = { x: event.clientX, y: event.clientY, panX: viewerPanX, panY: viewerPanY };
  if (viewerZoom > 1) {
    event.preventDefault();
    viewerStage.setPointerCapture(event.pointerId);
    viewerStage.classList.add("is-panning");
  }
});
viewerStage.addEventListener("pointermove", (event) => {
  if (!pointerStart || viewerZoom <= 1) return;
  event.preventDefault();
  viewerPanX = pointerStart.panX + event.clientX - pointerStart.x;
  viewerPanY = pointerStart.panY + event.clientY - pointerStart.y;
  applyViewerTransform();
});
viewerStage.addEventListener("pointerup", (event) => {
  if (!pointerStart) return;
  const x = event.clientX - pointerStart.x;
  const y = event.clientY - pointerStart.y;
  viewerStage.classList.remove("is-panning");
  if (viewerZoom <= 1 && Math.abs(x) > 55 && Math.abs(x) > Math.abs(y) * 1.3) navigate(x < 0 ? 1 : -1);
  pointerStart = null;
});
function stopViewerPan() {
  pointerStart = null;
  viewerStage.classList.remove("is-panning");
}
viewerStage.addEventListener("pointercancel", stopViewerPan);
viewerStage.addEventListener("lostpointercapture", stopViewerPan);
yearFilter.addEventListener("change", renderGallery);
locationFilter.addEventListener("change", renderGallery);
cameraFilter?.addEventListener("change", renderGallery);
collectionFilter?.addEventListener("change", renderGallery);
gridScale?.addEventListener("input", () => {
  const value = Number(gridScale.value);
  const progress = (value - Number(gridScale.min)) / (Number(gridScale.max) - Number(gridScale.min));
  gridScale.style.setProperty("--trace", `${progress * 100}%`);
  gridScaleValue.textContent = `${value}%`;
});
gridScale?.addEventListener("change", () => {
  timeScale = Number(gridScale.value) / 100;
  const recompose = () => renderGallery();
  if (document.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches) document.startViewTransition(recompose);
  else recompose();
});
window.addEventListener("resize", layoutGalleryGrid, { passive: true });
shuffleButton.addEventListener("click", () => {
  const shuffled = [...photos];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  shuffledRanks = new Map(shuffled.map((photo, index) => [photo.id, index]));
  if (timeMode) shuffleButton.lastChild.textContent = " Mix again";
  shuffleButton.classList.remove("just-shuffled");
  void shuffleButton.offsetWidth;
  shuffleButton.classList.add("just-shuffled");
  renderGallery();
});

async function init() {
  try {
    const [photoResponse, videoResponse] = await Promise.all([fetch("/hedwig-gallery/gallery.json"), fetch("/hedwig-gallery/videos.json")]);
    if (!photoResponse.ok) throw new Error(`Gallery request failed (${photoResponse.status})`);
    const galleryData = await photoResponse.json();
    const videoData = videoResponse.ok ? await videoResponse.json() : { videos: [] };
    photos = [...galleryData.photos, ...videoData.videos.filter((video) => !video.hidden)];
    populateFilters();
    renderColorRibbon();
    renderFeatureStrip();
    renderGallery();
    const requestedId = location.hash.match(/^#photo=(.+)$/)?.[1];
    const requestedIndex = visiblePhotos.findIndex((photo) => photo.id === requestedId);
    if (requestedIndex >= 0) openViewer(requestedIndex);
  } catch (error) {
    gallery.setAttribute("aria-busy", "false");
    status.textContent = "Could not load photographs.";
    console.error(error);
  }
}

init();
