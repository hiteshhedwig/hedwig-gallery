import { build } from "esbuild";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

await build({
  entryPoints: [resolve(root, "src", "map.js")],
  outfile: resolve(root, "public", "map.bundle.js"),
  bundle: true,
  format: "esm",
  minify: true,
  target: ["es2020"],
  loader: { ".json": "json" }
});

console.log("Interactive globe client ready");
