// 签名的验收：self/sign.hmoca 的 签名 与 从种子，对着 RFC 8032 的两组测试向量。
//
// 为什么用 RFC 的向量而不是「自己签、自己验」：后者在实现错得一致的时候照样全绿。
// design/SIGNING.txt 记过这个陷阱 —— 那个 k 与每一份正确实现都不同，而它自己与自己
// 始终一致，于是两个月都看着像对的。RFC 8032 是第一个不和 HMYR 商量的对手。
//
// 两组向量都来自 RFC 8032 第七节（Test 1 与 Test 2），公钥与签名都是定值。
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

// 一条向量：种子、消息（十六进制，空串表示空消息）、公钥、签名。
const 向量 = [
  {
    名: "RFC 8032 Test 1",
    种: "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
    消: "",
    公: "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
    签: "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155"
      + "5fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
  },
  {
    名: "RFC 8032 Test 2",
    种: "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb",
    消: "72",
    公: "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c",
    签: "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da"
      + "085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00",
  },
];

// 一条程序：把 从种子 与 签名 的结果打出来，一行一个。
const 跑一条 = (种, 消) => {
  const 源 = [
    '引入 "./self/sign.hmoca"',
    "",
    "函数 十六(字节串: Int) -> String {",
    '  定 表 = "0123456789abcdef"',
    '  变 出 = ""',
    "  变 i = 0",
    "  当 i < len(字节串) {",
    "    定 v = to_int(字节串[i])",
    "    出 = 出 + slice(表, (v - v % 16) / 16, (v - v % 16) / 16 + 1) + slice(表, v % 16, v % 16 + 1)",
    "    i = i + 1",
    "  }",
    "  返回 出",
    "}",
    "",
    "函数 main() -> Int {",
    `  定 种 = 解base64十六进制("${种}")`,
    `  定 消 = 解base64十六进制("${消}")`,
    '  定 材 = 从种子(种)',
    '  print("公 " + 十六(材.公) + chr(10))',
    '  print("签 " + 十六(签名(种, 消)) + chr(10))',
    "  返回 0",
    "}",
    "",
  ].join("\n");
  // 临时文件写在仓库根：引入用的是相对 self/ 的路径，放在别处解析不到。
  const 路 = path.join(ROOT, ".tmp-signgen.hmoca");
  fs.writeFileSync(路, 源, "utf8");
  try {
    return spawnSync(process.execPath,
      [path.join(ROOT, "bin", "hmyr.mjs"), "--compile", 路],
      { encoding: "utf8", timeout: 300000, env: { ...process.env, HMYR_STEPS: "80000000000" } });
  } finally {
    fs.rmSync(路, { force: true });
  }
};

for (const v of 向量) {
  console.log("\n" + v.名);
  const r = 跑一条(v.种, v.消);
  const 行 = String(r.stdout || "");
  const 取 = (键) => {
    const m = 行.match(new RegExp("^" + 键 + " (.*)$", "m"));
    return m ? m[1].trim() : "";
  };
  ok("公钥与 RFC 一致", 取("公") === v.公, 取("公"));
  ok("签名与 RFC 一致", 取("签") === v.签, 取("签") + " " + String(r.stderr || "").slice(0, 80));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
