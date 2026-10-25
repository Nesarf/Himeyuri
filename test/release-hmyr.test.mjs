// release 的验收：一条命令出三样东西 —— 清单、归档、说明书。
//
// 轻的那一半每次全量都跑：源码读得动、编得过、入口函数没和别的工具撞名、
// 说明书里三个小标题都在（那三问是这份说明书存在的理由，缺一个就等于没写）。
// 真跑一次挂 HMYR_HEAVY：它要先造清单，而那是给两百多个文件算 sha256，一分多钟。
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadUnit } from "../src/loader.mjs";
import { 编译模块, 合并程序 } from "../src/bytecode.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

console.log("一、源码读得动、编得过");
const 源路 = path.join(ROOT, "self/release.hmyr");
ok("self/release.hmyr 在", fs.existsSync(源路));
const 层 = loadUnit(源路);
ok("加载没有诊断", 层.ok, JSON.stringify((层.diagnostics.errors || []).slice(0, 1).map((e) => e.code)));
if (层.ok) {
  const 份们 = 层.order.map((f) => 编译模块(层.modules.get(f)));
  const 程序 = 合并程序(份们, 份们[份们.length - 1]);
  ok("编得过（函数表非空）", 程序.函数们.size > 20, String(程序.函数们.size));
  ok("入口函数叫 发布（main 与 打包 都已有主）", 程序.函数们.has("发布") && 程序.函数们.has("main"));
}
const 文 = fs.readFileSync(源路, "utf8");
ok("发布 声明了 file 与 process 效果", /fn 发布\([^)]*\) effects\(file, process\)/.test(文));
ok("说明书回答了「哪些资产带签名」", 文.includes("哪些资产带签名"));
ok("说明书回答了「哪些没有，以及为什么」", 文.includes("哪些没有，以及为什么"));
ok("说明书回答了「怎么自己验」", 文.includes("怎么自己验"));
ok("说明书说了包里不含语料，以及去哪补",
  文.includes("conformance/") && 文.includes("codepoints.txt") && 文.includes("tools/ucd.mjs"));
ok("真发留在 JS 那一侧，且写明了理由", 文.includes("gh release create") && 文.includes("令牌"));

if (!process.env.HMYR_HEAVY) {
  console.log("  跳过  真跑一次要先造清单，一分多钟，挂 HMYR_HEAVY 之后");
} else {
  console.log("二、真跑一次：三样产物都要在");
  const 临 = fs.mkdtempSync(path.join(ROOT, ".tmp-release-"));
  const r = spawnSync(process.execPath, ["bin/hmyr.mjs", "--compile", "self/release.hmyr", "v0.0.1", 临], {
    cwd: ROOT, encoding: "utf8", timeout: 600000,
    env: { ...process.env, HMYR_STEPS: "4000000000" },
  });
  ok("发布跑得动", r.status === 0, String(r.status) + " " + String(r.stderr || "").slice(0, 200));
  const 包路 = path.join(临, "himeyuri-v0.0.1.zip");
  const 清单路 = path.join(临, "manifest.json");
  const 说明路 = path.join(临, "release-notes.md");
  ok("归档按 tag 命名", fs.existsSync(包路), 包路);
  ok("清单在", fs.existsSync(清单路), 清单路);
  ok("说明书在", fs.existsSync(说明路), 说明路);
  if (fs.existsSync(清单路)) {
    let 对象 = null;
    try { 对象 = JSON.parse(fs.readFileSync(清单路, "utf8")); } catch (e) { 对象 = null; }
    ok("清单是合法 JSON", 对象 !== null);
    if (对象) ok("清单里有 commit 与 kernel", !!(对象.commit && 对象.kernel && 对象.kernel.minimalSet));
  }
  if (fs.existsSync(包路)) {
    const 包 = fs.readFileSync(包路);
    const 尾位 = 包.length - 22;
    ok("归档的尾记录签名对", 包[尾位] === 0x50 && 包[尾位 + 1] === 0x4b && 包[尾位 + 2] === 5 && 包[尾位 + 3] === 6);
    ok("归档里有两百多个条目", 包.readUInt16LE(尾位 + 10) > 200, String(包.readUInt16LE(尾位 + 10)));
  }
  if (fs.existsSync(说明路)) {
    const 说明 = fs.readFileSync(说明路, "utf8");
    ok("说明书含三问的三个小标题",
      说明.includes("哪些资产带签名") && 说明.includes("哪些没有，以及为什么") && 说明.includes("怎么自己验"));
    ok("说明书里写着这一次的 tag", 说明.includes("v0.0.1"));
  }
  fs.rmSync(临, { recursive: true, force: true });
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
