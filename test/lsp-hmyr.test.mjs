// HMYR 写的语言服务器：JSON-RPC 走标准输入与标准输出。
//
// 它现在会两件事：握手（initialize / shutdown / exit）与列符号（didOpen 之后
// documentSymbol）。列符号靠的是自举侧那一套前端 —— self/sig.hmyr 的 all_signatures，
// 读的是真正的 token 流，不是在编辑器插件里另养一个解析器。
//
// 一条边界钉在这里：Content-Length 数的是字节。回话里一旦出现中文，
// 字节数与码元数就不再相等 —— 所以正文里既有中文又有断言。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadUnit } from "../src/loader.mjs";
import { 编译模块, 合并程序 } from "../src/bytecode.mjs";
import { 写程序 } from "../src/code-file.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

console.log("一、语言服务器的源码读得动");
const 源路 = path.join(ROOT, "self/lsp.hmyr");
ok("self/lsp.hmyr 在", fs.existsSync(源路));
const unit = loadUnit(源路);
ok("加载没有诊断", unit.ok, JSON.stringify(unit.diagnostics.errors.slice(0, 1).map((e) => e.code)));
const 份们 = unit.order.map((文件) => 编译模块(unit.modules.get(文件)));
// 入口 main 覆盖别人那一份 —— 这条规矩在 合并程序 里，不再由每个调用者各抄一遍。
const 程序 = 合并程序(份们, 份们[份们.length - 1]);
ok("它把前端与 JSON 库都带了进来", 程序.函数们.size > 60, String(程序.函数们.size));

const 有编译器 = (() => {
  try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();

console.log("二、握手：initialize / shutdown / exit");
if (!有编译器) {
  console.log("  跳过  这台机器上没有 gcc");
} else {
  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-lsp-"));
  const exe = path.join(临, "hmyr.exe");
  const c = spawnSync("gcc", ["-std=c11", "-O2", "-Wall", "-Wl,--stack,67108864", "-o", exe, path.join(ROOT, "vm/hmyr.c"), "-lm"], { encoding: "utf8" });
  ok("C 那台编得出来", c.status === 0, String(c.stderr).slice(0, 160));
  if (c.status === 0) {
    const 码路 = path.join(临, "lsp.hmyrb");
    fs.writeFileSync(码路, 写程序(程序));
    const 源码 = "fn 一() -> Int {\n  return 1\n}\n\nfn 二() -> Int {\n  return 2\n}\n";
    const 消息们 = [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { uri: "file:///t.hmyr", languageId: "hmyr", version: 1, text: 源码 } } },
      { jsonrpc: "2.0", id: 2, method: "textDocument/documentSymbol", params: { textDocument: { uri: "file:///t.hmyr" } } },
      { jsonrpc: "2.0", id: 3, method: "textDocument/definition", params: { textDocument: { uri: "file:///t.hmyr" }, position: { line: 0, character: 3 } } },
      { jsonrpc: "2.0", id: 4, method: "textDocument/hover", params: { textDocument: { uri: "file:///t.hmyr" }, position: { line: 0, character: 3 } } },
      { jsonrpc: "2.0", id: 3, method: "shutdown" },
      { jsonrpc: "2.0", method: "exit" },
    ];
    const 输入 = 消息们.map((m) => {
      const 体 = JSON.stringify(m);
      return "Content-Length: " + Buffer.byteLength(体) + "\r\n\r\n" + 体;
    }).join("");
    const r = spawnSync(exe, [码路], {
      input: 输入, encoding: "utf8", timeout: 120000,
      env: { ...process.env, HMYR_STEPS: "2000000000" },
    });
    ok("它跑完了（exit 之后自己停）", r.status === 0, String(r.status) + " " + String(r.stderr).slice(0, 160));
    const 出 = String(r.stdout || "");
    ok("回话带着 Content-Length 头", 出.includes("Content-Length: "), JSON.stringify(出.slice(0, 80)));
    ok("第一条回的是 initialize 的能力", 出.includes('"capabilities"') && 出.includes('"id":1'), "");
    ok("能力里说会列符号、给定义、给悬浮", 出.includes('"documentSymbolProvider":true') && 出.includes('"definitionProvider":true') && 出.includes('"hoverProvider":true'), "");
    ok("五回话（初始化、符号、定义、悬浮、关闭）", 出.split("Content-Length:").length - 1 === 5, String(出.split("Content-Length:").length - 1));
    ok("没有一行不通过", !出.includes("不通过"), "");

    console.log("三、列符号：didOpen 送来的文档里两个函数都列得出");
    ok("第一个函数列出来了", 出.includes('"name":"一"'), JSON.stringify(出.slice(-120)));
    ok("第二个函数列出来了", 出.includes('"name":"二"'), "");
    ok("符号的类是函数（12）", 出.includes('"kind":12'), "");

    console.log("四、定义：指着名字问，答的是它声明在哪儿");
    {
      ok("定义答了，而且指向名字那一格", 出.includes('"id":3') && 出.includes('"start":{"line":0,"character":3}') && 出.includes('"end":{"line":0,"character":4}'), JSON.stringify(出.slice(0, 400)));
      ok("定义带着文档地址", 出.includes('"uri":"file:///t.hmyr"'), "");
    }

    console.log("五、悬浮：指着名字问，答的是一行签名");
    {
      ok("悬浮答了", 出.includes('"id":4'), "");
      ok("签名排成一行", 出.includes('"value":"fn 一() -> Int"'), JSON.stringify(出.slice(-200)));
    }

        console.log("四、Content-Length 数的是字节，不是码元");
    {
      // 按字节切开：头是 Content-Length: N，随后空行，随后正好 N 字节的体 ——
      // 而那个体必须能单独解析成 JSON。这一条是实的：如果 N 按码元算（偏小），
      // 切开来的体就是半截 JSON，JSON.parse 会当场拒绝。
      const 全字节 = Buffer.from(出, "utf8");
      let at = 0;
      let 条数 = 0;
      let 全对 = true;
      let 第一处 = "";
      while (at < 全字节.length) {
        const 头文 = 全字节.subarray(at, Math.min(at + 80, 全字节.length)).toString("utf8");
        const m = /^Content-Length: (\d+)\r\n\r\n/.exec(头文);
        if (!m) { 全对 = false; 第一处 = "第 " + 条数 + " 条之后找不到头"; break; }
        const n = Number(m[1]);
        const 体起 = at + Buffer.byteLength(m[0], "utf8");
        const 体 = 全字节.subarray(体起, 体起 + n);
        if (体.length !== n) { 全对 = false; 第一处 = "第 " + 条数 + " 条短了"; break; }
        try { JSON.parse(体.toString("utf8")); } catch (e) { 全对 = false; 第一处 = "第 " + 条数 + " 条不是完整 JSON"; break; }
        at = 体起 + n;
        条数++;
      }
      ok("五条回话都按字节切开、每条都是完整 JSON", 全对 && 条数 === 5, 第一处 + " 条数=" + 条数);
      ok("含中文的回话字节数大于码元数", Buffer.byteLength(出) > 出.length, Buffer.byteLength(出) + " 对 " + 出.length);
    }
  }
  fs.rmSync(临, { recursive: true, force: true });
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
