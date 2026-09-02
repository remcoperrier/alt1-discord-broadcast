// Minimal esbuild build/dev script for the Alt1 plugin.
//   node build.mjs           -> one-off build into dist/
//   node build.mjs --serve   -> watch + local dev server on :5173
import * as esbuild from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

const OUT = "dist";
const serve = process.argv.includes("--serve");

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

/** Copy the static shell (html + appconfig) into dist after every rebuild. */
const staticFiles = {
  name: "static-files",
  setup(build) {
    build.onEnd(async () => {
      await cp("src/index.html", `${OUT}/index.html`);
      await cp("src/appconfig.json", `${OUT}/appconfig.json`);
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
