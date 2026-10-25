// OpenSSH 线格式的验收：base64 解出来、SSHSIG 结构逐段取出来。
//
// 样本是真的：dist/manifest.json.sig 的正文（一段 Ed25519 的分离签名）。
// 判据是各段的期望值，那些值由 node 独立解出过 —— 不靠「看起来像」。
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 样本 = "U1NIU0lHAAAAAQAAADMAAAALc3NoLWVkMjU1MTkAAAAgZKif3Awo5M1VeQW/gVzanyW+mELvOWFYVPMKSKHoGac" +
  "AAAAEZmlsZQAAAAAAAAAGc2hhNTEyAAAAUwAAAAtzc2gtZWQyNTUxOQAAAEDG2WX0neN+R094rpRHvcFLd0DY9l4b9L9S" +
  "aqC3RuKGwCzRiMX2ocTL/RcyUE1/6fdcfzoPbbDgf2ikWIBszBsB";

const 公钥blob = "0000000b7373682d656432353531390000002064a89fdc0c28e4cd557905bf815cda9f25be9842ef39615854f30a48a1e819a7";
const 签名blob = "0000000b7373682d6564323535313900000040c6d965f49de37e474f78ae9447bdc14b7740d8f65e1bf4bf526aa0b746e286c02cd188c5f6a1c4cbfd1732504d7fe9f75c7f3a0f6db0e07f68a458806ccc1b01";

const r = spawnSync(process.execPath, ["bin/hmyr.mjs", "--compile", "self/ssh.hmoca", 样本], {
  cwd: ROOT, encoding: "utf8", timeout: 300000,
});
ok("解析跑得动", r.status === 0, String(r.stderr || "").slice(0, 160));
const 出 = String(r.stdout || "");

if (r.status === 0) {
  const 行 = (片) => (出.split(/\r?\n/).find((l) => l.includes(片)) || "").trim();
  ok("总字节 174", 行("总字节").includes("174"), 行("总字节"));
  ok("魔数是 SSHSIG", 行("魔数").includes("SSHSIG"), 行("魔数"));
  ok("版本是 1", 行("版本").includes("1"), 行("版本"));
  ok("公钥 blob 逐字节相同", 行("公钥 blob").includes(公钥blob), 行("公钥 blob").slice(0, 60));
  ok("命名空间是 file", 行("命名空间").includes("file"), 行("命名空间"));
  ok("保留字段是空的", 行("保留").includes("0 字节"), 行("保留"));
  ok("哈希算法是 sha512", 行("哈希算法").includes("sha512"), 行("哈希算法"));
  ok("签名 blob 逐字节相同", 行("签名 blob").includes(签名blob), 行("签名 blob").slice(0, 60));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
