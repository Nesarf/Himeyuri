// The colour module's acceptance: two named strategies, a report with fingerprints on every input,
// and the assertion that makes the strategy名字 honest - min-loss must actually lose less.
//
// The measurement itself is the bridge's job (LittleCMS through Pillow). What is checked here is the
// language-side contract: the strategy list, the call, and the report's shape.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PY = "E:/DaShaoHuo/Python-managed/bin/python.exe";
const SWOP = "C:/Windows/System32/spool/drivers/color/RSWOP.icm";
const SRGB_FILE = "C:/Windows/System32/spool/drivers/color/sRGB Color Space Profile.icm";
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const SCRATCH = fs.mkdtempSync("E:/DaShaoHuo/cache/tmp/hmyr-color-");
const p = (n) => path.join(SCRATCH, n).replace(/\\/g, "/");

// a layered test image: greys on the left (dark to light), saturated colours on the right
const made = spawnSync(PY, ["-c",
  "from PIL import Image\n" +
  "img=Image.new('RGB',(32,16))\n" +
  "px=img.load()\n" +
  "cols=[(0,255,0),(255,90,0),(200,0,255),(0,0,255),(0,255,255),(255,0,0),(255,255,0),(0,128,64)]\n" +
  "for y in range(16):\n" +
  "    for x in range(16):\n" +
  "        v=int(x/15*255); px[x,y]=(v,v,v)\n" +
  "    for x in range(16,32):\n" +
  "        px[x,y]=cols[(x-16)%len(cols)]\n" +
  "img.save(r'" + p("in.png") + "')\n"], { encoding: "utf8" });
ok("测试图已造出", made.status === 0 && fs.existsSync(p("in.png")), String(made.stderr || "").slice(0, 120));

const unit = loadUnit(path.join(ROOT, "color.hmoca"));
ok("色彩模块加载", unit.ok, unit.diagnostics.errors.map((e) => e.code + " " + e.message).join("; "));
const rt = runUnit(unit);
const call = (name, args) => {
  const fn = rt.functions.get(name);
  if (!fn) throw new Error("没有这个函数：" + name);
  return rt.callFunction(fn, args, null);
};

try {
  console.log("\n策略清单");
  {
    const list = call("策略清单", []);
    ok("两条策略", Array.isArray(list) && list.length === 2, JSON.stringify(list));
    ok("名字是 min-loss 与 look", list.map((x) => x[0]).sort().join(",") === "look,min-loss", JSON.stringify(list.map((x) => x[0])));
    ok("每条都带「为什么」", list.every((x) => typeof x[1] === "string" && x[1].length > 8));
  }

  console.log("\n可用清单（由语言这边发起，桥回答）");
  {
    const text = call("可用清单", []);
    ok("清单里有内建三个", text.includes("sRGB built-in") && text.includes("Lab identity") && text.includes("XYZ identity"));
    ok("清单里有存储模式", text.includes("storage_modes"));
    ok("清单里有 SWOP 那张", text.includes("RSWOP.icm"));
  }

  console.log("\n两次转换：min-loss 对 look");
  const reports = {};
  for (const strategy of ["min-loss", "look"]) {
    const out = p(strategy + ".png");
    const rep = p(strategy + ".json");
    const r = call("转换", [p("in.png"), out, SRGB_FILE, SWOP, strategy, rep]);
    ok(strategy + " 跑通（退出码 0）", Array.isArray(r) && r[0] === 0, JSON.stringify(r).slice(0, 160));
    ok(strategy + " 写出了图与报告", fs.existsSync(out) && fs.existsSync(rep));
    reports[strategy] = JSON.parse(fs.readFileSync(rep, "utf8"));
  }

  console.log("\n报告的形状与指纹");
  {
    const rep = reports["min-loss"];
    ok("源有指纹", typeof rep.source.sha256 === "string" && rep.source.sha256.length === 64, String(rep.source.sha256));
    ok("目标有指纹", typeof rep.target.sha256 === "string" && rep.target.sha256.length === 64, String(rep.target.sha256));
    ok("引擎与版本记下了", !!rep.engine.pillow && !!rep.engine.littlecms, JSON.stringify(rep.engine));
    ok("意图记下了", typeof rep.intent === "number", String(rep.intent));
    ok("分层三个段都在", ["暗部", "中间", "高光"].every((b) => rep.delta_e76[b]), Object.keys(rep.delta_e76).join(","));
    ok("改动比例记下了", typeof rep.changed_fraction === "number", String(rep.changed_fraction));
  }

  console.log("\n选工作空间：从损失最小的排起（这是三条原则的机械化）");
  {
    const text = call("选工作空间", ["sRGB", "ClayRGB-elle-V2-srgbtrc.icc;AllColorsRGB-elle-V2-srgbtrc.icc;RSWOP.icm"]);
    const data = JSON.parse(text);   // 语言那边现在有 json.hmoca 了；这一条暂时留在宿主侧，下一步换成它
    ok("排名第一的是零损失的目标", data.ranked[0].given === "ClayRGB-elle-V2-srgbtrc.icc" && data.ranked[0].sum === 0,
      JSON.stringify(data.ranked[0]));
    ok("CMYK 排在最后", data.ranked[data.ranked.length - 1].given === "RSWOP.icm",
      JSON.stringify(data.ranked.map((r) => r.given + ":" + r.sum)));
    ok("每个候选都带指纹", data.ranked.every((r) => typeof r.sha256 === "string" && r.sha256.length === 64));
    console.log("        （" + data.ranked.map((r) => r.given.replace(/-elle-V2.*/, "") + " " + r.sum).join(" · ") + "）");
  }

  console.log("\n核心断言：min-loss 必须真的损失更小");
  {
    const sumOf = (rep) => ["暗部", "中间", "高光"].reduce((acc, b) => acc + (rep.delta_e76[b].max || 0), 0);
    const a = sumOf(reports["min-loss"]), b = sumOf(reports["look"]);
    ok("min-loss 的三段之和 <= look 的三段之和", a <= b + 1e-9, "min-loss " + a.toFixed(2) + " vs look " + b.toFixed(2));
    console.log("        （min-loss " + a.toFixed(2) + " · look " + b.toFixed(2) + "）");
  }
} finally {
  fs.rmSync(SCRATCH, { recursive: true, force: true });
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
