// The conformance cases, as data.
//
// SPEC 4.2 asks for three things and this file is the first two of them:
//   - every grammar point has at least one positive and one negative case
//   - every case names the clause it verifies, so coverage is a fact rather than a feeling
//
// A case is:
//   id      stable, never reused
//   clause  the SPEC clause it verifies, e.g. "2.1" or "2.4"
//   stage   "lex" | "parse" | "run"  - how far the source is taken
//   expect  { kind: "clean" } | { kind: "warning", code } | { kind: "error", code } | { kind: "output", value }
//   xfail   true when the language does not do this yet; the runner reports it separately rather than
//           counting it as a pass, because a suite that hides what is missing is worse than none.
export const CASES = [
  // ---------- 2.1 lexical ----------
  { id: "C-0001", clause: "2.1", stage: "lex", title: "a BOM is accepted and ignored", source: "\uFEFFlet x = 1\n", expect: { kind: "clean" } },
  { id: "C-0002", clause: "2.1", stage: "lex", title: "identifiers may be non-Latin", source: "let 名前 = 1\n", expect: { kind: "clean" } },
  { id: "C-0003", clause: "2.1", stage: "lex", title: "identifiers are NFC-normalised", source: "let e\u0301clair = 1\n", expect: { kind: "clean" } },
  { id: "C-0004", clause: "2.1", stage: "lex", title: "a mixed-script identifier warns", source: "let идent = 1\n", expect: { kind: "warning", code: "HMYR-詞-002" } },
  { id: "C-0005", clause: "2.1", stage: "lex", title: "line comments are dropped", source: "// nothing\nlet x = 1\n", expect: { kind: "clean" } },
  { id: "C-0006", clause: "2.1", stage: "lex", title: "block comments nest", source: "/* a /* b */ c */ let x = 1\n", expect: { kind: "clean" } },
  { id: "C-0007", clause: "2.1", stage: "lex", title: "an unclosed block comment is reported", source: "/* never\n", expect: { kind: "error", code: "HMYR-詞-003" } },
  { id: "C-0008", clause: "2.1", stage: "lex", title: "an unclosed string is reported", source: 'let s = "open\n', expect: { kind: "error", code: "HMYR-詞-001" } },
  { id: "C-0009", clause: "2.1", stage: "lex", title: "an unknown escape is reported", source: 'let s = "a\\qb"\n', expect: { kind: "error", code: "HMYR-詞-006" } },
  { id: "C-0010", clause: "2.1", stage: "lex", title: "a based literal carries its base", source: "let x = 0x1F\n", expect: { kind: "clean" } },
  { id: "C-0011", clause: "2.1", stage: "lex", title: "a misplaced separator is reported", source: "let x = 1__0\n", expect: { kind: "error", code: "HMYR-詞-004" } },
  { id: "C-0012", clause: "2.1", stage: "lex", title: "a stray character is reported", source: "let x = 1 ~ 2\n", expect: { kind: "error", code: "HMYR-詞-007" } },
  { id: "C-0013", clause: "2.1", stage: "lex", title: "a newline ends a statement", source: "let a = 1\nlet b = 2\n", expect: { kind: "clean" } },
  { id: "C-0014", clause: "2.1", stage: "lex", title: "a trailing operator continues the statement", source: "let a = 1 +\n  2\n", expect: { kind: "clean" } },
  { id: "C-0015", clause: "2.1", stage: "lex", title: "an open ( or [ continues the statement", source: "let a = f(\n  1\n)\n", expect: { kind: "clean" } },
  { id: "C-0016", clause: "2.1", stage: "lex", title: "an open { does NOT continue the statement", source: "fn f() {\n  let a = 1\n  let b = 2\n}\n", expect: { kind: "clean" } },

  // ---------- 2.2 grammar ----------
  { id: "C-0020", clause: "2.2", stage: "parse", title: "import with an alias", source: 'import "std/io" as io\n', expect: { kind: "clean" } },
  { id: "C-0021", clause: "2.2", stage: "parse", title: "import without a path fails", source: "import\n", expect: { kind: "error", code: "HMYR-形-002" } },
  { id: "C-0022", clause: "2.2", stage: "parse", title: "fn with params, return type, effects and a contract", source: 'pub fn read(own p: Path, n: Int = 4) -> Bytes effects(file) requires n > 0 { return p }\n', expect: { kind: "clean" } },
  { id: "C-0023", clause: "2.2", stage: "parse", title: "a parameter without a type fails", source: "fn f(x) { }\n", expect: { kind: "error", code: "HMYR-形-002" } },
  { id: "C-0024", clause: "2.2", stage: "parse", title: "generic arguments, nullable, tuple and fn types", source: "fn f(a: Map<K, V>, b: Int?, c: (Int, Bytes), d: fn(Int) -> Bytes) { }\n", expect: { kind: "clean" } },
  { id: "C-0025", clause: "2.2", stage: "parse", title: "an unclosed generic fails", source: "fn f(a: Map<Int) { }\n", expect: { kind: "error", code: "HMYR-形-002" } },
  { id: "C-0026", clause: "2.2", stage: "parse", title: "let, var, expression and return statements", source: "fn f() {\n  let a = 1\n  var b: Int = 2\n  a + b\n  return a\n}\n", expect: { kind: "clean" } },
  { id: "C-0027", clause: "2.2", stage: "parse", title: "two statements on one line fail", source: "fn f() {\n  let a = 1 let b = 2\n}\n", expect: { kind: "error", code: "HMYR-形-003" } },
  { id: "C-0028", clause: "2.2", stage: "parse", title: "a missing expression fails", source: "fn f() {\n  let a =\n}\n", expect: { kind: "error", code: "HMYR-形-005" } },
  { id: "C-0029", clause: "2.2", stage: "parse", title: "if / else if / else", source: "fn f() {\n  if a { 1 } else if b { 2 } else { 3 }\n}\n", expect: { kind: "clean" } },
  { id: "C-0030", clause: "2.2", stage: "parse", title: "a match arm without => fails", source: 'fn f() {\n  match x {\n    1 "one"\n  }\n}\n', expect: { kind: "error", code: "HMYR-形-002" } },
  { id: "C-0031", clause: "2.2", stage: "parse", title: "one syntax error does not cascade", source: 'fn f() {\n  let a = 1 +\n  let b = 2\n  let c = 3\n}\n', expect: { kind: "error", code: "HMYR-形-005" } },

  // ---------- 2.3 types and evaluation ----------
  { id: "C-0040", clause: "2.3", stage: "run", title: "arithmetic follows precedence", source: 'fn main() {\n  print(1 + 2 * 3)\n}\n', expect: { kind: "output", value: ["7"] } },
  { id: "C-0041", clause: "2.3", stage: "run", title: "arguments are evaluated before the call", source: "fn f(a: Int, b: Int) -> Int { return a * 10 + b }\nfn main() {\n  print(f(1, 2))\n}\n", expect: { kind: "output", value: ["12"] } },
  { id: "C-0042", clause: "2.3", stage: "run", title: "an unknown name is refused", source: "fn main() {\n  print(nope)\n}\n", expect: { kind: "error", code: "HMYR-行-005" } },
  { id: "C-0043", clause: "2.3", stage: "run", title: "division by zero is refused", source: "fn main() {\n  print(1 / 0)\n}\n", expect: { kind: "error", code: "HMYR-行-012" } },
  { id: "C-0044", clause: "2.3", stage: "run", title: "a wrong argument count is refused", source: "fn f(a: Int) { }\nfn main() {\n  f(1, 2)\n}\n", expect: { kind: "error", code: "HMYR-行-002" } },
  { id: "C-0045", clause: "2.3", stage: "run", title: "a match with no accepting arm is refused", source: 'fn main() {\n  print(match 3 {\n    1 => "one"\n  })\n}\n', expect: { kind: "error", code: "HMYR-行-006" } },
  { id: "C-0046", clause: "2.3", stage: "run", title: "recursion works", source: "fn fact(n: Int) -> Int {\n  if n <= 1 { return 1 }\n  return n * fact(n - 1)\n}\nfn main() {\n  print(fact(6))\n}\n", expect: { kind: "output", value: ["720"] } },
  // 这一条的源码原先是 return spin(n + 1)——纯尾递归。尾调用之后那种形状不再爆栈，
  // 它撞的是步数（HMYR-行-003），而「深度由语言管」这件事仍要有一条具名用例。
  // 于是在前面加一个一，让它变成非尾递归：这一层要保留，于是它仍然撞深度。
  { id: "C-0047", clause: "2.3", stage: "run", title: "runaway recursion is a language error", source: "fn spin(n: Int) -> Int { return 1 + spin(n + 1) }\nfn main() {\n  print(spin(0))\n}\n", expect: { kind: "error", code: "HMYR-行-009" } },

  // ---------- 2.4 the three knobs ----------
  { id: "C-0050", clause: "2.4", stage: "run", title: "an undeclared caller may not use an effectful function", source: 'fn read(p: Path) -> String effects(file) { return "d" }\nfn main() {\n  print(read("x"))\n}\n', expect: { kind: "error", code: "HMYR-內-001" } },
  { id: "C-0051", clause: "2.4", stage: "run", title: "the same call is allowed when the effect is declared", source: 'fn read(p: Path) -> String effects(file) { return "d" }\nfn main() effects(file) {\n  print(read("x"))\n}\n', expect: { kind: "output", value: ["d"] } },
  { id: "C-0052", clause: "2.4", stage: "run", title: "an effect may not widen", source: 'fn a(p: Path) -> String effects(file, net) { return "d" }\nfn b(p: Path) effects(file) { return a(p) }\nfn main() effects(file) {\n  print(b("x"))\n}\n', expect: { kind: "error", code: "HMYR-內-001" } },

  { id: "C-0110", clause: "2.1", stage: "lex", title: "unbalanced brackets are reported", source: "let x = (1 + 2\n", expect: { kind: "error", code: "HMYR-詞-005" } },
  { id: "C-0111", clause: "2.3", stage: "run", title: "a module without main is refused", source: "fn other() { }\n", expect: { kind: "error", code: "HMYR-行-001" } },
  { id: "C-0112", clause: "2.3", stage: "run", title: "calling a number is refused", source: "fn main() {\n  let x = 1\n  print(x())\n}\n", expect: { kind: "error", code: "HMYR-行-008" } },
  { id: "C-0113", clause: "2.3", stage: "run", title: "comparing unlike values is refused", source: 'fn main() {\n  print(1 < "a")\n}\n', expect: { kind: "error", code: "HMYR-行-014" } },
  { id: "C-0114", clause: "2.3", stage: "run", title: "len() on a number is refused", source: "fn main() {\n  print(len(7))\n}\n", expect: { kind: "error", code: "HMYR-行-015" } },
  { id: "C-0115", clause: "2.3", stage: "run", title: "int() on text that is not a number is refused", source: 'fn main() {\n  print(int("abc"))\n}\n', expect: { kind: "error", code: "HMYR-行-016" } },
  { id: "C-0122", clause: "2.4", stage: "run", title: "reading a file without declaring the effect is refused", source: 'fn main() {\n  print(read_text("x"))\n}\n', expect: { kind: "error", code: "HMYR-內-001" } },
  { id: "C-0120", clause: "2.2", stage: "run", title: "(x,) is a one-element tuple", source: "fn main() {\n  let t = (7,)\n  print(len(t))\n}\n", expect: { kind: "output", value: ["1"] } },
  { id: "C-0121", clause: "2.2", stage: "run", title: "(x) is a group, not a tuple", source: "fn main() {\n  let t = (7)\n  print(len(t))\n}\n", expect: { kind: "error", code: "HMYR-行-015" } },
  { id: "C-0118", clause: "2.3", stage: "run", title: "two tuples join with +", source: "fn main() {\n  let a = (1, 2)\n  let b = (3, 4)\n  print(len(a + b))\n}\n", expect: { kind: "output", value: ["4"] } },
  { id: "C-0119", clause: "2.3", stage: "run", title: "a tuple cannot be joined to a number", source: "fn main() {\n  let a = (1, 2)\n  print(a + 2)\n}\n", expect: { kind: "error", code: "HMYR-行-013" } },
  { id: "C-0117", clause: "2.3", stage: "run", title: "subtracting text from a number is refused", source: 'fn main() {\n  print(1 - "a")\n}\n', expect: { kind: "error", code: "HMYR-行-013" } },
  { id: "C-0116", clause: "2.4", stage: "run", title: "an effect-free function may call an effect-free one", source: "fn twice(n: Int) -> Int { return n * 2 }\nfn main() {\n  print(twice(3))\n}\n", expect: { kind: "output", value: ["6"] } },

  // ---------- what the language does not do yet, stated rather than hidden ----------
  { id: "C-0090", clause: "2.2", stage: "parse", title: "assignment to a name parses", source: "fn f() {\n  var a = 1\n  a = 2\n}\n", expect: { kind: "clean" } },
  { id: "C-0091", clause: "2.2", stage: "parse", title: "subscript parses", source: "fn f() {\n  let t = (1, 2)\n  t[0]\n}\n", expect: { kind: "clean" } },
  { id: "C-0094", clause: "2.3", stage: "run", title: "a var can be assigned", source: "fn main() {\n  var n = 1\n  n = n + 41\n  print(n)\n}\n", expect: { kind: "output", value: ["42"] } },
  { id: "C-0095", clause: "2.3", stage: "run", title: "assigning to a let is refused", source: "fn main() {\n  let n = 1\n  n = 2\n}\n", expect: { kind: "error", code: "HMYR-行-017" } },
  { id: "C-0096", clause: "2.3", stage: "run", title: "a subscript reads a tuple element", source: "fn main() {\n  let t = (10, 20, 30)\n  print(t[1])\n}\n", expect: { kind: "output", value: ["20"] } },
  { id: "C-0097", clause: "2.3", stage: "run", title: "a subscript reads a character of a string", source: 'fn main() {\n  let s = "abcdef"\n  print(s[0])\n}\n', expect: { kind: "output", value: ["a"] } },
  { id: "C-0098", clause: "2.3", stage: "run", title: "an out-of-range subscript is refused", source: "fn main() {\n  let t = (1, 2)\n  print(t[5])\n}\n", expect: { kind: "error", code: "HMYR-行-018" } },
  { id: "C-0099", clause: "2.3", stage: "run", title: "subscripting a number is refused", source: "fn main() {\n  let n = 7\n  print(n[0])\n}\n", expect: { kind: "error", code: "HMYR-行-019" } },
  { id: "C-0100", clause: "2.2", stage: "parse", title: "a subscript with no index fails", source: "fn f() {\n  let t = (1)\n  t[]\n}\n", expect: { kind: "error", code: "HMYR-形-005" } },
  { id: "C-0123", clause: "2.2", stage: "run", title: "a field name may be a keyword", source: 'fn main() {\n  let r = {type: "fn", pub: true, effects: 2}\n  print(r.type)\n  print(r.pub)\n  print(r.effects)\n}\n', expect: { kind: "output", value: ["fn", "true", "2"] } },
  { id: "C-0101", clause: "2.2", stage: "run", title: "a record literal is constructed and read", source: 'fn main() {\n  let strip = {name: "lead", gain: -3}\n  print(strip.name)\n  print(strip.gain)\n}\n', expect: { kind: "output", value: ["lead", "-3"] } },
  { id: "C-0102", clause: "2.2", stage: "parse", title: "a field without a colon fails", source: "fn f() {\n  let r = {name: 1, other 2}\n}\n", expect: { kind: "error", code: "HMYR-形-002" } },
  { id: "C-0103", clause: "2.2", stage: "run", title: "a field that is not there is refused", source: 'fn main() {\n  let r = {a: 1}\n  print(r.b)\n}\n', expect: { kind: "error", code: "HMYR-行-007" } },
  { id: "C-0092", clause: "2.3", stage: "run", title: "arena() is a host stub: close() marks its blocks dead", source: 'fn main() {\n  let a = arena()\n  let b = a.alloc(8)\n  a.close()\n  print(b.live)\n}\n', expect: { kind: "output", value: ["false"] } },
  { id: "C-0093", clause: "2.4", stage: "run", title: "the evaluator does not statically refuse an escape: the block still answers after close, and the refusal lives in the loader (test/zone-static)", source: "fn make() -> Int {\n  let a = arena()\n  let b = a.alloc(8)\n  a.close()\n  return b.size\n}\nfn main() {\n  print(make())\n}\n", expect: { kind: "output", value: ["8"] } },
];
