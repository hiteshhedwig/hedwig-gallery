import { geoDistance, geoGraticule10, geoOrthographic, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import world from "world-atlas/countries-110m.json";
import officialIndia from "./india-official-outline.json";

// Survey of India publishes RFC 7946 ring winding; d3's spherical renderer
// uses the inverse winding convention for polygons smaller than a hemisphere.
for (const polygon of officialIndia.features[0].geometry.coordinates) {
  for (const ring of polygon) ring.reverse();
}

const canvas = document.querySelector("#globe-canvas");
const context = canvas.getContext("2d");
const projection = geoOrthographic().clipAngle(90).precision(.25);
const path = geoPath(projection, context);
const countries = feature(world, world.objects.countries);
const countriesWithoutIndia = {
  type: "FeatureCollection",
  features: countries.features.filter((country) => String(country.id) !== "356")
};
const graticule = geoGraticule10();
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const MIN_ZOOM = .72;
const MAX_ZOOM = 1.075;

let groups = [];
let width = 0;
let height = 0;
let rotation = [-30, -15, 0];
let zoom = 1;
let dragging = false;
let dragStart = null;
let dragRotation = null;
let lastInteraction = performance.now();
let lastFrame = performance.now();
let projectedPins = [];
const postcards = new Map();
let hoveredPin = null;

function locationGroups(photos) {
  const found = new Map();
  for (const photo of photos) {
    if (!photo.location || photo.latitude === null || photo.longitude === null) continue;
    if (!found.has(photo.location)) found.set(photo.location, { name: photo.location, latitude: photo.latitude, longitude: photo.longitude, count: 0, photos: [] });
    const group = found.get(photo.location);
    group.count += 1;
    group.photos.push(photo);
  }
  return [...found.values()];
}

function configureCanvas() {
  const bounds = canvas.getBoundingClientRect();
  const pixelRatio = Math.min(devicePixelRatio || 1, 2);
  width = Math.max(1, bounds.width);
  height = Math.max(1, bounds.height);
  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  projection.translate([width / 2, height / 2]).scale(Math.min(width, height) * .455 * zoom).rotate(rotation);
}

function render(time = performance.now()) {
  if (!width || !height) return;
  projection.rotate(rotation).scale(Math.min(width, height) * .455 * zoom);
  canvas.dataset.rotation = rotation.map((value) => value.toFixed(2)).join(",");
  canvas.dataset.zoom = zoom.toFixed(2);
  context.clearRect(0, 0, width, height);

  context.beginPath();
  path({ type: "Sphere" });
  context.fillStyle = "#dedcd4";
  context.fill();

  context.beginPath();
  path(graticule);
  context.strokeStyle = "rgba(17, 17, 15, .18)";
  context.lineWidth = .75;
  context.stroke();

  context.beginPath();
  path(countriesWithoutIndia);
  context.fillStyle = "#696a64";
  context.fill();
  context.strokeStyle = "#dedcd4";
  context.lineWidth = .55;
  context.stroke();

  context.beginPath();
  path(officialIndia);
  context.fillStyle = "#151513";
  context.fill();
  context.strokeStyle = "#f0eee7";
  context.lineWidth = .9;
  context.stroke();

  context.beginPath();
  path({ type: "Sphere" });
  context.strokeStyle = "#11110f";
  context.lineWidth = 1.5;
  context.stroke();

  projectedPins = [];
  const center = projection.invert([width / 2, height / 2]);
  for (const group of groups) {
    const coordinates = [group.longitude, group.latitude];
    if (geoDistance(center, coordinates) > Math.PI / 2) continue;
    const point = projection(coordinates);
    if (!point) continue;
    const [x, y] = point;
    projectedPins.push({ ...group, x, y });
    const pulse = 10 + ((time / 28) % 24);
    context.beginPath();
    context.arc(x, y, pulse, 0, Math.PI * 2);
    context.strokeStyle = `rgba(223, 74, 52, ${Math.max(0, .7 - (pulse - 10) / 28)})`;
    context.lineWidth = 1.5;
    context.stroke();
    context.beginPath();
    context.arc(x, y, 6.5, 0, Math.PI * 2);
    context.fillStyle = "#df4a34";
    context.fill();
    context.strokeStyle = "#f2efe7";
    context.lineWidth = 2.5;
    context.stroke();
  }
  canvas.dataset.pinPositions = projectedPins.map((pin) => `${pin.name}:${pin.x.toFixed(1)},${pin.y.toFixed(1)}`).join("|");
  updatePostcards();
}

function updatePostcards() {
  for (const [name, postcard] of postcards) {
    const pin = projectedPins.find((item) => item.name === name);
    if (!pin || (hoveredPin !== name && !postcard.matches(":hover"))) {
      postcard.hidden = true;
      continue;
    }
    postcard.hidden = false;
    postcard.style.left = `${canvas.offsetLeft + pin.x}px`;
    postcard.style.top = `${canvas.offsetTop + pin.y}px`;
    postcard.classList.toggle("pin-postcard-left", pin.x > width * .82);
  }
}

function animate(time) {
  const elapsed = Math.min(50, time - lastFrame);
  lastFrame = time;
  if (!dragging && !reduceMotion && time - lastInteraction > 1800) rotation[0] = (rotation[0] + elapsed * .0045) % 360;
  render(time);
  requestAnimationFrame(animate);
}

function pointerPosition(event) {
  const bounds = canvas.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

canvas.addEventListener("pointerdown", (event) => {
  dragging = true;
  dragStart = pointerPosition(event);
  dragRotation = [...rotation];
  lastInteraction = performance.now();
  canvas.setPointerCapture(event.pointerId);
  canvas.classList.add("dragging");
});

canvas.addEventListener("pointermove", (event) => {
  const current = pointerPosition(event);
  if (!dragging) {
    const pin = projectedPins.find((item) => Math.hypot(item.x - current.x, item.y - current.y) < 16);
    hoveredPin = pin?.name || null;
    canvas.classList.toggle("pin-hovered", Boolean(pin));
    updatePostcards();
    return;
  }
  rotation[0] = dragRotation[0] + (current.x - dragStart.x) * .32;
  rotation[1] = Math.max(-75, Math.min(75, dragRotation[1] - (current.y - dragStart.y) * .25));
  lastInteraction = performance.now();
});

canvas.addEventListener("pointerup", (event) => {
  const end = pointerPosition(event);
  const moved = dragStart ? Math.hypot(end.x - dragStart.x, end.y - dragStart.y) : Infinity;
  dragging = false;
  canvas.classList.remove("dragging");
  lastInteraction = performance.now();
  if (moved < 7) {
    const pin = projectedPins.find((item) => Math.hypot(item.x - end.x, item.y - end.y) < 22);
    if (pin) location.href = `/?location=${encodeURIComponent(pin.name)}#frames`;
  }
});

canvas.addEventListener("pointercancel", () => {
  dragging = false;
  canvas.classList.remove("dragging");
});

document.querySelector(".globe-wrap").addEventListener("pointerleave", () => {
  hoveredPin = null;
  canvas.classList.remove("pin-hovered");
  updatePostcards();
});

canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * Math.exp(-event.deltaY * .001)));
  lastInteraction = performance.now();
}, { passive: false });

canvas.addEventListener("keydown", (event) => {
  const movement = 8;
  if (event.key === "ArrowLeft") rotation[0] -= movement;
  else if (event.key === "ArrowRight") rotation[0] += movement;
  else if (event.key === "ArrowUp") rotation[1] = Math.min(75, rotation[1] + movement);
  else if (event.key === "ArrowDown") rotation[1] = Math.max(-75, rotation[1] - movement);
  else if (event.key === "+" || event.key === "=") zoom = Math.min(MAX_ZOOM, zoom + .04);
  else if (event.key === "-") zoom = Math.max(MIN_ZOOM, zoom - .08);
  else return;
  event.preventDefault();
  lastInteraction = performance.now();
});

canvas.addEventListener("dblclick", () => {
  rotation = [-30, -15, 0];
  zoom = 1;
  lastInteraction = performance.now();
});

function renderLocations() {
  document.querySelector("#place-count").textContent = `${String(groups.length).padStart(2, "0")} ${groups.length === 1 ? "place" : "places"}`;
  document.querySelector("#location-list").innerHTML = groups.map((group, index) => `<a href="/?location=${encodeURIComponent(group.name)}#frames"><span>${String(index + 1).padStart(2, "0")}</span><strong>${group.name}</strong><small>${group.count} frames →</small></a>`).join("");
  for (const group of groups) {
    const photo = group.photos[Math.min(group.photos.length - 1, Math.floor(group.photos.length * .62))];
    const postcard = document.createElement("a");
    postcard.className = "pin-postcard";
    postcard.href = `/?location=${encodeURIComponent(group.name)}#frames`;
    postcard.setAttribute("aria-label", `View ${group.count} photographs from ${group.name}`);
    postcard.innerHTML = `<img src="${photo.images[640]}" alt=""><span><strong>${group.name}</strong><small>${group.count} frames</small></span>`;
    document.querySelector(".globe-wrap").append(postcard);
    postcard.addEventListener("pointerleave", () => {
      hoveredPin = null;
      updatePostcards();
    });
    postcards.set(group.name, postcard);
  }
  canvas.setAttribute("aria-label", `Interactive globe with ${groups.length} photographed ${groups.length === 1 ? "place" : "places"}: ${groups.map((group) => group.name).join(", ")}. Drag or use arrow keys to rotate.`);
}

new ResizeObserver(() => { configureCanvas(); render(); }).observe(canvas);

fetch("/gallery.json")
  .then((response) => {
    if (!response.ok) throw new Error(`Map request failed (${response.status})`);
    return response.json();
  })
  .then(({ photos }) => {
    groups = locationGroups(photos);
    renderLocations();
  })
  .catch((error) => {
    document.querySelector("#place-count").textContent = "Map unavailable";
    console.error(error);
  });

requestAnimationFrame(animate);
