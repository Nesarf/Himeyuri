// MOD 头部的验收：读得对，而读不到时有话说。
//
// 测试自己造一个最小的 MOD——一百零八十四字节的头加两个 pattern，
// 于是这一套不依赖任何外部的音乐文件，谁都能跑。
//
// 那个「一百零八十四」与「一千零二十四」是格式本身给的字面量，不是猜的：
// 头是 20 + 31×30 + 1 + 1 + 128 + 4 = 1084，而一个 pattern 是 4×64×4 = 1024。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 造 = (名, 标题, 标记, 歌长, 序列, 样本长) => {
  const 头 = Buffer.alloc(1084, 0x20);
  Buffer.from(标题, "latin1").copy(头, 0);
  头.fill(0x00, 20, 20 + 31 * 30);          // 样本头清零
  头[20 + 22] = (样本长 >> 16) & 0xff;      // 第一个样本的长度（大端，三字节）
  头[20 + 23] = (样本长 >> 8) & 0xff;
  头[20 + 24] = 样本长 & 0xff;
  头[950] = 歌长;
  头[951] = 0;
  序列.forEach((v, i) => { 头[952 + i] = v; });
  Buffer.from(标记, "latin1").copy(头, 1080);
  const 格 = Buffer.alloc(1024 * Math.max(1, Math.max(...序列) + 1));
  const p = path.join(过程目录, 名);
  fs.writeFileSync(p, Buffer.concat([头, 格]));
  return p.replace(/\\/g, "/");
};
const 过程目录 = fs.mkdtempSync("E:/DaShaoHuo/cache/tmp/mod-");

const unit = loadUnit(path.join(ROOT, "mod.hmoca"));
ok("MOD 那一层加载得动", unit.ok, unit.diagnostics.errors.map((e) => e.code + " " + e.message).join("; "));
const rt = runUnit(unit);
rt.registerModule(loadUnit(path.join(ROOT, "shell.hmoca")).modules.values().next().value);
const call = (name, args) => {
  const fn = rt.functions.get(name);
  if (!fn) throw new Error("没有这个函数：" + name);
  return rt.callFunction(fn, args, null);
};

try {
  console.log("一、一份四声道的 M.K. 文件");
  {
    const p = 造("a.mod", "Test Song", "M.K.", 2, [0, 1], 100);
    const b = call("读字节", [p]);
    ok("读得到", b.length > 0, String(b.length));
    ok("标题去掉了补的空格", call("标题", [b]) === "Test Song", JSON.stringify(call("标题", [b])));
    ok("声道是四", call("声道数", [b]) === 4, String(call("声道数", [b])));
    ok("歌长是二", call("歌长", [b]) === 2, String(call("歌长", [b])));
    ok("格子数是二", call("格子数", [b]) === 2, String(call("格子数", [b])));
    ok("样本数是一", call("样本数", [b]) === 1, String(call("样本数", [b])));
    ok("应收大小与实际相同", call("应收大小", [b]) === b.length, call("应收大小", [b]) + " 对 " + b.length);
  }

  console.log("二、别的标记");
  {
    const p6 = 造("b.mod", "Six", "6CHN", 1, [0], 0);
    const b6 = call("读字节", [p6]);
    ok("6CHN 读到六声道", call("声道数", [b6]) === 6, String(call("声道数", [b6])));
    const p8 = 造("c.mod", "Eight", "8CHN", 1, [0], 0);
    ok("8CHN 读到八声道", call("声道数", [call("读字节", [p8])]) === 8);
    const pnx = 造("d.mod", "Ten", "10CH", 1, [0], 0);
    ok("10CH 读到十声道", call("声道数", [call("读字节", [pnx])]) === 10, String(call("声道数", [call("读字节", [pnx])])));
  }

  console.log("三、读不到的时候");
  {
    // 读不到时它拒绝，而不是悄悄交回空串——这一条我原来写反了，

    // 而拒绝才对：静默的空串会让调用方以为「这文件没有标题」，而其实是没有这个文件。

    let 拒绝了吗 = false;

    try { call("读字节", [过程目录.replace(/\\\\/g, "/") + "/nope.mod"]); } catch (e) { 拒绝了吗 = (e.code || "").indexOf("HMYR-內-011") >= 0; }

    ok("不存在的文件给 HMYR-內-011（拒绝比静默好）", 拒绝了吗);
    const p = 造("e.mod", "", "M.K.", 0, [0], 0);
    const b = call("读字节", [p]);
    ok("歌长为零时格子数是零", call("格子数", [b]) === 0, String(call("格子数", [b])));
    ok("空标题也照实交回空串", call("标题", [b]) === "", JSON.stringify(call("标题", [b])));
  }
} finally {
  fs.rmSync(过程目录, { recursive: true, force: true });
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
