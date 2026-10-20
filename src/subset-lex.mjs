// 子集切词器：一个更小的 Stage 0 的第一步。
//
// 现状：切词这一层对得上了，并且带位置（2026-10-20）。
//
//   六份一致   lex 1988 · chain 2137 · stmt 1252 · body 1285 · eval 2687 · run 2246
//              token 的种类、值、顺序与位置，与 src/lexer.mjs 逐个相同。
//
// 那处分歧（换行折叠的位置）查清了，它只有一个成因：ident 与 keyword 那一支
// 曾经用 出.push 而不是 记()，于是 末个 停在更早的运算符上，续行() 误判。
// 一处笔误，六份里的四份症状各不相同——而那正是它看起来像「规则不对」的原因。
//
// 位置这一层是照宿主抄的算法，不是自己发明的：行从 1、列从 1，每推进一个字符
// 若不是换行就加一列，是换行就换行并回到第一列，而 token 记的是它第一个字符的位置。
// 于是 CRLF 里那个 \r 也占一列——这一点宿主如此，这里照办；不照办的话，
// 同一份用的是 CRLF 的源码，两边的列号会差出一个字符。
//
// 还差的是范围而不是规则：转义表只认 \n \t \r \\ \"，以及它不认全角标点的别名
// （宿主有一张 ALIASES 表，而 self/ 那六份里没有用到全角标点）。
//
// 它仍然不接线到任何地方，也没被拿去当 lexer 用。理由变了一点：以前是「半成品不该被钉」，
// 现在是「它还没有自己的立场」——它现在只证明能对齐，而 Stage 0 要的是能替代。
// 接线的时机是它真被拿去读一份源码、而报错能用它的行号列号指回去的那一刻。
//
// 它只认 self/ 那六份用到的东西，而目标是「把 Stage 0 从八百行缩到能读得清的大小」。
// 现在它与 src/lexer.mjs 并存，而验收是两者对同一份源码给出同样的 token——
// 「更小」只有在对得上的时候才算数。
//
// 认的五类（与 self/lex.hmyr 的说法一致）：
//   ident · int · string · punct · newline
//
// 不认的：注释（跳过）、浮点、十六进制转义、字符字面量、全角标点别名。那些 self/ 里没有用到，
// 而这一份的立场是「认得窄而说清」，于是遇上不认的东西它会报错而不是猜。
// 关键字表与宿主保持一致——这一份自己的立场是「更小」，不是「另立一套」。
const 关键字 = new Set(["import","as","pub","fn","type","const","effect","effects","requires","ensures","invariant","own","borrow","let","var","return","while","if","else","match","true","false","nil","arena","managed"]);

export const 切 = (源) => {
  const 出 = [];
  let i = 0;
  // 位置：行从 1、列从 1。算法照 src/lexer.mjs 的 advance——
  // 换行才换行，其余每个字符（\r、全角、代理对的一半都算）各占一列。
  let 行 = 1, 列 = 1;
  const 进 = (n = 1) => {
    for (let k = 0; k < n && i < 源.length; k++) {
      if (源[i] === "\n") { 行++; 列 = 1; } else { 列++; }
      i++;
    }
  };

  const 是数字 = (c) => c >= "0" && c <= "9";
  const 是首 = (c) => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_" || c.charCodeAt(0) > 127;
  const 是余 = (c) => 是首(c) || 是数字(c);

  // 换行是有条件的：那一条规则在宿主的 lexer.mjs 里，而这里的立场是照它来。
  // 括号里还有 ( 或 [ 开着 → 续行；行尾是运算符 → 续行；行尾是 and/or/not → 续行；
  // 否则出一个 newline。
  //
  // 花括号不算「开着」：块里的一行仍是一条语句。那一点宿主写得很清楚，
  // 而它当初踩过「把整个块当成一个表达式」的坑。
  const 括 = [];
  let 末个 = null;
  const 续行 = () => {
    if (括.some((b) => b === "(" || b === "[")) return true;
    if (!末个) return false;
    if (末个.type === "punct" && !["(", ")", "[", "]", "{", "}", ",", ";"].includes(末个.value)) return true;
    return ["and", "or", "not"].includes(末个.value);
  };
  // 每一个 token 都得经过这里：换行规则问的是「这一行最后一个 token 是什么」，
  // 绕过它就等于让规则去看一个更早的 token。
  const 记 = (tok) => { 出.push({ ...tok, line: 行, column: 列 }); if (tok.type !== "newline") 末个 = { ...tok, line: 行, column: 列 }; };

  while (i < 源.length) {
    const c = 源[i];
    if (c === "\n") { if (!续行()) 记({ type: "newline", value: "\n" }); 进(); continue; }
    if (c === " " || c === "\t" || c === "\r") { 进(); continue; }
    // 注释：行注释到行尾，块注释到星号斜杠。两者都不出 token。
    if (c === "/" && 源[i + 1] === "/") { while (i < 源.length && 源[i] !== "\n") 进(); continue; }
    if (c === "/" && 源[i + 1] === "*") {
      进(2);
      while (i < 源.length && !(源[i] === "*" && 源[i + 1] === "/")) 进();
      进(2);
      continue;
    }
    if (是数字(c)) {
      let j = i;
      while (j < 源.length && 是数字(源[j])) j++;
      if (源[j] === ".") throw new Error("子集不含浮点数（行 " + 行 + " 列 " + 列 + "）");
      记({ type: "int", value: 源.slice(i, j) });
      进(j - i);
      continue;
    }
    if (是首(c)) {
      let j = i;
      while (j < 源.length && 是余(源[j])) j++;
      const 词 = 源.slice(i, j);
      记(关键字.has(词) ? { type: "keyword", value: 词 } : { type: "ident", value: 词 });
      进(j - i);
      continue;
    }
    if (c === "\"") {
      let j = i + 1;
      let 文 = "";
      while (j < 源.length && 源[j] !== "\"") {
        if (源[j] === "\\") {
          const 次 = 源[j + 1];
          if (次 === "n") 文 += "\n";
          else if (次 === "t") 文 += "\t";
          else if (次 === "r") 文 += "\r";
          else if (次 === "\\") 文 += "\\";
          else if (次 === "\"") 文 += "\"";
          else throw new Error("子集不含这种转义：" + 次 + "（行 " + 行 + " 列 " + 列 + "）");
          j += 2;
          continue;
        }
        文 += 源[j];
        j++;
      }
      if (j >= 源.length) throw new Error("字符串没有收尾（行 " + 行 + " 列 " + 列 + "）");
      记({ type: "string", value: 文 });
      进(j + 1 - i);
      continue;
    }
    // 标点：认两字符的那些先，认不着再试单字符。
    const 两 = 源.slice(i, i + 2);
    if (["==", "!=", "<=", ">=", "&&", "||", "->", "=>"].includes(两)) { 记({ type: "punct", value: 两 }); 进(2); continue; }
    if ("(){}[]<>=+-*/%!,.&|:?".includes(c)) {
      if (c === "(" || c === "[" || c === "{") 括.push(c);
      else if (c === ")" || c === "]" || c === "}") 括.pop();
      记({ type: "punct", value: c });
      进();
      continue;
    }
    throw new Error("子集不认这个字符：" + JSON.stringify(c) + "（行 " + 行 + " 列 " + 列 + "）");
  }
  return 出;
};
