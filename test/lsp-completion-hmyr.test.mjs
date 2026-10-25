// 语言服务器的补全：HMYR 那一份与 src/lsp.mjs 对同一份文档必须交出同一张候选表。
//
// 两边都用真进程跑，与 lspsymbol 那套同一条路：宿主是 node src/lsp.mjs --stdio，
// 自举那一边是 C 那台的 exe 跑 self/lsp.hmyr 编出来的字节码。
// 只比 completion 那一条应答的全貌 —— initialize 里的版本号本来就不同，不该拿它当差异。
//
// 一条容易错的地方：补全的 kind 用 CompletionItemKind（函数是 3），
// 而 documentSymbol 的 kind 用 SymbolKind（函数是 12）。两张表各自成立。
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label + (detail ? "  " + detail : "")); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 源 = [
  "fn 一(a: Int) -> Int {",
  "  return a",
  "}",
  "",
  "fn 二() -> Int {",
  "  return 2",
  "}",
  "",
].join("\n");
const 地址 = "file:///tmp/probe.hmyr";

const 消息们 = [
  { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
  { jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { uri: 地址, languageId: "hmyr", version: 1, text: 源 } } },
  { jsonrpc: "2.0", id: 2, method: "textDocument/completion", params: { textDocument: { uri: 地址 }, position: { line: 0, character: 0 } } },
  { jsonrpc: "2.0", id: 3, method: "shutdown", params: {} },
  { jsonrpc: "2.0", method: "exit", params: {} },
];

const 装框 = (m) => {
  const body = Buffer.from(JSON.stringify(m), "utf8");
  return Buffer.concat([Buffer.from("Content-Length: " + body.length + "\r\n\r\n", "utf8"), body]);
};
const 输入 = Buffer.concat(消息们.map(装框));

const 拆应答 = (buf) => {
  const 出 = new Map();
  let b = buf;
  for (;;) {
    const end = b.indexOf("\r\n\r\n");
    if (end < 0) break;
    const m = /Content-Length:\s*(\d+)/i.exec(b.slice(0, end).toString("utf8"));
    if (!m) break;
    const start = end + 4;
    const len = Number(m[1]);
    if (b.length < start + len) break;
    const body = b.slice(start, start + len).toString("utf8");
    b = b.slice(start + len);
    try { const j = JSON.parse(body); if (j && j.id !== undefined) 出.set(j.id, j); } catch { /* 跳过 */ }
  }
  return 出;
};

const 有编译器 = (() => {
  try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();

if (!有编译器) {
  console.log("  跳过  这台机器上没有 gcc —— 自举那一边跑不起来");
  process.exit(0);
}

// 临时目录留在非系统盘（与 package.test.mjs 同一条约定）。
const 临 = fs.mkdtempSync("E:/DaShaoHuo/cache/tmp/hmyr-lspcomp-");
const exe = path.join(临, "hmyr.exe");
const 编r = spawnSync("gcc", ["-std=c11", "-O2", "-Wall", "-Wl,--stack,67108864", "-o", exe, path.join(ROOT, "vm/hmyr.c"), "-lm"], { encoding: "utf8" });
ok("C 那台编得动", 编r.status === 0, String(编r.stderr || "").slice(0, 120));

const 码路 = path.join(临, "lsp.hmyrb");
const 码r = spawnSync(process.execPath, [path.join(ROOT, "tools/emit-code.mjs"), path.join(ROOT, "self/lsp.hmyr"), 码路], { encoding: "utf8" });
ok("self/lsp.hmyr 编得出字节码", 码r.status === 0 && fs.existsSync(码路), String(码r.stderr || "").slice(0, 120));

console.log("一、宿主那一份的应答");
const 宿 = spawnSync(process.execPath, [path.join(ROOT, "src/lsp.mjs"), "--stdio"], { input: 输入, encoding: "buffer", timeout: 60000 });
const 宿答 = 拆应答(宿.stdout);
ok("拿到了 completion 的应答", 宿答.has(2), String(宿.status));
const 宿补 = 宿答.get(2) && 宿答.get(2).result ? 宿答.get(2).result : null;

console.log("二、自举那一份的应答");
const 自 = spawnSync(exe, [码路], { input: 输入, encoding: "buffer", timeout: 120000 });
const 自答 = 拆应答(自.stdout);
ok("拿到了 completion 的应答", 自答.has(2), String(自.status) + " " + String(自.stderr || "").slice(0, 120));
const 自补 = 自答.get(2) && 自答.get(2).result ? 自答.get(2).result : null;
if (!自补) console.log("    自举那一侧回的整条：" + JSON.stringify(自答.get(2) || null).slice(0, 300));

console.log("三、两张表相同");
{
  const 正 = (v) => (v === null || v === undefined ? "" : JSON.stringify(v));
  ok("两边都交回一个补全列表", !!宿补 && !!自补 && Array.isArray(宿补.items) && Array.isArray(自补.items),
    (宿补 ? "宿主有" : "宿主没有") + " 对 " + (自补 ? "自举有" : "自举没有"));
  ok("两边都说 isIncomplete 是假", 宿补 && 自补 && 宿补.isIncomplete === false && 自补.isIncomplete === false,
    (宿补 ? String(宿补.isIncomplete) : "?") + " 对 " + (自补 ? String(自补.isIncomplete) : "?"));
  ok("候选个数相同", !!宿补 && !!自补 && 宿补.items.length === 自补.items.length,
    (宿补 && 宿补.items ? 宿补.items.length : "?") + " 对 " + (自补 && 自补.items ? 自补.items.length : "?"));
  let 第一处 = "";
  if (宿补 && 自补 && Array.isArray(宿补.items) && Array.isArray(自补.items)) {
    for (let i = 0; i < Math.max(宿补.items.length, 自补.items.length); i++) {
      const a = 宿补.items[i], b = 自补.items[i];
      if (!a || !b) { 第一处 = "第 " + i + " 条只在一边"; break; }
      if (a.label !== b.label || a.kind !== b.kind || a.detail !== b.detail) {
        第一处 = "第 " + i + " 条：宿主 " + 正(a).slice(0, 100) + " · 自举 " + 正(b).slice(0, 100);
        break;
      }
    }
  }
  ok("每一项的 label、kind、detail 都一样", 第一处 === "", 第一处);
  // 两张表不可混用：补全的 kind 是 CompletionItemKind，函数在这一张表里是三。
  ok("函数在补全表里是三，不是 documentSymbol 的十二",
    !!宿补 && Array.isArray(宿补.items) && 宿补.items.length > 0 && 宿补.items.every((x) => x.kind === 3),
    JSON.stringify(宿补 && 宿补.items ? 宿补.items.map((x) => x.kind) : null));
}

console.log("四、能力声明里都报了补全");
{
  const 宿能 = 宿答.get(1) && 宿答.get(1).result ? 宿答.get(1).result.capabilities : null;
  const 自能 = 自答.get(1) && 自答.get(1).result ? 自答.get(1).result.capabilities : null;
  ok("宿主声明了 completionProvider", !!(宿能 && 宿能.completionProvider));
  ok("自举也声明了 completionProvider", !!(自能 && 自能.completionProvider), 自能 ? Object.keys(自能).join(",") : "（没有 capabilities）");
}

fs.rmSync(临, { recursive: true, force: true });

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
