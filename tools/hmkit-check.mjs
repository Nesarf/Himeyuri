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

/**
 * 规范化字节（design/PKGMAN.txt 第五节）：去掉 签名、键按字节序排、无空格、UTF-8。
 *
 * 这四条必须写到能逐字复现，否则两个实现差一个空格就验不过 ——
 * 而「验不过」与「被改过」在调用者眼里是同一件事，那是这条规矩最贵的地方。
 */
function 规范化(清单) {
  const 去 = { ...清单 };
  delete 去.签名;
  const 排 = (v) => {
    if (Array.isArray(v)) return v.map(排);
    if (v && typeof v === "object") {
      const 出 = {};
      for (const k of Object.keys(v).sort()) 出[k] = 排(v[k]);
      return 出;
    }
    return v;
  };
  return Buffer.from(JSON.stringify(排(去)), "utf8");
}

const { createHash, createPublicKey, verify } = await import("node:crypto");

async function 主() {
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

    // 签名（design/PKGMAN.txt 第五节）：真伪在这里验，形状由装载器验。
    // 签的是「去掉签名字段之后的规范化字节」，所以验签要自己算一遍那串字节 ——
    // 拿清单原文去验会一辈子验不过，而那种失败看上去像「被改过」。
    if (清单.签名 && typeof 清单.签名 === "object") {
      const 表路 = path.join(根, "hmyr.hmtrust");
      let 表 = null;
      try { 表 = JSON.parse(fs.readFileSync(表路, "utf8")); } catch { 表 = null; }
      const 钥 = 表 && typeof 表 === "object" ? 表[名] : undefined;
      if (typeof 钥 !== "string") {
        console.log("  不通过  " + 名 + "：签了名，但 hmyr.hmtrust 里没有它的公钥");
        坏++;
      } else {
        try {
          const 公钥 = createPublicKey({
            key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(钥, "hex").toString("base64url") },
            format: "jwk",
          });
          const 好 = verify(null, 规范化(清单), 公钥, Buffer.from(String(清单.签名.值), "hex"));
          if (好) {
            console.log("  通过  " + 名 + "：签名验过");
          } else {
            console.log("  不通过  " + 名 + "：签名对不上（清单被改过，或者签名不是这一份清单的）");
            坏++;
          }
        } catch (e) {
          console.log("  不通过  " + 名 + "：验签失败 —— " + String(e && e.message).slice(0, 80));
          坏++;
        }
      }
    }

    // 哈希链（design/PKGMAN.txt 第二节）：依赖哈希记的是「那个包入口文件的 sha256」。
    // 它挡的是「换了一个包」；挡不住「换的人同时改了清单」—— 那要签名，另一页的事。
    const 依赖哈希 = 清单.依赖哈希 && typeof 清单.依赖哈希 === "object" && !Array.isArray(清单.依赖哈希) ? 清单.依赖哈希 : {};
    for (const [依赖名, 记的] of Object.entries(依赖哈希)) {
      const 依赖入口 = path.join(根, 依赖名, "index.hmoca");
      if (!fs.existsSync(依赖入口)) {
        console.log("  不通过  " + 名 + "：依赖 " + 依赖名 + " 不在这个包根下");
        坏++;
        continue;
      }
      const 它 = "sha256:" + createHash("sha256").update(fs.readFileSync(依赖入口)).digest("hex");
      if (它 === 记的) {
        console.log("  通过  " + 名 + " → " + 依赖名 + "：" + 它.slice(0, 20) + "…");
      } else {
        console.log("  不通过  " + 名 + " → " + 依赖名 + "：清单记的是 " + String(记的).slice(0, 20) + "…，那个包现在是 " + 它.slice(0, 20) + "…（它被换过）");
        坏++;
      }
    }
  }
  process.exit(坏 === 0 ? 0 : 1);
}

主();
