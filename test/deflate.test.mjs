// deflate：stored 块与固定 Huffman 两支。
//
// 两支的承诺不同，验收也不同：
//   stored        往返一致、压缩率 1.0 加五字节头、空输入也合法 —— 它证明格式对。
//   固定 Huffman  真的压（4 KB 样本压到一半以下）、zlib 解得回原样 —— 它证明码表与位序对。
//
// 解压那一侧现在只认 stored。固定 Huffman 的流由 zlib 解：自举侧的解码器是下一步，
// 而这一步能许的承诺是「压出来的东西标准工具读得懂」。
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
const 源路 = path.join(ROOT, "self/deflate.hmoca");
ok("self/deflate.hmoca 在", fs.existsSync(源路));
const unit = loadUnit(源路);
ok("加载没有诊断", unit.ok, JSON.stringify(unit.diagnostics.errors.slice(0, 1).map((e) => e.code)));
const 程序 = 合并程序(unit.order.map((文件) => 编译模块(unit.modules.get(文件))), 编译模块(unit.modules.get(unit.order[unit.order.length - 1])));
ok("它编出了函数表", 程序.函数们.size >= 15, String(程序.函数们.size));

const 有编译器 = (() => {
  try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();

if (!有编译器) {
  console.log("  跳过  这台机器上没有 gcc");
} else {
  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-deflate-"));
  const exe = path.join(临, "hmyr.exe");
  const c = spawnSync("gcc", ["-std=c11", "-O2", "-Wall", "-Wl,--stack,67108864", "-o", exe, path.join(ROOT, "vm/hmyr.c"), "-lm"], { encoding: "utf8" });
  ok("C 那台编得出来", c.status === 0, String(c.stderr).slice(0, 160));
  if (c.status === 0) {
    const 码路 = path.join(临, "deflate.hmoks");
    fs.writeFileSync(码路, 写程序(程序));
    const 跑 = (参) => spawnSync(exe, [码路, ...参], {
      encoding: "utf8", timeout: 600000,
      env: { ...process.env, HMYR_STEPS: "40000000000", HMYR_GC: "1", HMYR_MEM_LIMIT: "0" },
    });

    console.log("二、stored：往返一个字节都不差");
    const 源 = path.join(ROOT, "bootstrap/pack.hmtn");
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
      ok("压缩比是 1.0（多出来的只是五个字节的块头）", 压.length === 原.length + 5, 压.length + " 对 " + 原.length);

      console.log("三、标准工具读得懂这个流");
      try {
        const 借 = zlib.inflateRawSync(压);
        ok("zlib 解得开", 借.length === 原.length && Buffer.compare(原, 借) === 0, String(借.length));
      } catch (e) {
        ok("zlib 解得开", false, e.message);
      }
    }

    console.log("三·五、动态 Huffman：zlib 接受，且比固定更小");
    {
      // 这一节的两个数就是这一件要记的东西：固定与动态各压成多少字节。
      const 样本路 = path.join(临, "dyn-sample.bin");
      fs.writeFileSync(样本路, fs.readFileSync(path.join(ROOT, "bootstrap/pack.hmtn")).subarray(0, 4096));
      const 固路 = path.join(临, "dyn-fixed.z");
      const 动路 = path.join(临, "dyn-dynamic.z");
      const 固 = 跑([样本路, 固路, "--固定"]);
      const 动 = 跑([样本路, 动路, "--动态"]);
      ok("固定 Huffman 压得动", 固.status === 0, String(固.status));
      ok("动态 Huffman 压得动", 动.status === 0, String(动.status) + " " + String(动.stderr).slice(0, 160));
      if (fs.existsSync(固路) && fs.existsSync(动路)) {
        const 原 = fs.readFileSync(样本路);
        const 固长 = fs.readFileSync(固路).length;
        const 动长 = fs.readFileSync(动路).length;
        try {
          const a = zlib.inflateRawSync(fs.readFileSync(固路));
          ok("固定流 zlib 解得回原样", a.length === 原.length && Buffer.compare(a, 原) === 0, String(a.length));
        } catch (e) {
          ok("固定流 zlib 解得回原样", false, e.message);
        }
        try {
          const b = zlib.inflateRawSync(fs.readFileSync(动路));
          ok("动态流 zlib 解得回原样", b.length === 原.length && Buffer.compare(b, 原) === 0, String(b.length));
        } catch (e) {
          ok("动态流 zlib 解得回原样", false, e.message);
        }
        ok("动态比固定小（固定 " + 固长 + "，动态 " + 动长 + "）", 动长 < 固长, "");
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

    console.log("五、固定 Huffman：真的压了，而且 zlib 解得回来");
    {
      // 样本取种子的前 4 KB：字节码重复多，适合看压缩率。
      const 全 = fs.readFileSync(path.join(ROOT, "bootstrap/pack.hmtn"));
      const 样本 = path.join(临, "sample.bin");
      fs.writeFileSync(样本, 全.subarray(0, 4096));
      const 压2 = path.join(临, "sample.fixed");
      const r = 跑([样本, 压2, "--固定"]);
      ok("固定 Huffman 压得动", r.status === 0, String(r.status) + " " + String(r.stderr).slice(0, 160));
      if (fs.existsSync(压2)) {
        const 压 = fs.readFileSync(压2);
        ok("真的压了（小于原长的一半）", 压.length < 2048, "压到 " + 压.length + "（原 4096）");
        try {
          const 借 = zlib.inflateRawSync(压);
          const 原 = fs.readFileSync(样本);
          ok("zlib 解回原样", 借.length === 原.length && Buffer.compare(原, 借) === 0, String(借.length));
        } catch (e) {
          ok("zlib 解回原样", false, e.message);
        }
      }
    }
  }
    if (process.env.HMYR_HEAVY) {
      console.log("六、多块：一百 KB 的输入切成多块");
      {
        // 每 65535 字节一块，BFINAL 只在最后一块置位。
        // 链式找匹配对这个规模要五分钟，所以只在 HMYR_HEAVY 下跑。
        const 种 = fs.readFileSync(path.join(ROOT, "bootstrap/pack.hmtn"));
        const 大 = Buffer.concat([种, 种, 种.subarray(0, 20000)]);
        const 大入 = path.join(临, "multi.bin");
        const 大出 = path.join(临, "multi.z");
        fs.writeFileSync(大入, 大);
        const r = spawnSync(exe, [path.join(临, "deflate.hmoks"), 大入, 大出, "--固定"], {
          encoding: "utf8", timeout: 1800000,
          env: { ...process.env, HMYR_STEPS: "400000000000", HMYR_GC: "1", HMYR_MEM_LIMIT: "0" },
        });
        ok("一百 KB 压得动", r.status === 0 && fs.existsSync(大出), String(r.status));
        if (fs.existsSync(大出)) {
          const 流 = fs.readFileSync(大出);
          const 取 = (i) => (流[i >> 3] >> (i & 7)) & 1;
          let 位 = 0;
          let 头 = 0;
          for (let k = 0; k < 3; k++) { 头 |= 取(位) << k; 位++; }
          ok("第一块不是最后一块（BFINAL=0）", 头 % 2 === 0, "头=" + 头);
          ok("第一块是固定 Huffman（BTYPE=1）", Math.floor(头 / 2) % 4 === 1, "BTYPE=" + (Math.floor(头 / 2) % 4));
          try {
            const 回 = zlib.inflateRawSync(流);
            ok("zlib 解回原样", 回.length === 大.length && Buffer.compare(回, 大) === 0, String(回.length));
          } catch (e) {
            ok("zlib 解回原样", false, e.message);
          }
        }
      }
    }

    fs.rmSync(临, { recursive: true, force: true });
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
