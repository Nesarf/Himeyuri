// 一个名字是源码还是字节码：这个判断只写在这里。
//
// 第二步（批量 git mv）走完之后，仓库里已经没有 .hmyr 与 .hmyrb 了 —— 于是这里
// 只认新名。曾经有一版同时收两套，那是给迁移留的桥；桥在第三步拆掉，理由与它
// 当初被搭起来时一样：判断只留一处，而旧名留着就会有人继续写旧名。
//
// 对应关系见 design/FILETYPE.txt：
//   .hmoca   源码
//   .hmoks   字节码
//   .hmtn    种子（字节码的特例，单独一个名字）
//
// 大小写一律按小写比：Windows 上 Hello.HMOCA 与 hello.hmoca 是同一个文件，
// 而两侧的工具都跑在 Windows 上，判据不必假装自己在 POSIX 上。

// 两档的入口也是源码（内容就是 HMYR 源程序），只是档位不同 —— 所以它们算源码。
const 源码后缀 = [".hmoca", ".hmsnp", ".hmhsr"];
const 字节码后缀 = [".hmoks", ".hmtn"];

export const 是源码 = (名) => {
  const 小 = String(名 || "").toLowerCase();
  return 源码后缀.some((x) => 小.endsWith(x));
};

export const 是字节码 = (名) => {
  const 小 = String(名 || "").toLowerCase();
  return 字节码后缀.some((x) => 小.endsWith(x));
};

// 种子单独认一句：它是字节码，但它是自举的根，混在普通字节码里会让人分不清
// 「这一份是跑一次的产物」与「这一份是编译一切的起点」。
export const 是种子 = (名) => {
  const 小 = String(名 || "").toLowerCase();
  return 小.endsWith(".hmtn") || 小.endsWith(".seed.hmtn");
};

// 两档：hmsnp 是稳定的那个，hmhsr 是弹性的那个。档位由后缀定，不由文件内容猜 ——
// 理由与「源码还是字节码」那条一样：判据要能被一眼核出来。
// 它们是同一份内容的两档入口，所以「内容相同」与「行为不同」可以同时成立：
// 决定行为的是名字，而名字在文件名上。
export const 档位 = (名) => {
  const 小 = String(名 || "").toLowerCase();
  if (小.endsWith(".hmhsr")) return "elastic";
  if (小.endsWith(".hmsnp")) return "steady";
  return null;
};

// 两档各自给什么。steady 是小步慢走：步限保守、GC 开着、只开一个线程；
// elastic 是吃满硬件：步限放宽、GC 关掉、线程按 CPU 数来。
// 这两个预设是「资源策略」，不是「内存模型」—— 三区模型是另一件事，别混着说。
// 步限取这两个数不是随手写的：五百万是 C 那台一直以来的默认步限，两亿是启动器
// 主路径一直以来的默认。所以两档各自落在「已经存在的两个数」上，不是新编出来的。
// 差别要能被一个小程序看见 —— 五千万那种限得跑十几分钟才撞得上，那种判据没人愿意跑。
export const 档预设 = {
  steady: { 步限: 5000000, gc: true, 线程: 1 },
  elastic: { 步限: 200000000, gc: false, 线程: 0 },
};

// 目标文件该给多少步限。没有档位时是两亿 —— 那是启动器主路径一直以来的默认，
// 所以「多了两档」这件事不会改变一份 .hmoca 的跑法。
export const 档步限 = (名) => {
  const 档 = 档位(名);
  return 档 ? 档预设[档].步限 : 200000000;
};

export const 全部源码后缀 = () => [...源码后缀];
export const 全部字节码后缀 = () => [...字节码后缀];
