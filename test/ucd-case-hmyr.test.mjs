// 语料生成第三支的验收：HMYR 写的 ucd-case 生成器，跑在字节码机上，产物必须与
// 仓库里那份（tools/ucd-case.mjs 生成的）逐字节相同。
//
// 这一支比前两支多读一份 SpecialCasing.txt，并且要合并两种映射、排一次序 ——
// 那一步最初写成「用只改重建元组」的三次方，真语料上要跑六分钟，改成可变数组后三秒。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { 编译模块, 合并程序 } from "../src/bytecode.mjs";
import { 写程序, 读程序 } from "../src/code-file.mjs";
import { 虚拟机 } from "../src/vm.mjs";
import { 本机能力 } from "../src/capabilities.mjs";
import { lex } from "../src/lexer.mjs";
import { parse } from "../src/parser.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label + (detail ? "  " + detail : "")); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 源路 = path.join(ROOT, "self/ucd-case.hmoca");
const 现成 = path.join(ROOT, "vm/ucd-case.h");
const 语料 = path.join(ROOT, "data/ucd");

console.log("一、前提在");
ok("self/ucd-case.hmyr 在", fs.existsSync(源路));
ok("vm/ucd-case.h 在（JS 那位的产物）", fs.existsSync(现成));
ok("三份语料都在", ["UnicodeData.txt", "SpecialCasing.txt", "DerivedCoreProperties.txt"]
  .every((f) => fs.existsSync(path.join(语料, f))));

if (failed === 0) {
  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-case-"));
  const 出 = path.join(临, "ucd-case.h");

  const d = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
  const { ast } = parse(lex(fs.readFileSync(源路, "utf8"), { diagnostics: d }).tokens, { diagnostics: d });
  const 字节 = 写程序(合并程序([编译模块(ast)]));
  const vm = new 虚拟机(读程序(字节), {
    capabilities: 本机能力(), stepLimit: 400000000, maxDepth: 4000,
    argv: ["hmyr", 语料, 出],
  });
  vm.write = () => {};

  console.log("二、在字节码机上跑得动");
  const r = vm.调用("main", [], null);
  ok("main 跑完", r && r.ok, r && r.ok ? "" : JSON.stringify(vm.停机));

  console.log("三、产物与 JS 那位逐字节相同");
  if (!fs.existsSync(出)) {
    ok("产物写出来了", false, "没有 " + 出);
  } else {
    const 甲 = fs.readFileSync(出);
    const 乙 = fs.readFileSync(现成);
    ok("字节数相同（" + 甲.length + "）", 甲.length === 乙.length, 甲.length + " / " + 乙.length);
    ok("内容相同", 甲.equals(乙));
    const 行 = (b) => b.toString("utf8").split("\n").length;
    ok("行数相同（" + 行(甲) + "）", 行(甲) === 行(乙));
  }
  fs.rmSync(临, { recursive: true, force: true });
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
