// 一条真签名的完整一跳：读 .sig、拼被签数据、交给 Ed25519 验。
//
// 判据是发布物本身 —— dist/manifest.json 与 dist/manifest.json.sig 由同一次发布产出，
// 而它们由 HMYR 自己验：不经 ssh-keygen，也不经 node 的 crypto。
//
// 被签数据的形状按 PROTOCOL.sshsig 第 3 节，只有五段：
//   6 字节魔数 + 命名空间 + 保留 + 哈希算法 + 消息的哈希。
// 这一份签名下它正好 96 字节。第一版把版本与公钥 blob 也塞了进去，于是每一份合法签名
// 都验不过 —— 而那种失败长得像「算法错」。所以这里除了「通过」，还要求「改了就不过」。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label + (detail ? "  " + detail : "")); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 验 = (签名路, 消息路) => {
  const r = spawnSync(process.execPath, ["bin/hmyr.mjs", "--compile", "self/sign.hmoca", 签名路, 消息路], {
    cwd: ROOT, encoding: "utf8", timeout: 300000,
    env: { ...process.env, HMYR_STEPS: "20000000000" },
  });
  if (r.status !== 0) return { 坏: String(r.stderr || "").slice(0, 140) };
  const 出 = String(r.stdout || "");
  return { 通过: 出.indexOf("通过") >= 0 && 出.indexOf("不通过") < 0 };
};

const 签名 = path.join(ROOT, "dist/manifest.json.sig");
const 清单 = path.join(ROOT, "dist/manifest.json");

if (!fs.existsSync(签名) || !fs.existsSync(清单)) {
  console.log("  跳过  dist 里没有 manifest.json 与它的签名：发布物打出来之后才有");
} else {
  console.log("一、发布物自己的签名");
  const 好 = 验(签名, 清单);
  ok("HMYR 验得过那份真签名", 好.通过 === true, 好.坏);

  console.log("二、判据要敢说否");
  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-sign-"));
  const 改 = Buffer.from(fs.readFileSync(清单));
  改[Math.floor(改.length / 2)] ^= 0x01;
  const 改路 = path.join(临, "manifest.json");
  fs.writeFileSync(改路, 改);
  const 坏 = 验(签名, 改路);
  ok("清单改一个字节就不通过", 坏.通过 === false, 坏.坏);

  const 缺 = 验(签名, path.join(临, "no-such-file"));
  ok("消息不存在时如实失败", 缺.通过 !== true, 缺.坏);
  fs.rmSync(临, { recursive: true, force: true });
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
