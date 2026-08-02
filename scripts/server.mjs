import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, stat, unlink } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, extname, join, normalize } from "node:path";
import { execFile } from "node:child_process";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { loadSettings, saveSettings, uploadDir } from "./gallery-config.mjs";

const root = new URL("../", import.meta.url).pathname;
const port = Number(process.env.PORT || 4173);
const manifest = join(root, "public", "gallery.json");
const videoManifest = join(root, "public", "videos.json");
const videoUploadDir = join(root, "content", "video-uploads");
const generator = join(root, "scripts", "generate-gallery.mjs");
const videoGenerator = join(root, "scripts", "generate-videos.mjs");
const mime = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".png": "image/png", ".webp": "image/webp", ".mp4": "video/mp4", ".webm": "video/webm", ".svg": "image/svg+xml", ".ico": "image/x-icon"
};
const allowedImageUploads = new Set([".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"]);
const allowedVideoUploads = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv"]);

function runNode(script) {
  return new Promise((resolve, reject) => execFile(process.execPath, [script], { cwd: root }, (error, stdout, stderr) => {
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
    error ? reject(error) : resolve();
  }));
}

async function ensureGallery() {
  console.log("Checking the photo collection…");
  await runNode(generator);
  await runNode(videoGenerator);
  await runNode(join(root, "scripts", "build-client.mjs"));
}

let rebuildQueue = Promise.resolve();
function rebuildGallery() {
  const next = rebuildQueue.catch(() => {}).then(async () => {
    await runNode(generator);
    await runNode(videoGenerator);
  });
  rebuildQueue = next;
  return next;
}

function json(response, status, body) {
  const content = Buffer.from(JSON.stringify(body));
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": content.length, "Cache-Control": "no-store" });
  response.end(content);
}

async function requestBody(request, limit = 80 * 1024 * 1024) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > limit) throw new Error("File is larger than 80 MB");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function requestJson(request) {
  const body = await requestBody(request, 1024 * 1024);
  return JSON.parse(body.toString("utf8") || "{}");
}

async function receiveFile(request, path, limit) {
  let length = 0;
  const limiter = new Transform({
    transform(chunk, encoding, callback) {
      length += chunk.length;
      callback(length > limit ? new Error(`File is larger than ${Math.round(limit / 1024 / 1024)} MB`) : null, chunk);
    }
  });
  try {
    await pipeline(request, limiter, createWriteStream(path, { flags: "wx" }));
  } catch (error) {
    await unlink(path).catch(() => {});
    throw error;
  }
}

async function galleryData() {
  return JSON.parse(await readFile(manifest, "utf8"));
}

async function videoData() {
  return JSON.parse(await readFile(videoManifest, "utf8"));
}

async function visibleMedia() {
  const [gallery, motion] = await Promise.all([galleryData(), videoData()]);
  return [...gallery.photos, ...motion.videos.filter((video) => !video.hidden)];
}

async function handleAdminApi(request, response, pathname) {
  if (request.method === "GET" && pathname === "/api/admin/gallery") {
    const [media, settings] = await Promise.all([visibleMedia(), loadSettings()]);
    json(response, 200, { photos: media, hiddenPhotos: settings.hiddenPhotos });
    return true;
  }

  if (request.method === "POST" && pathname === "/api/admin/upload") {
    const supplied = decodeURIComponent(String(request.headers["x-file-name"] || "photo"));
    const extension = extname(supplied).toLowerCase();
    const isVideo = allowedVideoUploads.has(extension);
    if (!isVideo && !allowedImageUploads.has(extension)) { json(response, 415, { error: "Unsupported image or video format" }); return true; }
    const stem = basename(supplied, extension).replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "photo";
    const targetDir = isVideo ? videoUploadDir : uploadDir;
    await mkdir(targetDir, { recursive: true });
    let filename = `${stem}${extension}`;
    try {
      await stat(join(targetDir, filename));
      filename = `${stem}-${Date.now()}${extension}`;
    } catch {}
    await receiveFile(request, join(targetDir, filename), isVideo ? 2 * 1024 * 1024 * 1024 : 80 * 1024 * 1024);
    if (request.headers["x-defer-rebuild"] !== "1") await rebuildGallery();
    json(response, 201, { ok: true, filename });
    return true;
  }

  if (request.method === "POST" && pathname === "/api/admin/hide") {
    const { sourceKey } = await requestJson(request);
    const [media, settings] = await Promise.all([visibleMedia(), loadSettings()]);
    const item = media.find((candidate) => candidate.sourceKey === sourceKey);
    if (!item) { json(response, 404, { error: "Gallery item not found" }); return true; }
    if (!settings.hiddenPhotos.some((candidate) => candidate.sourceKey === sourceKey)) settings.hiddenPhotos.push(item);
    await saveSettings(settings);
    await rebuildGallery();
    json(response, 200, { ok: true });
    return true;
  }

  if (request.method === "POST" && pathname === "/api/admin/hide-many") {
    const { sourceKeys = [] } = await requestJson(request);
    if (!Array.isArray(sourceKeys) || !sourceKeys.length || sourceKeys.length > 500) {
      json(response, 400, { error: "Choose between 1 and 500 gallery items" });
      return true;
    }
    const [media, settings] = await Promise.all([visibleMedia(), loadSettings()]);
    const requestedKeys = new Set(sourceKeys.map(String));
    const selected = media.filter((item) => requestedKeys.has(item.sourceKey));
    if (!selected.length) { json(response, 404, { error: "No selected gallery items were found" }); return true; }
    const alreadyHidden = new Set(settings.hiddenPhotos.map((item) => item.sourceKey));
    settings.hiddenPhotos.push(...selected.filter((item) => !alreadyHidden.has(item.sourceKey)));
    await saveSettings(settings);
    await rebuildGallery();
    json(response, 200, { ok: true, hidden: selected.length });
    return true;
  }

  if (request.method === "POST" && pathname === "/api/admin/restore") {
    const { sourceKey } = await requestJson(request);
    const settings = await loadSettings();
    settings.hiddenPhotos = settings.hiddenPhotos.filter((photo) => photo.sourceKey !== sourceKey);
    await saveSettings(settings);
    await rebuildGallery();
    json(response, 200, { ok: true });
    return true;
  }

  if (request.method === "POST" && pathname === "/api/admin/delete-upload") {
    const { sourceKey } = await requestJson(request);
    const [media, settings] = await Promise.all([visibleMedia(), loadSettings()]);
    const photo = media.find((item) => item.sourceKey === sourceKey)
      || settings.hiddenPhotos.find((item) => item.sourceKey === sourceKey);
    if (!photo) { json(response, 404, { error: "Gallery item not found" }); return true; }
    const adminImage = photo.collection === "uploads" && sourceKey.startsWith("uploads:");
    const adminVideo = photo.collection === "motion-uploads" && sourceKey.startsWith("motion:upload-");
    if (!adminImage && !adminVideo) {
      json(response, 403, { error: "Original source media can only be hidden, not deleted" });
      return true;
    }
    const filename = basename(photo.source);
    await unlink(join(adminVideo ? videoUploadDir : uploadDir, filename)).catch((error) => { if (error.code !== "ENOENT") throw error; });
    settings.hiddenPhotos = settings.hiddenPhotos.filter((item) => item.sourceKey !== sourceKey);
    delete settings.overrides[sourceKey];
    await saveSettings(settings);
    await rebuildGallery();
    json(response, 200, { ok: true });
    return true;
  }

  if (request.method === "POST" && pathname === "/api/admin/update") {
    const { sourceKey, changes = {} } = await requestJson(request);
    const media = await visibleMedia();
    if (!media.some((item) => item.sourceKey === sourceKey)) { json(response, 404, { error: "Gallery item not found" }); return true; }
    const settings = await loadSettings();
    const clean = {};
    for (const key of ["title", "date", "location"]) {
      if (typeof changes[key] === "string") clean[key] = changes[key].trim() || null;
    }
    for (const key of ["latitude", "longitude"]) {
      if (changes[key] === null || changes[key] === "") clean[key] = null;
      else if (Number.isFinite(Number(changes[key]))) clean[key] = Number(changes[key]);
    }
    if (Array.isArray(changes.tags)) clean.tags = changes.tags.map(String).map((tag) => tag.trim()).filter(Boolean);
    settings.overrides[sourceKey] = { ...(settings.overrides[sourceKey] || {}), ...clean };
    await saveSettings(settings);
    await rebuildGallery();
    json(response, 200, { ok: true });
    return true;
  }
  return false;
}

await ensureGallery();

createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
  try {
    if (pathname.startsWith("/api/admin/")) {
      if (!await handleAdminApi(request, response, pathname)) json(response, 404, { error: "Not found" });
      return;
    }
    const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const publicAsset = requested.startsWith("photos/") || requested.startsWith("videos/") || requested.startsWith("favicon") || requested === "apple-touch-icon.png" || requested === "gallery.json" || requested === "videos.json" || requested === "map.bundle.js";
    const path = normalize(join(root, publicAsset ? `public/${requested}` : requested));
    if (!path.startsWith(root)) { response.writeHead(403).end("Forbidden"); return; }
    const fileStat = await stat(path);
    if (!fileStat.isFile()) throw new Error("Not a file");
    const extension = extname(path);
    const immutable = extension === ".webp" || extension === ".mp4" || extension === ".webm";
    const cacheControl = immutable ? "public, max-age=31536000, immutable" : "no-cache";
    const range = request.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
    if (range && (extension === ".mp4" || extension === ".webm")) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), fileStat.size - 1) : fileStat.size - 1;
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= fileStat.size) {
        response.writeHead(416, { "Content-Range": `bytes */${fileStat.size}` }).end();
        return;
      }
      response.writeHead(206, { "Content-Type": mime[extension], "Content-Length": end - start + 1, "Content-Range": `bytes ${start}-${end}/${fileStat.size}`, "Accept-Ranges": "bytes", "Cache-Control": cacheControl });
      createReadStream(path, { start, end }).pipe(response);
      return;
    }
    response.writeHead(200, { "Content-Type": mime[extension] || "application/octet-stream", "Content-Length": fileStat.size, "Cache-Control": cacheControl, ...(extension === ".mp4" || extension === ".webm" ? { "Accept-Ranges": "bytes" } : {}) });
    createReadStream(path).pipe(response);
  } catch (error) {
    if (pathname.startsWith("/api/admin/")) json(response, 500, { error: error.message || "Admin request failed" });
    else response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
  }
}).listen(port, "127.0.0.1", () => console.log(`Hedwig's Gallery is open at http://127.0.0.1:${port}`));
