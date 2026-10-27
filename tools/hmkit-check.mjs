#!/usr/bin/env node
// 包清单的哈希校验（design/PKGMAN.txt 第三节）。
//
// 装载器只验「形状」那一半 —— 哈希的计算归这里，因为它要 node:crypto，
// 而装载器至今只借文件与路径两样能力。把校验分两层，每层只借它真正需要的东西。
//
//   node tools/hmkit-check.mjs <包目录>        校验一个包
//   node tools/hmkit-check.mjs --all <包根>    校验包根下的每一个包
//
// 退非零并说清哪一位不一样 —— 「不符」这句话要能让人知道去改什么。
import fs from "node:fs";
import path from "node:path";

async function 主() {
  const { createHash } = await import("node:crypto");
  const 参 = process.argv.slice(2);
  if (参.length === 0) {
    console.error("用法：node tools/hmkit-check.mjs <包目录> | --all <包根>");
    process.exit(2);
  }
  const 是全部 = 参[0] === "--all";
  const 根 = path.resolve(是全部 ? (参[1] || ".") : 参[0]);
  const 包们 = 是全部
    ? fs.readdirSync(根, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(根, e.name))
    : [根];

  let 坏 = 0;
  for (const 目录 of 包们) {
    const 名 = path.basename(目录);
    const 清单路 = path.join(目录, "hmyr.hmkit");
    const 入口 = path.join(目录, "index.hmoca");
    if (!fs.existsSync(清单路)) { console.log("  跳过  " + 名 + "：没有清单"); continue; }
    if (!fs.existsSync(入口)) { console.log("  不通过  " + 名 + "：没有 index.hmoca"); 坏++; continue; }
    let 清单;
    try { 清单 = JSON.parse(fs.readFileSync(清单路, "utf8")); }
    catch { console.log("  不通过  " + 名 + "：清单不是 JSON"); 坏++; continue; }
    const 真 = "sha256:" + createHash("sha256").update(fs.readFileSync(入口)).digest("hex");
    if (清单.哈希 === 真) {
      console.log("  通过  " + 名 + "：" + 真.slice(0, 20) + "…");
    } else {
      console.log("  不通过  " + 名 + "：清单独说 " + String(清单.哈希).slice(0, 20) + "…，文件是 " + 真.slice(0, 20) + "…");
      坏++;
    }
  }
  process.exit(坏 === 0 ? 0 : 1);
}

主();
