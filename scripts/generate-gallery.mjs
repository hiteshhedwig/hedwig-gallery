import { execFile, spawn } from "node:child_process";
import { access, mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { basename, delimiter, extname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { loadSettings, uploadDir } from "./gallery-config.mjs";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, "..");
const defaultSourceDirs = [
  "/home/hedwig/Downloads/100_FUJI_PHOTOS",
  "/home/hedwig/heetez/cool_stuff/photoblog/hedwigphoto-blog/content/about/images",
  uploadDir
];
const configuredSources = process.env.PHOTO_SOURCES?.split(delimiter).filter(Boolean)
  || (process.env.PHOTO_SOURCE ? [process.env.PHOTO_SOURCE] : defaultSourceDirs);
const sourceDirs = configuredSources.map((directory) => resolve(directory));
const outputDir = join(projectRoot, "public", "photos");
const manifestPath = join(projectRoot, "public", "gallery.json");
const sizes = [640, 1280, 2200];
const pipelineVersion = 2;
const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"]);

const exists = async (path) => access(path).then(() => true, () => false);

function rational(value) {
  if (!value) return null;
  const match = String(value).trim().match(/^(-?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
  const number = match ? Number(match[1]) / Number(match[2]) : Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatAperture(raw) {
  const number = rational(raw);
  return number ? `f/${Number(number.toFixed(1))}` : null;
}

function formatFocalLength(raw) {
  const number = rational(raw);
  return number ? `${Number(number.toFixed(1))} mm` : null;
}

function formatExposure(raw) {
  const seconds = rational(raw);
  if (!seconds) return null;
  if (seconds >= 1) return `${Number(seconds.toFixed(1))} s`;
  return `1/${Math.round(1 / seconds)} s`;
}

function normalizeDate(raw) {
  const match = raw?.match(/^(\d{4}):(\d{2}):(\d{2}) (.+)$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}T${match[4]}` : null;
}

function gpsDecimal(raw, reference) {
  if (!raw) return null;
  const values = raw.split(",").map((part) => rational(part.trim()));
  if (values.length < 3 || values.some((value) => value === null)) return null;
  const decimal = values[0] + values[1] / 60 + values[2] / 3600;
  return /[SW]/i.test(reference) ? -decimal : decimal;
}

function locationName(latitude, longitude) {
  if (latitude === null || longitude === null) return null;
  if (Math.abs(latitude - 28.6139) < 1 && Math.abs(longitude - 77.209) < 1) return "New Delhi, India";
  return `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`;
}

function taggedLocation(tags = []) {
  const normalized = tags.map((tag) => String(tag).toLowerCase());
  if (normalized.includes("seoul")) return { location: "Seoul, South Korea", latitude: 37.5665, longitude: 126.978 };
  if (normalized.includes("jibhi")) return { location: "Jibhi, Himachal Pradesh, India", latitude: 31.59, longitude: 77.35 };
  if (normalized.includes("delhi")) return { location: "New Delhi, India", latitude: 28.6139, longitude: 77.209 };
  if (normalized.includes("himachal")) return { location: "Himachal Pradesh, India", latitude: 31.1048, longitude: 77.1734 };
  return { location: null, latitude: null, longitude: null };
}

async function inspectSidecar(file) {
  return readFile(`${file}.meta`, "utf8").then((content) => {
    const parsed = JSON.parse(content);
    return {
      title: typeof parsed.Title === "string" ? parsed.Title.trim() : null,
      tags: Array.isArray(parsed.Tags) ? parsed.Tags.map((tag) => String(tag).trim()).filter(Boolean) : [],
      rating: Number.isFinite(Number(parsed.Rating)) ? Number(parsed.Rating) : null
    };
  }, () => ({ title: null, tags: [], rating: null }));
}

function colorProfile(hexValue) {
  const hex = `#${hexValue.slice(0, 6).toLowerCase()}`;
  const [red, green, blue] = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const lightness = (maximum + minimum) / 2;
  const delta = maximum - minimum;
  let hue = 0;
  let saturation = 0;
  if (delta) {
    saturation = delta / (1 - Math.abs(2 * lightness - 1));
    if (maximum === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (maximum === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  if (hue < 0) hue += 360;
  let tone;
  if (saturation < .07) tone = "monochrome";
  else if (saturation < .18) tone = "muted";
  else if (saturation > .38) tone = "vivid";
  else if (hue >= 75 && hue <= 265) tone = "cool";
  else tone = "warm";
  return { color: hex, colorHue: Math.round(hue), colorSaturation: Number(saturation.toFixed(3)), colorLightness: Number(lightness.toFixed(3)), tone };
}

async function inspectColor(file) {
  const { stdout } = await execFileAsync("convert", [file, "-resize", "1x1!", "-format", "%[hex:p{0,0}]", "info:"], { maxBuffer: 1024 });
  return colorProfile(stdout.trim());
}

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolvePromise() : reject(new Error(`${command} exited with ${code}`)));
  });
}

async function mapLimit(items, limit, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

async function inspect(file) {
  const separator = "\u001f";
  const format = [
    "%w", "%h", "%[orientation]", "%[EXIF:DateTimeOriginal]", "%[EXIF:Make]",
    "%[EXIF:Model]", "%[EXIF:LensModel]", "%[EXIF:FocalLength]", "%[EXIF:FNumber]",
    "%[EXIF:ExposureTime]", "%[EXIF:PhotographicSensitivity]", "%[EXIF:GPSLatitude]",
    "%[EXIF:GPSLatitudeRef]", "%[EXIF:GPSLongitude]", "%[EXIF:GPSLongitudeRef]"
  ].join(separator);
  const { stdout } = await execFileAsync("identify", ["-quiet", "-format", format, file], { maxBuffer: 1024 * 1024 });
  const [rawWidth, rawHeight, orientation, date, make, camera, lens, focalLength, aperture, exposure, iso, rawLatitude, latitudeRef, rawLongitude, longitudeRef] = stdout.split(separator);
  const rotated = /^(Left|Right)/.test(orientation);
  const width = rotated ? Number(rawHeight) : Number(rawWidth);
  const height = rotated ? Number(rawWidth) : Number(rawHeight);
  const latitude = gpsDecimal(rawLatitude, latitudeRef);
  const longitude = gpsDecimal(rawLongitude, longitudeRef);
  return {
    width,
    height,
    date: normalizeDate(date),
    camera: [make, camera].filter(Boolean).join(" ").replace(/^FUJIFILM\s+FUJIFILM\s+/i, "FUJIFILM ").trim() || null,
    lens: lens?.trim() || null,
    focalLength: formatFocalLength(focalLength),
    aperture: formatAperture(aperture),
    shutterSpeed: formatExposure(exposure),
    iso: iso ? `ISO ${iso.trim()}` : null,
    latitude,
    longitude,
    location: locationName(latitude, longitude)
  };
}

async function main() {
  await mkdir(uploadDir, { recursive: true });
  const settings = await loadSettings();
  const hiddenKeys = new Set(settings.hiddenPhotos.map((photo) => photo.sourceKey));
  const sourceChecks = await Promise.all(sourceDirs.map(exists));
  const missingSources = sourceDirs.filter((_, index) => !sourceChecks[index]);
  if (missingSources.length) throw new Error(`Photo directory not found: ${missingSources.join(", ")}`);
  await mkdir(outputDir, { recursive: true });

  const collections = await Promise.all(sourceDirs.map(async (directory, index) => {
    const names = (await readdir(directory))
      .filter((name) => imageExtensions.has(extname(name).toLowerCase()))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const collection = directory === uploadDir ? "uploads" : index === 0 ? "fujifilm" : `archive-${index}`;
    console.log(`Discovered ${names.length} photographs in ${directory}`);
    return names.map((name) => ({ name, directory, collection, sourceKey: `${collection}:${name}` }));
  }));
  const entries = collections.flat().filter((entry) => !hiddenKeys.has(entry.sourceKey));
  if (!entries.length) throw new Error(`No supported images found in configured photo directories`);
  const baseIdCounts = new Map();
  entries.forEach(({ name }) => {
    const baseId = basename(name, extname(name)).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    baseIdCounts.set(baseId, (baseIdCounts.get(baseId) || 0) + 1);
  });

  const previous = await readFile(manifestPath, "utf8").then(JSON.parse, () => ({ photos: [] }));
  const previousBySource = new Map();
  previous.photos?.forEach((photo) => {
    previousBySource.set(photo.source, photo);
    if (photo.sourceKey) previousBySource.set(photo.sourceKey, photo);
  });
  const photos = [];

  await mapLimit(entries, 6, async ({ name, directory, collection, sourceKey }, index) => {
    const input = join(directory, name);
    const sourceStat = await stat(input);
    const baseId = basename(name, extname(name)).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const id = baseIdCounts.get(baseId) > 1 ? `${collection}-${baseId}` : baseId;
    const outputs = Object.fromEntries(sizes.map((size) => [size, `/photos/${id}-${size}.webp`]));
    const outputPaths = sizes.map((size) => join(outputDir, `${id}-${size}.webp`));
    const cached = previousBySource.get(sourceKey) || previousBySource.get(name);
    const cacheValid = previous.pipelineVersion === pipelineVersion
      && cached?.sourceModified === Math.trunc(sourceStat.mtimeMs)
      && await Promise.all(outputPaths.map(exists)).then((checks) => checks.every(Boolean));

    let metadata;
    if (cacheValid) {
      metadata = cached;
    } else {
      metadata = await inspect(input);
      for (let sizeIndex = 0; sizeIndex < sizes.length; sizeIndex += 1) {
        const size = sizes[sizeIndex];
        await run("convert", [
          input, "-auto-orient", "-strip", "-filter", "Lanczos",
          "-resize", `${size}x${size}>`, "-quality", size === 2200 ? "84" : "80",
          "-define", "webp:method=4", outputPaths[sizeIndex]
        ]);
      }
    }
    const palette = cached?.color ? colorProfile(cached.color.replace("#", "")) : await inspectColor(outputPaths[0]);
    const sidecar = await inspectSidecar(input);
    const sidecarPlace = taggedLocation(sidecar.tags);
    const exifLatitude = Number.isFinite(metadata.latitude) ? metadata.latitude : null;
    const exifLongitude = Number.isFinite(metadata.longitude) ? metadata.longitude : null;
    const exifLocation = locationName(exifLatitude, exifLongitude);

    const override = settings.overrides[sourceKey] || {};
    photos[index] = {
      id,
      source: name,
      sourceKey,
      collection,
      sourceModified: Math.trunc(sourceStat.mtimeMs),
      width: metadata.width,
      height: metadata.height,
      orientation: metadata.width > metadata.height ? "landscape" : metadata.width < metadata.height ? "portrait" : "square",
      date: override.date ?? metadata.date,
      camera: metadata.camera,
      lens: metadata.lens,
      focalLength: metadata.focalLength,
      aperture: metadata.aperture,
      shutterSpeed: metadata.shutterSpeed,
      iso: metadata.iso,
      latitude: override.latitude ?? exifLatitude ?? sidecarPlace.latitude,
      longitude: override.longitude ?? exifLongitude ?? sidecarPlace.longitude,
      location: override.location ?? (sidecarPlace.location || exifLocation),
      title: override.title ?? sidecar.title,
      tags: override.tags ?? sidecar.tags,
      rating: sidecar.rating,
      ...palette,
      dimensions: `${metadata.width} × ${metadata.height}`,
      images: outputs
    };
    if (!cacheValid) console.log(`[${index + 1}/${entries.length}] Prepared ${name}`);
  });

  photos.sort((a, b) => (a.date || a.source).localeCompare(b.date || b.source));
  const expectedAssets = new Set([
    ...photos.flatMap((photo) => sizes.map((size) => `${photo.id}-${size}.webp`)),
    ...settings.hiddenPhotos.flatMap((photo) => photo.id ? sizes.map((size) => `${photo.id}-${size}.webp`) : [])
  ]);
  const obsoleteAssets = (await readdir(outputDir)).filter((name) => /-\d+\.webp$/i.test(name) && !expectedAssets.has(name));
  await Promise.all(obsoleteAssets.map((name) => unlink(join(outputDir, name))));
  if (obsoleteAssets.length) console.log(`Removed ${obsoleteAssets.length} obsolete generated assets`);
  const manifest = {
    title: "Hedwig's Gallery",
    pipelineVersion,
    generatedAt: new Date().toISOString(),
    count: photos.length,
    photos
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Gallery ready: ${manifestPath}`);

  if (process.argv.includes("--check")) {
    const paths = photos.flatMap((photo) => sizes.map((size) => join(outputDir, `${photo.id}-${size}.webp`)));
    const checks = await Promise.all(paths.map(exists));
    const missing = paths.filter((_, index) => !checks[index]);
    if (missing.length) throw new Error(`${missing.length} derivatives are missing`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
