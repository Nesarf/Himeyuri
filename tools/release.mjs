// 发布：把 dist/ 那三件备好，并写出发布说明。
//
// 默认只准备，不发送。--upload 才真发——因为往外面发东西该是一个明确的动作，
// 而不是跑一下工具就顺手做了的事。
//
// 发布说明写三件事，那是 S.M.Y.T. 的规矩（design/DISTRO.txt 引过）：
//   一、哪些资产带签名
//   二、哪些没有、以及为什么
//   三、怎么在不装本项目任何工具的情况下自己验
//
//   node tools/release.mjs --tag v0.1.0            准备（写说明、列命令）
//   node tools/release.mjs --tag v0.1.0 --upload   真发到 GitHub Releases
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 参 = process.argv.slice(2);
const 位 = 参.indexOf("--tag");
const 标 = 位 >= 0 ? 参[位 + 1] : "";
const 发 = 参.includes("--upload");

if (!标) {
  console.error("  要给一个 tag：node tools/release.mjs --tag v0.1.0");
  console.error("  版本号不是工具能猜的——它是一个声明，而声明由人来做。");
  process.exit(2);
}

// 一、先打包：清单与签名都刷新。顺序是硬约束——签名会改变字节，
// 于是「先签再打包」会得到一份描述已不存在字节的清单。
const 包 = spawnSync(process.execPath, [path.join(ROOT, "tools/package.mjs")], { encoding: "utf8" });
process.stdout.write(包.stdout || "");
if (包.status !== 0) { console.error("  打包失败，发布中止。"); process.exit(1); }

const 清单 = JSON.parse(fs.readFileSync(path.join(ROOT, "dist/manifest.json"), "utf8"));
const 签名在 = fs.existsSync(path.join(ROOT, "dist/manifest.json.sig"));

// 二、发布说明
const 说明 = `Himeyuri ${标}

  提交      ${清单.commit || "（未知）"}
  内核      ${清单.kernel.builtins} 个内置，其中最小的集合 ${清单.kernel.minimalSet.length} 个
  标准库    ${清单.standardLibrary.length} 个文件
  套件      ${清单.suites.length} 套
  工具      ${清单.tools.length} 件
  文档      ${清单.documents.length} 份

哪些资产带签名
--------------------------------------------------------------------

  manifest.json.sig 是清单的分离签名（Ed25519，用 S.M.Y.T. 的签名钥匙）。
  而 zip 本身没有签名：压缩归档没有内嵌签名的位置，所以签的是清单，
  不是它。这一条是 S.M.Y.T. 对 Linux 包与 portable 归档的既有做法。

哪些没有，以及为什么
--------------------------------------------------------------------

  zip 没有内嵌签名——它里面没有地方放一个签名。于是它靠清单覆盖：
  清单里每个文件一个 sha256，整份清单一个 digest，而清单本身被签名。
  于是「这一包是什么」由清单说，「清单是谁给的」由签名说。

怎么自己验（不装本项目任何工具）
--------------------------------------------------------------------

  一、验清单的签名（需要 OpenSSH 9.5 以上）：

      ssh-keygen -Y verify \\
        -I Nesarf@users.noreply.github.com -n file \\
        -f allowed_signers \\
        -s manifest.json.sig < manifest.json

    通过时输出：Good "file" signature for Nesarf@users.noreply.github.com
    公钥在 allowed_signers 里，而它是这份发布的一部分。

  二、验每个文件的哈希：

      node tools/verify.mjs --in manifest.json

    它会逐项比对，并说清「内容对不对」与「签名对不对」。
    注意：清单里的路径以仓库根为基准，所以它验的是这一包解开之后的样子。

  三、不想跑任何脚本时，只看一件事：清单的 digest。
    它是清单自身的 sha256，而签名覆盖的是清单。于是校验 digest 就够判断
    「这份清单有没有被动过」——而签名告诉你它是谁给的。
`;

fs.writeFileSync(path.join(ROOT, "dist/release-notes.md"), 说明, "utf8");
console.log("  发布说明已写：dist/release-notes.md（" + 说明.split("\n").length + " 行）");
console.log("  清单 digest " + 清单.digest.slice(0, 16) + " · 签名 " + (签名在 ? "有" : "没有"));

// 三、要发出去的资产
const 资 = ["himeyuri-" + 清单.generatedAt + ".zip", "manifest.json"];
if (签名在) 资.push("manifest.json.sig");
const 缺 = 资.filter((n) => !fs.existsSync(path.join(ROOT, "dist", n)));
if (缺.length) { console.error("  少了资产：" + 缺.join(" ")); process.exit(1); }

console.log("");
console.log("  要发的资产：");
for (const n of 资) console.log("    dist/" + n + "（" + Math.round(fs.statSync(path.join(ROOT, "dist", n)).size / 1024) + " KB）");

if (!发) {
  console.log("");
  console.log("  准备好了，但什么都没发。真发用 --upload，或者手工跑：");
  console.log("    gh release create " + 标 + " " + 资.map((n) => "dist/" + n).join(" ") + " \\");
  console.log("      --title \"Himeyuri " + 标 + "\" --notes-file dist/release-notes.md");
  process.exit(0);
}

// 四、真发
const 上 = spawnSync("gh", ["release", "create", 标, ...资.map((n) => path.join(ROOT, "dist", n)),
  "--title", "Himeyuri " + 标, "--notes-file", path.join(ROOT, "dist/release-notes.md")], { encoding: "utf8" });
if (上.status !== 0) {
  console.error("  发不出去：" + String(上.stderr || 上.stdout).trim().slice(0, 200));
  process.exit(1);
}
console.log("  已发：" + String(上.stdout).trim());
