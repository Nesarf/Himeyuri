// 出口的第三个用法：命名管道。
//
// 「出口可替换」这条规矩有三个用法，前两个是标准流与 --out 那个文件。第三个是管道：
// 程序不必知道自己被谁接走 —— 谁在管道那头听是调用方的事，而语言侧写的仍是 print("...")。
//
// 这一套验两件事：
//   一、写进管道的内容，管道那头收得到（而且末尾不丢 —— 那是异步关闭最容易出的错）
//   二、连不上时出声，而不是把 print 静静丢掉
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-pipe-"));
const 源码 = [
  "fn main() -> Int {",
  '  print("第一行")',
  '  print("\\n")',
  '  print("第二行")',
  '  print("\\n")',
  "  return 0",
  "}",
  "",
].join("\n");
const 源路 = path.join(临, "hello.hmoca");
fs.writeFileSync(源路, 源码, "utf8");

// 管道的名字：Windows 走 \\.\pipe\，别的机器上是一个 socket 路径。
const 名字 = process.platform === "win32"
  ? "\\\\.\\pipe\\hmyr-test-" + process.pid + "-" + Math.random().toString(36).slice(2)
  : path.join(临, "p.sock");

console.log("一、print 写进命名管道，那头收得到");
{
  await new Promise((resolve) => {
    const 收到 = [];
    const 服务端 = net.createServer((sock) => {
      sock.on("data", (b) => 收到.push(b));
      sock.on("end", () => {
        服务端.close();
        const 出 = Buffer.concat(收到).toString("utf8");
        // 末尾那一个 0 是自举层打印的目标程序返回值（self/run.hmoca 一直这么做），不是多余的。
        ok("管道那头收到了两行", 出.startsWith("第一行\n第二行\n"), JSON.stringify(出));
        ok("末尾那一行没有丢", 出.includes("第二行\n"), JSON.stringify(出.slice(-12)));
        ok("程序返回值也走同一个出口", 出.trimEnd().endsWith("0"), JSON.stringify(出));
        resolve();
      });
    });
    服务端.on("error", (err) => { ok("管道服务端起得来", false, String(err && err.message)); resolve(); });
    服务端.listen(名字, () => {
      const 子 = spawn(process.execPath, [path.join(ROOT, "bin/hmyr.mjs"), 源路, "--pipe", 名字], { cwd: ROOT, stdio: ["ignore", "ignore", "pipe"] });
      let 错 = "";
      子.stderr.on("data", (b) => { 错 += String(b); });
      子.on("exit", (码) => {
        ok("hmyr 退出码是 0", 码 === 0, String(码) + " " + 错.slice(0, 100));
        // 服务端那边靠 end 收尾；若 hmyr 没关管道，这里兜底。
        setTimeout(() => { try { 服务端.close(); } catch { /* 已经关了 */ } resolve(); }, 1500);
      });
    });
  });
}

console.log("二、连不上时出声，而不是把输出丢掉");
{
  const 不存在 = process.platform === "win32"
    ? "\\\\.\\pipe\\hmyr-no-such-" + process.pid
    : path.join(临, "no-such.sock");
  const r = spawnSync(process.execPath, [path.join(ROOT, "bin/hmyr.mjs"), 源路, "--pipe", 不存在], { encoding: "utf8", cwd: ROOT, timeout: 20000 });
  const 话 = String(r.stderr || "");
  ok("退出码是 2（出口没有去处时的那个约定）", r.status === 2, String(r.status));
  // 只看「含有编号」是不够的：Node 打 ReferenceError 的堆栈时会把那一行源码一起打出来，
  // 编号就藏在源码文本里，于是断言会假通过。这里改成看第一行、并且明说不许有堆栈。
  ok("stderr 的第一行就是那条消息", 话.split("\n")[0].includes("HMYR-詞-003"), JSON.stringify(话.slice(0, 80)));
  ok("而且没有堆栈混在里面", !话.includes("ReferenceError") && !话.includes("    at "), JSON.stringify(话.slice(0, 200)));
}

console.log("三、标准流那个出口没被弄坏");
{
  const r = spawnSync(process.execPath, [path.join(ROOT, "bin/hmyr.mjs"), 源路], { encoding: "utf8", cwd: ROOT, timeout: 60000 });
  ok("不给 --pipe 时仍然写到标准流", String(r.stdout || "").includes("第一行"), JSON.stringify(String(r.stdout || "").slice(0, 40)));
}

fs.rmSync(临, { recursive: true, force: true });
console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
