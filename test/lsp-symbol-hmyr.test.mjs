// 语言服务器的符号列表：HMYR 那一份与 src/lsp.mjs 对同一份文档必须交出同一张表。
//
// 两边都用真进程跑：宿主是 node src/lsp.mjs --stdio，自举那一边是 C 那台的 exe 跑
// self/lsp.hmyr 编出来的字节码。喂同样的四条消息，只比 documentSymbol 那一条应答 ——
// initialize 里的 serverInfo 名字本来就不同，不该拿它当差异。
import fs from "node:fs";
import os from "node:os";
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
  { jsonrpc: "2.0", id: 2, method: "textDocument/documentSymbol", params: { textDocument: { uri: 地址 } } },
  { jsonrpc: "2.0", id: 3, method: "shutdown", params: {} },
  { jsonrpc: "2.0", method: "exit", params: {} },
];

const 装框 = (m) => {
  const body = Buffer.from(JSON.stringify(m), "utf8");
  return Buffer.concat([Buffer.from("Content-Length: " + body.length + "\r\n\r\n", "utf8"), body]);
};
const 输入 = Buffer.concat(消息们.map(装框));

// 从一坨 stdout 里把所有应答取出来，按 id 索引
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

const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-lspsym-"));
const exe = path.join(临, "hmyr.exe");
const 编r = spawnSync("gcc", ["-std=c11", "-O2", "-Wall", "-Wl,--stack,67108864", "-o", exe, path.join(ROOT, "vm/hmyr.c"), "-lm"], { encoding: "utf8" });
ok("C 那台编得动", 编r.status === 0, String(编r.stderr || "").slice(0, 120));

const 码路 = path.join(临, "lsp.hmyrb");
const 码r = spawnSync(process.execPath, [path.join(ROOT, "tools/emit-code.mjs"), path.join(ROOT, "self/lsp.hmyr"), 码路], { encoding: "utf8" });
ok("self/lsp.hmyr 编得出字节码", 码r.status === 0 && fs.existsSync(码路), String(码r.stderr || "").slice(0, 120));

console.log("一、宿主那一份的应答");
const 宿 = spawnSync(process.execPath, [path.join(ROOT, "src/lsp.mjs"), "--stdio"], { input: 输入, encoding: "buffer", timeout: 60000 });
const 宿答 = 拆应答(宿.stdout);
ok("拿到了 documentSymbol 的应答", 宿答.has(2), String(宿.status));
const 宿符 = 宿答.get(2) ? 宿答.get(2).result : null;

console.log("二、自举那一份的应答");
const 自 = spawnSync(exe, [码路], { input: 输入, encoding: "buffer", timeout: 120000 });
const 自答 = 拆应答(自.stdout);
ok("拿到了 documentSymbol 的应答", 自答.has(2), String(自.status) + " " + String(自.stderr || "").slice(0, 120));
const 自符 = 自答.get(2) ? 自答.get(2).result : null;
if (!Array.isArray(自符)) console.log("    自举那一侧回的整条：" + JSON.stringify(自答.get(2) || null).slice(0, 300));

console.log("三、两张表相同");
{
  const 正 = (v) => (v === null || v === undefined ? "" : JSON.stringify(v));
  ok("符号个数相同", Array.isArray(宿符) && Array.isArray(自符) && 宿符.length === 自符.length,
    (宿符 ? 宿符.length : "?") + " 对 " + (自符 ? 自符.length : "?"));
  // 逐条比：名字、kind、location（containerName 宿主可能给 undefined，JSON 里干脆没有）
  let 第一处 = "";
  if (Array.isArray(宿符) && Array.isArray(自符)) {
    for (let i = 0; i < Math.max(宿符.length, 自符.length); i++) {
      const a = 宿符[i], b = 自符[i];
      if (a === undefined || b === undefined) { 第一处 = "第 " + i + " 条只在一边"; break; }
      const 同 = a.name === b.name && a.kind === b.kind
        && JSON.stringify(a.location) === JSON.stringify(b.location)
        && JSON.stringify(a.containerName ?? null) === JSON.stringify(b.containerName ?? null);
      if (!同) { 第一处 = "第 " + i + " 条：宿主 " + 正(a).slice(0, 110) + " · 自举 " + 正(b).slice(0, 110); break; }
    }
  }
  ok("每一条的名字、类别、位置都一样", 第一处 === "", 第一处);
}

fs.rmSync(临, { recursive: true, force: true });

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
