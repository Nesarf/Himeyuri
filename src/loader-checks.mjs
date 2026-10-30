// 装载的第二趟：那些「树已经有了、只看树」的检查。
//
// 为什么抽出来（2026-11-02）：src/loader-self.mjs 与 tools/self-bridge.mjs 是两条
// 完全不同的路 —— 前者只换 loadUnit，后者连 runUnit 也换 —— 而它们要做的第二趟
// 一模一样：区、实时、持有格、共享名字、可见性第一步。抄第二份就等于让两份知识
// 分叉，而分叉的代价前面已经付过一次（是路径 在同一个文件里定义了两遍，后到的悄悄赢）。
//
// 留着不搬的两件是「与 import 解析有关」的：别名表与包清单、版本协商 —— 那两者
// 各自要知道 import 说明怎么解析成一个文件，而两条 loader 的解析方式不同。
import path from "node:path";
import { 区检查 } from "./zone-check.mjs";
import { 实时检查 } from "./realtime-check.mjs";
import { 持有格检查 } from "./owned-check.mjs";

/**
 * 一份模块的编译期检查：区（design/MEMORY.txt 第一、二条）与实时档位那四条。
 *
 * 宿主在 visit 里做这两件（src/loader.mjs 第 282 与 291 行）。换掉 loader 之后
 * 它们得有人做，否则「装载应当失败」的那些判据会看到 ok:true。
 */
export function 逐模块检查(ast, 文件名, diagnostics, options = {}) {
  if (options.zoneCheck !== false) {
    for (const d of 区检查(ast, { 文件: 文件名 })) {
      if (d.severity === "error") diagnostics.error(d.code, d.message, d.line, d.column);
      else diagnostics.warn(d.code, d.message, d.line, d.column);
    }
  }
  if (options.realtimeCheck !== false) {
    for (const d of 实时检查(ast, { 文件: 文件名 })) {
      diagnostics.error(d.code, d.message, d.line, d.column);
    }
  }
}

/**
 * 整棵树的检查：共享名字（HMYR-載-004）、可见性第一步（HMYR-載-006）、持有格（两趟）。
 *
 * 持有格要两张跨模块的表，所以它必须是「先收集、再报错」两趟 —— 一趟报不了，
 * 因为「被调者可能先在别的模块里装载过」这件事只有收齐了才知道。
 */
export function 全树检查(modules, order, diagnostics, options = {}) {
  const 短名 = (p) => path.basename(p);

  // 按真实路径去重（2026-11-02）：桥那条路给同一个模块挂了两个门牌 —— order 里是
  // 相对形式，查询上还有绝对形式。不去重的话，同一个文件会被当成两个模块，
  // 于是「两个模块声明了同一个名字」这条会在同一个文件上对自己报一次
  // （症状：消息里两头是同一个路径），而 modules 那套要的是一条警告。
  const 去过 = [];
  const 见过 = new Set();
  for (const abs of order) {
    const 真 = path.resolve(abs);
    if (见过.has(真)) continue;
    见过.add(真);
    去过.push(abs);
  }
  order = 去过;

  // 共享名字：函数表是扁平的，两个模块声明同一个名字就是一次静默覆盖。
  const 已声明 = new Map();
  for (const abs of order) {
    const ast = modules.get(abs);
    if (!ast) continue;
    for (const decl of ast.decls || []) {
      if (decl.kind !== "Fn" && decl.kind !== "Const" && decl.kind !== "TypeAlias") continue;
      if (已声明.has(decl.name)) {
        diagnostics.warn(
          "HMYR-載-004",
          "two modules declare '" + decl.name + "' (" + 短名(已声明.get(decl.name)) + " and " + 短名(abs) +
            "); the later one wins until namespaces exist",
          0,
          0,
        );
      } else {
        已声明.set(decl.name, abs);
      }
    }
  }

  // 可见性第一步（SPEC 6.4 第二步）：非 pub 的声明被别的模块调用时说一声。
  // 只把「调用」算作引用 —— 局部变量与参数不是对全局声明的引用，把它们算进去
  // 会盘出一半误报（宿主那一版踩过这个坑，注释在 src/loader.mjs 第 409 到 415 行）。
  {
    const 非公开 = new Map();
    for (const abs of order) {
      const ast = modules.get(abs);
      if (!ast) continue;
      for (const decl of ast.decls || []) {
        if (decl.kind !== "Fn" && decl.kind !== "Const" && decl.kind !== "TypeAlias") continue;
        if (decl.pub) continue;
        非公开.set(decl.name, abs);
      }
    }
    const 走 = (n, 报) => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) {
        for (const x of n) 走(x, 报);
        return;
      }
      if (n.kind === "名") return;
      if (n.kind === "Call" && n.callee && n.callee.kind === "名") 报(n);
      for (const [k, v] of Object.entries(n)) {
        if (k === "line" || k === "column" || k === "kind") continue;
        走(v, 报);
      }
    };
    for (const abs of order) {
      const ast = modules.get(abs);
      if (!ast) continue;
      走(ast, (n) => {
        const 家 = 非公开.get(n.callee.name);
        if (家 && 家 !== abs) {
          diagnostics.warn(
            "HMYR-載-006",
            "'" + n.callee.name + "' is declared in " + 短名(家) + " without pub, and it is called in " +
              短名(abs) + "; the flat table still lets it through, so this is a notice rather than a refusal",
            n.line || 0,
            n.column || 0,
          );
        }
      });
    }
  }

  // 持有格：两趟，跨模块两张表。
  const 跨模块 = { 签名: new Map(), 脏: new Map() };
  if (options.ownedCheck !== false) {
    for (const abs of order) {
      const ast = modules.get(abs);
      if (!ast) continue;
      持有格检查(ast, { 文件: 短名(abs), 外部: 跨模块, 只收集: true });
    }
    for (const abs of order) {
      const ast = modules.get(abs);
      if (!ast) continue;
      for (const d of 持有格检查(ast, { 文件: 短名(abs), 外部: 跨模块 })) {
        diagnostics.error(d.code, d.message, d.line, d.column);
      }
    }
  }
}
