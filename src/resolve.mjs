// 包名的解析：从「一个 import 说明」到「一个绝对路径」。
//
// 这一层从 src/loader.mjs 里搬出来（2026-11-07），理由是依赖成环：
// loader.mjs 为了 HMYR_LOADER=self 那一个开关静态 import 了 loader-self.mjs，
// 而 loader-self.mjs 又要这三个函数 —— 于是被一百三十五个文件依赖的枢纽
// 和一个会 spawn 子进程的替身互相拴着，谁也没法单独测。
//
// 搬到这里的三个函数只用「能力」（cap）里的文件与路径两样，不碰加载器的其余部分，
// 所以两边都从这里拿，环就断了。搬的是原文，一个字符没改。

/**
 * 从某个文件往上找「包根」：最外层的那个含 hmyr.hmkit 的目录；找不到就用仓库根。
 *
 * 「最外层」这三个字是必要的，不是谨慎：每个包自己在 hmyr.hmkit 里说明身份
 * （design/PKGMAN.txt），所以「第一个含清单的目录」会是包自己 —— 于是
 * import "乙包" 会被解析成 甲包/乙包/index.hmoca。往上走到底、取最后遇到的那个，
 * 才是这个工程的外壳。
 */
export function 找包根(cap, fromFile) {
  let 目录 = cap.path.dirname(fromFile);
  let 最后 = null;
  for (let i = 0; i < 64; i++) {
    if (cap.file.exists(cap.path.join(目录, "hmyr.hmkit"))) 最后 = 目录;
    const 上 = cap.path.dirname(目录);
    if (上 === 目录) break;
    目录 = 上;
  }
  return 最后 || cap.path.root();
}

/**
 * 读一个包的清单，并做「形状」那一半的校验（design/PKGMAN.txt 第三节）。
 *
 * 装载器不计算哈希 —— 那要一个密码学库，而它至今只借文件与路径两样能力。
 * 哈希由 tools/hmkit-check.mjs 算。这里只验：能读、四项齐、名字与目录一致、
 * 版本是整数、许可非空、哈希的形状对。
 */
export function 读包清单(cap, 包根, 名, diagnostics) {
  const 路 = cap.path.join(包根, 名, "hmyr.hmkit");
  if (!cap.file.exists(路)) {
    diagnostics.error("HMYR-載-007", "package '" + 名 + "' has no hmyr.hmkit beside its index.hmoca", 0, 0);
    return null;
  }
  let 清单;
  try { 清单 = JSON.parse(String(cap.file.read(路))); }
  catch {
    diagnostics.error("HMYR-載-007", "package '" + 名 + "' has a manifest that is not JSON", 0, 0);
    return null;
  }
  if (!清单 || typeof 清单 !== "object" || Array.isArray(清单)) {
    diagnostics.error("HMYR-載-007", "package '" + 名 + "' has a manifest that is not an object", 0, 0);
    return null;
  }
  if (清单.名字 !== 名) {
    diagnostics.error("HMYR-載-007",
      "package '" + 名 + "' declares its name as '" + String(清单.名字) + "'; the directory and the manifest must agree, or 'which package did I import' becomes a guess", 0, 0);
  }
  if (!Number.isInteger(清单.版本)) {
    diagnostics.error("HMYR-載-007", "package '" + 名 + "' has no integer 版本 in its manifest", 0, 0);
  }
  if (typeof 清单.许可 !== "string" || 清单.许可.length === 0) {
    diagnostics.error("HMYR-載-007", "package '" + 名 + "' has no 许可 in its manifest", 0, 0);
  }
  if (typeof 清单.哈希 !== "string" || !/^sha256:[0-9a-f]{64}$/.test(清单.哈希)) {
    diagnostics.error("HMYR-載-007", "package '" + 名 + "' has no sha256:<64 lowercase hex> 哈希 in its manifest", 0, 0);
  }
  // 依赖（design/PKGMAN.txt 第二、三节）：名字 → 最低版本。
  //
  // 只写最低版本，不写区间 —— 因为 rev 的语义是「向下兼容」：模块提供到第 N 版
  // 就意味着它提供第 M 版（M 小于等于 N），于是「我要至少 M」正好可判，
  // 而一个区间要第二套版本语言。理由写在设计稿的第三节。
  if (清单.依赖 !== undefined) {
    if (typeof 清单.依赖 !== "object" || 清单.依赖 === null || Array.isArray(清单.依赖)) {
      diagnostics.error("HMYR-載-007", "package '" + 名 + "' has a 依赖 that is not an object of name->minimum version", 0, 0);
    } else {
      for (const [依赖名, 最低] of Object.entries(清单.依赖)) {
        if (!Number.isInteger(最低)) {
          diagnostics.error("HMYR-載-007", "package '" + 名 + "' asks for '" + 依赖名 + "' at a version that is not an integer", 0, 0);
          continue;
        }
        const 依赖清单路 = cap.path.join(包根, 依赖名, "hmyr.hmkit");
        if (!cap.file.exists(依赖清单路)) {
          diagnostics.error("HMYR-載-009",
            "package '" + 名 + "' depends on '" + 依赖名 + "', which is not in " + 包根 +
            "; a dependency is a package beside this one, and a missing one is not a warning", 0, 0);
          continue;
        }
        let 依赖清单 = null;
        try { 依赖清单 = JSON.parse(String(cap.file.read(依赖清单路))); } catch { 依赖清单 = null; }
        if (!依赖清单 || !Number.isInteger(依赖清单.版本)) continue;   // 它自己的形状由它自己的装载去报
        if (依赖清单.版本 < 最低) {
          diagnostics.error("HMYR-載-011",
            "package '" + 名 + "' needs '" + 依赖名 + "' at version at least " + 最低 + ", but it offers " +
            依赖清单.版本 + "; revisions only move forward, so a lower one cannot satisfy a higher request", 0, 0);
        }
      }
    }
  }
  if (清单.依赖哈希 !== undefined) {
    if (typeof 清单.依赖哈希 !== "object" || 清单.依赖哈希 === null || Array.isArray(清单.依赖哈希)) {
      diagnostics.error("HMYR-載-007", "package '" + 名 + "' has a 依赖哈希 that is not an object of name->hash", 0, 0);
    } else {
      for (const [依赖名, 哈希] of Object.entries(清单.依赖哈希)) {
        if (typeof 哈希 !== "string" || !/^sha256:[0-9a-f]{64}$/.test(哈希)) {
          diagnostics.error("HMYR-載-007", "package '" + 名 + "' records a 依赖哈希 for '" + 依赖名 + "' that is not sha256:<64 lowercase hex>", 0, 0);
        }
      }
    }
  }
  // 依赖与依赖哈希同进同退：只写一边，那一边什么也证明不了。
  // 这一条要在「依赖」那边查，而不是在「依赖哈希」那边 —— 只写依赖不写哈希的包
  // 根本走不到后一个分支，于是那句提示永远不会出现（第一版就是这样）。
  if (清单.依赖 && typeof 清单.依赖 === "object" && !Array.isArray(清单.依赖)) {
    const 哈希表 = 清单.依赖哈希 && typeof 清单.依赖哈希 === "object" && !Array.isArray(清单.依赖哈希) ? 清单.依赖哈希 : {};
    for (const 依赖名 of Object.keys(清单.依赖)) {
      if (!(依赖名 in 哈希表)) {
        diagnostics.warn("HMYR-載-010",
          "package '" + 名 + "' depends on '" + 依赖名 + "' without recording its hash; the hash is what tells you the package you use has not been swapped", 0, 0);
      }
    }
  }
  // 签名（design/PKGMAN.txt 第五节）：装载器只验形状。
  //
  // 真伪由 tools/hmkit-check.mjs 验 —— 那要 node:crypto，而装载器只借文件与路径。
  // 形状包括：算法名认得、值的形状对、可信表里有这个包的公钥。
  // 最后那一条在这里查，是因为「信任的锚在被信任的东西之外」这件事，
  // 装载器是唯一同时看得见包与包根的一层。
  if (清单.签名 !== undefined) {
    const 签名 = 清单.签名;
    if (!签名 || typeof 签名 !== "object" || Array.isArray(签名)) {
      diagnostics.error("HMYR-載-007", "package '" + 名 + "' has a 签名 that is not an object", 0, 0);
    } else {
      if (签名.包 !== 名) {
        diagnostics.error("HMYR-載-007",
          "package '" + 名 + "' has a 签名 for '" + String(签名.包) + "'; the package name is signed too, or one signature could be moved onto another manifest", 0, 0);
      }
      if (签名.算法 !== "ed25519") {
        diagnostics.error("HMYR-載-007", "package '" + 名 + "' signs with '" + String(签名.算法) + "', and ed25519 is the only algorithm this layer knows", 0, 0);
      }
      if (typeof 签名.值 !== "string" || !/^[0-9a-f]{128}$/.test(签名.值)) {
        diagnostics.error("HMYR-載-007", "package '" + 名 + "' has a 签名 值 that is not 128 lowercase hex digits", 0, 0);
      }
      // 可信表：包根下的 hmyr.hmtrust。它不在包里 —— 不然换包的人顺手换掉锚。
      const 表路 = cap.path.join(包根, "hmyr.hmtrust");
      if (!cap.file.exists(表路)) {
        diagnostics.error("HMYR-載-012",
          "package '" + 名 + "' is signed, but there is no hmyr.hmtrust beside it; a signature with no table to check it against proves nothing", 0, 0);
      } else {
        let 表 = null;
        try { 表 = JSON.parse(String(cap.file.read(表路))); } catch { 表 = null; }
        const 钥 = 表 && typeof 表 === "object" && !Array.isArray(表) ? 表[名] : undefined;
        if (typeof 钥 !== "string" || !/^[0-9a-f]{64}$/.test(钥)) {
          diagnostics.error("HMYR-載-012",
            "package '" + 名 + "' is signed, but hmyr.hmtrust has no 64 lowercase hex public key for it", 0, 0);
        }
      }
    }
  }
  return 清单;
}

/**
 * 把一个 import 说明解析成一个绝对路径。
 *
 * 两种形式：路径（相对、绝对、带盘符），与包名。
 * 包名的规则只有一句：是包根下面的一个目录，入口是那个目录里的 index.hmoca。
 * 一条规则、一个约定文件名 —— 因为它要在四台机器上给出同一个答案，
 * 而任何「按清单字段去猜」的写法都会把答案藏进解析顺序里。
 */
export function resolveImport(cap, fromFile, spec, diagnostics) {
  if (spec.startsWith("./") || spec.startsWith("../") || /^[A-Za-z]:[\\/]/.test(spec) || cap.path.isAbsolute(spec)) {
    return cap.path.resolve(cap.path.dirname(fromFile), spec);
  }
  // 包名：只认「像名字」的形状，其余仍然交给包管理器（与以前一样）。
  // 允许非 ASCII —— 这门语言的标识符本来就能写中文，包名没有理由更窄。
  const 名 = spec.replace(/\/+$/, "");
  if (!/^[\p{L}_][\p{L}\p{N}_-]*$/u.test(名)) return null;
  const 包根 = 找包根(cap, fromFile);
  // 有诊断出口时顺手把清单读一遍 —— 那件事只有包名这一支需要。
  if (diagnostics) 读包清单(cap, 包根, 名, diagnostics);
  return cap.path.join(包根, 名, "index.hmoca");
}
