// 验清单的验收：对得上就说对得上，而改过一处就要说不通过。
//
// 第二条比第一条重要得多。一个永远说「通过」的验证器与没有验证器一样，
// 而它的危害更大——它让人以为验过了。
//
// 这一套不碰 dist/：它在临时目录里自己造清单、自己签、自己验。
// 曾有一版依赖仓库里的 dist/manifest.json，于是「改一行 verify.mjs」
// 就让清单过期、测试变红——那测的是打包顺序，不是验证器。
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
const 验 = (...参) => spawnSync(process.execPath, [path.join(ROOT, "tools/verify.mjs"), ...参], { encoding: "utf8" });
const 临 = fs.mkdtempSync("E:/DaShaoHuo/cache/tmp/verify-");

// 本机的签名能力：有就测签名那几节，没有就跳过去。
const 钥匙 = "C:/Windows/System32/OpenSSH/ssh-keygen.exe";
const 私钥 = "C:/Users/Administrator/.ssh/signing_ed25519_20261011";
const allowed = "C:/Users/Administrator/.ssh/allowed_signers";
const 能签 = fs.existsSync(钥匙) && fs.existsSync(私钥) && fs.existsSync(allowed);

try {
  // 一份最小的清单：只列一个真实存在的文件，哈希按真算。
  // 清单里的路径以仓库根为基准（那是 verify 的规矩，也是清单的规矩）——
  // 于是这里不能凭空造一个 target.txt，得用一个仓库里真有的文件。
  // 那个文件不会被改动，而它的哈希按真算。
  const 造 = (名, 内容) => {
    const p = path.join(临, 名);
    fs.writeFileSync(p, 内容, "utf8");
    return p;
  };
  const 真件 = "runtime/text.hmyr";
  const { createHash } = await import("node:crypto");
  const 哈 = (p) => createHash("sha256").update(fs.readFileSync(path.join(ROOT, p))).digest("hex").slice(0, 16);
  const 列表 = (哈希) => {
    const 清 = {
      name: "test",
      kernel: { builtins: 1, minimalSet: ["len"] },
      standardLibrary: [{ file: 真件, functions: 21, lines: 131, sha256: 哈希 }],
      suites: [],
      tools: [],
      documents: [],
    };
    // digest 要自洽：先不含它算一次，再补进去
    清.digest = createHash("sha256").update(JSON.stringify(清, null, 2)).digest("hex");
    return 清;
  };
  const 真 = 哈(真件);
  const 清单路径 = 造("m.json", JSON.stringify(列表(真), null, 2) + "\n");

  console.log("一、对得上就说对得上");
  {
    const r = 验("--in", 清单路径);
    ok("退出码零", r.status === 0, String(r.status));
    ok("说清了对上多少项", /对得上 \d+ 项/.test(r.stdout), r.stdout.slice(0, 60));
    ok("而且说了「内容与签名都查了」", r.stdout.includes("内容对不对") || r.stdout.includes("签名对不对"), r.stdout.slice(-120));
  }

  console.log("二、内容一改就验不过");
  {
    const 坏 = 造("bad.json", JSON.stringify(列表("0000000000000000"), null, 2) + "\n");
    const r = 验("--in", 坏);
    ok("退出码非零", r.status !== 0, String(r.status));
    ok("指出了是哪一项不对", r.stdout.includes("[不通过]"), r.stdout.slice(0, 120));
  }

  console.log("三、清单本体一改就验不过");
  {
    const 清 = 列表(真);
    清.name = "改过的";
    const 坏 = 造("tampered.json", JSON.stringify(清, null, 2) + "\n");
    const r = 验("--in", 坏);
    ok("退出码非零", r.status !== 0, String(r.status));
    ok("说清单本身被动过了", r.stdout.includes("清单本身被动过了"), r.stdout.slice(0, 100));
  }

  console.log("四、分离签名");
  if (!能签) {
    console.log("    跳过：这台机器上没有签名钥匙");
  } else {
    // 先删旧 .sig：ssh-keygen 会问「Overwrite (y/n)?」而脚本里没人回答。
    const 签路径 = 清单路径 + ".sig";
    fs.rmSync(签路径, { force: true });
    const 签 = spawnSync(钥匙, ["-Y", "sign", "-f", 私钥, "-n", "file", 清单路径], { encoding: "utf8" });
    ok("签得出来", fs.existsSync(签路径), String(签.status));

    const 好 = 验("--in", 清单路径);
    ok("签过之后验得过", 好.status === 0, (好.stdout || "").slice(-140));
    ok("而且说了签名验过", (好.stdout || "").includes("分离签名验过了"), (好.stdout || "").slice(-160));

    // 改一个字节：签名就不再匹配
    const 原 = fs.readFileSync(清单路径, "utf8");
    fs.writeFileSync(清单路径, 原.replace('"name": "test"', '"name": "test2"'), "utf8");
    const 坏 = 验("--in", 清单路径);
    fs.writeFileSync(清单路径, 原, "utf8");
    ok("改一个字节签名就验不过", 坏.status !== 0, String(坏.status));
    ok("而且指出是签名不对", (坏.stdout || "").includes("分离签名验不过"), (坏.stdout || "").slice(-140));
  }

  console.log("五、读不了的清单");
  {
    const r = 验("--in", path.join(临, "没有这个.json"));
    ok("给出非零退出码与说明", r.status !== 0 && r.stderr.indexOf("读不了") >= 0, String(r.status));
  }
} finally {
  fs.rmSync(临, { recursive: true, force: true });
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
