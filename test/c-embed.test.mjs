// HMYR 被别人调用：design/EMBED.txt 第四节那个最小形状的可重复版本。
//
// 判据是两件事：一个 C 程序（test/c-embed.c）编得出来、调得到 HMYR 的函数；
// 而它拿到的值与 HMYR 自己跑同一份得到的一样。第二条比第一条重要 ——
// 「编得过」不说明调对了，而两个数字一样说明。
//
// 为什么这个套件要现编：那一侧是 C，而它不经过任何 JS。这一条与 ffi 那套的
// 第四节同一个理由。
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 缓存 = "E:\\DaShaoHuo\\cache\\tmp";
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 临 = fs.mkdtempSync(path.join(缓存, "hmyr-cembed-"));
const 有gcc = (() => {
  try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();

console.log("一、一个 C 程序调到 HMYR");
{
  if (!有gcc) {
    console.log("  跳过  这台机器上没有 gcc —— 嵌入那一侧不验");
  } else {
    const exe = path.join(临, "c-embed.exe");
    const 编 = spawnSync("gcc", ["-std=c11", "-O2", "-w", "-DHMYR_NO_MAIN", "-I", path.join(ROOT, "vm"),
      "-o", exe, path.join(ROOT, "test", "c-embed.c"), path.join(ROOT, "vm", "hmyr.c"), "-lm"],
      { encoding: "utf8" });
    ok("库模式编得出来", 编.status === 0, String(编.stderr || "").slice(0, 200));
    if (编.status === 0) {
      const 源 = path.join(临, "answer.hmoca");
      fs.writeFileSync(源, "fn main() -> Int {\n  return 42\n}\n", "utf8");
      const 码 = path.join(临, "answer.hmoks");
      const 编程序 = spawnSync(process.execPath, [path.join(ROOT, "tools", "emit-code.mjs"), 源, 码], { encoding: "utf8" });
      ok("程序编得出来", 编程序.status === 0, String(编程序.stderr || "").slice(0, 200));

      const 台 = spawnSync(exe, [码], { encoding: "utf8", timeout: 300000 });
      ok("宿主拿到 42", String(台.stdout || "").trim() === "42", JSON.stringify({ status: 台.status, out: (台.stdout || "").slice(0, 80), err: (台.stderr || "").slice(0, 120) }));

      // 第二条判据：HMYR 自己跑同一份，拿到的是同一个数（退出码就是 main 的返回值）。
      const 自己 = spawnSync(path.join(缓存, "hmyr-self", "hmyr.exe"), [码], { encoding: "utf8", timeout: 300000 });
      ok("HMYR 自己跑也是 42", 自己.status === 42, String(自己.status));

      // 三条失败各自要有一个退出码，而不是「跑挂了」。
      const 缺 = spawnSync(exe, [path.join(临, "missing.hmoks")], { encoding: "utf8" });
      ok("载入失败返回 2", 缺.status === 2, String(缺.status));
      const 无 = spawnSync(exe, [码, "no-such-function"], { encoding: "utf8" });
      ok("没有那个函数返回 3", 无.status === 3, String(无.status));
    }
  }
}

try { fs.rmSync(临, { recursive: true, force: true }); } catch { /* 删不掉就留着 */ }
console.log("");
console.log(passed + " passed, " + failed + " failed");
if (failed) process.exit(1);
