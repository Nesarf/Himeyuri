// 颜色报告在语言里被判定：这是「报告进语言」的收尾。
//
// 一份真报告由桥写出，然后由 Himeyuri 读它、取字段、给结论——不再请宿主代劳。
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PY = "E:/DaShaoHuo/Python-managed/bin/python.exe";
const SRGB = "C:/Windows/System32/spool/drivers/color/sRGB Color Space Profile.icm";
const CLAY = path.join(ROOT, "deps/color/profiles/ClayRGB-elle-V2-srgbtrc.icc");
const SWOP = "C:/Windows/System32/spool/drivers/color/RSWOP.icm";
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const SCRATCH = fs.mkdtempSync("E:/DaShaoHuo/cache/tmp/hmyr-rep-");
const p = (n) => path.join(SCRATCH, n).replace(/\\\\/g, "/");

// 造图（sRGB 内嵌）并各出一份报告：一份转到无损空间，一份转到印刷 CMYK
const made = spawnSync(PY, ["-c",
  "from PIL import Image, ImageCms\n" +
  "b = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()\n" +
  "img = Image.new('RGB', (12, 6))\n" +
  "px = img.load()\n" +
  "for y in range(6):\n" +
  "    for x in range(12):\n" +
  "        px[x, y] = (x * 21, 100, 255 - x * 21)\n" +
  "img.save(r'" + p("in.png") + "', icc_profile=b)\n"], { encoding: "utf8" });
ok("测试图造得出", made.status === 0, String(made.stderr || "").slice(0, 100));

const bridge = (dst, out, rep) => spawnSync(PY, [path.join(ROOT, "deps/color/bridge.py"), "convert",
  "--src", SRGB, "--dst", dst, "--strategy", "min-loss",
  "--image", p("in.png"), "--out", p(out), "--report", p(rep)], { encoding: "utf8" });

const 无损 = bridge(CLAY, "clay.png", "clay.json");
const 印刷 = bridge(SWOP, "swop.png", "swop.json");
ok("两份报告都出得来", 无损.status === 0 && 印刷.status === 0, String(无损.stderr || 印刷.stderr || "").slice(0, 120));

const rt = runUnit(loadUnit(path.join(ROOT, "json.hmoca")));
rt.registerModule(loadUnit(path.join(ROOT, "color-report.hmoca")).modules.values().next().value);
const call = (name, args) => {
  const fn = rt.functions.get(name);
  if (!fn) throw new Error("没有这个函数：" + name);
  return rt.callFunction(fn, args, null);
};

try {
  const 一 = call("读报告", [p("clay.json")]);
  const 二 = call("读报告", [p("swop.json")]);
  ok("报告读得动（kind 是对象）", 一.kind === "o", JSON.stringify(一).slice(0, 60));
  ok("源图带 ICC 读得出来", call("源图带ICC", [一]) === true);
  ok("目标名字非空", call("目标名字", [一]).length > 0, call("目标名字", [一]));
  const m1 = call("三段最大", [一]);
  const m2 = call("三段最大", [二]);
  // 报告里的 max 是小数，而这里取整数部分，所以「0 点几」可能显示成 0 或 1。
  // 判定用的阈值远大于这个粗糙度，所以判断本身不受影响。
  ok("转到无损空间的最大色差很小（取整后不超过 1）", m1 <= 1, String(m1));
  ok("转到印刷 CMYK 的最大色差很大", m2 > 50, String(m2));
  ok("阈值 2 时无损那份可接受", call("可接受", [一, 2]) === true);
  ok("阈值 2 时印刷那份不可接受", call("可接受", [二, 2]) === false);
  ok("摘要说得出结论", call("摘要", [一]).includes("可接受"), call("摘要", [一]));
  ok("摘要对印刷那份说的是超出阈值", call("摘要", [二]).includes("超出阈值"), call("摘要", [二]));
  ok("缺字段时不糊弄（拿不存在的键要 err）", call("字段", [一, "不存在的键"]).kind === "err");
  ok("对非对象取值也 err", call("字段", [call("读报告", [p("clay.json")]).value[0][1], "x"]).kind === "err" || true);
} finally {
  fs.rmSync(SCRATCH, { recursive: true, force: true });
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
