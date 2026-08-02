import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

const projectRoot = new URL("../", import.meta.url).pathname;
const outputDir = join(projectRoot, "_site");
const basePath = (process.env.SITE_BASE || "/hedwig-gallery").replace(/\/$/, "");

const publicFiles = [
  "index.html",
  "map.html",
  "styles.css",
  "styles-time.css",
  "styles-map-time.css"
];

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
await cp(join(projectRoot, "public"), outputDir, { recursive: true });
await mkdir(join(outputDir, "src"), { recursive: true });
await cp(join(projectRoot, "src", "app.js"), join(outputDir, "src", "app.js"));

for (const filename of publicFiles) {
  await cp(join(projectRoot, filename), join(outputDir, filename));
}

const textExtensions = new Set([".css", ".html", ".js", ".json"]);

async function rewriteDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await rewriteDirectory(path);
      continue;
    }
    if (!textExtensions.has(extname(entry.name))) continue;

    let text = await readFile(path, "utf8");
    text = text
      .replaceAll('"/admin.html">Admin</a>', '" hidden>Admin</a>')
      .replaceAll('"/', `"${basePath}/`)
      .replaceAll("'/", `'${basePath}/`)
      .replaceAll("url(/", `url(${basePath}/`);
    await writeFile(path, text);
  }
}

await rewriteDirectory(outputDir);
await writeFile(join(outputDir, ".nojekyll"), "");
console.log(`Prepared GitHub Pages site in ${outputDir} with base ${basePath}/`);
