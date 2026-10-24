// deflate 的解码侧：自举侧的 inflate（固定 Huffman）。
//
// 三条验收，一条比一条硬：
//   小的        五个手工可算的样本（一个字节、两个字节、重复、交替、三重重复）
//   自家的      四 KB 样本，HMYR 压、HMYR 解，往返逐字节一致
//   别人的      zlib 用固定策略压出来的流，HMYR 也解得回原样 —— 只认自家产物不算互操作
//
// 最后一条是这一件真正的判据：位序与码表的理解若有一点偏，它会在别人的流上立刻现形。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadUnit } from "../tools/self-bridge.mjs";
import { 编译模块, 合并程序 } from "../src/bytecode.mjs";
import { 写程序 } from "../src/code-file.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 编一份 = (名) => {
  const u = loadUnit(path.join(ROOT, "self", 名 + ".hmyr"));
  if (!u.ok) return null;
  return 写程序(合并程序(u.order.map((f) => 编译模块(u.modules.get(f))), 编译模块(u.modules.get(u.order[u.order.length - 1]))));
};

console.log("一、两份工具的源码都读得动");
const 压码 = 编一份("deflate");
const 解码 = 编一份("inflate");
ok("self/deflate.hmyr 编得动", !!压码, "");
ok("self/inflate.hmyr 编得动", !!解码, "");

const 有编译器 = (() => {
  try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();

if (!有编译器) {
  console.log("  跳过  这台机器上没有 gcc");
} else {
  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-inflate-"));
  const exe = path.join(临, "hmyr.exe");
  const c = spawnSync("gcc", ["-std=c11", "-O2", "-Wall", "-Wl,--stack,67108864", "-o", exe, path.join(ROOT, "vm/hmyr.c"), "-lm"], { encoding: "utf8" });
  ok("C 那台编得出来", c.status === 0, String(c.stderr).slice(0, 160));
  if (c.status === 0 && 压码 && 解码) {
    const 压路 = path.join(临, "deflate.hmyrb");
    const 解路 = path.join(临, "inflate.hmyrb");
    fs.writeFileSync(压路, 压码);
    fs.writeFileSync(解路, 解码);
    const 压 = (参) => spawnSync(exe, [压路, ...参], { encoding: "utf8", timeout: 600000, env: { ...process.env, HMYR_STEPS: "20000000000", HMYR_GC: "1", HMYR_MEM_LIMIT: "0" } });
    const 解 = (参) => spawnSync(exe, [解路, ...参], { encoding: "utf8", timeout: 600000, env: { ...process.env, HMYR_STEPS: "20000000000", HMYR_GC: "1", HMYR_MEM_LIMIT: "0" } });

    console.log("二、五个小样本：短到能手工算");
    for (const 内容 of ["a", "ab", "aaaa", "abab", "abcabcabc"]) {
      const 名 = 内容.replace(/[^a-z]/g, "") + 内容.length;
      const 入 = path.join(临, 名 + ".bin");
      const 流 = path.join(临, 名 + ".fixed");
      const 出 = path.join(临, 名 + ".out");
      fs.writeFileSync(入, Buffer.from(内容, "latin1"));
      压([入, 流, "--固定"]);
      const r = 解([流, 出]);
      const 原 = fs.readFileSync(入);
      const 回 = fs.existsSync(出) ? fs.readFileSync(出) : null;
      ok(内容 + " 往返一致", r.status === 0 && 回 && Buffer.compare(原, 回) === 0, String(r.status) + " " + (回 ? 回.length : 0));
    }

    console.log("三、四 KB 样本：自家压、自家解");
    const 全 = fs.readFileSync(path.join(ROOT, "bootstrap/pack.hmyrb"));
    const 样本 = 全.subarray(0, 4096);
    const 样本路 = path.join(临, "sample.bin");
    fs.writeFileSync(样本路, 样本);
    const 自流 = path.join(临, "sample.fixed");
    const 自出 = path.join(临, "sample.out");
    压([样本路, 自流, "--固定"]);
    const r = 解([自流, 自出]);
    ok("自家流解得动", r.status === 0, String(r.status) + " " + String(r.stderr).slice(0, 200));
    if (fs.existsSync(自出)) {
      const 回 = fs.readFileSync(自出);
      ok("自家往返逐字节一致", 回.length === 样本.length && Buffer.compare(样本, 回) === 0, 回.length + " 对 " + 样本.length);
    }
    if (fs.existsSync(自流)) {
      ok("自家的流真的压了（小于一半）", fs.readFileSync(自流).length < 2048, String(fs.readFileSync(自流).length));
    }

    console.log("三·六、动态 Huffman：码表在流里");
    {
      // 自家编码器只写固定块，所以这一节的对手只能是 zlib 的默认策略。
      // 它写的是 BTYPE=2，而 16/17/18 那三个重复标记正是最容易错的地方。
      for (const [名, 选项] of [["默认", {}], ["level9", { level: 9 }], ["rle", { strategy: zlib.constants.Z_RLE }]]) {
        const 流 = zlib.deflateRawSync(样本, 选项);
        const 型 = (流[0] - 流[0] % 2) / 2 % 4;
        ok(名 + " 那一份确实是动态块（BTYPE=2）", 型 === 2, "BTYPE=" + 型);
        const 流路 = path.join(临, "dyn-" + 名 + ".z");
        const 出2 = path.join(临, "dyn-" + 名 + ".out");
        fs.writeFileSync(流路, 流);
        const r2 = spawnSync(exe, [解路, 流路, 出2], {
          encoding: "utf8", timeout: 600000,
          env: { ...process.env, HMYR_STEPS: "20000000000", HMYR_MEM_LIMIT: "0", HMYR_GC: "1" },
        });
        const 回2 = fs.existsSync(出2) ? fs.readFileSync(出2) : null;
        ok(名 + " 的动态流解回原样", r2.status === 0 && 回2 && 回2.length === 样本.length && Buffer.compare(样本, 回2) === 0, String(r2.status) + " " + (回2 ? 回2.length : 0));
      }
    }

        console.log("三·五、大流：整份种子，以及十倍于它");
    {
      // 这一节量的是「优化到头了没有」：四万三千字节与四十三万字节，时间该按比例走。
      // 逐字节往元组上拼的那一版在四万三千字节就顶到四吉；块化之后这里是 41 兆与 238 兆。
      for (const 倍 of [1, 10]) {
        const 大 = Buffer.concat(Array.from({ length: 倍 }, () => 全));
        const 大路 = path.join(临, "big-" + 倍 + ".bin");
        const 大流 = path.join(临, "big-" + 倍 + ".zfixed");
        const 大出 = path.join(临, "big-" + 倍 + ".out");
        fs.writeFileSync(大路, 大);
        fs.writeFileSync(大流, zlib.deflateRawSync(大, { strategy: zlib.constants.Z_FIXED }));
        const t0 = Date.now();
        const r = spawnSync(exe, [解路, 大流, 大出], {
          encoding: "utf8", timeout: 1800000,
          env: { ...process.env, HMYR_STEPS: "20000000000", HMYR_GC: "1", HMYR_MEM_LIMIT: "0" },
        });
        const 秒 = ((Date.now() - t0) / 1000).toFixed(1);
        const 回 = fs.existsSync(大出) ? fs.readFileSync(大出) : null;
        ok(倍 + " 倍（" + 大.length + " 字节）解得回原样", r.status === 0 && 回 && 回.length === 大.length && Buffer.compare(大, 回) === 0, String(r.status) + " 用时 " + 秒 + "s " + (回 ? 回.length : 0));
      }
    }

        console.log("四、别人的流：zlib 用固定策略压的，HMYR 也解得开");
    {
      const z流 = path.join(临, "zlib.fixed");
      const z出 = path.join(临, "zlib.out");
      fs.writeFileSync(z流, zlib.deflateRawSync(样本, { strategy: zlib.constants.Z_FIXED }));
      const r2 = 解([z流, z出]);
      ok("zlib 的固定流解得动", r2.status === 0, String(r2.status) + " " + String(r2.stderr).slice(0, 200));
      if (fs.existsSync(z出)) {
        const 回 = fs.readFileSync(z出);
        ok("解出来与原样本一致", 回.length === 样本.length && Buffer.compare(样本, 回) === 0, 回.length + " 对 " + 样本.length);
      }
    }
  }
  fs.rmSync(临, { recursive: true, force: true });
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
