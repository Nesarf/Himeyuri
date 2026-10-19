// 验清单的验收：对得上就说对得上，而改过一处就要说不通过。
//
// 第二条比第一条重要得多。一个永远说「通过」的验证器与没有验证器一样，
// 而它的危害更大——它让人以为验过了。
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};
const 跑 = (...参) => spawnSync(process.execPath, [path.join(ROOT, "tools/verify.mjs"), ...参], { encoding: "utf8" });
const 临 = fs.mkdtempSync("E:/DaShaoHuo/cache/tmp/verify-");

try {
  console.log("一、自检：现算一份并验它");
  {
    const r = 跑();
    ok("退出码零", r.status === 0, String(r.status));
    ok("说清了对上多少项", /对得上 \d+ 项/.test(r.stdout), r.stdout.slice(0, 60));
    ok("而且明说「不等于可信」", r.stdout.includes("不说明「值得信」"));
  }

  console.log("二、它真的能验出不对");
  {
    // 拿一份清单，改掉其中一项的哈希，再验
    const m = spawnSync(process.execPath, [path.join(ROOT, "tools/manifest.mjs")], { encoding: "utf8" });
    const 清单 = JSON.parse(m.stdout);
    const 目标 = 清单.tools[0];
    目标.sha256 = "0000000000000000";
    // digest 也要跟着改成「自洽的」，于是这一条只查哈希，不查清单被动过
    const 去掉 = { ...清单 };
    delete 去掉.digest;
    const { createHash } = await import("node:crypto");
    去掉.digest = createHash("sha256").update(JSON.stringify(去掉, null, 2), "utf8").digest("hex");
    // 注意：上面那一步已经把 digest 补回去了，所以这里写回来的是一份自洽但内容错的清单
    清单.digest = 去掉.digest;
    const p = path.join(临, "bad.json");
    fs.writeFileSync(p, JSON.stringify(清单, null, 2) + "\n", "utf8");
    const r = 跑("--in", p);
    ok("退出码非零", r.status !== 0, String(r.status));
    ok("指出了是哪一项不对", r.stdout.includes("[不通过]"), r.stdout.slice(0, 120));
    ok("而且没有说「通过」", !/^  通过$/m.test(r.stdout));
  }

  console.log("三、清单被动过也能验出来");
  {
    const m = spawnSync(process.execPath, [path.join(ROOT, "tools/manifest.mjs")], { encoding: "utf8" });
    const 清单 = JSON.parse(m.stdout);
    清单.name = "改过的名字";   // digest 不再对得上
    const p = path.join(临, "tampered.json");
    fs.writeFileSync(p, JSON.stringify(清单, null, 2) + "\n", "utf8");
    const r = 跑("--in", p);
    ok("退出码非零", r.status !== 0, String(r.status));
    ok("说清单本身被动过了", r.stdout.includes("清单本身被动过了"), r.stdout.slice(0, 100));
  }

  console.log("四、读不了的清单");
  {
    const r = 跑("--in", path.join(临, "没有这个.json"));
    ok("给出非零退出码与说明", r.status !== 0 && r.stderr.indexOf("读不了") >= 0, String(r.status));
  }
} finally {
  fs.rmSync(临, { recursive: true, force: true });
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
