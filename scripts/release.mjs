import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("用法：npm run release -- <major.minor.patch>");
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function output(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  return result.stdout.trim();
}

async function updateJson(path, mutate) {
  const data = JSON.parse(await readFile(path, "utf8"));
  mutate(data);
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
}

if (output("git", ["status", "--porcelain"])) {
  console.error("工作区不干净，拒绝发版。请先提交或移走现有改动。");
  process.exit(1);
}

const branch = output("git", ["branch", "--show-current"]);
if (branch !== "main") {
  console.error(`发版只能从 main 分支执行；当前分支是 ${branch || "detached HEAD"}。`);
  process.exit(1);
}

// 在改版本号之前确认最后一步所需工具存在，避免提交和推送完成后才发现
// 无法创建 Release，留下标签存在但 releases/latest 仍为 404 的半成品。
output("gh", ["--version"]);

const tag = `v${version}`;
if (output("git", ["tag", "--list", tag])) {
  console.error(`${tag} 已存在，拒绝重复发版。`);
  process.exit(1);
}

await updateJson("manifest.json", (manifest) => {
  manifest.version = version;
});
await updateJson("package.json", (pkg) => {
  pkg.version = version;
});
await updateJson("package-lock.json", (lock) => {
  lock.version = version;
  if (lock.packages?.[""]) lock.packages[""].version = version;
});

run(process.execPath, ["build.mjs", "--release"]);
run("git", ["add", "manifest.json", "package.json", "package-lock.json", "dist"]);
run("git", ["commit", "-m", `Release ${tag}`]);
run("git", ["tag", tag]);
run("git", ["push", "origin", "HEAD"]);
run("git", ["push", "origin", tag]);
run("gh", ["release", "create", tag, "--generate-notes", "--verify-tag"]);

console.log(`${tag} 已发布。`);
