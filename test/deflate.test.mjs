// deflate 的第一种形式：stored 块（RFC 1951 的 BTYPE=00）。
//
// 它不压 —— 压缩率是 1.0 加五个字节的头。但格式是真的 deflate：两份方向都跑得通，
// 而标准工具（node 的 zlib）不用被交代什么就能读。这就是打包发布缺的那一件。
//
// 验收四条：往返一致、zlib 解得开、空输入也有一个合法的块、以及压缩比写着 1.0（不许假装）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
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

console.log("一、工具的源码读得动");
const 源路 = path.join(ROOT, "self/deflate.hmyr");
ok("self/deflate.hmyr 在", fs.existsSync(源路));
const unit = loadUnit(源路);
ok("加载没有诊断", unit.ok, JSON.stringify(unit.diagnostics.errors.slice(0, 1).map((e) => e.code)));
const 程序 = 合并程序(unit.order.map((文件) => 编译模块(unit.modules.get(文件))), 编译模块(unit.modules.get(unit.order[unit.order.length - 1])));
ok("它编出了函数表", 程序.函数们.size >= 5, String(程序.函数们.size));

const 有编译器 = (() => {
  try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();

console.log("二、往返：压了再解，一个字节都不差");
if (!有编译器) {
  console.log("  跳过  这台机器上没有 gcc");
} else {
  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-deflate-"));
  const exe = path.join(临, "hmyr.exe");
  const c = spawnSync("gcc", ["-std=c11", "-O2", "-Wall", "-Wl,--stack,67108864", "-o", exe, path.join(ROOT, "vm/hmyr.c"), "-lm"], { encoding: "utf8" });
  ok("C 那台编得出来", c.status === 0, String(c.stderr).slice(0, 160));
  if (c.status === 0) {
    const 码路 = path.join(临, "deflate.hmyrb");
    fs.writeFileSync(码路, 写程序(程序));
    const 跑 = (参) => spawnSync(exe, [码路, ...参], {
      encoding: "utf8", timeout: 300000,
      env: { ...process.env, HMYR_STEPS: "4000000000" },
    });
    const 源 = path.join(ROOT, "bootstrap/pack.hmyrb");
    const 压出 = path.join(临, "pack.deflate");
    const 解出 = path.join(临, "pack.roundtrip");
    const a = 跑([源, 压出]);
    ok("压得动", a.status === 0, String(a.status) + " " + String(a.stderr).slice(0, 160));
    const b = 跑([压出, 解出, "--解"]);
    ok("解得动", b.status === 0, String(b.status) + " " + String(b.stderr).slice(0, 160));
    if (fs.existsSync(压出) && fs.existsSync(解出)) {
      const 原 = fs.readFileSync(源);
      const 回 = fs.readFileSync(解出);
      ok("往返逐字节一致", 原.length === 回.length && Buffer.compare(原, 回) === 0, 原.length + " 对 " + 回.length);
      const 压 = fs.readFileSync(压出);
      ok("压缩比写着 1.0（多出来的只是五个字节的块头）", 压.length === 原.length + 5, 压.length + " 对 " + 原.length);
      console.log("三、标准工具读得懂这个流");
      try {
        const 借 = zlib.inflateRawSync(压);
        ok("zlib 解得开", 借.length === 原.length && Buffer.compare(原, 借) === 0, String(借.length));
      } catch (e) {
        ok("zlib 解得开", false, e.message);
      }
    }
    console.log("四、空输入也是一个合法的块");
    {
      const 空 = path.join(临, "empty.bin");
      fs.writeFileSync(空, Buffer.alloc(0));
      const 空压 = path.join(临, "empty.deflate");
      const r = 跑([空, 空压]);
      ok("空输入压得动", r.status === 0, String(r.status));
      if (fs.existsSync(空压)) {
        const 流 = fs.readFileSync(空压);
        ok("空输入出来五个字节（一个空块）", 流.length === 5, String(流.length));
        try {
          const 借 = zlib.inflateRawSync(流);
          ok("zlib 解得出空", 借.length === 0, String(借.length));
        } catch (e) {
          ok("zlib 解得出空", false, e.message);
        }
      }
    }
  }
  fs.rmSync(临, { recursive: true, force: true });
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
