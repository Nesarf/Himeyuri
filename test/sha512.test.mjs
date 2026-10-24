// SHA-512 的验收：与 node 的 crypto 逐字符对照，覆盖填充边界与跨块。
//
// 判据只认别人的实现 —— 一个只与自己对称的哈希说明不了什么，
// 而 node 的 crypto 是这一台上最省事的权威。
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 临 = fs.mkdtempSync(path.join(ROOT, ".tmp-sha512-"));

const 跑 = (字节) => {
  const 路 = path.join(临, "样本.bin");
  fs.writeFileSync(路, 字节);
  const r = spawnSync(process.execPath, ["bin/hmyr.mjs", "--compile", "self/sha512.hmyr", 路], {
    cwd: ROOT, encoding: "utf8", timeout: 300000,
    env: { ...process.env, HMYR_STEPS: "4000000000" },
  });
  if (r.status !== 0) return { 坏: String(r.stderr || "").slice(0, 140) };
  return { 得: String(r.stdout || "").trim() };
};

// 四份样本：空、三字节、正好落在填充边界、跨两块。
const 样本们 = [
  ["空串", Buffer.alloc(0)],
  ["abc", Buffer.from("abc")],
  ["112 字节（填充边界）", Buffer.alloc(112, 0x61)],
  ["200 字节（跨块）", Buffer.alloc(200, 0x62)],
];

for (const [名, 字节] of 样本们) {
  const 应 = crypto.createHash("sha512").update(字节).digest("hex");
  const { 得, 坏 } = 跑(字节);
  ok(名 + "：跑得动", !坏, 坏);
  if (坏) continue;
  ok(名 + "：与 node 一致", 得 === 应, (得 || "").slice(0, 32) + " 对 " + 应.slice(0, 32));
}

fs.rmSync(临, { recursive: true, force: true });

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
