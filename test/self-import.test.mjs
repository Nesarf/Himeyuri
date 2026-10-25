// 认 import 的验收：语言自己认，而不是宿主替它认。
//
// 这一段以前是 bin/hmyr.mjs 里的一个正则。搬到语言侧之后，有三件事要说清：
//   一、认得出来的写对
//   二、认不出来的当没有（注释里的 import 不算）
//   三、顺序按出现的先后，于是「谁引了谁」可查
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 层 = loadUnit(path.join(ROOT, "self/run.hmoca"));
ok("自举那一层加载得动", 层.ok, 层.diagnostics.errors.map((e) => e.code + " " + e.message).join("; "));
const 自举 = runUnit(层);
const 认 = (源) => 自举.callFunction(自举.functions.get("找导入们"), [源], null);

console.log("一、认得出");
{
  ok("一行 import", JSON.stringify(认('import "./a.hmoca"\n')) === JSON.stringify(["./a.hmoca"]), JSON.stringify(认('import "./a.hmoca"\n')));
  const 两 = 认('import "./a.hmoca"\nimport "./b.hmoca"\n');
  ok("两行 import，按顺序", JSON.stringify(两) === JSON.stringify(["./a.hmoca", "./b.hmoca"]), JSON.stringify(两));
  ok("缩进的也算", JSON.stringify(认('  import "./c.hmoca"\n')) === JSON.stringify(["./c.hmoca"]));
  ok("tab 缩进的也算", JSON.stringify(认('\timport "./d.hmoca"\n')) === JSON.stringify(["./d.hmoca"]));
}

console.log("二、认不出的当没有");
{
  ok("没有 import 就是空", JSON.stringify(认("fn main() -> Int {\n  return 1\n}\n")) === "[]");
  ok("空源码是空", JSON.stringify(认("")) === "[]");
  // 注释里的 import 不算：注释是给人看的，不是给解析器看的。
  ok("注释里的不算", JSON.stringify(认('// import "./假.hmoca"\n')) === "[]", JSON.stringify(认('// import "./假.hmoca"\n')));
  ok("拼错的也不算", JSON.stringify(认('importx "./a.hmoca"\n')) === "[]");
  ok("没有引号的也不算", JSON.stringify(认("import ./a.hmoca\n")) === "[]");
}

console.log("三、顺序按出现");
{
  const 序 = 认('import "./z.hmoca"\nimport "./a.hmoca"\nimport "./m.hmoca"\n');
  ok("不是排序，是出现顺序", JSON.stringify(序) === JSON.stringify(["./z.hmoca", "./a.hmoca", "./m.hmoca"]), JSON.stringify(序));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
