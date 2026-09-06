// Minimal esbuild build/dev script for the Alt1 plugin.
//   node build.mjs           -> one-off build into dist/
//   node build.mjs --serve   -> watch + local dev server on :5173
import * as esbuild from "esbuild";
import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const OUT = "dist";
const serve = process.argv.includes("--serve");

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const exists = (p) => access(p).then(() => true, () => false);

/** Copy the static shell into dist after every rebuild, cache-busting the
 *  bundle reference so Alt1 / browsers never serve a stale build. */
const staticFiles = {
  name: "static-files",
  setup(build) {
    build.onEnd(async () => {
      const v = Date.now().toString(36);

      // Cache-bust the bundle reference so a fetched index.html always pulls
      // the fresh build.
      const html = (await readFile("src/index.html", "utf8")).replace(
        './bundle.js"',
        `./bundle.js?v=${v}"`,
      );
      await writeFile(`${OUT}/index.html`, html);

      // Stamp a changing `version` into appconfig.json — Alt1 polls configUrl
      // and re-downloads the app when the config content differs, so every
      // deploy triggers its auto-update instead of serving a stale cache.
      const cfg = JSON.parse(await readFile("src/appconfig.json", "utf8"));
      cfg.version = v;
      await writeFile(`${OUT}/appconfig.json`, JSON.stringify(cfg, null, 2) + "\n");

      await writeFile(`${OUT}/.nojekyll`, ""); // GitHub Pages: serve files as-is
      if (await exists("src/icon.png")) await cp("src/icon.png", `${OUT}/icon.png`);
    });
  },
};

/** @type {import("esbuild").BuildOptions} */
const options = {
  entryPoints: ["src/index.ts"],
  bundle: true,
  format: "esm",
  target: ["es2020"],
  outfile: `${OUT}/bundle.js`,
  sourcemap: true,
  logLevel: "info",
  plugins: [staticFiles],
};

if (serve) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: OUT, port: 5173 });
  console.log(`\n  Dev server : http://localhost:${port}`);
  console.log(`  Add to Alt1: alt1://addapp/http://localhost:${port}/appconfig.json\n`);
} else {
  await esbuild.build(options);
  console.log("Built to dist/");
}
