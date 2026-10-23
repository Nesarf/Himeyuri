// HMYR 写的语言服务器：JSON-RPC 走标准输入与标准输出。
//
// 这是工具链里最难的一项留给它的理由：它要的东西最多 —— 读一行（头）、
// 读 N 字节（体）、把字节解成文本、一个 JSON 库。四格都不在的时候它一步也走不了；
// 四格齐了之后，它只是一段分派。
//
// 现在它只回答「你是谁」与「关掉吧」。符号、定义、悬浮签名要读语法树，
// 而那件事该由自举侧那一套前端来做 —— 一件一件来。
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
ok("它把 JSON 库也带了进来", 程序.函数们.size > 30, String(程序.函数们.size));

const 有编译器 = (() => {
  try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();

console.log("二、它答得出 initialize，也关得掉");
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
    // 三条消息：初始化、关闭、退出。Content-Length 数的是字节。
    const 消息们 = [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", id: 2, method: "shutdown" },
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
    ok("第一条回的是 initialize 的能力", 出.includes('"capabilities"') && 出.includes('"id":1'), JSON.stringify(出.slice(0, 200)));
    ok("服务器名字写着", 出.includes('"himeyuri"'), "");
    ok("第二条回的是 shutdown 的空结果", 出.includes('"id":2') && 出.includes('"result":null'), "");
    ok("exit 不再回话（回话只有两条）", 出.split("Content-Length:").length === 3, String(出.split("Content-Length:").length - 1));
  }
  fs.rmSync(临, { recursive: true, force: true });
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
