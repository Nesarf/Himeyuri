#!/usr/bin/env node
// 量「全自举第一段的起点数」：让 src/loader.mjs 把每一次加载交给 self/ 那一侧
// （HMYR_LOADER=self），然后看直接依赖它的套件还有多少能通过。
//
// 为什么要单独一个工具：这个数在 design/FULLSELF.txt 里挂了三轮没量出来，而手工
// 量那一次（2026-11-01）八路并行乘上「每次加载一个进程」，把机器推到几百个 node
// 进程、内存持续满。所以这里写得保守：一场一场跑、每场都有超时、跑完把表打出来，
// 谁通过谁失败一目了然。
//
// 用法：
//   node tools/starting-count.mjs                 全部（直接依赖 src/loader.mjs 的套件）
//   node tools/starting-count.mjs --limit=12      只跑前十二场（先看耗时）
//   node tools/starting-count.mjs --timeout=180   每场给三分钟
//
// 环境：HMYR_C_VM 要给（自举侧的适配层需要一台 C 机器）。没有它时每一场都会
// 立刻报 E0303 —— 那也是一种读数：它说明这台机器上量不了，而不是套件坏了。
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 参数 = process.argv.slice(2);
const 取数 = (名, 默认) => {
  const 一 = 参数.find((a) => a.startsWith("--" + 名 + "="));
  return 一 ? 一.slice(名.length + 3) : 默认;
};
const 上限 = Number(取数("limit", "0")) || 0;
const 每场秒 = Number(取数("timeout", "180")) || 180;
// 整机水位：可用内存低于这个数就先等一等，等不到就停手并把这件事说出来。
// 为什么要有它（2026-11-01）：前两次手工量都把机器拖坏了 —— 一次八百个 node 进程，
// 一次五百一十七个。串行与每进程堆上限都挡不住「子进程一层套一层」，
// 而这一道闸不看谁在起进程，只看这台机器还有没有地方放它们。
const 水位MB = Number(取数("mem", "1500")) || 1500;
const 水位最多等秒 = Number(取数("memWait", "120")) || 120;

const 睡 = (毫秒) => {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 毫秒);
  } catch {
    const 末 = Date.now() + 毫秒;
    while (Date.now() < 末) {
      /* 水位检查很少走到这里；走到了也只是把这一小段等完。 */
    }
  }
};

function 等水位() {
  const 限 = Date.now() + 水位最多等秒 * 1000;
  while (os.freemem() / (1024 * 1024) < 水位MB) {
    if (Date.now() > 限) return false;
    console.log("  （可用内存低于 " + 水位MB + " MB，先等一等）");
    睡(3000);
  }
  return true;
}

// 直接依赖：test/ 下哪些套件自己 import 了 src/loader.mjs。
// 只算直接依赖 —— 那正是 tools/impact.mjs 报的一百零一套，也是「换掉 loader 会立刻
// 碰到」的那一批。间接依赖先不论，因为那是下一段的事。
function 直接依赖() {
  const 目录 = path.join(ROOT, "test");
  const 名们 = [];
  for (const 名 of fs.readdirSync(目录)) {
    if (!名.endsWith(".test.mjs")) continue;
    const 源 = fs.readFileSync(path.join(目录, 名), "utf8");
    if (源.includes("../src/loader.mjs")) 名们.push(名);
  }
  return 名们.sort();
}

const 机器 = process.env.HMYR_C_VM || "";
const 名单 = 直接依赖();
const 要跑 = 上限 > 0 ? 名单.slice(0, 上限) : 名单;

console.log("起点数：直接依赖 src/loader.mjs 的套件 " + 名单.length + " 个，这一次跑 " + 要跑.length + " 个");
console.log("机器：" + (机器 || "(未给 HMYR_C_VM —— 每一场都会报 E0303)"));
console.log("");

const 结果 = [];
let 中止 = false;
let t0 = Date.now();
for (const 名 of 要跑) {
  // 每一场之前先看这台机器还有没有地方放它 —— 这是那三道闸里唯一管「整机」的一道。
  if (!等水位()) {
    中止 = true;
    console.log("  可用内存一直低于 " + 水位MB + " MB，停在这里 —— 后面的套件这一次没量。");
    break;
  }
  const t = Date.now();
  const r = spawnSync(process.execPath, [path.join(ROOT, "test", 名)], {
    encoding: "utf8",
    cwd: ROOT,
    timeout: 每场秒 * 1000,
    env: {
      ...process.env,
      HMYR_LOADER: "self",
      HMYR_C_VM: 机器,
      HMYR_JOBS: "1",
      HMYR_HEAP_MB: "512",
    },
  });
  const 秒 = ((Date.now() - t) / 1000).toFixed(1);
  const 通过 = r.status === 0;
  const 尾 = String(r.stdout || "")
    .trim()
    .split("\n")
    .filter(Boolean);
  const 汇 = 尾.length ? 尾[尾.length - 1].trim() : "";
  const 错 = String(r.stderr || "")
    .trim()
    .split("\n")
    .filter(Boolean)[0] || "";
  const 超时 = r.error && r.error.code === "ETIMEDOUT";
  const 记 = { 名: 名.replace(/\.test\.mjs$/, ""), 通过, 秒: Number(秒), 超时, 汇, 错 };
  结果.push(记);
  console.log(
    (通过 ? "[通过] " : 超时 ? "[超时] " : "[不通过] ") +
      (记.名 + "                    ").slice(0, 20) +
      " " + 秒 + "s  " +
      (通过 ? 汇 : 错 || 汇).slice(0, 90),
  );
}

const 过 = 结果.filter((r) => r.通过).length;
const 挂 = 结果.filter((r) => !r.通过);
const 总秒 = ((Date.now() - t0) / 1000).toFixed(0);
console.log("");
console.log("起点数 " + 过 + " / " + 结果.length + "    总耗时 " + 总秒 + " 秒");
if (挂.length) {
  console.log("没过的是：");
  for (const r of 挂) console.log("  " + r.名 + (r.超时 ? "（超时）" : "") + "  " + (r.错 || r.汇).slice(0, 100));
}
const 存 = 取数("out", "");
if (存) {
  fs.writeFileSync(存, JSON.stringify({ 名单: 名单.length, 跑了: 结果.length, 通过: 过, 结果 }, null, 1), "utf8");
  console.log("明细写到 " + 存);
}
process.exit(0);
