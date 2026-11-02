// 更新器：我这一份旧了没有。
//
// 它只回答能回答的，而把不能回答的如实说出来：
//
//   能答     本地是哪一份（清单里的 commit）、本地有没有改动
//   能答     远端有没有新的（git fetch 成功时）
//   不能答   远端有没有新的（没有网络、或没有 git 时——那时它不说「你最新」）
//
// 「不知道」与「是最新」是两件事，而这个工具最不该做的就是把前者说成后者。
//
//   node tools/update.mjs
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// 每一步都有上限。没有超时的 git fetch，在没有网络、或者远端要凭据的时候会一直等
// —— 那比说错更糟：这个工具连「不知道」都说不出来了。
// 2026-11-03 在 WSL 里第一次跑全量，distro 那一套就是卡在这里：十分钟、零 CPU，
// 把整轮全量堵住。超时之后 status 是 null，于是它走「取不到远端」那条，
// 退出码非零 —— 而 distro 套件对「退零」与「非零」两种情形各有断言，不会因此变红。
const 走 = (参) => spawnSync("git", 参, { encoding: "utf8", cwd: ROOT, timeout: 20000 });

console.log("");
console.log("  我是哪一份");
{
  const r = 走(["rev-parse", "--short", "HEAD"]);
  if (r.status === 0) console.log("    本地提交：" + String(r.stdout).trim());
  else { console.log("    不在 git 仓库里——于是没有版本可比。"); process.exit(0); }

  const 脏 = 走(["status", "--porcelain"]);
  const 改过 = String(脏.stdout || "").trim().split("\n").filter(Boolean).length;
  console.log("    工作区：" + (改过 === 0 ? "干净" : 改过 + " 处改动没提交"));

  const 清单 = path.join(ROOT, "dist/manifest.json");
  if (fs.existsSync(清单)) {
    const 内容 = JSON.parse(fs.readFileSync(清单, "utf8"));
    const 同 = 内容.commit && 内容.commit === String(走(["rev-parse", "--short", "HEAD"]).stdout).trim();
    console.log("    打好的清单：" + (内容.commit || "（没有 commit 字段）") + (同 ? "，与本地提交一致" : "，而它与本地提交不同——清单过期了，重打一次"));
  } else {
    console.log("    还没有打好的清单：node tools/package.mjs");
  }
}

console.log("");
console.log("  远端有没有新的");
{
  const 远 = 走(["rev-parse", "--abbrev-ref", "origin/main"]);
  if (远.status !== 0) { console.log("    没有配置远端——于是「有没有新的」无从判断。"); process.exit(0); }

  const 取 = 走(["fetch", "origin", "--quiet"]);
  if (取.status !== 0) {
    // 这一条最要紧：取不到就说不清，而不是顺手说「你最新」。
    console.log("    取不到远端（没有网络，或者仓库不可达）——于是不知道远端有没有新的。");
    console.log("    这不等于「你是最新的」。");
    process.exit(1);
  }

  const 落 = 走(["rev-list", "--count", "HEAD..origin/main"]);
  const 领 = 走(["rev-list", "--count", "origin/main..HEAD"]);
  const 落后 = Number(String(落.stdout || "0").trim());
  const 领先 = Number(String(领.stdout || "0").trim());
  if (落后 === 0 && 领先 === 0) console.log("    与远端同一份。");
  else if (落后 > 0) console.log("    远端有 " + 落后 + " 笔新的。拿到它：git pull --ff-only");
  else console.log("    本地比远端多 " + 领先 + " 笔（还没推）。");
}
console.log("");
