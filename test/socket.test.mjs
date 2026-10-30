// 出口的第四个用法：socket。
//
// 前三个用法是标准流、--out 那个文件、--pipe 那条命名管道。第四个是 socket，
// 而它是四个里唯一一个能连到另一台机器的，所以它默认不开 —— 理由写在 design/RELAY.txt。
//
// 这一套验五件事：
//   一、TCP 那头收到两行，按顺序，末尾那一行没丢（异步关闭最容易丢的就是末尾）
//   二、程序返回值也走同一个出口（--pipe 已经这么做，socket 要一样）
//   三、连不上时出声，而不是把 print 静静丢掉
//   四、形状写错时也出声 —— 若退回标准流，就等于静默丢输出
//   五、不给 --socket 时，标准流那条路没被弄坏
//
// 另加一件：pipe: 前缀真的连得上命名管道。命名管道那套机制（谁等谁、end 之后怎么收尾）
// 在 test/pipe.test.mjs 里已经逐项验过，这里只验这一条前缀认得出名字，不重复验同一件事。
//
// unix: 那一支不在这里验：Windows 上 Node 没有 Unix 域套接字，而这台机器是 Windows；
// 在 POSIX 上它与 pipe: 走的是同一行 net.connect（只是名字不同）。于是这里跳过它，
// 而不是写一个必然不通过的用例，让「验过」这三个字变得不可信。
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 启动器 = path.join(ROOT, "bin/hmyr.mjs");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-socket-"));
const 源路 = path.join(临, "hello.hmoca");
// 返回值用 7，不用 0：0 与「退出码是 0」读起来会混，而这两件事这里要分开验。
fs.writeFileSync(源路, [
  "fn main() -> Int {",
  '  print("第一行")',
  '  print("\\n")',
  '  print("第二行")',
  '  print("\\n")',
  "  return 7",
  "}",
  "",
].join("\n"), "utf8");

// 起一个只听 127.0.0.1 的服务端，端口让内核给（写死端口迟早会撞上别的东西）。
// 「结束」是一个随时可以 await 的 Promise：那头收完并关掉之后，它就是收到的全部文本。
const 起服务端 = () => {
  const 收到 = [];
  let 交 = null;
  const 结束 = new Promise((r) => { 交 = r; });
  const 服务端 = net.createServer((sock) => {
    sock.on("data", (b) => 收到.push(b));
    sock.on("end", () => {
      try { 服务端.close(); } catch { /* 已经关了 */ }
      交(Buffer.concat(收到).toString("utf8"));
    });
  });
  return new Promise((resolve, reject) => {
    服务端.on("error", reject);
    服务端.listen(0, "127.0.0.1", () => {
      resolve({
        端口: 服务端.address().port,
        结束,
        关: () => { try { 服务端.close(); } catch { /* 已经关了 */ } },
      });
    });
  });
};

// 跑一次启动器，等它退出。二十秒是兜底：没有它，一个卡住的子进程会让整套挂死，
// 那比报一条不通过更难查。
const 跑 = (参数们) => new Promise((resolve) => {
  const 子 = spawn(process.execPath, [启动器, 源路, ...参数们], { cwd: ROOT, stdio: ["ignore", "ignore", "pipe"] });
  let 错 = "";
  子.stderr.on("data", (b) => { 错 += String(b); });
  const 记 = setTimeout(() => { try { 子.kill(); } catch { /* 已经退了 */ } }, 20000);
  子.on("exit", (码) => { clearTimeout(记); resolve({ 码, 错 }); });
});

// 等那头收完，但不干等到天荒地老；超时交回 undefined，由用例报不通过。
const 等结束 = (结束) => Promise.race([
  结束,
  new Promise((r) => { const t = setTimeout(() => r(undefined), 20000); t.unref(); }),
]);

console.log("一、print 写进 socket，那头收得到");
{
  const 服务 = await 起服务端();
  const 子 = 跑(["--socket", "tcp:127.0.0.1:" + 服务.端口]);
  const 文本 = await 等结束(服务.结束);
  const 果 = await 子;
  const 出 = typeof 文本 === "string" ? 文本 : "";
  ok("两行按顺序到达", 出.startsWith("第一行\n第二行\n"), JSON.stringify(出));
  ok("末尾那一行没有丢", 出.includes("第二行\n"), JSON.stringify(出.slice(-16)));
  ok("程序返回值也走同一个出口", 出.trimEnd().endsWith("7"), JSON.stringify(出.slice(-16)));
  ok("hmyr 退出码是 0", 果.码 === 0, String(果.码) + " " + 果.错.slice(0, 80));
  if (typeof 文本 !== "string") 服务.关();
}

console.log("二、连不上时出声，而不是把输出丢掉");
{
  // 先占一个端口再放掉，这样「刚才确实没有人在听」是这一条用例自己造出来的事实，
  // 而不是对某个编号的猜测。一百毫秒是给 close 落地的时间，少了会偶尔连到正在关的监听上。
  const 占 = await 起服务端();
  const 空位 = 占.端口;
  占.关();
  await new Promise((r) => setTimeout(r, 100));
  const 果 = await 跑(["--socket", "tcp:127.0.0.1:" + 空位]);
  ok("退出码是 2", 果.码 === 2, String(果.码));
  // 看第一行、并且明说不许有堆栈：Node 打异常堆栈时会把那行源码一起打出来，
  // 编号就藏在源码文本里，于是「含有编号」这一条会假通过。
  ok("stderr 的第一行就是那条消息", 果.错.split("\n")[0].includes("HMYR-行-021"), JSON.stringify(果.错.slice(0, 80)));
  ok("消息里带着连不上的原因", /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|EACCES/.test(果.错), JSON.stringify(果.错.slice(0, 120)));
  ok("而且没有堆栈混在里面", !果.错.includes("    at ") && !果.错.includes("ReferenceError"), JSON.stringify(果.错.slice(0, 200)));
}

console.log("三、形状写错时也出声，而不是退回标准流");
{
  // 没有前缀的 "127.0.0.1:9" 是最容易犯的那种写法：它是 --pipe 的形状，不是 socket 的。
  const 果 = await 跑(["--socket", "127.0.0.1:9"]);
  ok("退出码是 2", 果.码 === 2, String(果.码));
  ok("stderr 里把三种形状念了一遍", 果.错.includes("HMYR-行-021") && 果.错.includes("tcp:"), JSON.stringify(果.错.slice(0, 120)));
  // 只写开关不给值：这一种最容易被当成「没给选项」而静默退回标准流。
  const 空 = await 跑(["--socket"]);
  ok("只写开关不给值时也出声", 空.码 === 2 && 空.错.split("\n")[0].includes("HMYR-行-021"), String(空.码) + " " + JSON.stringify(空.错.slice(0, 80)));
}

console.log("四、不给 --socket 时，标准流那个出口没被弄坏");
{
  const r = spawnSync(process.execPath, [启动器, 源路], { encoding: "utf8", cwd: ROOT, timeout: 60000 });
  ok("仍然写到标准流", String(r.stdout || "").includes("第一行"), JSON.stringify(String(r.stdout || "").slice(0, 40)));
  ok("返回值仍然在标准流末尾", String(r.stdout || "").trimEnd().endsWith("7"), JSON.stringify(String(r.stdout || "").slice(-16)));
}

console.log("五、pipe: 前缀认得出命名管道的名字");
{
  const 名 = process.platform === "win32"
    ? "\\\\.\\pipe\\hmyr-socket-test-" + process.pid + "-" + Math.random().toString(36).slice(2)
    : path.join(临, "p.sock");
  await new Promise((resolve) => {
    const 收到 = [];
    const 服务端 = net.createServer((sock) => {
      sock.on("data", (b) => 收到.push(b));
      sock.on("end", () => {
        const 出 = Buffer.concat(收到).toString("utf8");
        try { 服务端.close(); } catch { /* 已经关了 */ }
        ok("pipe: 前缀连得上", 出.startsWith("第一行\n"), JSON.stringify(出.slice(0, 20)));
        resolve();
      });
    });
    服务端.on("error", (err) => { ok("命名管道服务端起得来", false, String(err && err.message)); resolve(); });
    服务端.listen(名, () => {
      跑(["--socket", "pipe:" + 名]).then((果) => {
        ok("管道那条也退出 0", 果.码 === 0, String(果.码) + " " + 果.错.slice(0, 80));
        // 服务端靠 end 收尾；若 hmyr 那边没关干净，这里兜底，免得整套挂在等一个不来的事件上。
        setTimeout(() => { try { 服务端.close(); } catch { /* 已经关了 */ } resolve(); }, 3000).unref();
      });
    });
  });
}

fs.rmSync(临, { recursive: true, force: true });
console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
