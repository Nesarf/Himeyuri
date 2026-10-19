// 容器识别的验收：认出壳，也认得出「没有壳」。
//
// 这一层只做前半段——认出是哪一个壳。解压交出去，而交出去这件事也要说清：
// 「要解吗」回答的是「外面有没有壳」，而不是「我会不会解」。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const unit = loadUnit(path.join(ROOT, "container.hmyr"));
ok("容器那一层加载得动", unit.ok, unit.diagnostics.errors.map((e) => e.code + " " + e.message).join("; "));
const rt = runUnit(unit);
const call = (name, args) => {
  const fn = rt.functions.get(name);
  if (!fn) throw new Error("没有这个函数：" + name);
  return rt.callFunction(fn, args, null);
};

// XPK 的壳：XPKF 之后四个字节是内容长度，再四个字节才是子压缩器的名字。
const XPK = "XPKF" + "0001" + "SQSH" + "body";
const MMCMP = "ziRCONia" + "rest";
const PP20 = "PP20" + "rest";
const 普通 = "Test Song".padEnd(1084, " ") + "M.K.";

console.log("一、三种壳都认得出");
{
  ok("XPK", call("认", [XPK]) === "xpk", JSON.stringify(call("认", [XPK])));
  ok("MMCMP", call("认", [MMCMP]) === "mmcmp", JSON.stringify(call("认", [MMCMP])));
  ok("PowerPacker", call("认", [PP20]) === "pp20", JSON.stringify(call("认", [PP20])));
  ok("壳名给人看", call("壳名", [PP20]) === "PowerPacker", call("壳名", [PP20]));
}

console.log("二、「没有壳」与「壳不认识」是两件事");
{
  ok("普通模块没有壳", call("认", [普通]) === "", JSON.stringify(call("认", [普通])));
  ok("空串也没有壳", call("认", [""]) === "");
  ok("壳名说「无」而不是「不认识」", call("壳名", [普通]) === "无", call("壳名", [普通]));
}

console.log("三、要解吗：问的是壳，不是能力");
{
  ok("有壳就说要解", call("要解吗", [XPK]) === true);
  ok("没壳就说不用", call("要解吗", [普通]) === false);
  ok("而认不出时解压器名是空串", call("解压器名", [普通]) === "", JSON.stringify(call("解压器名", [普通])));
}

console.log("四、XPK 的子压缩器在第八字节");
{
  ok("读得到 SQSH", call("子压缩器", [XPK]) === "SQSH", JSON.stringify(call("子压缩器", [XPK])));
  ok("非 XPK 的交回空串", call("子压缩器", [MMCMP]) === "");
  ok("太短的交回空串", call("子压缩器", ["XPKF"]) === "");
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
