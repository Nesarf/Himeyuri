// package 的验收：一个真的包，自己解析它。
//
// 不用 Expand-Archive —— 它只回答「解不开」，而自己读 EOCD、读中央目录、按偏移取成员，
// 连「偏移算错」「名字带了反斜杠」都能抓住。
//
// 打包交给 C 那台（它的 CRC32 比求值器快一个量级），所以这一套几秒就跑完，不必挂 heavy。
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadUnit } from "../tools/self-bridge.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

console.log("一、源码读得动、编得过");
const 源路 = path.join(ROOT, "self/package.hmyr");
ok("self/package.hmyr 在", fs.existsSync(源路));
const 层 = loadUnit(源路);
ok("加载没有诊断", 层.ok, JSON.stringify((层.diagnostics.errors || []).slice(0, 1).map((e) => e.code)));
const 文 = fs.readFileSync(源路, "utf8");
// 撞名那个错只有真跑才现形：manifest.hmyr 里也有 主，而合并是先到者赢。
ok("辅助函数不叫 主（会和 manifest 撞名）", !/fn 主\(/.test(文));
ok("打包 声明了 file 效果", /fn 打包\([^)]*\) effects\(file/.test(文));

const 有编译器 = (() => {
  try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();

console.log("二、真打一个包（design/），再自己读回来");
if (!有编译器) {
  console.log("  跳过  这台机器上没有 gcc");
} else {
  const 临 = fs.mkdtempSync(path.join(ROOT, ".tmp-package-"));
  const exe = path.join(临, "hmyr.exe");
  const c = spawnSync("gcc", ["-std=c11", "-O2", "-Wall", "-Wl,--stack,67108864", "-o", exe, path.join(ROOT, "vm/hmyr.c"), "-lm"], { encoding: "utf8" });
  ok("C 那台编得出来", c.status === 0, String(c.stderr || "").slice(0, 160));

  if (c.status === 0) {
    const 码路 = path.join(临, "package.hmyrb");
    const e = spawnSync("node", ["tools/emit-code.mjs", "self/package.hmyr", 码路], { cwd: ROOT, encoding: "utf8" });
    ok("字节码落盘（三份源码合成一份）", e.status === 0 && fs.existsSync(码路), String(e.stderr || "").slice(0, 200));

    if (e.status === 0) {
      const 包路 = path.join(临, "design.zip");
      const r = spawnSync(exe, [码路, 包路, "design"], {
        encoding: "utf8", timeout: 600000, cwd: ROOT,
        env: { ...process.env, HMYR_STEPS: "40000000000" },
      });
      ok("打包跑得动", r.status === 0 && fs.existsSync(包路), String(r.status) + " " + String(r.stderr || "").slice(0, 200));

      if (fs.existsSync(包路)) {
        const 源们 = fs.readdirSync(path.join(ROOT, "design")).filter((n) => n.endsWith(".txt")).sort();
        const 包 = fs.readFileSync(包路);
        const 尾位 = 包.length - 22;
        ok("尾记录的签名是 PK 5 6", 包[尾位] === 0x50 && 包[尾位 + 1] === 0x4b && 包[尾位 + 2] === 5 && 包[尾位 + 3] === 6,
          [...包.subarray(尾位, 尾位 + 4)].join(","));
        const 条数 = 包.readUInt16LE(尾位 + 10);
        const 目录起 = 包.readUInt32LE(尾位 + 16);
        const 目录大 = 包.readUInt32LE(尾位 + 12);
        ok("条目数等于 design 里的 .txt 数", 条数 === 源们.length, 条数 + " 对 " + 源们.length);
        ok("目录大小与实际相符", 目录起 + 目录大 === 尾位, 目录起 + "+" + 目录大 + " 对 " + 尾位);

        // 逐条读中央目录，按偏移取成员，与源文件逐字节比。
        let at = 目录起;
        let 读对 = 0;
        const 坏 = [];
        for (let i = 0; i < 条数; i++) {
          if (包[at] !== 0x50 || 包[at + 1] !== 0x4b || 包[at + 2] !== 1 || 包[at + 3] !== 2) { 坏.push("第 " + i + " 条的签名不对"); break; }
          const 方法 = 包.readUInt16LE(at + 10);
          const 压缩 = 包.readUInt32LE(at + 20);
          const 名长 = 包.readUInt16LE(at + 28);
          const 偏移 = 包.readUInt32LE(at + 42);
          const 名 = 包.subarray(at + 46, at + 46 + 名长).toString("utf8");
          // 本地头：30 字节固定 + 名字 + 扩展 + 负载
          const 本名长 = 包.readUInt16LE(偏移 + 26);
          const 本扩长 = 包.readUInt16LE(偏移 + 28);
          const 载起 = 偏移 + 30 + 本名长 + 本扩长;
          const 内容 = 包.subarray(载起, 载起 + 压缩);
          if (方法 !== 0) { 坏.push(名 + " 的方法不是 0"); break; }
          const 源 = path.join(ROOT, 名.split("/").join(path.sep));
          if (!名.startsWith("design/") || 名.includes("\\")) { 坏.push("名字不对：" + JSON.stringify(名)); break; }
          if (!fs.existsSync(源)) { 坏.push(名 + " 在仓库里找不到"); break; }
          const 原 = fs.readFileSync(源);
          if (原.length !== 压缩 || Buffer.compare(原, 内容) !== 0) { 坏.push(名 + " 内容不一致"); break; }
          读对++;
          at += 46 + 名长 + 包.readUInt16LE(at + 30) + 包.readUInt16LE(at + 32);
        }
        ok("每个成员都能按偏移取回、且与源文件逐字节相同", 读对 === 条数, 读对 + " 对 " + 条数 + (坏.length ? "  " + 坏[0] : ""));
        ok("成员名一律正斜杠、都在 design/ 下", !坏.some((x) => x.includes("名字") || x.includes("反斜杠")));
      }
    }
  }
  console.log("三、整棵仓库：默认目录表一次打完");
if (有编译器) {
  const 全路 = path.join(临, "all.zip");
  // 字节码是上一节生成的（同一个文件名）。这里只用它，不再生成一遍。
  const 全码路 = path.join(临, "package.hmyrb");
  ok("上一节烘好的字节码还在", fs.existsSync(全码路), 全码路);
  // 用 spawnSync 而不是命令行：PowerShell 那边的引号层会把参数嚼掉一次，
  // 症状是「cannot open <包里那个名字>」—— 看起来像打包失败，其实是参数顺序被打乱。
  const r2 = spawnSync(exe, [全码路, 全路], {
    cwd: ROOT, encoding: "utf8", timeout: 600000,
    env: { ...process.env, HMYR_STEPS: "2000000000", HMYR_MEM_LIMIT: "0" },
  });
  ok("整棵仓库打得动", r2.status === 0 && fs.existsSync(全路), String(r2.status) + " " + String(r2.stderr || "").slice(0, 200));
  if (fs.existsSync(全路)) {
    const 包 = fs.readFileSync(全路);
    const 尾位 = 包.length - 22;
    const 条数 = 包.readUInt16LE(尾位 + 10);
    ok("条目数超过两百", 条数 > 200, String(条数));
    // 抽查三个成员，按偏移取回、与源文件逐字节比。
    const 想要 = ["src/eval.mjs", "design/TOOLING.txt", "self/zip.hmyr"];
    let 找到 = 0;
    let at = 包.readUInt32LE(尾位 + 16);
    for (let i = 0; i < 条数; i++) {
      const 名长 = 包.readUInt16LE(at + 28);
      const 名 = 包.subarray(at + 46, at + 46 + 名长).toString("utf8");
      const 压缩 = 包.readUInt32LE(at + 20);
      const 偏移 = 包.readUInt32LE(at + 42);
      const 本名长 = 包.readUInt16LE(偏移 + 26);
      const 本扩长 =包.readUInt16LE(偏移 + 28);
      if (想要.includes(名)) {
        const 载起 = 偏移 + 30 + 本名长 + 本扩长;
        const 内容 = 包.subarray(载起, 载起 + 压缩);
        const 原 = fs.readFileSync(path.join(ROOT, 名.split("/").join(path.sep)));
        if (原.length === 压缩 && Buffer.compare(原, 内容) === 0) 找到++;
      }
      at += 46 + 名长 + 包.readUInt16LE(at + 30) + 包.readUInt16LE(at + 32);
    }
    ok("抽查三个成员，逐字节相同", 找到 === 想要.length, 找到 + " 对 " + 想要.length);
    ok("包的大小与条目数相称", 包.length > 3000000 && 包.length < 6000000, String(包.length));
  }
}

console.log("四、附加一份包外的文件（发布清单走的就是这条）");
if (有编译器) {
  const 源们 = fs.readdirSync(path.join(ROOT, "design")).filter((n) => n.endsWith(".txt")).sort();
  const 附路 = path.join(临, "manifest.json");
  fs.writeFileSync(附路, '{"name":"himeyuri","digest":"x"}\n', "utf8");
  const 附包 = path.join(临, "with-manifest.zip");
  const 附码 = path.join(临, "package.hmyrb");
  const r3 = spawnSync(exe, [附码, 附包, "design", "--附加", 附路, "manifest.json"], {
    cwd: ROOT, encoding: "utf8", timeout: 600000,
    env: { ...process.env, HMYR_STEPS: "40000000000" },
  });
  ok("带附加成员打得动", r3.status === 0 && fs.existsSync(附包), String(r3.status) + " " + String(r3.stderr || "").slice(0, 160));
  if (fs.existsSync(附包)) {
    const 包 = fs.readFileSync(附包);
    const 尾位 = 包.length - 22;
    const 条数 = 包.readUInt16LE(尾位 + 10);
    ok("成员数是 design 的 .txt 数加一", 条数 === 源们.length + 1, 条数 + " 对 " + (源们.length + 1));
    let 找到 = null;
    let at = 包.readUInt32LE(尾位 + 16);
    for (let i = 0; i < 条数; i++) {
      const 名长 = 包.readUInt16LE(at + 28);
      const 名 = 包.subarray(at + 46, at + 46 + 名长).toString("utf8");
      const 压缩 = 包.readUInt32LE(at + 20);
      const 偏移 = 包.readUInt32LE(at + 42);
      const 本名长 = 包.readUInt16LE(偏移 + 26);
      const 本扩长 = 包.readUInt16LE(偏移 + 28);
      if (名 === "manifest.json") {
        const 载起 = 偏移 + 30 + 本名长 + 本扩长;
        找到 = 包.subarray(载起, 载起 + 压缩);
      }
      at += 46 + 名长 + 包.readUInt16LE(at + 30) + 包.readUInt16LE(at + 32);
    }
    ok("包里有 manifest.json 这个成员", 找到 !== null);
    const 原 = fs.readFileSync(附路);
    ok("它的字节与包外那份相同", 找到 !== null && 找到.length === 原.length && Buffer.compare(找到, 原) === 0,
      找到 === null ? "没找到" : 找到.length + " 对 " + 原.length);
  }
}

fs.rmSync(临, { recursive: true, force: true });
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
