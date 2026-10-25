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

const 源码后缀 = [".hmoca"];
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

export const 全部源码后缀 = () => [...源码后缀];
export const 全部字节码后缀 = () => [...字节码后缀];
