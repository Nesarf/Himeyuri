// 一个名字是源码还是字节码：这个判断只写在这里。
//
// 为什么单独一份：改名分两步，第一步是「工具同时认两套」。若七处各写一遍
// endsWith(".hmyr") || endsWith(".hmoca")，第二步删旧名时就要改七处，
// 而漏一处的样子不是报错 —— 是「某几套安静地扫不到文件」。
//
// 对应关系见 design/FILETYPE.txt：
//   .hmyr   旧名  源码    ↔ .hmoca  新名
//   .hmyrb  旧名  字节码  ↔ .hmoks  新名
//   .hmtn   新名  种子    （字节码的特例，单独一个名字）
//
// 大小写一律按小写比：Windows 上 Hello.HMYR 与 hello.hmyr 是同一个文件，
// 而两侧的工具都跑在 Windows 上，判据不必假装自己在 POSIX 上。

const 源码后缀 = [".hmyr", ".hmoca"];
const 字节码后缀 = [".hmyrb", ".hmoks", ".hmtn"];

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
  return 小.endsWith(".hmtn") || 小.endsWith(".seed.hmyrb") || 小.endsWith(".seed.hmoks");
};

export const 全部源码后缀 = () => [...源码后缀];
export const 全部字节码后缀 = () => [...字节码后缀];
