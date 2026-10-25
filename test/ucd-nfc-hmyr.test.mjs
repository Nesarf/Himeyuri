// 语料生成第二支的验收：HMYR 写的 ucd-nfc 生成器，跑在字节码机上，产物必须与
// 仓库里那份（tools/ucd-nfc.mjs 生成的）逐字节相同。
//
// 这是 design/INDEX.txt 那五个内置的第一个真实用户 —— 顺带也验了索引本身。
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

const 源路 = path.join(ROOT, "self/ucd-nfc.hmoca");
const 现成 = path.join(ROOT, "vm/ucd-nfc.h");
const 语料 = path.join(ROOT, "data/ucd");

console.log("一、前提在");
ok("self/ucd-nfc.hmyr 在", fs.existsSync(源路));
ok("vm/ucd-nfc.h 在（JS 那位的产物）", fs.existsSync(现成));
ok("data/ucd 语料在", fs.existsSync(path.join(语料, "UnicodeData.txt")) && fs.existsSync(path.join(语料, "CompositionExclusions.txt")));

if (failed === 0) {
  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-nfc-"));
  const 出 = path.join(临, "ucd-nfc.h");

  const d = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
  const { ast } = parse(lex(fs.readFileSync(源路, "utf8"), { diagnostics: d }).tokens, { diagnostics: d });
  const 字节 = 写程序(合并程序([编译模块(ast)]));
  const vm = new 虚拟机(读程序(字节), {
    capabilities: 本机能力(), stepLimit: 2000000000, maxDepth: 4000,
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
    // 行数也报一句，读的人好判断「差一点」是什么样子
    const 行 = (b) => b.toString("utf8").split("\n").length;
    ok("行数相同（" + 行(甲) + "）", 行(甲) === 行(乙));
  }
  fs.rmSync(临, { recursive: true, force: true });
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
