import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export const projectRoot = resolve(import.meta.dirname, "..");
export const contentDir = join(projectRoot, "content");
export const uploadDir = join(contentDir, "uploads");
export const settingsPath = join(contentDir, "gallery-settings.json");

export const emptySettings = () => ({ hiddenPhotos: [], overrides: {} });

export async function loadSettings() {
  try {
    const parsed = JSON.parse(await readFile(settingsPath, "utf8"));
    return {
      hiddenPhotos: Array.isArray(parsed.hiddenPhotos) ? parsed.hiddenPhotos : [],
      overrides: parsed.overrides && typeof parsed.overrides === "object" ? parsed.overrides : {}
    };
  } catch {
    return emptySettings();
  }
}

export async function saveSettings(settings) {
  await mkdir(dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
}
