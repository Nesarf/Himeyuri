// 语言档案的验收：中日英三套（四份，因为中文给了两种编码）。
//
// 要紧的是最后一条：**档案绝不影响语法与求值**。所以这里除了查表与切换，
// 还要验「同一段程序在不同档案下算出同一个结果」。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";
import { lex } from "../src/lexer.mjs";
import { parse } from "../src/parser.mjs";
import { Runtime } from "../src/eval.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const rt = runUnit(loadUnit(path.join(ROOT, "locale.hmoca")));
const call = (name, args) => {
  const fn = rt.functions.get(name);
  if (!fn) throw new Error("没有这个函数：" + name);
  return rt.callFunction(fn, args, null);
};

console.log("四套档案都在，字段对得上");
{
  const 表 = call("档案表", []);
  ok("四套", Array.isArray(表) && 表.length === 4, String(表 && 表.length));
  const 名字 = 表.map((x) => x[0]);
  ok("名字是语言加编码", JSON.stringify(名字) === JSON.stringify(["zh-CN.gbk", "zh-CN.utf8", "ja-JP.shift_jis", "en-US.utf8"]), JSON.stringify(名字));
  ok("中文给了两种编码", 名字.filter((n) => n.startsWith("zh-CN.")).length === 2);
  ok("中文那两套语言相同、编码不同", call("档案的文字", ["zh-CN.gbk"]) === call("档案的文字", ["zh-CN.utf8"]) && call("档案的编码", ["zh-CN.gbk"]) !== call("档案的编码", ["zh-CN.utf8"]));
}
console.log("查编码与说法");
{
  ok("中文 GBK 那套的编码是 gbk", call("档案的编码", ["zh-CN.gbk"]) === "gbk", call("档案的编码", ["zh-CN.gbk"]));
  ok("中文 UTF-8 那套的编码是 utf8", call("档案的编码", ["zh-CN.utf8"]) === "utf8");
  ok("日文那套是 shift_jis", call("档案的编码", ["ja-JP.shift_jis"]) === "shift_jis");
  ok("英文那套是 utf8", call("档案的编码", ["en-US.utf8"]) === "utf8");
  ok("说法分别是中文、日本語、English", call("档案的说法", ["zh-CN.gbk"]) === "中文" && call("档案的说法", ["ja-JP.shift_jis"]) === "日本語" && call("档案的说法", ["en-US.utf8"]) === "English");
  ok("没有的档案返回空串，不回退", call("档案的编码", ["xx-XX.utf8"]) === "", JSON.stringify(call("档案的编码", ["xx-XX.utf8"])));
}
console.log("切换：能覆盖，也要能拒绝");
{
  ok("一开始当前档案为空（还没选过）", call("当前档案", []) === "", JSON.stringify(call("当前档案", [])));
  ok("切到中文 GBK 成功", call("切换档案", ["zh-CN.gbk"]) === "zh-CN.gbk");
  ok("当前档案就是它", call("当前档案", []) === "zh-CN.gbk", call("当前档案", []));
  ok("再切到日文", call("切换档案", ["ja-JP.shift_jis"]) === "ja-JP.shift_jis");
  ok("当前档案跟着变", call("当前档案", []) === "ja-JP.shift_jis");
  let raised = null;
  try { call("切换档案", ["xx-XX.utf8"]); } catch (e) { raised = (e.code || "") + " " + e.message; }
  ok("不存在的档案被拒绝并点名 HMYR-R0205", !!raised && raised.includes("HMYR-R0205"), String(raised));
  ok("拒绝之后当前档案没变", call("当前档案", []) === "ja-JP.shift_jis", call("当前档案", []));
}
console.log("环境说该是哪一套（可能是空，表示没档案）");
{
  const 环境 = call("环境档案", []);
  ok("返回字符串", typeof 环境 === "string", String(环境));
  ok("要么是四套之一，要么是空串", 环境 === "" || ["zh-CN.gbk", "zh-CN.utf8", "ja-JP.shift_jis", "en-US.utf8"].includes(环境), JSON.stringify(环境));
  console.log("        （本机环境给的是：" + (环境 === "" ? "空，即没有对应档案" : 环境) + "）");
}
console.log("硬规矩：档案不影响求值");
{
  // 同一段程序，在两个不同的档案下各算一次，结果必须一样。
  const src = 'fn main() -> Int { return (1 + 2) * 3 }\n';
  const d = (n) => ({ items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} });
  const 算一次 = () => {
    const 求值器 = new Runtime({});
    求值器.write = () => {};
    const { ast } = parse(lex(src, { diagnostics: d() }).tokens, { diagnostics: d() });
    求值器.run(ast);
    return 求值器.callFunction(求值器.functions.get("main"), [], null);
  };
  const 旧 = call("当前档案", []);
  call("切换档案", ["zh-CN.gbk"]);
  const 甲 = 算一次();
  call("切换档案", ["en-US.utf8"]);
  const 乙 = 算一次();
  ok("两种档案下算出同一个结果", 甲 === 乙 && 甲 === 9, String(甲) + " 对 " + String(乙));
  if (旧 === "") { /* 之前没选过，就保持现在选的 */ } else { call("切换档案", [旧]); }
}

console.log("数字的写法不进档案（第五条在输出那一头）");
{
  // 同一份程序在两个档案下算同一个数，写出来必须一模一样。
  // 挑 3.5 与 1234567 是因为它们最容易被本地化：小数点与千分位。
  // 这一条是「档案不影响语义」落到字符串上的形状 —— 也是 SPEC 2.8 里
  // 「数字格式不进档案」那一条的判据。
  const src = 'fn main() { print(str(3.5) + "|" + str(1234567) + "\\n") }\n';
  const 跑一次 = (档案) => {
    const 旧 = call("当前档案", []);
    call("切换档案", [档案]);
    const 求值器 = new Runtime({});
    let 出 = "";
    求值器.write = (s) => { 出 += String(s); };
    const 诊断 = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
    const { ast } = parse(lex(src, { diagnostics: 诊断 }).tokens, { diagnostics: 诊断 });
    求值器.run(ast);
    // 只跑一次：run() 已经跑过 main 了。上一版在这里又手动调了一次，
    // 于是输出重复了 —— 而两份重复的输出当然也「一样」，那种判据是假通过。
    if (旧 !== "") call("切换档案", [旧]);
    return 出;
  };
  const 甲 = 跑一次("zh-CN.gbk");
  const 乙 = 跑一次("en-US.utf8");
  ok("两个档案下数字写成同一串", 甲 === 乙 && 甲 === "3.5|1234567\n", JSON.stringify([甲, 乙]));
}

console.log("fmt_number：按档案格式化，而四台一致");
{
  // 它是纯函数（只读档案的字面、不碰世界），所以四台不一致就是 bug —— 与 str 一样。
  // 于是这一节要跑四台：默认、--host-eval、--compile、C。
  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-fmt-"));
  const 源 = path.join(临, "f.hmoca");
  fs.writeFileSync(源, [
    "fn main() -> Int effects(process) {",
    "  print(fmt_number(1234567, \"zh-CN.utf8\") + chr(10))",
    "  print(fmt_number(1234567, \"en-US.utf8\") + chr(10))",
    "  print(fmt_number(0 - 1234567, \"zh-CN.gbk\") + chr(10))",
    "  print(fmt_number(3.5, \"zh-CN.utf8\") + chr(10))",
    "  print(fmt_number(999, \"en-US.utf8\") + chr(10))",
    "  return 0",
    "}",
  ].join("\n") + "\n", "utf8");
  const 具 = path.join(ROOT, "bin", "hmyr.mjs");
  const 跑 = (参) => spawnSync(process.execPath, [具, ...参], { encoding: "utf8", cwd: 临, timeout: 300000 });
  const 行 = (s) => String(s || "").split("\n").map((x) => x.trimEnd()).filter((x) => x.length > 0);

  const 甲 = 跑([源]);
  const 甲行 = 行(甲.stdout);
  const 应 = ["123,4567", "1,234,567", "-123,4567", "3.5", "999"];
  ok("默认路径：中文四位分组", 甲行[0] === 应[0], JSON.stringify(甲行));
  ok("默认路径：英文三位分组", 甲行[1] === 应[1], JSON.stringify(甲行));
  ok("默认路径：负数前置不减位", 甲行[2] === 应[2], JSON.stringify(甲行));
  ok("默认路径：小数点是句点", 甲行[3] === 应[3], JSON.stringify(甲行));
  ok("默认路径：不到一组就不加逗号", 甲行[4] === 应[4], JSON.stringify(甲行));

  const 乙 = 跑(["--host-eval", 源]);
  ok("--host-eval 同一段", JSON.stringify(行(乙.stdout)) === JSON.stringify(甲行),
    JSON.stringify([行(乙.stdout), 甲行]));

  const 丙 = 跑(["--compile", 源]);
  const 丙行 = 行(丙.stdout);
  ok("--compile 同一段", 丙.status === 0 && JSON.stringify(丙行) === JSON.stringify(甲行.slice(0, 丙行.length)),
    JSON.stringify([丙行, 甲行.slice(0, 丙行.length)]));

  const 有gcc = (() => {
    try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; }
  })();
  if (有gcc) {
    const exe = path.join(临, "hmyr-c.exe");
    const 编 = spawnSync("gcc", ["-std=c11", "-O2", "-w", "-Wl,--stack,67108864", "-o", exe,
      path.join(ROOT, "vm", "hmyr.c"), "-lm"], { encoding: "utf8" });
    if (编.status === 0) {
      const 码 = path.join(临, "f.hmoks");
      const 编程序 = spawnSync(process.execPath, [path.join(ROOT, "tools", "emit-code.mjs"), 源, 码], { encoding: "utf8" });
      if (编程序.status === 0) {
        const 台 = spawnSync(exe, [码], { encoding: "utf8", timeout: 300000,
          env: { ...process.env, HMYR_MEM_LIMIT: "0", HMYR_STEPS: "4000000000" } });
        const 台行 = 行(台.stdout);
        ok("C 那台同一段", 台.status === 0 && JSON.stringify(台行) === JSON.stringify(甲行.slice(0, 台行.length)),
          JSON.stringify({ status: 台.status, out: 台行 }));
      }
    }
  } else {
    console.log("  跳过  这台机器上没有 gcc —— 第四台不验");
  }
  fs.rmSync(临, { recursive: true, force: true });
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
