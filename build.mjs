import * as esbuild from "esbuild";
import { readdir, unlink } from "node:fs/promises";

const watch = process.argv.includes("--watch");
const release = process.argv.includes("--release");

if (watch && release) {
  throw new Error("--watch 与 --release 不能同时使用");
}

const buildOptions = {
  bundle: true,
  entryPoints: {
    background: "background.js",
    offscreen: "offscreen.js",
    "asr-worklet": "asr-worklet.js",
    "content-overlay": "content-overlay.js",
    "content-tiktok": "content-tiktok.js",
    popup: "popup.js",
    options: "options.js",
  },
  entryNames: "[name]",
  format: "iife",
  logLevel: "info",
  outdir: "dist",
  sourcemap: !release,
  target: ["chrome138"],
};

if (release) {
  const entries = await readdir("dist").catch(() => []);
  await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".map"))
      .map((entry) => unlink(`dist/${entry}`)),
  );
}

const context = await esbuild.context(buildOptions);
if (watch) {
  await context.watch();
  console.log("Watching source files. Reload the extension manually in chrome://extensions.");
} else {
  await context.rebuild();
  await context.dispose();
}
