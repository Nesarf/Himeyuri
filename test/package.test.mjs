// 打包的验收：出来的东西里有一份清单，而那份清单说得通。
//
// 关键的一条是最后那个：包里带着清单，而清单能被 tools/verify.mjs 验。
// 那说明这份包是自洽的——别人拿到它，不用问作者就知道自己拿到的是什么。
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
const 临 = fs.mkdtempSync("E:/DaShaoHuo/cache/tmp/pkg-");
const 出 = path.join(临, "out.zip");

try {
  console.log("一、打得出来");
  {
    const r = spawnSync(process.execPath, [path.join(ROOT, "tools/package.mjs"), "--out", 出], { encoding: "utf8" });
    ok("退出码零", r.status === 0, String(r.status));
    ok("说了收了多少文件", /收了 \d+ 个文件/.test(r.stdout), r.stdout.slice(0, 50));
    ok("文件真的在", fs.existsSync(出) && fs.statSync(出).size > 1000, String(fs.existsSync(出)));
    ok("而且它明说「这是 zip，不是 PE」", r.stdout.includes("OnlySign"), r.stdout.slice(-80));
  }

  console.log("二、包里有什么");
  {
    const 解 = path.join(临, "x");
    fs.mkdirSync(解, { recursive: true });
    const r = spawnSync("powershell", ["-NoProfile", "-Command",
      "Expand-Archive -Path '" + 出 + "' -DestinationPath '" + 解 + "' -Force"], { encoding: "utf8" });
    ok("解得开", fs.existsSync(path.join(解, "manifest.json")), String(r.status));
    ok("清单在里面", fs.existsSync(path.join(解, "manifest.json")));
    ok("源码在里面", fs.existsSync(path.join(解, "src", "eval.mjs")));
    ok("语言文件在里面", fs.existsSync(path.join(解, "term.hmyr")));
    ok("套件在里面", fs.existsSync(path.join(解, "test")));
    ok("设计文档在里面", fs.existsSync(path.join(解, "design")));
    ok("标准库在里面", fs.existsSync(path.join(解, "runtime", "text.hmyr")));

    console.log("三、包里那份清单能被验");
    // 清单里的哈希是按仓库根算的，而包里是一个完整的仓库副本，
    // 于是拿包目录当根去验就该全对。
    const 验 = spawnSync(process.execPath, [path.join(解, "tools", "verify.mjs"), "--in", path.join(解, "manifest.json")], {
      encoding: "utf8", cwd: 解,
    });
    ok("验得过（退出码零）", 验.status === 0, (验.stdout || "").slice(-160));
    ok("而且说清单没被动过", (验.stdout || "").includes("清单本身没被动过"), (验.stdout || "").slice(0, 100));
  }
} finally {
  fs.rmSync(临, { recursive: true, force: true });
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
