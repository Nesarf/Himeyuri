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
const 程序 = 合并程序(unit.order.map((文件) => 编译模块(unit.modules.get(文件))));
// 入口文件的 main 覆盖别人那一份 —— 与 tools/emit-code.mjs 里同一条规则。
// 为什么需要这一句：合并的规矩是「重名先到者赢」，而 import 的顺序是依赖在前，
// 于是 self/lex.hmyr 的自测 main 会抢走入口的 main。症状是「跑起来没输出、退出码 19」，
// 19 是那个自测数出来的词数，与语言服务器毫无关系。
{
  const 入口名 = unit.order[unit.order.length - 1];
  const 入口函 = 编译模块(unit.modules.get(入口名)).函数们.get("main");
  程序.函数们.set("main", 入口函);
}
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
      { jsonrpc: "2.0", method: "didOpen", params: { textDocument: { uri: "file:///t.hmyr", languageId: "hmyr", version: 1, text: 源码 } } },
      { jsonrpc: "2.0", id: 2, method: "documentSymbol", params: { textDocument: { uri: "file:///t.hmyr" } } },
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
    ok("能力里说会列符号", 出.includes('"documentSymbolProvider":true'), "");
    ok("三回话（初始化、符号、关闭）", 出.split("Content-Length:").length - 1 === 3, String(出.split("Content-Length:").length - 1));
    ok("没有一行不通过", !出.includes("不通过"), "");

    console.log("三、列符号：didOpen 送来的文档里两个函数都列得出");
    ok("第一个函数列出来了", 出.includes('"name":"一"'), JSON.stringify(出.slice(-120)));
    ok("第二个函数列出来了", 出.includes('"name":"二"'), "");
    ok("符号的类是函数（12）", 出.includes('"kind":12'), "");

    console.log("四、Content-Length 数的是字节，不是码元");
    {
      // 一条一条拆：头是 Content-Length: N，随后空行，随后 N 字节。
      let at = 0;
      let 条数 = 0;
      let 全对 = true;
      while (at < 出.length) {
        const 头 = /^Content-Length: (\d+)\r\n\r\n/.exec(出.slice(at));
        if (!头) break;
        const n = Number(头[1]);
        const 体 = Buffer.from(出.slice(at + 头[0].length), "utf8");
        const 实 = Buffer.byteLength(体.subarray(0, n).toString("utf8"));
        if (Buffer.byteLength(体.subarray(0, n).toString("utf8")) !== n) 全对 = false;
        at += 头[0].length + 体.subarray(0, n).length;
        条数++;
      }
      ok("两条回话的长度都按字节算", 全对 && 条数 >= 2, String(条数));
      // 回话里有中文时，字节数必须大于码元数 —— 那正是这一节存在的理由。
      ok("含中文的回话字节数大于码元数", Buffer.byteLength(出) > 出.length, Buffer.byteLength(出) + " 对 " + 出.length);
    }
  }
  fs.rmSync(临, { recursive: true, force: true });
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
