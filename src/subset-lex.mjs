// 子集切词器：一个更小的 Stage 0 的第一步。
//
// 现状：切词这一层对得上了（2026-10-20）。
//
//   六份一致   lex 1988 · chain 2137 · stmt 1252 · body 1285 · eval 2687 · run 2246
//              token 的种类、值、顺序，与 src/lexer.mjs 逐个相同。
//
// 那处分歧（换行折叠的位置）查清了，它只有一个成因：ident 与 keyword 那一支
// 曾经用 出.push 而不是 记()，于是 末个 停在更早的运算符上，续行() 误判。
// 一处笔误，六份里的四份症状各不相同——而那正是它看起来像「规则不对」的原因。
//
// 还差的不是规则，是范围：转义表只认 \n \t \r \\ \"，以及它没有行号与列号。
// 后者是「能被谁用」的分界：没有位置，报错就指不到源码上。
//
// 即使如此它仍然不接线到任何地方、也不被套件钉住。理由变了一点：以前是「半成品不该被钉」，
// 现在是「它还没有自己的立场」——它现在只证明“能对齐”，而 Stage 0 要的是“能替代”。
// 接线的时机是它有了行号与列号、并且真被拿去当 lexer 用的那一刻。
//
// 它只认 self/ 那六份用到的东西，而目标是「把 Stage 0 从八百行缩到能读得清的大小」。
// 现在它与 src/lexer.mjs 并存，而验收是两者对同一份源码给出同样的 token——
// 「更小」只有在对得上的时候才算数。
//
// 认的五类（与 self/lex.hmyr 的说法一致）：
//   ident · int · string · punct · newline
//
// 不认的：注释（跳过）、浮点、十六进制转义、字符字面量。那些 self/ 里没有用到，
// 而这一份的立场是「认得窄而说清」，于是遇上不认的东西它会报错而不是猜。
// 关键字表与宿主保持一致——这一份自己的立场是「更小」，不是「另立一套」。
const 关键字 = new Set(["import","as","pub","fn","type","const","effect","effects","requires","ensures","invariant","own","borrow","let","var","return","while","if","else","match","true","false","nil","arena","managed"]);

export const 切 = (源) => {
  const 出 = [];
  let i = 0;
  const 是数字 = (c) => c >= "0" && c <= "9";
  const 是首 = (c) => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_" || c.charCodeAt(0) > 127;
  const 是余 = (c) => 是首(c) || 是数字(c);

  // 换行是有条件的：那一条规则在宿主的 lexer.mjs 里，而这里的立场是照它来。
  // 括号里还有 ( 或 [ 开着 → 续行；行尾是运算符 → 续行；否则出一个 newline。
  //
  // 花括号不算「开着」：块里的一行仍是一条语句。那一点宿主写得很清楚，
  // 而它当初踩过「把整个块当成一个表达式」的坑。
  const 括 = [];
  let 末个 = null;
  const 续行 = () => {
    if (括.some((b) => b === "(" || b === "[")) return true;
    if (!末个) return false;
    if (末个.type === "punct" && !["(", ")", "[", "]", "{", "}", ",", ";"].includes(末个.value)) return true;
    return false;
  };
  const 记 = (tok) => { 出.push(tok); if (tok.type !== "newline") 末个 = tok; };

  while (i < 源.length) {
    const c = 源[i];
    if (c === "\n") { if (!续行()) 记({ type: "newline", value: "\n" }); i++; continue; }
    if (c === " " || c === "\t" || c === "\r") { i++; continue; }
    // 注释：行注释到行尾，块注释到星号斜杠。两者都不出 token。
    if (c === "/" && 源[i + 1] === "/") { while (i < 源.length && 源[i] !== "\n") i++; continue; }
    if (c === "/" && 源[i + 1] === "*") {
      i += 2;
      while (i < 源.length && !(源[i] === "*" && 源[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (是数字(c)) {
      let j = i;
      while (j < 源.length && 是数字(源[j])) j++;
      if (源[j] === ".") throw new Error("子集不含浮点数（第 " + j + " 个字符）");
      记({ type: "int", value: 源.slice(i, j) });
      i = j;
      continue;
    }
    if (是首(c)) {
      let j = i;
      while (j < 源.length && 是余(源[j])) j++;
      // 走 记（而不是 出.push）：换行规则问的是「这一行最后一个 token 是什么」，
      // 于是每一个 token 都得让 末个 看见。少了这一句，末个 会停在更早的运算符上，
      // 接着 续行() 就把真实的行尾误判成续行，把换行吞掉。
      记(关键字.has(源.slice(i, j)) ? { type: "keyword", value: 源.slice(i, j) } : { type: "ident", value: 源.slice(i, j) });
      i = j;
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
          else throw new Error("子集不含这种转义：" + 次);
          j += 2;
          continue;
        }
        文 += 源[j];
        j++;
      }
      if (j >= 源.length) throw new Error("字符串没有收尾");
      记({ type: "string", value: 文 });
      i = j + 1;
      continue;
    }
    // 标点：认两字符的那些先，认不着再试单字符。
    const 两 = 源.slice(i, i + 2);
    if (["==", "!=", "<=", ">=", "&&", "||", "->", "=>"].includes(两)) { 记({ type: "punct", value: 两 }); i += 2; continue; }
    if ("(){}[]<>=+-*/%!,.&|:".includes(c)) {
      if (c === "(" || c === "[" || c === "{") 括.push(c);
      else if (c === ")" || c === "]" || c === "}") 括.pop();
      记({ type: "punct", value: c });
      i++;
      continue;
    }
    throw new Error("子集不认这个字符：" + JSON.stringify(c) + "（第 " + i + " 个）");
  }
  return 出;
};
