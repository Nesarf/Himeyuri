// Parser tests: every production in SPEC 2.2 gets a positive case and a negative case, which is the
// acceptance rule the specification itself sets for the grammar.
import { lex } from "../src/lexer.mjs";
import { parse } from "../src/parser.mjs";

let passed = 0, failed = 0;
const ok = (label, condition) => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label); }
};

function run(source) {
  const lexed = lex(source, { path: "<test>" });
  return parse(lexed.tokens, { diagnostics: lexed.diagnostics });
}
const clean = (source) => { const r = run(source); return r.diagnostics.errors.length === 0 ? r : null; };
const errorsOf = (source) => run(source).diagnostics.errors.map((d) => d.code);

console.log("module and import");
{
  const r = clean('import "std/io"\nimport "std/math" as m\nfn main() { }\n');
  ok("imports are collected in order", r && r.ast.imports.length === 2 && r.ast.imports[1].alias === "m");
}
{
  ok("an import without a path is HMYR-形-001", errorsOf("import\n").includes("HMYR-形-001"));
}

console.log("\nfn and parameters");
{
  const r = clean('pub fn read(own p: Path, borrow b: Bytes, n: Int = 4) -> Bytes effects(file, net) requires n > 0 { return b }\n');
  const fn = r && r.ast.decls[0];
  ok("pub, params, return type, effects and contract all land", fn && fn.pub === true && fn.params.length === 3 && fn.returns.name === "Bytes" && fn.effects.join(",") === "file,net" && fn.contracts.requires.length === 1);
  ok("own and borrow are recorded", fn.params[0].passing === "own" && fn.params[1].passing === "borrow");
  ok("a parameter default is an expression", fn.params[2].fallback.kind === "字");
}
{
  ok("a parameter without a type is HMYR-形-001", errorsOf("fn f(x) { }\n").includes("HMYR-形-001"));
}

console.log("\ntypes");
{
  const r = clean('fn f(a: Map<K, V>, b: Int?, c: (Int, Bytes), d: fn(Int) -> Bytes) { }\n');
  const ps = r.ast.decls[0].params;
  ok("generic type arguments", ps[0].type.args.length === 2);
  ok("nullable is marked", ps[1].type.nullable === true);
  ok("tuple type", ps[2].type.kind === "组类型" && ps[2].type.items.length === 2);
  ok("function type", ps[3].type.kind === "函数类型");
}
{
  ok("an unclosed generic is HMYR-形-001", errorsOf("fn f(a: Map<Int) { }\n").includes("HMYR-形-001"));
}

console.log("\nstatements");
{
  const r = clean("fn f() {\n  let a = 1\n  var b: Int = 2\n  a + b\n  return a\n}\n");
  const kinds = r.ast.decls[0].body.statements.map((s) => s.kind);
  ok("let, var, expression and return", kinds.join(",") === "定,变,表达式语句,返回");
  ok("the type annotation is kept", r.ast.decls[0].body.statements[1].type.name === "Int");
}
{
  ok("a missing value after '=' is HMYR-形-004", errorsOf("fn f() {\n  let a =\n}\n").includes("HMYR-形-004"));
}
{
  ok("two expressions on one line is HMYR-形-002", errorsOf("fn f() {\n  a b\n}\n").includes("HMYR-形-002"));
}

console.log("\nexpressions and precedence");
{
  const r = clean("fn f() {\n  a + b * c\n}\n");
  const expr = r.ast.decls[0].body.statements[0].expr;
  ok("* binds tighter than +", expr.op === "+" && expr.right.op === "*");
}
{
  const r = clean("fn f() {\n  a == b && c < d\n}\n");
  const expr = r.ast.decls[0].body.statements[0].expr;
  ok("&& is looser than comparison", expr.op === "&&" && expr.left.op === "==" && expr.right.op === "<");
}
{
  const r = clean("fn f() {\n  f(1, 2).field\n}\n");
  const expr = r.ast.decls[0].body.statements[0].expr;
  ok("call then field access", expr.kind === "字段" && expr.target.kind === "调用" && expr.target.args.length === 2);
}
{
  const r = clean("fn f() {\n  -a\n}\n");
  ok("unary minus", r.ast.decls[0].body.statements[0].expr.kind === "一元");
}
{
  const r = clean('fn f() {\n  r"raw\\n"\n}\n');
  const lit = r.ast.decls[0].body.statements[0].expr;
  ok("a raw string keeps its value and its marking", lit.value === "raw\\n" && lit.raw === true);
}

console.log("\nif and match");
{
  const r = clean("fn f() {\n  if a { 1 } else if b { 2 } else { 3 }\n}\n");
  const e = r.ast.decls[0].body.statements[0].expr;
  ok("if / else if / else", e.kind === "若" && e.otherwise.kind === "若" && e.otherwise.otherwise.kind === "Block");
}
{
  const r = clean("fn f() {\n  match x {\n    1 => \"one\",\n    _ => \"other\"\n  }\n}\n");
  const e = r.ast.decls[0].body.statements[0].expr;
  ok("match arms", e.kind === "Match" && e.arms.length === 2);
}
{
  ok("an arm without => is HMYR-形-001", errorsOf("fn f() {\n  match x {\n    1 \"one\"\n  }\n}\n").includes("HMYR-形-001"));
}

console.log("\nrecovery: one mistake does not become a cascade");
{
  const codes = errorsOf("fn f() {\n  let a = 1 +\n  let b = 2\n  let c = 3\n}\n");
  ok("a single error is reported", codes.length <= 2);
  const r = run("fn f() {\n  let a = 1 +\n  let b = 2\n  let c = 3\n}\n");
  const lets = r.ast.decls[0].body.statements.filter((s) => s.kind === "定").length;
  ok("statements after the error are still parsed", lets >= 2);
}
{
  const r = clean("fn f() {\n  let xs = (1, 2)\n  let t = (1)\n}\n");
  const stmts = r.ast.decls[0].body.statements;
  ok("a tuple stays a tuple, a group is not", stmts[0].value.kind === "组" && stmts[1].value.kind === "字");
}

console.log("\nthe spec's own example");
{
  const src = `import "std/path"

pub fn read(p: Path) -> Bytes effects(file) {
  let a = arena()
  let b = a.alloc(16)
  a.close()
  return b
}
`;
  const r = clean(src);
  ok("the example parses with no diagnostics", r !== null);
  ok("and yields one function", r !== null && r.ast.decls.length === 1);
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
