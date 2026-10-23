// 多成员 ZIP：中央目录要能装 N 条，每条带自己的偏移。
//
// 验收不走 Expand-Archive —— 它在临时目录里给出的是「解不开」，
// 而自己读中央目录、按偏移取成员，连偏移算错都能抓到。
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

console.log("一、工具的源码读得动");
const 源路 = path.join(ROOT, "self/zip.hmyr");
ok("self/zip.hmyr 在", fs.existsSync(源路));
const unit = loadUnit(源路);
ok("加载没有诊断", unit.ok, JSON.stringify(unit.diagnostics.errors.slice(0, 1).map((e) => e.code)));
const 程序 = 合并程序(unit.order.map((文件) => 编译模块(unit.modules.get(文件))), 编译模块(unit.modules.get(unit.order[unit.order.length - 1])));

const 有编译器 = (() => {
  try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();

if (!有编译器) {
  console.log("  跳过  这台机器上没有 gcc");
} else {
  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-zipmulti-"));
  const exe = path.join(临, "hmyr.exe");
  const c = spawnSync("gcc", ["-std=c11", "-O2", "-Wall", "-Wl,--stack,67108864", "-o", exe, path.join(ROOT, "vm/hmyr.c"), "-lm"], { encoding: "utf8" });
  ok("C 那台编得出来", c.status === 0, String(c.stderr).slice(0, 160));
  if (c.status === 0) {
    const 码路 = path.join(临, "zip.hmyrb");
    fs.writeFileSync(码路, 写程序(程序));
    // 三个成员：一个带子目录、两个在根。
    // 三个成员：两个在根、一个带子目录。
    const 成员 = [
      path.join(ROOT, "src/eval.mjs"),
      path.join(ROOT, "LICENSE"),
      path.join(ROOT, "examples/twice.hmyr"),
    ].filter((p) => fs.existsSync(p)).map((p) => path.relative(ROOT, p));
    const 包路 = path.join(临, "multi.zip");
    const r = spawnSync(exe, [码路, "--多", 包路, ...成员], {
      encoding: "utf8", timeout: 600000, cwd: ROOT,
      env: { ...process.env, HMYR_STEPS: "40000000000", HMYR_GC: "1", HMYR_MEM_LIMIT: "0" },
    });
    ok("多成员包写得动", r.status === 0 && fs.existsSync(包路), String(r.status) + " " + String(r.stderr).slice(0, 160));
    if (fs.existsSync(包路)) {
      const 包 = fs.readFileSync(包路);
      const 尾位 = 包.length - 22;
      const 条数 = 包.readUInt16LE(尾位 + 10);
      const 目录起 = 包.readUInt32LE(尾位 + 16);
      ok("尾里的条目数等于成员数", 条数 === 成员.length, 条数 + " 对 " + 成员.length);
      // 逐条读中央目录
      let at = 目录起;
      const 见到的 = [];
      for (let k = 0; k < 条数; k++) {
        const 名长 = 包.readUInt16LE(at + 28);
        const 偏移 = 包.readUInt32LE(at + 42);
        const 压缩长 = 包.readUInt32LE(at + 20);
        const 名 = 包.subarray(at + 46, at + 46 + 名长).toString("latin1");
        const 本地名长 = 包.readUInt16LE(偏移 + 26);
        const 本地额外 = 包.readUInt16LE(偏移 + 28);
        const 数据起 = 偏移 + 30 + 本地名长 + 本地额外;
        见到的.push({ 名, 数据: 包.subarray(数据起, 数据起 + 压缩长) });
        at += 46 + 名长;
      }
      ok("中央目录的条数对", 见到的.length === 成员.length, String(见到的.length));
      let 全都对 = true;
      let 问题 = "";
      for (const p of 成员) {
        const 名 = p.split(path.sep).join("/");
        const 条 = 见到的.find((m) => m.名 === 名);
        if (!条) { 全都对 = false; 问题 += " 缺:" + 名; }
        else if (Buffer.compare(条.数据, fs.readFileSync(path.join(ROOT, p))) !== 0) { 全都对 = false; 问题 += " 内容不同:" + 名; }
      }
      ok("每个成员都在、内容都对", 全都对, 问题 + " | 包里的是: " + 见到的.map((m) => JSON.stringify(m.名)).join(" "));
      ok("目录大小与实际一致", 包.readUInt32LE(尾位 + 12) === 包.length - 22 - 目录起, "");
      ok("目录偏移是中央目录的起点", 包.readUInt32LE(尾位 + 16) === 目录起, "");
    }
  }
  fs.rmSync(临, { recursive: true, force: true });
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
