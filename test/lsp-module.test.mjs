// 语言服务器的跨模块跳转：本地找不到的名字，按 import 语句去目标文件里找。
//
// 三段都要钉住：
//   一、本地声明优先 —— 同名符号优先离得近的那一个，这是编辑器的常识
//   二、本地没有、import 里有 —— 应答的 uri 必须指向那个文件
//   三、哪边都没有 —— 交回 null，不是交回一个错
//
// 这里用的是两份真文件：base.hmyr import 了 other.hmyr，并调用里面的函数。
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label + (detail ? "  " + detail : "")); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

// 临时目录留在非系统盘。
const 临 = fs.mkdtempSync("E:/DaShaoHuo/cache/tmp/hmyr-lspmod-");
const 别路 = path.join(临, "other.hmyr");
const 基路 = path.join(临, "base.hmyr");
fs.writeFileSync(别路, "fn 别的(a: Int) -> Int {\n  return a\n}\n");
fs.writeFileSync(基路, "import \"./other.hmyr\"\n\nfn 本地的() -> Int {\n  return 别的(1)\n}\n");
const 基址 = pathToFileURL(基路).href;
const 别址 = pathToFileURL(别路).href;

const 装框 = (m) => {
  const body = Buffer.from(JSON.stringify(m), "utf8");
  return Buffer.concat([Buffer.from("Content-Length: " + body.length + "\r\n\r\n", "utf8"), body]);
};
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

const 消息们 = [
  { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
  { jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { uri: 基址, languageId: "hmyr", version: 1, text: fs.readFileSync(基路, "utf8") } } },
  // 2：别的 —— 只在 other.hmyr 里
  { jsonrpc: "2.0", id: 2, method: "textDocument/definition", params: { textDocument: { uri: 基址 }, position: { line: 3, character: 9 } } },
  // 3：本地的 —— 只在 base.hmyr 里
  { jsonrpc: "2.0", id: 3, method: "textDocument/definition", params: { textDocument: { uri: 基址 }, position: { line: 2, character: 4 } } },
  // 4：哪边都没有
  { jsonrpc: "2.0", id: 4, method: "textDocument/definition", params: { textDocument: { uri: 基址 }, position: { line: 3, character: 13 } } },
  { jsonrpc: "2.0", id: 5, method: "shutdown", params: {} },
  { jsonrpc: "2.0", method: "exit", params: {} },
];

const 宿 = spawnSync(process.execPath, [path.join(ROOT, "src/lsp.mjs"), "--stdio"], {
  input: Buffer.concat(消息们.map(装框)), encoding: "buffer", timeout: 60000,
});
const 答 = 拆应答(宿.stdout);
ok("拿到了三条 definition 的应答", 答.has(2) && 答.has(3) && 答.has(4), String(宿.status));

console.log("一、本地声明优先");
{
  const r = 答.get(3) && 答.get(3).result;
  ok("答了一个位置", !!r && !!r.uri, JSON.stringify(r).slice(0, 120));
  ok("指向当前这一份文件", r && r.uri === 基址, r ? r.uri : "（没有）");
  ok("行号是声明那一行（零基）", r && r.range && r.range.start.line === 2, r && r.range ? String(r.range.start.line) : "（没有）");
}

console.log("二、import 里的名字跳到那个文件");
{
  const r = 答.get(2) && 答.get(2).result;
  ok("答了一个位置", !!r && !!r.uri, JSON.stringify(r).slice(0, 120));
  ok("指向 other.hmyr", r && r.uri === 别址, r ? r.uri : "（没有）");
  ok("行号是那份文件里的声明行（零基 0）", r && r.range && r.range.start.line === 0, r && r.range ? String(r.range.start.line) : "（没有）");
}

console.log("三、哪边都没有：交回 null，不是交回一个错");
{
  const r = 答.get(4);
  ok("有一条应答", !!r, JSON.stringify(r).slice(0, 120));
  ok("result 是 null", r && r.result === null, JSON.stringify(r && r.result));
  ok("没有 error 字段", r && !r.error, JSON.stringify(r && r.error));
}

console.log("四、自举那一份也跳得过去");
{
  // 这一份跑在 C 那台上，所以先要一个编译器。没有就跳过这一段，前三段照跑。
  const 有编译器 = (() => {
    try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; }
  })();
  if (!有编译器) {
    console.log("  跳过  这台机器上没有 gcc —— 自举那一边跑不起来");
  } else {
    const 临二 = fs.mkdtempSync("E:/DaShaoHuo/cache/tmp/hmyr-lspmod-c-");
    const exe = path.join(临二, "hmyr.exe");
    const 编r = spawnSync("gcc", ["-std=c11", "-O2", "-Wall", "-Wl,--stack,67108864", "-o", exe, path.join(ROOT, "vm/hmyr.c"), "-lm"], { encoding: "utf8" });
    ok("C 那台编得动", 编r.status === 0, String(编r.stderr || "").slice(0, 120));

    const 码路 = path.join(临二, "lsp.hmyrb");
    const 码r = spawnSync(process.execPath, [path.join(ROOT, "tools/emit-code.mjs"), path.join(ROOT, "self/lsp.hmyr"), 码路], { encoding: "utf8" });
    ok("self/lsp.hmyr 编得出字节码", 码r.status === 0 && fs.existsSync(码路), String(码r.stderr || "").slice(0, 160));

    const 自 = spawnSync(exe, [码路], { input: Buffer.concat(消息们.map(装框)), encoding: "buffer", timeout: 120000 });
    const 自答 = 拆应答(自.stdout);
    ok("自举拿到了三条应答", 自答.has(2) && 自答.has(3) && 自答.has(4),
      String(自.status) + " " + String(自.stderr || "").slice(0, 120));

    const b = 自答.get(2) && 自答.get(2).result;
    ok("自举从 import 里跳到了 other.hmyr", !!b && b.uri === 别址, b ? b.uri : "（没有）");
    ok("自举那边的行号也是那份文件里的声明行", b && b.range && b.range.start.line === 0,
      b && b.range ? String(b.range.start.line) : "（没有）");

    const c = 自答.get(3) && 自答.get(3).result;
    ok("自举的本地优先也成立", !!c && c.uri === 基址, c ? c.uri : "（没有）");

    const d = 自答.get(4);
    ok("自举哪边都没有时也给 null", !!d && d.result === null, JSON.stringify(d && d.result));

    fs.rmSync(临二, { recursive: true, force: true });
  }
}

fs.rmSync(临, { recursive: true, force: true });

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
