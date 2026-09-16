import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

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
  sourcemap: true,
  target: ["chrome138"],
};

const context = await esbuild.context(buildOptions);
if (watch) {
  await context.watch();
  console.log("Watching source files. Reload the extension manually in chrome://extensions.");
} else {
  await context.rebuild();
  await context.dispose();
}
