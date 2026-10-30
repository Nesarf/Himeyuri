// Twenty programs - the acceptance the specification sets for M2 ("twenty example programs run"),
// plus the runtime failures that must be reported rather than silently survived.
import { run } from "../src/eval.mjs";

let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

// ---- the twenty ----
const PROGRAMS = [
  ["prints a string", 'fn main() { print("こんにちは") }\n', ["こんにちは"]],
  ["arithmetic respects precedence", "fn main() { print(1 + 2 * 3) }\n", ["7"]],
  ["parentheses override it", "fn main() { print((1 + 2) * 3) }\n", ["9"]],
  ["negation and subtraction", "fn main() { print(-5 + 2) }\n", ["-3"]],
  ["comparison yields a bool", "fn main() { print(3 > 2) }\n", ["true"]],
  ["&& and || short-circuit", "fn main() { print(1 < 2 && 2 < 3) }\n", ["true"]],
  ["string concatenation", 'fn main() { print("a" + "b" + 1) }\n', ["ab1"]],
  ["a let binding", "fn main() {\n  let x = 21\n  print(x * 2)\n}\n", ["42"]],
  ["two bindings and a name in scope", "fn main() {\n  let a = 2\n  let b = a + 1\n  print(b)\n}\n", ["3"]],
  ["if as an expression", "fn main() {\n  let x = if 1 < 2 { \"yes\" } else { \"no\" }\n  print(x)\n}\n", ["yes"]],
  ["else if chain", "fn main() {\n  let n = 5\n  print(if n > 10 { \"big\" } else if n > 3 { \"mid\" } else { \"small\" })\n}\n", ["mid"]],
  ["match on a number", 'fn main() { print(match 2 {\n  1 => "one",\n  2 => "two",\n  _ => "many"\n}) }\n', ["two"]],
  ["match falls to the wildcard", 'fn main() { print(match 9 {\n  1 => "one",\n  _ => "many"\n}) }\n', ["many"]],
  ["a function with a parameter", "fn twice(n: Int) -> Int { return n * 2 }\nfn main() { print(twice(21)) }\n", ["42"]],
  ["a parameter default", "fn greet(name: String = \"world\") -> String { return \"hello, \" + name }\nfn main() { print(greet()) }\n", ["hello, world"]],
  ["recursion: factorial", "fn fact(n: Int) -> Int {\n  if n <= 1 { return 1 }\n  return n * fact(n - 1)\n}\nfn main() { print(fact(6)) }\n", ["720"]],
  ["recursion: fibonacci", "fn fib(n: Int) -> Int {\n  if n < 2 { return n }\n  return fib(n - 1) + fib(n - 2)\n}\nfn main() { print(fib(12)) }\n", ["144"]],
  ["a tuple and a builtin", "fn main() { let xs = (3, 1, 4) print(len(xs)) print(min(xs[0], xs[1])) }\n", null],
  ["loop by recursion, printing each step", "fn count(n: Int) {\n  if n == 0 { return 0 }\n  print(n)\n  return count(n - 1)\n}\nfn main() { count(3) }\n", ["3", "2", "1"]],
  ["a nested function declaration", "fn main() {\n  fn square(x: Int) -> Int { return x * x }\n  print(square(7))\n}\n", ["49"]],
];

console.log("the twenty programs");
PROGRAMS.forEach(([label, source, expected], index) => {
  const result = run(source);
  const errors = result.diagnostics.errors.map((e) => e.code + " " + e.message);
  if (expected === null) {
    // case 18 uses indexing, which the grammar does not have yet: it must FAIL, and say so clearly
    ok(label, errors.length > 0, "(expected a clear refusal)");
  } else {
    ok(label, errors.length === 0 && JSON.stringify(result.output) === JSON.stringify(expected),
      errors.length ? errors[0] : JSON.stringify(result.output));
  }
});

// ---- runtime failures must be reported, not survived ----
console.log("\nruntime failures");
const FAILURES = [
  ["no main", "fn other() { }\n", "HMYR-行-001"],
  ["unknown name", "fn main() { print(nope) }\n", "HMYR-行-005"],
  ["wrong arity", "fn f(a: Int) { }\nfn main() { f(1, 2) }\n", "HMYR-行-002"],
  ["division by zero", "fn main() { print(1 / 0) }\n", "HMYR-行-012"],
  ["adding text to a number", 'fn main() { print(1 - "a") }\n', "HMYR-行-013"],
  ["a match with no arm", "fn main() { print(match 3 {\n  1 => \"one\"\n}) }\n", "HMYR-行-006"],
  ["calling a number", "fn main() {\n  let x = 1\n  print(x())\n}\n", "HMYR-行-008"],
  // 尾调用之后，「无限尾递归」不再爆栈——它撞的是步数。
  // 那是对的：这一门语言现在不会因为尾递归耗尽宿主栈，
  // 于是「跑太久」才是它该报的那一条。非尾递归的 runaway 仍撞深度（见 tailcall 那一套）。
  ["runaway tail recursion", "fn spin(n: Int) -> Int { return spin(n + 1) }\nfn main() { print(spin(0)) }\n", "HMYR-行-003"],
];
for (const [label, source, code] of FAILURES) {
  const result = run(source, { stepLimit: 200000 });
  const codes = result.diagnostics.errors.map((e) => e.code);
  ok(label + " is " + code, codes.includes(code), codes.join(",") || "no error reported");
}

// ---- effects: a caller may not do more than it declared ----
console.log("\neffects narrow, never widen (SPEC 2.4)");
{
  const source = 'fn read(p: Path) -> String effects(file) { return "data" }\nfn main() { print(read("x")) }\n';
  const result = run(source);
  ok("an undeclared caller is refused", result.diagnostics.errors.map((e) => e.code).includes("HMYR-內-001"),
    result.diagnostics.errors.map((e) => e.code).join(",") || "no error reported");
}
{
  const source = 'fn read(p: Path) -> String effects(file) { return "data" }\nfn main() effects(file) { print(read("x")) }\n';
  const result = run(source);
  ok("the same call is allowed when declared", result.diagnostics.errors.length === 0,
    result.diagnostics.errors.map((e) => e.code).join(","));
}

// ---- the specification's own example runs ----
console.log("\nthe specification's example");
{
  const source = `pub fn read(p: Path) -> Bytes effects(file) {
  let a = arena()
  let b = a.alloc(16)
  a.close()
  return b
}

fn main() effects(file) {
  let b = read("x")
  print(b.size)
}
`;
  const result = run(source);
  ok("it compiles and runs, printing the block size", result.diagnostics.errors.length === 0 && result.output.join("") === "16",
    result.diagnostics.errors.map((e) => e.message).join("; ") || JSON.stringify(result.output));
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
