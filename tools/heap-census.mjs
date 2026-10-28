#!/usr/bin/env node
// 板子上的天花板：一个程序要多少堆，而哪一档开始装不下。
//
//   node tools/heap-census.mjs <程序.hmoca> [...]
//
// 它做三件事，每一件都是可复现的：
//
//   一、把程序编成字节码（tools/emit-code.mjs）
//   二、在宿主的 C 机器上跑一遍，环境里放 HMYR_MEM=1 —— 那一台会打印
//       "heap live N bytes, peak M bytes"，而 M 就是要的那个数
//   三、把「堆峰值 + 栈 + 静态段」与板子的 128 KB SRAM 比
//
// 为什么在桌面上量而不在板子上：板子只有 128 KB，而一个装不下的程序在板子上
// 表现为「串口不出字节」或者 HardFault —— 看得到结果，看不到它是多少。
// 桌面上的那一台是同一份 vm/hmyr.c，堆账是同一套账。
//
// 三个常数写在这里，因为它们是这一页的判据而不是可调项：
//   SRAM 128 KB、栈 8 KB（port/link.ld 给的那一段）、静态段 48128 字节（.bss）。
// 前两个是板子与链接脚本的事实，第三个来自 arm-none-eabi-size 的实测。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRAM = 128 * 1024;
const STACK = 8 * 1024;
const STATIC_BYTES = 48128;

// 桌面上的 C 机器：这个仓库的构建脚本不生成它，所以要找一个已经编好的。
// 找不到就给一条明确的命令，而不是静默跳过 —— 「量不了」与「装得下」不一样。
const 找C机器 = () => {
  const 候选 = [
    path.join(ROOT, "port", "build", "host-hmyr.exe"),
    "E:\\DaShaoHuo\\cache\\tmp\\stack1\\hmyr-128.exe",
  ];
  for (const p of 候选) if (fs.existsSync(p)) return p;
  return null;
};

const 程序们 = process.argv.slice(2);
if (程序们.length === 0) {
  console.error("用法：node tools/heap-census.mjs <程序.hmoca> [...]");
  process.exit(2);
}

const exe = 找C机器();
if (!exe) {
  console.error("找不到桌面上的 C 机器。先编一份：");
  console.error('  gcc -std=c11 -O2 -w -o port/build/host-hmyr.exe vm/hmyr.c -lm');
  process.exit(2);
}

const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-heap-"));
const 行们 = [];

for (const 相 of 程序们) {
  const 源 = path.isAbsolute(相) ? 相 : path.join(ROOT, 相);
  if (!fs.existsSync(源)) { 行们.push({ 程序: 相, 备注: "没有这个文件" }); continue; }
  const 码 = path.join(临, path.basename(相).replace(/\.hmoca$/, "") + ".hmoks");
  const 编 = spawnSync(process.execPath, [path.join(ROOT, "tools", "emit-code.mjs"), 源, 码], { encoding: "utf8" });
  if (编.status !== 0 || !fs.existsSync(码)) {
    行们.push({ 程序: 相, 备注: "编不出来" });
    continue;
  }
  const 跑 = spawnSync(exe, [码], {
    encoding: "utf8",
    timeout: 120000,
    env: { ...process.env, HMYR_MEM: "1", HMYR_MEM_LIMIT: "0", HMYR_STEPS: "4000000000" },
  });
  const 出 = String(跑.stdout || "") + String(跑.stderr || "");
  const m = /heap live (\d+) bytes, peak (\d+) bytes/.exec(出);
  if (!m) { 行们.push({ 程序: 相, 备注: "它没打印堆账" }); continue; }
  const 堆 = Number(m[2]);
  const 需要 = 堆 + STACK + STATIC_BYTES;
  行们.push({ 程序: 相, 堆, 需要, 装得下: 需要 <= SRAM, 字节码: fs.statSync(码).size });
}

fs.rmSync(临, { recursive: true, force: true });

const 宽 = (s, n) => String(s).padEnd(n);
console.log("板子：SRAM " + (SRAM / 1024) + " KB · 栈 " + (STACK / 1024) + " KB · 静态段 " + STATIC_BYTES + " 字节");
console.log("");
console.log(宽("程序", 26) + 宽("字节码", 10) + 宽("堆峰值", 10) + 宽("合计需要", 12) + "装得下");
for (const r of 行们) {
  if (r.备注) { console.log(宽(r.程序, 26) + r.备注); continue; }
  console.log(
    宽(path.basename(r.程序), 26) +
    宽(r.字节码 + " B", 10) +
    宽(r.堆, 10) +
    宽(r.需要 + " B", 12) +
    (r.装得下 ? "是" : "不（差 " + (r.需要 - SRAM) + " 字节）")
  );
}

const 装得下 = 行们.filter((r) => r.装得下 === true).length;
const 量了 = 行们.filter((r) => r.装得下 !== undefined).length;
console.log("");
console.log(量了 + " 个程序里，装得下的有 " + 装得下 + " 个");
