import fs from "node:fs";
const t = fs.readFileSync("E:/himeyuri/src/lexer.mjs", "utf8").split("\n");
console.log("  总行数 " + t.length);
t.forEach((l, i) => { if (/export function lex|function lex\(|while \(|for \(|isIdentStart|isIdentPart|unrecognised|unknown|else \{/.test(l)) console.log("    " + (i + 1) + "  " + l.trim().slice(0, 96)); });
