// ZIP 容器：stored 模式，结构按 APPNOTE 6.3。
//
// 验收不靠外部工具，靠把结构一个字段一个字段读出来 —— 外部工具通过只说明它宽容，
// 而字段对齐才说明写对了。CRC 那一条特意与 node 自己的 crc32 比：那是它唯一可能
// 「算得像但错」的地方。
//
// 已知边界：stored 不压（压缩率 1.0），CRC32 逐位算所以只适合几 KB 的文件。
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
const 源路 = path.join(ROOT, "self/zip.hmyr");
ok("self/zip.hmyr 在", fs.existsSync(源路));
const unit = loadUnit(源路);
ok("加载没有诊断", unit.ok, JSON.stringify(unit.diagnostics.errors.slice(0, 1).map((e) => e.code)));
const 程序 = 合并程序(unit.order.map((文件) => 编译模块(unit.modules.get(文件))), 编译模块(unit.modules.get(unit.order[unit.order.length - 1])));
ok("它编出了函数表", 程序.函数们.size >= 9, String(程序.函数们.size));

const 有编译器 = (() => {
  try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();

if (!有编译器) {
  console.log("  跳过  这台机器上没有 gcc");
} else {
  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-zip-"));
  const exe = path.join(临, "hmyr.exe");
  const c = spawnSync("gcc", ["-std=c11", "-O2", "-Wall", "-Wl,--stack,67108864", "-o", exe, path.join(ROOT, "vm/hmyr.c"), "-lm"], { encoding: "utf8" });
  ok("C 那台编得出来", c.status === 0, String(c.stderr).slice(0, 160));
  if (c.status === 0) {
    const 码路 = path.join(临, "zip.hmyrb");
    fs.writeFileSync(码路, 写程序(程序));
    const 成员 = path.join(ROOT, "examples/twice.hmyr");
    const 包路 = path.join(临, "twice.zip");
    const r = spawnSync(exe, [码路, 成员, 包路], { encoding: "utf8", timeout: 300000, env: { ...process.env, HMYR_STEPS: "4000000000" } });
    ok("包写得动", r.status === 0, String(r.status) + " " + String(r.stderr).slice(0, 200));
    if (fs.existsSync(包路)) {
      const 包 = fs.readFileSync(包路);
      const 原 = fs.readFileSync(成员);
      const 名长 = 包.readUInt16LE(26);
      const 额外 = 包.readUInt16LE(28);
      const 名 = 包.subarray(30, 30 + 名长).toString("latin1");
      const 中央起 = 30 + 名长 + 额外 + 包.readUInt32LE(22);

      console.log("二、本地头：签名、方法、长度、CRC");
      ok("本地签名是 50 4b 03 04", 包.subarray(0, 4).toString("hex") === "504b0304", 包.subarray(0, 4).toString("hex"));
      ok("方法字段是 0（stored）", 包.readUInt16LE(8) === 0, String(包.readUInt16LE(8)));
      ok("压缩后大小与原始大小都等于原文件", 包.readUInt32LE(18) === 原.length && 包.readUInt32LE(22) === 原.length, 包.readUInt32LE(18) + "/" + 包.readUInt32LE(22) + " 对 " + 原.length);
      ok("成员名是文件最后一段", 名 === "twice.hmyr", JSON.stringify(名));
      ok("CRC 与 node 的 crc32 一致", 包.readUInt32LE(14) === zlib.crc32(原), 包.readUInt32LE(14) + " 对 " + zlib.crc32(原));

      console.log("二·五、deflate 成员：方法 8，压缩后能被 zlib 解回原样");
      {
        const 压包路 = path.join(临, "twice-deflate.zip");
        const r2 = spawnSync(exe, [码路, 成员, 压包路, "--压"], { encoding: "utf8", timeout: 300000, env: { ...process.env, HMYR_STEPS: "4000000000" } });
        ok("带压缩的包写得动", r2.status === 0, String(r2.status) + " " + String(r2.stderr).slice(0, 200));
        if (fs.existsSync(压包路)) {
          const 包2 = fs.readFileSync(压包路);
          ok("方法字段是 8（deflate）", 包2.readUInt16LE(8) === 8, String(包2.readUInt16LE(8)));
          ok("压缩后比原始小", 包2.readUInt32LE(18) < 原.length, 包2.readUInt32LE(18) + " 对 " + 原.length);
          ok("原始大小仍写着原长", 包2.readUInt32LE(22) === 原.length, String(包2.readUInt32LE(22)));
          ok("CRC 仍按原始数据算", 包2.readUInt32LE(14) === zlib.crc32(原), "");
          const 名长2 = 包2.readUInt16LE(26);
          const 压长 = 包2.readUInt32LE(18);
          const 段 = 包2.subarray(30 + 名长2, 30 + 名长2 + 压长);
          try {
            const 借 = zlib.inflateRawSync(段);
            ok("zlib 把 deflate 段解回原样", 借.length === 原.length && Buffer.compare(借, 原) === 0, String(借.length));
          } catch (e) {
            ok("zlib 把 deflate 段解回原样", false, e.message);
          }
        }
      }

            console.log("三、数据段：一个字节都不差");
      {
        const 数据 = 包.subarray(30 + 名长 + 额外, 30 + 名长 + 额外 + 原.length);
        ok("数据逐字节一致", 数据.length === 原.length && Buffer.compare(数据, 原) === 0, 数据.length + " 对 " + 原.length);
      }

      console.log("四、中央目录与尾");
      ok("中央签名是 50 4b 01 02", 包.subarray(中央起, 中央起 + 4).toString("hex") === "504b0102", 包.subarray(中央起, 中央起 + 4).toString("hex"));
      ok("中央里的 CRC 与本地一致", 包.readUInt32LE(中央起 + 16) === 包.readUInt32LE(14), "");
      ok("中央里的名字与本地一致", 包.subarray(中央起 + 46, 中央起 + 46 + 名长).toString("latin1") === 名, "");
      ok("中央里的本地头偏移是 0", 包.readUInt32LE(中央起 + 42) === 0, String(包.readUInt32LE(中央起 + 42)));
      {
        const 尾 = 包.length - 22;
        ok("尾签名是 50 4b 05 06", 包.subarray(尾, 尾 + 4).toString("hex") === "504b0506", 包.subarray(尾, 尾 + 4).toString("hex"));
        ok("尾里写的目录大小与实际一致", 包.readUInt32LE(尾 + 12) === 包.length - 22 - 中央起, 包.readUInt32LE(尾 + 12) + " 对 " + (包.length - 22 - 中央起));
        ok("尾里写的目录偏移与实际一致", 包.readUInt32LE(尾 + 16) === 中央起, 包.readUInt32LE(尾 + 16) + " 对 " + 中央起);
        ok("条目数写着 1", 包.readUInt16LE(尾 + 8) === 1 && 包.readUInt16LE(尾 + 10) === 1, "");
      }
    }
  }
  fs.rmSync(临, { recursive: true, force: true });
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
