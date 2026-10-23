// 工具链账本：每一项要么搬进了 HMYR，要么被判为不必搬，两种都有据可查。
//
// 为什么账本是可执行的东西：design/SELFRUN.txt 的「远读法」有两种结清方式 ——
// 搬，或者证明它不在「跑程序」那条路上。写在文档里的一句话没法被检查；
// 写成这张表，就能让 test/tooling-ledger.test.mjs 去核：
//
//   搬了的        要有一个在 check-all 里登记的验收套件
//   不搬的        要有理由，而且它的文件必须落在 runtime-path 的「工具」清单里
//                 （那是「不在运行时路径上」的可执行证明）
//
// 用法：node tools/tooling-ledger.mjs          打出整张表
//       node tools/tooling-ledger.mjs --check  只报不一致（给测试用）

export const 账本 = [
  {
    名: "读",
    状态: "搬了",
    在哪: "self/lex.hmyr 与另外五件",
    验收: "self",
    说明: "词法、语句、函数体、签名、切分",
  },
  {
    名: "编译链",
    状态: "搬了",
    在哪: "self/compile.hmyr",
    验收: "bytecode",
    说明: "表达式与语句编成字节码",
  },
  {
    名: "打包（字节码文件）",
    状态: "搬了",
    在哪: "self/pack.hmyr",
    验收: "seed",
    说明: "把编译好的程序写成 .hmyrb，这就是种子在做事",
  },
  {
    名: "求值",
    状态: "搬了",
    在哪: "self/eval.hmyr 与 self/run.hmyr",
    验收: "seed",
    说明: "自举求值器与它的入口",
  },
  {
    名: "启动",
    状态: "搬了",
    在哪: "vm/hmyr.c",
    验收: "cvm",
    说明: "C 那台自己就是启动器，不需要 node",
  },
  {
    名: "测试框架",
    状态: "搬了",
    在哪: "self/check.hmyr",
    验收: "checkhmyr",
    说明: "读清单、跑套件、按退出码汇总；清单由 check-all 导出",
  },
  {
    名: "嵌入",
    状态: "搬了",
    在哪: "self/embed.hmyr",
    验收: "embedhmyr",
    说明: "把 .hmyrb 摊成 C 数组，用 read_bytes",
  },
  {
    名: "语料生成：区间表",
    状态: "搬了",
    在哪: "self/ucd-c.hmyr",
    验收: "ucdchmyr",
    说明: "字母与记号两张表，两份实现逐字节相同",
  },
  {
    名: "语言服务器",
    状态: "搬了第一版",
    在哪: "self/lsp.hmyr",
    验收: "lsphmyr",
    说明: "initialize / shutdown / exit；符号、定义、悬浮还没搬",
  },
  {
    名: "语料生成：另外三支",
    状态: "不搬",
    为什么不搬: "它们生成的是两张静态表与一份全码点扫描，产物已经入库；生成器只在换 UCD 时跑一次，不在「跑程序」这条路上。要更新表时用 JS 那一份，它是权威。",
    证明: ["tools/ucd-case.mjs", "tools/ucd-nfc.mjs", "tools/ucd.mjs"],
  },
  {
    名: "格式化器",
    状态: "不搬",
    为什么不搬: "它是开发时的排版工具，不在运行时路径上。要搬的话得先接上自举侧的完整语句树（parse.hmyr 只认表达式），那是另一件事。",
    证明: ["src/format.mjs"],
  },
  {
    名: "打包发布",
    状态: "不搬",
    为什么不搬: "发布是人的动作，不是程序的动作；而且 ZIP 里的 deflate 要先有压缩实现，而这门语言还没有。它不在「跑程序」这条路上。",
    证明: ["tools/package.mjs", "tools/release.mjs", "tools/manifest.mjs", "tools/verify.mjs"],
  },
];

export function 表格() {
  const 行们 = [];
  const 宽 = (s, n) => {
    let 出 = s;
    while (出.length < n) 出 += " ";
    return 出;
  };
  for (const 项 of 账本) {
    行们.push(宽(项.状态, 10) + 宽(项.名, 22) + (项.在哪 || 项.证明.join(" ")));
  }
  return 行们;
}

if (process.argv[1] && process.argv[1].endsWith("tooling-ledger.mjs")) {
  const 行们 = 表格();
  for (const 行 of 行们) console.log(行);
  const 搬了 = 账本.filter((x) => x.状态.startsWith("搬")).length;
  console.log("");
  console.log("共 " + 账本.length + " 项：搬了 " + 搬了 + " 项，不搬 " + (账本.length - 搬了) + " 项");
}
