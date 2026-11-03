// 与 ssh-keygen 的互通：第一步 —— HMYR 写出来的私钥，ssh-keygen 认不认。
//
// design/SIGNING.txt 第 141 行走了一半：验那半边早就通了（test/sign.test.mjs 验的就是
// ssh-keygen 签出来的东西），而「HMYR 签的东西 ssh-keygen 认不认」一直没验。
//
// 四个箭头里这是第一个：
//   HMYR 从 seed 写私钥  →  ssh-keygen -y 读出同一个公钥
// 后面三个（ssh-keygen 签 → HMYR 验、HMYR 签 → ssh-keygen -Y verify）要 SSHSIG 结构，
// 等这一步稳了再接。
//
// 一条前提写在明处：私钥文件必须 0600，否则 ssh-keygen 拒绝读它（它报的是
// UNPROTECTED PRIVATE KEY FILE）。那是权限不是格式，所以这一页自己 chmod。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 有ssh = (() => {
  try { return spawnSync("ssh-keygen", ["-?"], { encoding: "utf8" }).status !== null; } catch { return false; }
})();
if (!有ssh) {
  console.log("  跳过  这台机器上没有 ssh-keygen —— 互通那半边不验");
} else {
  // RFC 8032 Test 1 的 seed 与它该派生的公钥。
  const 种 = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
  const 公 = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";

  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-key-"));
  const 私 = path.join(临, "key.pem");
  const 出行 = path.join(临, "key.pub");

  // 一条 HMYR 程序：写那两份文件。写成临时文件放在仓库根，因为 引入 用的是相对路径。
  const 源 = [
    '引入 "./self/keyfile.hmoca"',
    "",
    "函数 main() -> Int effects(file) {",
    `  定 种 = 解base64十六进制("${种}")`,
    `  write_text("${私.replace(/\\/g, "/")}", 成私钥文(种, "hmyr"), "utf8")`,
    `  write_text("${出行.replace(/\\/g, "/")}", 成公钥文(种, "hmyr"), "utf8")`,
    "  返回 0",
    "}",
    "",
  ].join("\n");
  const 路 = path.join(ROOT, ".tmp-keyfile.hmoca");
  fs.writeFileSync(路, 源, "utf8");
  let 写 = null;
  try {
    写 = spawnSync(process.execPath,
      [path.join(ROOT, "bin", "hmyr.mjs"), "--compile", 路],
      { encoding: "utf8", timeout: 300000, env: { ...process.env, HMYR_STEPS: "80000000000" } });
  } finally {
    fs.rmSync(路, { force: true });
  }

  console.log("一、HMYR 写得出一份私钥");
  ok("两份文件都写出来了", fs.existsSync(私) && fs.existsSync(出行),
     String(写 && 写.stderr || "").slice(0, 140));

  console.log("二、ssh-keygen 读得懂它");
  if (!fs.existsSync(私)) {
    console.log("  跳过  私钥没写出来，后面两条不验");
  } else {
    fs.chmodSync(私, 0o600);
    if (process.platform === "win32") {
      // Windows 上 chmod 只改只读位，而 ssh-keygen 检查的是 ACL —— 它要「只有当前用户能读」。
      // 所以补一条 icacls：去掉继承、只留当前用户的完全控制。
      // 2026-11-03 撞到，报的是 "Bad permissions. Try removing permissions for user: BUILTIN\Users"。
      const 户 = process.env.USERNAME || "";
      spawnSync("icacls", [私, "/inheritance:r", "/grant:r", 户 + ":F"], { encoding: "utf8" });
    }
    const 读 = spawnSync("ssh-keygen", ["-y", "-f", 私], { encoding: "utf8" });
    ok("ssh-keygen -y 退出码零", 读.status === 0, String(读.status) + " " + String(读.stderr || "").slice(0, 120));
    const 出 = String(读.stdout || "").trim().split(/\s+/);
    ok("它读出的公钥就是 RFC 8032 那一个", 出[1] === "AAAAC3NzaC1lZDI1NTE5AAAAINdamAGCsQq31Uv+08lkBzoO4XLz2qYjJa8CGmj3B1Ea",
       String(读.stdout || "").slice(0, 120));
    // .pub 那一行自己也要对得上：它同样由 HMYR 写成。
    const 行 = fs.readFileSync(出行, "utf8").trim().split(/\s+/);
    ok("HMYR 写的 .pub 与它一致", 行[0] === "ssh-ed25519" && 行[1] === 出[1], String(行[1] || "").slice(0, 60));
  }
  fs.rmSync(临, { recursive: true, force: true });
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
