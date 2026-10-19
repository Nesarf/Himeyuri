// 发布的验收：准备得对，而默认不发。
//
// 最要紧的一条是最后那个：不带 --upload 时，它什么都不发。
// 一个跑一下就把东西发到外面的工具，是危险的工具。
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
const 跑 = (...参) => spawnSync(process.execPath, [path.join(ROOT, "tools/release.mjs"), ...参], { encoding: "utf8" });

console.log("一、不给 tag 就不动");
{
  const r = 跑();
  ok("退出码非零", r.status !== 0, String(r.status));
  ok("明说要给一个 tag", (r.stderr || "").includes("tag"), (r.stderr || "").slice(0, 100));
  ok("而且说了版本号该由人来做", (r.stderr || "").includes("由人"), (r.stderr || "").slice(-100));
}

console.log("二、准备，而不发");
{
  const r = 跑("--tag", "v0.0.0-test");
  ok("退出码零", r.status === 0, String(r.status));
  ok("打了包", r.stdout.includes("清单已签") || r.stdout.includes("没有签名钥匙"), r.stdout.slice(0, 160));
  ok("写了发布说明", fs.existsSync(path.join(ROOT, "dist/release-notes.md")));
  ok("列出了要发的资产", r.stdout.includes("要发的资产"), r.stdout.slice(-400));
  ok("明说「什么都没发」", r.stdout.includes("什么都没发"), r.stdout.slice(-300));
  ok("而没提到真的发了", !r.stdout.includes("已发："), r.stdout.slice(-200));
}

console.log("三、发布说明写全了三件事");
{
  const p = path.join(ROOT, "dist/release-notes.md");
  const 文 = fs.readFileSync(p, "utf8");
  ok("说了哪些带签名", 文.includes("哪些资产带签名"), 文.slice(0, 80));
  ok("说了哪些没有与为什么", 文.includes("哪些没有") && 文.includes("为什么"), 文.slice(0, 200));
  ok("说了怎么自己验", 文.includes("怎么自己验"), 文.slice(0, 300));
  ok("给了不装本项目任何工具的命令", 文.includes("ssh-keygen -Y verify"), 文.slice(-400));
  ok("而且带了 commit", 文.includes("提交"), 文.slice(0, 120));
}

console.log("四、顺序是硬的：签名之后才写说明");
{
  // 清单的 digest 与签名必须在说明写出来之前就定下来——
  // 因为签名会改变字节，先写说明再签，说明描述的就是已不存在的字节。
  const r = 跑("--tag", "v0.0.0-test");
  const 说明行 = r.stdout.split("\n").findIndex((l) => l.includes("发布说明已写"));
  const 签行 = r.stdout.split("\n").findIndex((l) => l.includes("清单已签") || l.includes("没有签名钥匙"));
  ok("签名那一步在说明之前", 签行 >= 0 && 说明行 > 签行, 签行 + " 对 " + 说明行);
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
