// 后缀判据的 HMYR 那一份：装载一次，之后按批问。
//
// 判据本身在 tools/file-kind.hmoca 里（与 tools/file-kind-reference.mjs 同一口径，两边由
// test/file-kind-hmyr.test.mjs 钉住）。调用方都是 .mjs，跨过去要一个入口 —— 这一层就是它。
//
// 为什么整批而不是逐个：逐个问在跨层时贵一千倍（tools/file-kind.hmoca 的文件头有实测）。
// 所以这一层只暴露「交一串名字、拿回算源码的那些」，不暴露「问一个名字」。
// 想单个问的人该先想清楚自己是不是真的只问一次 —— 而那种情形至今没有出现。
//
// 装载是懒的：这一层被 import 不等于会装 HMYR 那一份。有些工具只在某条分支上才用到它，
// 装一次九毫秒不算多，但在不需要的时候装一次就是白花。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let 判据 = null;

const 装 = () => {
  if (判据) return 判据;
  const 层 = loadUnit(path.join(ROOT, "tools/file-kind.hmoca"));
  if (!层.ok) {
    const 因 = 层.diagnostics.errors.map((e) => e.code + " " + e.message).join("; ");
    throw new Error("tools/file-kind.hmoca 装不动：" + 因);
  }
  判据 = runUnit(层);
  return 判据;
};

// 传进来的可以是任何可迭代的名字清单；空串与非字符串被丢掉，因为它们不可能是文件名。
export const 只留源码 = (名册) => {
  const 清单 = Array.from(名册).filter((n) => typeof n === "string" && n.length > 0);
  if (清单.length === 0) return [];
  const 机 = 装();
  return String(机.callFunction(机.functions.get("只留源码"), [清单.join("\n")], null) || "")
    .split("\n").filter(Boolean);
};

// 只要「是或不是」时用这个，省得调用方自己建 Set。
export const 是源码集 = (名册) => new Set(只留源码(名册));

// 档位三条：它们问的是「这一次跑多少步」，不是「这是什么文件」。
//
// 这三条不必整批 —— 唯一的调用方 bin/hmyr.mjs 在进程起来时问一次，然后一直用。
// 一次跨层一百多微秒，而它整个进程只付一次，那就没有必要为它造一个批形状。
const 叫 = (名, 参) => {
  const 机 = 装();
  return 机.callFunction(机.functions.get(名), 参, null);
};

// 没有档位时 HMYR 那一份交回空串（它没有 null），而调用方判的是真假 —— 空串是假。
export const 档位 = (名) => String(叫("档位", [名]) || "");
export const 档步限 = (名) => Number(叫("档步限", [名]));
export const 档线程 = (名) => Number(叫("档线程", [名]));
