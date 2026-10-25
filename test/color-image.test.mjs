// 图像进出的验收：能说清「这张图带不带 ICC」，并在写出时把目标空间嵌进去。
//
// 为什么这件事要紧：交给印厂的文件如果不说自己是什么空间，对方就只能猜——
// 而这一路的全部立场就是「不许猜」。所以报告的源图那一栏与输出的 ICC 都必须可核对。
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PY = "E:/DaShaoHuo/Python-managed/bin/python.exe";
const SWOP = "C:/Windows/System32/spool/drivers/color/RSWOP.icm";
const SRGB = "C:/Windows/System32/spool/drivers/color/sRGB Color Space Profile.icm";
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const SCRATCH = fs.mkdtempSync("E:/DaShaoHuo/cache/tmp/hmyr-img-");
const p = (n) => path.join(SCRATCH, n).replace(/\\/g, "/");

// 造一张带 sRGB ICC 的图。CmsProfile 本身没有 tobytes，要用 ImageCmsProfile 包一层。
const made = spawnSync(PY, ["-c",
  "from PIL import Image, ImageCms\n" +
  "b = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()\n" +
  "img = Image.new('RGB', (16, 8))\n" +
  "px = img.load()\n" +
  "for y in range(8):\n" +
  "    for x in range(16):\n" +
  "        px[x, y] = (x * 16, 128, 255 - x * 16)\n" +
  "img.save(r'" + p("in.png") + "', icc_profile=b)\n"], { encoding: "utf8" });
ok("带 ICC 的测试图已造出", made.status === 0 && fs.existsSync(p("in.png")), String(made.stderr || "").slice(0, 120));

const rt = runUnit(loadUnit(path.join(ROOT, "color.hmoca")));
const call = (name, args) => {
  const fn = rt.functions.get(name);
  if (!fn) throw new Error("没有这个函数：" + name);
  return rt.callFunction(fn, args, null);
};

try {
  // color.hmoca 的转换封装不支持 --embed-target，所以这里直接用桥验证这一条
  const out = p("out.png"), rep = p("rep.json");
  const r = spawnSync(PY, [path.join(ROOT, "deps/color/bridge.py"), "convert",
    "--src", SRGB, "--dst", SWOP, "--strategy", "min-loss",
    "--image", p("in.png"), "--out", out, "--report", rep, "--embed-target"], { encoding: "utf8" });
  ok("桥跑通（退出码 0）", r.status === 0, String(r.stderr || "").slice(0, 140));
  ok("写出了图与报告", fs.existsSync(out) && fs.existsSync(rep));

  const report = JSON.parse(fs.readFileSync(rep, "utf8"));
  ok("报告说源图带 ICC", report.image.has_icc === true, JSON.stringify(report.image.has_icc));
  ok("而且说得出它是什么空间", String(report.image.icc_description).toLowerCase().includes("srgb"), String(report.image.icc_description));
  ok("源 ICC 有指纹", typeof report.image.icc_sha256 === "string" && report.image.icc_sha256.length === 64, String(report.image.icc_sha256));
  ok("目标有指纹", typeof report.target.sha256 === "string" && report.target.sha256.length === 64, String(report.target.sha256));

  // 回查输出文件的 ICC
  const probe = spawnSync(PY, ["-c",
    "import hashlib, json\n" +
    "from PIL import Image\n" +
    "img = Image.open(r'" + out + "')\n" +
    "icc = img.info.get('icc_profile')\n" +
    "print(json.dumps({'has': bool(icc), 'sha': hashlib.sha256(icc).hexdigest() if icc else None}))\n"], { encoding: "utf8" });
  ok("回查得动输出文件", probe.status === 0, String(probe.stderr || "").slice(0, 120));
  const info = JSON.parse(String(probe.stdout || "{}"));
  ok("输出文件带 ICC", info.has === true, JSON.stringify(info));
  ok("而且嵌的正是目标那一个（指纹一致）", info.sha === report.target.sha256, String(info.sha) + " 对 " + String(report.target.sha256));
} finally {
  fs.rmSync(SCRATCH, { recursive: true, force: true });
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
