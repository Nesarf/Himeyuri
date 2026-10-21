// 码元序列：字符串的另一种实现，用定长整数数组存十六位的码元。
//
// 它还没有接进执行器。src/text.mjs 定义的是「一个字符串怎么算长短、怎么切、怎么比」，
// 而它现在的实现仍是宿主那份字符串。这一份要把同一套规矩落在码元序列上，
// 证明两件事能对上，再谈换掉。
//
// 与 src/f64.mjs 当初的位置一样：先证明自己与宿主给同一个答案，再谈接。
//
// 借的只有两样，都很薄：
//   一块能放十六位整数的内存（Uint16Array 就是它）
//   一个「这个整数是哪个字符」的原语（String.fromCharCode）
// 长度、下标、界内、切片、拼接、比较、码点拆代理对，全在这份里。
//
// 规矩照 src/text.mjs：长度按码元数、下标取一个码元、比较按码元序。
// 这一份不另立一套，它只是同一套规矩换了一个底。

const 高位起 = 0xD800;
const 低位起 = 0xDC00;
const 十六位 = 0x10000;

export const 是码元序列 = (v) => v instanceof Uint16Array;

// 宿主串与码元序列之间，各一个方向。这两个函数就是「桥」，别处不该出现。
export const 由宿主 = (s) => {
  const a = new Uint16Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
  return a;
};
export const 成宿主 = (a) => {
  let s = "";
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return s;
};

// 一、长度：码元数。这里它就是数组的长度，而那正是规矩本来的意思。
export const 长 = (a) => a.length;

// 二、界内与取一个码元。
export const 在界内 = (a, i) => i >= 0 && i < a.length;
export const 元 = (a, i) => a[i];

// 三、切片。自己复制，不走 Array.prototype.slice —— 那是容器的库函数，
// 而这一层要证明的是「复制这一段码元」这件事自己能做。
//
// 起止要夹，因为码元序列没有「越界自动截断」这种性质：读一个没有的位置会拿到
// 未定义，而把它写进一块十六位的内存会悄悄变成零。夹在合法区间里，
// 于是它与 src/text.mjs 的 切 在合法区间内的结果相同（negatives 由调用处先夹好）。
export const 切 = (a, 起, 止) => {
  const 起2 = 起 < 0 ? 0 : 起 > a.length ? a.length : 起;
  const 止2 = 止 < 起2 ? 起2 : 止 > a.length ? a.length : 止;
  const n = 止2 - 起2;
  const 出 = new Uint16Array(n);
  for (let i = 0; i < n; i++) 出[i] = a[起2 + i];
  return 出;
};

// 拼接：新建一块，两段各抄一遍。
export const 拼 = (a, b) => {
  const 出 = new Uint16Array(a.length + b.length);
  for (let i = 0; i < a.length; i++) 出[i] = a[i];
  for (let i = 0; i < b.length; i++) 出[a.length + i] = b[i];
  return 出;
};

// 比较：按码元序，交回 -1 / 0 / 1。前缀相同的短的那个更小。
export const 比 = (a, b) => {
  const n = a.length < b.length ? a.length : b.length;
  for (let i = 0; i < n; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return a.length < b.length ? -1 : a.length > b.length ? 1 : 0;
};

// 码点 → 一个或两个码元的序列。代理对在这里被算出来，而不是抄一个公式了事。
// 超出范围交回 null，调用处报哪一个编号是它的事（与 numbers 的 收 同一个立场）。
export const 码点 = (cp) => {
  if (cp < 0 || cp > 0x10FFFF) return null;
  if (cp >= 十六位) {
    const v = cp - 十六位;
    const 出 = new Uint16Array(2);
    出[0] = 高位起 + (v >> 10);
    出[1] = 低位起 + (v & 0x3FF);
    return 出;
  }
  const 出 = new Uint16Array(1);
    出[0] = cp;
  return 出;
};

// 用于报错与比较的那一层：码元序列要能写进一句话里。
// 它不走 成宿主（那会借字符），而是把每个码元按十六进制写出来。
export const 述 = (a) => {
  let s = "u16[";
  for (let i = 0; i < a.length; i++) {
    if (i) s += " ";
    s += a[i].toString(16).padStart(4, "0");
  }
  return s + "]";
};
