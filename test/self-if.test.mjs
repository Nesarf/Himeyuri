// The last thing on the list: if, which is an expression in this language and carries statement blocks
// with it. It goes in the statement reader, because that is where block statements can be read
// recursively; the body reader already collects a braced block as one statement, so bodies get it too.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lex } from "../src/lexer.mjs";
import { parse } from "../src/parser.mjs";
import { loadUnit, runUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};
const attempt = (fn) => { try { return { value: fn() }; } catch (e) { return { error: (e.code || "") + " " + e.message }; } };

const unit = loadUnit(path.join(ROOT, "self/stmt.hmyr"));
ok("the statement reader loads with its chain", unit.ok, unit.diagnostics.errors.map((e) => e.code + " " + e.message).join("; "));
const rt = runUnit(unit);
const call = (name, args) => {
  const fn = rt.functions.get(name);
  if (!fn) throw new Error("there is no function called " + name);
  return rt.callFunction(fn, args, null);
};
// newlines matter here, so the reading goes through scan_lines
const readStatement = (source) => call("parse_statement", [call("scan_lines", [source])]).node;

/** The JavaScript shapes, reduced to the ones this reader produces. */
function jsShape(node) {
  if (!node) return null;
  if (node.kind === "Binary") return { kind: "bin", op: node.op, left: jsShape(node.left), right: jsShape(node.right) };
  if (node.kind === "Literal" && node.type === "int") return { kind: "num", text: node.raw };
  if (node.kind === "Ident") return { kind: "name", text: node.name };
  if (node.kind === "Call") return { kind: "call", callee: jsShape(node.callee), args: node.args.map(jsShape) };
  if (node.kind === "Index") return { kind: "index", target: jsShape(node.target), index: jsShape(node.index) };
  if (node.kind === "Field") {
    const target = node.target !== undefined ? node.target : node.object;
    const name = node.name !== undefined ? node.name : node.field;
    return { kind: "field", target: jsShape(target), name: name };
  }
  if (node.kind === "If") {
    const list = (b) => (b && b.statements ? b.statements.map(jsStatement) : []);
    return { kind: "if", cond: jsShape(node.condition), then: list(node.then), otherwise: list(node.otherwise) };
  }
  return { kind: "other:" + node.kind };
}
function jsStatement(s) {
  if (s.kind === "Let") return { kind: "let", name: s.name, value: jsShape(s.value) };
  if (s.kind === "Var") return { kind: "var", name: s.name, value: jsShape(s.value) };
  if (s.kind === "Return") return { kind: "return", value: s.value ? jsShape(s.value) : [] };
  if (s.kind === "Assign") {
    const target = s.target !== undefined ? s.target : (s.name !== undefined ? s.name : s.left);
    const name = typeof target === "string" ? target : (target && (target.name !== undefined ? target.name : target.text));
    return { kind: "assign", name: name, value: jsShape(s.value) };
  }
  if (s.kind === "ExprStmt") {
    // 宿主把独立成句的 if 包成 ExprStmt；语句级的读取器直接给出 if 节点，所以这里展开那一层，
    // 让两边的形状对得上（包的是宿主，不是语言）。
    if (s.expr.kind === "If") return jsShape(s.expr);
    return { kind: "expr", value: jsShape(s.expr) };
  }
  return { kind: "other:" + s.kind };
}
function jsRead(source) {
  const diagnostics = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
  const { ast } = parse(lex("fn t() {\n  " + source + "\n}\n", {}).tokens, { diagnostics });
  if (diagnostics.errors.length) throw new Error("the JavaScript parser refused: " + diagnostics.errors[0].code);
  return jsStatement(ast.decls[0].body.statements[0]);
}

const CASES = [
  "if a { return 1 }",
  "if a { return 1 } else { return 2 }",
  "if a { let x = 1\n    return x }",
  "if a {\n    return 1\n  } else {\n    return 2\n  }",
  "if a { if b { return 1 } else { return 2 } } else { return 3 }",
];

console.log("\nif, against the JavaScript reader");
for (const source of CASES) {
  const mine = attempt(() => readStatement(source));
  const theirs = attempt(() => jsRead(source));
  const same = !mine.error && !theirs.error && JSON.stringify(mine.value) === JSON.stringify(theirs.value);
  ok(source.split("\n")[0], same, mine.error || theirs.error || (JSON.stringify(mine.value) + " vs " + JSON.stringify(theirs.value)));
}

console.log("\nthe parts, spelled out");
{
  const node = readStatement("if a { return 1 }");
  ok("the condition is kept", node.kind === "if" && node.cond.kind === "name" && node.cond.text === "a", JSON.stringify(node));
  ok("the then block is a list of statements", Array.isArray(node.then) && node.then.length === 1 && node.then[0].kind === "return");
  ok("no else means an empty list", Array.isArray(node.otherwise) && node.otherwise.length === 0);
}
{
  const node = readStatement("if a { return 1 } else { return 2 }");
  ok("an else block lands in its own list", node.otherwise.length === 1 && node.otherwise[0].value.text === "2", JSON.stringify(node.otherwise));
}
{
  const node = readStatement("if a { if b { return 1 } else { return 2 } } else { return 3 }");
  ok("an if can contain an if", node.then.length === 1 && node.then[0].kind === "if" && node.then[0].otherwise.length === 1, JSON.stringify(node.then));
}
{
  const node = readStatement("if a {\n  return 1\n  return 2\n}");
  ok("several statements in a block stay separate", node.then.length === 2, JSON.stringify(node.then));
}

console.log("\nwhat it refuses to guess");
{
  // 比较运算符不在链里（它只有 + - * / % 与括号、调用、下标、字段），所以条件读不出来时不硬猜。
  const node = attempt(() => readStatement("if a == b { return 1 }"));
  ok("a comparison in the condition is now read",
    !node.error && node.value.kind === "if" && node.value.cond.op === "==", node.error || JSON.stringify(node.value));
}
{
  const node = attempt(() => readStatement("if a return 1"));
  ok("an if without a block is refused, not repaired", !node.error && node.value.kind === "err", node.error || JSON.stringify(node.value));
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
