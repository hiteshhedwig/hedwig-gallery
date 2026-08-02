import { execFile, spawn } from "node:child_process";
import { access, mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, "..");
const photoblogRoot = "/home/hedwig/heetez/cool_stuff/photoblog/hedwigphoto-blog";
const originalFujiDir = "/home/hedwig/Downloads/100_FUJI";
const videoUploadDir = join(projectRoot, "content", "video-uploads");
const sourceDirs = [
  { directory: join(photoblogRoot, "content", "about", "images"), collection: "motion" },
  { directory: join(photoblogRoot, "public", "gallery", "images"), collection: "motion" },
  { directory: "/home/hedwig/Downloads/100_FUJI_4K_playback", collection: "motion-fuji", cameraHint: "FUJIFILM X-S20" },
  { directory: videoUploadDir, collection: "motion-uploads" }
];
const outputDir = join(projectRoot, "public", "videos");
const manifestPath = join(projectRoot, "public", "videos.json");
const videoExtensions = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv"]);
const posterSizes = [640, 1280, 2200];
const pipelineVersion = 1;

const exists = async (path) => access(path).then(() => true, () => false);
const slug = (value) => value.toLowerCase().replace(/_web$/i, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function captureDate(raw) {
  if (!raw) return null;
  if (!/Z$/i.test(raw)) return raw;
  return new Date(new Date(raw).getTime() + 330 * 60 * 1000).toISOString().slice(0, 19);
}

async function originalFileDate(file) {
  if (!file) return null;
  const fileStat = await stat(file);
  return new Date(fileStat.mtimeMs + 330 * 60 * 1000).toISOString().slice(0, 19);
}

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let diagnostic = "";
    child.stderr.on("data", (chunk) => { diagnostic = `${diagnostic}${chunk}`.slice(-8000); });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolvePromise() : reject(new Error(`${command} exited with ${code}\n${diagnostic}`)));
  });
}

async function sidecarFor(file) {
  return readFile(`${file}.meta`, "utf8").then((content) => {
    const parsed = JSON.parse(content);
    return {
      title: typeof parsed.Title === "string" ? parsed.Title.trim() : null,
      tags: Array.isArray(parsed.Tags) ? parsed.Tags.map(String).map((tag) => tag.trim()).filter(Boolean) : [],
      rating: Number.isFinite(Number(parsed.Rating)) ? Number(parsed.Rating) : null
    };
  }, () => ({ title: null, tags: [], rating: null }));
}

async function inspectVideo(file) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error", "-show_entries",
    "format=duration:format_tags=creation_time,com.android.model,com.android.manufacturer:stream=codec_type,width,height,r_frame_rate:stream_tags=rotate,creation_time",
    "-of", "json", file
  ], { maxBuffer: 1024 * 1024 });
  const data = JSON.parse(stdout);
  const stream = data.streams?.find((item) => item.codec_type === "video");
  if (!stream) throw new Error(`No video stream found in ${file}`);
  const rotation = Number(stream.tags?.rotate || 0);
  const rotated = Math.abs(rotation) % 180 === 90;
  const width = rotated ? Number(stream.height) : Number(stream.width);
  const height = rotated ? Number(stream.width) : Number(stream.height);
  const [rateTop, rateBottom = 1] = String(stream.r_frame_rate || "0/1").split("/").map(Number);
  const filenameDate = basename(file).match(/(?:PXL_|VID_)?(\d{4})(\d{2})(\d{2})[_-]?(\d{2})(\d{2})(\d{2})/);
  const derivedDate = filenameDate ? `${filenameDate[1]}-${filenameDate[2]}-${filenameDate[3]}T${filenameDate[4]}:${filenameDate[5]}:${filenameDate[6]}` : null;
  const tags = data.format?.tags || {};
  return {
    width,
    height,
    duration: Number(data.format?.duration || 0),
    fps: rateBottom ? rateTop / rateBottom : 0,
    date: captureDate(tags.creation_time || stream.tags?.creation_time) || derivedDate,
    camera: [tags["com.android.manufacturer"], tags["com.android.model"]].filter(Boolean).join(" ") || null
  };
}

async function averageColor(file) {
  const { stdout } = await execFileAsync("convert", [file, "-resize", "1x1!", "-format", "%[hex:p{0,0}]", "info:"], { maxBuffer: 1024 });
  return `#${stdout.trim().slice(0, 6).toLowerCase()}`;
}

function durationLabel(seconds) {
  const rounded = Math.max(0, Math.round(seconds));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

async function discoverVideos() {
  const unique = new Map();
  for (const source of sourceDirs) {
    const { directory } = source;
    if (!await exists(directory)) continue;
    const names = (await readdir(directory)).filter((name) => videoExtensions.has(extname(name).toLowerCase())).sort();
    for (const name of names) {
      const base = slug(basename(name, extname(name)));
      const canonical = source.collection === "motion-uploads" ? `upload-${base}` : base;
      if (!unique.has(canonical)) unique.set(canonical, { ...source, name, file: join(directory, name), canonical });
    }
  }
  if (await exists(originalFujiDir)) {
    const originals = (await readdir(originalFujiDir)).filter((name) => videoExtensions.has(extname(name).toLowerCase())).sort();
    const originalsByStem = new Map(originals.map((name) => [basename(name, extname(name)).toLowerCase(), { name, file: join(originalFujiDir, name) }]));
    const represented = new Set();
    for (const entry of unique.values()) {
      if (entry.collection !== "motion-fuji") continue;
      const stem = basename(entry.name, extname(entry.name)).toLowerCase().replace(/_4k_playback$/i, "");
      const original = originalsByStem.get(stem);
      if (original) {
        entry.metadataFile = original.file;
        entry.originalName = original.name;
        represented.add(stem);
      }
    }
    for (const [stem, original] of originalsByStem) {
      if (represented.has(stem)) continue;
      unique.set(`fuji-original-${stem}`, {
        directory: originalFujiDir,
        collection: "motion-fuji",
        cameraHint: "FUJIFILM X-S20",
        name: original.name,
        originalName: original.name,
        file: original.file,
        metadataFile: original.file,
        canonical: slug(stem)
      });
    }
  }
  return [...unique.values()];
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  await mkdir(videoUploadDir, { recursive: true });
  const entries = await discoverVideos();
  const [galleryData, settings] = await Promise.all([
    readFile(join(projectRoot, "public", "gallery.json"), "utf8").then(JSON.parse, () => ({ photos: [] })),
    readFile(join(projectRoot, "content", "gallery-settings.json"), "utf8").then(JSON.parse, () => ({ hiddenPhotos: [] }))
  ]);
  const fujiReferences = [...(galleryData.photos || []), ...(settings.hiddenPhotos || [])].filter((photo) => photo.collection === "fujifilm");
  const hiddenKeys = new Set((settings.hiddenPhotos || []).map((item) => item.sourceKey));
  const applySettings = (video) => {
    const override = settings.overrides?.[video.sourceKey] || {};
    return {
      ...video,
      hidden: hiddenKeys.has(video.sourceKey),
      title: override.title ?? video.title,
      date: override.date ?? video.date,
      location: override.location ?? video.location,
      latitude: override.latitude ?? video.latitude,
      longitude: override.longitude ?? video.longitude,
      tags: override.tags ?? video.tags
    };
  };
  const referenceFor = (entry) => {
    if (entry.collection !== "motion-fuji") return null;
    const number = Number(entry.name.match(/DSCF(\d+)/i)?.[1]);
    if (!Number.isFinite(number)) return null;
    return fujiReferences.map((photo) => ({ photo, distance: Math.abs(Number(photo.source.match(/DSCF(\d+)/i)?.[1]) - number) }))
      .filter(({ distance }) => Number.isFinite(distance) && distance <= 2)
      .sort((a, b) => a.distance - b.distance)[0]?.photo || null;
  };
  const previous = await readFile(manifestPath, "utf8").then(JSON.parse, () => ({ videos: [] }));
  const previousByKey = new Map((previous.videos || []).map((video) => [video.sourceKey, video]));
  const videos = [];

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const sourceKey = `motion:${entry.canonical}${extname(entry.name).toLowerCase()}`;
    const id = `motion-${entry.canonical}`;
    const sourceStat = await stat(entry.file);
    const images = Object.fromEntries(posterSizes.map((size) => [size, `/videos/${id}-poster-${size}.webp`]));
    const posterPaths = posterSizes.map((size) => join(outputDir, `${id}-poster-${size}.webp`));
    const previewPath = join(outputDir, `${id}-preview.mp4`);
    const fullPath = join(outputDir, `${id}-full.mp4`);
    const outputPaths = [...posterPaths, previewPath, fullPath];
    const cached = previousByKey.get(sourceKey);
    const cacheValid = previous.pipelineVersion === pipelineVersion
      && cached?.sourceModified === Math.trunc(sourceStat.mtimeMs)
      && await Promise.all(outputPaths.map(exists)).then((checks) => checks.every(Boolean));

    if (cacheValid) {
      const sidecar = await sidecarFor(entry.file);
      const reference = referenceFor(entry);
      const captureMetadata = entry.metadataFile ? await inspectVideo(entry.metadataFile) : null;
      cached.date = entry.collection === "motion-fuji" ? await originalFileDate(entry.metadataFile) : captureMetadata?.date || cached.date || sidecar.tags.find((tag) => /^\d{4}$/.test(tag)) || null;
      if (entry.originalName) cached.source = entry.originalName;
      cached.title ||= sidecar.title;
      cached.tags = sidecar.tags.length ? sidecar.tags : cached.tags;
      cached.collection = entry.collection;
      cached.camera ||= reference?.camera || entry.cameraHint || null;
      cached.lens ||= reference?.lens || null;
      cached.focalLength ||= reference?.focalLength || null;
      cached.latitude ??= reference?.latitude ?? null;
      cached.longitude ??= reference?.longitude ?? null;
      cached.location ||= reference?.location || null;
      videos.push(applySettings(cached));
      continue;
    }

    const metadata = await inspectVideo(entry.file);
    const captureMetadata = entry.metadataFile && entry.metadataFile !== entry.file ? await inspectVideo(entry.metadataFile) : metadata;
    const sidecar = await sidecarFor(entry.file);
    const reference = referenceFor(entry);
    const posterSource = join(outputDir, `${id}-poster-source.jpg`);
    const posterTime = Math.min(Math.max(metadata.duration * .16, .25), 3);
    await run("ffmpeg", ["-y", "-ss", String(posterTime), "-i", entry.file, "-map", "0:v:0", "-frames:v", "1", "-q:v", "2", posterSource]);
    for (let sizeIndex = 0; sizeIndex < posterSizes.length; sizeIndex += 1) {
      await run("convert", [posterSource, "-auto-orient", "-strip", "-filter", "Lanczos", "-resize", `${posterSizes[sizeIndex]}x${posterSizes[sizeIndex]}>`, "-quality", sizeIndex === 2 ? "84" : "80", "-define", "webp:method=4", posterPaths[sizeIndex]]);
    }
    await unlink(posterSource);

    const previewScale = "scale='if(gt(iw,ih),720,-2)':'if(gt(iw,ih),-2,720)',fps=24,format=yuv420p";
    await run("ffmpeg", ["-y", "-i", entry.file, "-map", "0:v:0", "-t", String(Math.min(6, metadata.duration)), "-an", "-vf", previewScale, "-c:v", "libx264", "-preset", "medium", "-crf", "28", "-movflags", "+faststart", previewPath]);
    const fullScale = "scale='if(gt(iw,ih),1920,-2)':'if(gt(iw,ih),-2,1920)',fps=30,format=yuv420p";
    await run("ffmpeg", ["-y", "-i", entry.file, "-map", "0:v:0", "-map", "0:a?", "-vf", fullScale, "-c:v", "libx264", "-preset", "medium", "-crf", "21", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", fullPath]);

    const color = await averageColor(posterPaths[0]);
    videos.push(applySettings({
      id,
      type: "video",
      source: entry.originalName || entry.name.replace(/_web(?=\.[^.]+$)/i, ""),
      sourceKey,
      collection: entry.collection,
      sourceModified: Math.trunc(sourceStat.mtimeMs),
      width: metadata.width,
      height: metadata.height,
      orientation: metadata.width > metadata.height ? "landscape" : metadata.width < metadata.height ? "portrait" : "square",
      date: entry.collection === "motion-fuji" ? await originalFileDate(entry.metadataFile) : captureMetadata.date || metadata.date || sidecar.tags.find((tag) => /^\d{4}$/.test(tag)) || null,
      camera: metadata.camera || reference?.camera || entry.cameraHint || null,
      lens: reference?.lens || null,
      focalLength: reference?.focalLength || null,
      aperture: null,
      shutterSpeed: null,
      iso: null,
      latitude: reference?.latitude ?? null,
      longitude: reference?.longitude ?? null,
      location: reference?.location || null,
      title: sidecar.title,
      tags: sidecar.tags,
      rating: sidecar.rating,
      color,
      dimensions: `${metadata.width} × ${metadata.height}`,
      duration: metadata.duration,
      durationLabel: durationLabel(metadata.duration),
      fps: Number(metadata.fps.toFixed(2)),
      images,
      videos: { preview: `/videos/${id}-preview.mp4`, full: `/videos/${id}-full.mp4` }
    }));
    console.log(`[${index + 1}/${entries.length}] Prepared motion clip ${entry.name}`);
  }

  const expected = new Set(videos.flatMap((video) => [
    ...posterSizes.map((size) => `${video.id}-poster-${size}.webp`), `${video.id}-preview.mp4`, `${video.id}-full.mp4`
  ]));
  const obsolete = (await readdir(outputDir)).filter((name) => !expected.has(name));
  await Promise.all(obsolete.map((name) => unlink(join(outputDir, name))));
  await writeFile(manifestPath, `${JSON.stringify({ pipelineVersion, generatedAt: new Date().toISOString(), count: videos.length, videos }, null, 2)}\n`);
  console.log(`Motion collection ready: ${videos.length} clips`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
