// manifest 的验收：HMYR 造得出一份能被标准 JSON 读、digest 也自洽的清单。
//
// 重的部分挂在 HMYR_HEAVY 之后：它要给将近两百个文件算 sha256，一分钟上下。
// 轻的部分（源码读得动、编得过）每次全量都跑 —— 因为「能不能编」是最先坏的那一环。
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
const 源路 = path.join(ROOT, "self/manifest.hmyr");
ok("self/manifest.hmyr 在", fs.existsSync(源路));
const 层 = loadUnit(源路);
ok("加载没有诊断", 层.ok, JSON.stringify((层.diagnostics.errors || []).slice(0, 1).map((e) => e.code)));
if (层.ok) {
  const 份们 = 层.order.map((f) => 编译模块(层.modules.get(f)));
  const 程序 = 合并程序(份们, 份们[份们.length - 1]);
  ok("编得过（函数表非空）", 程序.函数们.size > 10, String(程序.函数们.size));
  // 造项的那三个函数各自读写文件，必须自己声明 file 效果 —— 这一条错在
  // 「解释器能跑、字节码那台报 R0201」的分界上，而且只在真跑的时候现形。
  const 文 = fs.readFileSync(源路, "utf8");
  ok("造库项 声明了 file 效果", /fn 造库项\([^)]*\) effects\(file\)/.test(文));
  ok("造套件项 声明了 file 效果", /fn 造套件项\([^)]*\) effects\(file\)/.test(文));
  ok("造名项 声明了 file 效果", /fn 造名项\([^)]*\) effects\(file\)/.test(文));
  ok("函数体里没有裸块（字节码后端不认 Block 表达式）", !/^\s*\{\s*$/m.test(文.split("fn 主(")[1] || ""));
}

if (!process.env.HMYR_HEAVY) {
  console.log("  跳过  真生成要一分钟上下，挂 HMYR_HEAVY 之后");
} else {
  console.log("二、真跑一次：清单能被标准 JSON 读，digest 与标准缩进自洽");
  const 临 = fs.mkdtempSync(path.join(ROOT, ".tmp-manifest-"));
  const 出路 = path.join(临, "m.json");
  const r = spawnSync(process.execPath, ["bin/hmyr.mjs", "--compile", "self/manifest.hmyr", 出路], {
    cwd: ROOT, encoding: "utf8", timeout: 600000,
    env: { ...process.env, HMYR_STEPS: "4000000000" },
  });
  ok("生成跑得动", r.status === 0, String(r.stderr || "").slice(0, 200));
  if (r.status === 0 && fs.existsSync(出路)) {
    const 文 = fs.readFileSync(出路, "utf8");
    let 对象 = null;
    try { 对象 = JSON.parse(文); } catch (e) { 对象 = null; }
    ok("是合法 JSON", 对象 !== null, JSON.stringify(文.slice(0, 80)));
    if (对象) {
      ok("四组都在", Array.isArray(对象.standardLibrary) && Array.isArray(对象.suites) &&
        Array.isArray(对象.tools) && Array.isArray(对象.documents), Object.keys(对象).join(","));
      // kernel 与 commit 两组：前者从源码里数、从文档里抽，后者读 .git。
      ok("kernel.builtins 是个像样的数", Number(对象.kernel && 对象.kernel.builtins) > 40,
        String(对象.kernel && 对象.kernel.builtins));
      ok("kernel.minimalSet 是十五项", Array.isArray(对象.kernel && 对象.kernel.minimalSet) &&
       对象.kernel.minimalSet.length === 15, String((对象.kernel && 对象.kernel.minimalSet || []).length));
      ok("commit 是七位短哈希", /^[0-9a-f]{7}$/.test(String(对象.commit || "")), String(对象.commit));
      ok("套件有一百多项", (对象.suites || []).length > 100, String((对象.suites || []).length));
      const 十六 = /^[0-9a-f]{16}$/;
      const 全 = [...(对象.standardLibrary || []), ...(对象.suites || []), ...(对象.tools || []), ...(对象.documents || [])];
      ok("每一项的 sha256 都是十六位十六进制", 全.length > 0 && 全.every((x) => 十六.test(x.sha256)),
        String(全.filter((x) => !十六.test(x.sha256)).length) + " 项不合形");
      // digest 的定义：删掉它自己之后，按 JSON.stringify(x, null, 2) 的字节算。
      const 去 = { ...对象 };
      delete 去.digest;
      const 应 = createHash("sha256").update(JSON.stringify(去, null, 2)).digest("hex");
      ok("digest 与标准缩进算出来的一致", 应 === 对象.digest, 应.slice(0, 16) + " 对 " + String(对象.digest).slice(0, 16));
      // 末行是 }，文件以换行结尾 —— 与 verify 的重建规则对得上。
      ok("以 } 加一个换行收尾", 文.endsWith("}\n"), JSON.stringify(文.slice(-4)));
    }
  }
  fs.rmSync(临, { recursive: true, force: true });
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
