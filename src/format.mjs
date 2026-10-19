// The formatter - M6's first piece, and per design/PLATFORM.txt the language's first code generator.
//
// It prints an AST back as canonical source. Two properties matter more than prettiness:
//
//   round trip   parse(print(ast)) has to be the same tree as ast, or the printer is losing something
//   idempotence  print(parse(print(ast))) has to equal print(ast), or formatting is not a fixed point
//
// The layout decisions are made once, here, and not left to taste - the borrowed list in the
// specification takes Go's position that a single canonical form ends the argument:
//
//   - two spaces per level, one statement per line (the grammar requires the second anyway)
//   - spaces around binary operators, a space after every comma
//   - a record or tuple stays on one line up to two items and 72 columns; past that it goes multi-line
//     with a trailing comma, which keeps diffs small
//   - one contract clause per line
//
// What it does NOT do yet, said out loud rather than discovered later: comments are not attached to
// anything, so printing drops them. The CLI reports how many it dropped rather than staying silent.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { lex } from "./lexer.mjs";
import { parse, PRECEDENCE } from "./parser.mjs";

const INDENT = "  ";
const ONE_LINE_LIMIT = 72;

export function format(source, options = {}) {
  const diagnostics = { items: [], errors: [], warnings: [], add(s, c, m, l = 0, col = 0) { this.items.push({ severity: s, code: c, message: m, line: l, column: col }); if (s === "error") this.errors.push(this.items[this.items.length - 1]); }, error(c, m, l, col) { this.add("error", c, m, l, col); }, warn(c, m, l, col) { this.add("warning", c, m, l, col); } };
  const lexed = lex(source, {});
  const { ast } = parse(lexed.tokens, { diagnostics });

  const comments = (source.match(/\/\//g) || []).length + (source.match(/\/\*/g) || []).length;
  if (comments && !options.quiet) {
    diagnostics.warn("HMYR-W0100", comments + " comment(s) were dropped: this printer has no place to attach them yet");
  }
  if (diagnostics.errors.length) return { text: null, diagnostics };

  const printer = new Printer();
  const text = printer.module(ast) + "\n";
  return { text, diagnostics, comments: comments };
}

class Printer {
  module(ast) {
    const parts = [];
    for (const imp of ast.imports) parts.push(this.importDecl(imp));
    if (ast.imports.length && ast.decls.length) parts.push("");
    parts.push(ast.decls.map((d, i) => this.decl(d)).join("\n\n"));
    return parts.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
  }

  importDecl(node) {
    return "import " + JSON.stringify(node.path) + (node.alias ? " as " + node.alias : "");
  }

  decl(node) {
    const pub = node.pub ? "pub " : "";
    switch (node.kind) {
      case "Fn": {
        let head = pub + "fn " + node.name;
        if (node.typeParams && node.typeParams.length) head += "<" + node.typeParams.join(", ") + ">";
        head += "(" + node.params.map((p) => this.param(p)).join(", ") + ")";
        if (node.returns) head += " -> " + this.type(node.returns);
        if (node.effects && node.effects.length) head += " effects(" + node.effects.join(", ") + ")";
        for (const r of node.contracts.requires) head += "\n" + INDENT + "requires " + this.expr(r, 0, 0);
        for (const e of node.contracts.ensures) head += "\n" + INDENT + "ensures " + this.expr(e, 0, 0);
        if (!node.body) return head;
        return head + " " + this.block(node.body, 0);
      }
      case "TypeAlias": {
        let head = pub + "type " + node.name;
        if (node.params && node.params.length) head += "<" + node.params.join(", ") + ">";
        return head + " = " + this.type(node.value);
      }
      case "Const": return pub + "const " + node.name + " = " + this.expr(node.value, 0, 0);
      case "EffectDecl": return pub + "effect " + node.name;
      default: return "// (unprintable declaration: " + node.kind + ")";
    }
  }

  param(p) {
    let out = (p.passing ? p.passing + " " : "") + p.name;
    if (p.type) out += ": " + this.type(p.type);
    if (p.fallback) out += " = " + this.expr(p.fallback, 0, 0);
    return out;
  }

  type(t) {
    switch (t.kind) {
      case "TypeRef": {
        let out = t.name;
        if (t.args && t.args.length) out += "<" + t.args.map((a) => this.type(a)).join(", ") + ">";
        return out + (t.nullable ? "?" : "");
      }
      case "TupleType": return "(" + t.items.map((i) => this.type(i)).join(", ") + ")";
      case "FnType": return "fn(" + t.params.map((p) => this.type(p)).join(", ") + ") -> " + this.type(t.returns);
      default: return "Unknown";
    }
  }

  block(node, level) {
    const pad = INDENT.repeat(level);
    const inner = INDENT.repeat(level + 1);
    if (!node.statements.length) return "{}";
    const lines = node.statements.map((s) => inner + this.statement(s, level + 1));
    return "{\n" + lines.join("\n") + "\n" + pad + "}";
  }

  statement(node, level) {
    switch (node.kind) {
      case "Let": return "let " + node.name + (node.type ? ": " + this.type(node.type) : "") + " = " + this.expr(node.value, level, 0);
      case "Var": return "var " + node.name + (node.type ? ": " + this.type(node.type) : "") + " = " + this.expr(node.value, level, 0);
      case "Assign": return node.name + " = " + this.expr(node.value, level, 0);
      case "Return": return "return" + (node.value ? " " + this.expr(node.value, level, 0) : "");
      case "ExprStmt": return this.expr(node.expr, level, 0);
      case "DeclStmt": return this.decl(node.decl);
      default: return "// (unprintable statement: " + node.kind + ")";
    }
  }

  // level is the indentation depth, col the column the expression starts at (for the one-line test)
  expr(node, level, col) {
    switch (node.kind) {
      case "Literal":
        if (node.type === "string") {
          // A raw string takes its source characters literally, so printing one must not escape them:
          // r"raw\\n" printed with JSON escaping became r"raw\\\\n" and read back one backslash longer.
          // When the value cannot be written raw (it holds a quote or a newline) it falls back to the
          // escaped form - the value is what a round trip promises, not the spelling.
          if (node.raw && !/[\n"]/.test(node.value)) return 'r"' + node.value + '"';
          return JSON.stringify(node.value);
        }
        if (node.type === "bool") return node.value ? "true" : "false";
        if (node.type === "nil") return "nil";
        return String(node.raw ?? node.value);
      case "Ident": return node.name;
      case "Unary": return node.op + this.expr(node.operand, level, col + 1);
      case "Binary": return this.binary(node, level, col);
      case "Call": return this.expr(node.callee, level, col) + "(" + node.args.map((a) => this.expr(a, level, col)).join(", ") + ")";
      case "Field": return this.expr(node.target, level, col) + "." + node.name;
      case "Index": return this.expr(node.target, level, col) + "[" + this.expr(node.index, level, col) + "]";
      case "Tuple": return this.sequence("(", ")", node.items, level, col);
      case "Record": return this.record(node, level, col);
      case "Block": return this.block(node, level);
      case "If": return this.ifExpr(node, level, col);
      case "Match": return this.matchExpr(node, level, col);
      default: return "/* unprintable expression: " + node.kind + " */";
    }
  }

  binary(node, level, col) {
    // Power grows with the row number: the last row is the tightest. Getting this backwards is what
    // made the printer wrap 2 * 3 inside 1 + 2 * 3, which is a correctness bug wearing a style hat.
    const precedenceOf = (op) => {
      const at = PRECEDENCE.findIndex((row) => row.includes(op));
      return at < 0 ? 0 : at + 1;
    };
    const mine = precedenceOf(node.op);
    const wrap = (child, side) => {
      const text = this.expr(child, level, col);
      if (child.kind !== "Binary") return text;
      const theirs = precedenceOf(child.op);
      // a child binds more loosely, or equally on the right, needs brackets to keep the same tree
      return theirs < mine || (theirs === mine && side === "right") ? "(" + text + ")" : text;
    };
    return wrap(node.left, "left") + " " + node.op + " " + wrap(node.right, "right");
  }

  sequence(open, close, items, level, col) {
    if (!items.length) return open + close;
    // A one-element tuple must keep its trailing comma, or it prints as a group and reads back as
    // one - which is exactly how the recursion in kpb/etude.hmyr lost its shape.
    const comma = open === "(" && items.length === 1 ? "," : "";
    const oneLine = open + items.map((i) => this.expr(i, level, col)).join(", ") + comma + close;
    // Three items on a line, not two: a triple is the basic shape of data here (a note in kpb/), and
    // breaking it across lines makes the descriptions harder to read than the columns it saves.
    if (items.length <= 3 && col + oneLine.length <= ONE_LINE_LIMIT && !oneLine.includes("\n")) return oneLine;
    const inner = INDENT.repeat(level + 1);
    const pad = INDENT.repeat(level);
    return open + "\n" + items.map((i) => inner + this.expr(i, level + 1, inner.length) + ",").join("\n") + "\n" + pad + close;
  }

  record(node, level, col) {
    const fields = node.fields.map((f) => f.name + ": " + this.expr(f.value, level, col));
    const oneLine = "{" + fields.join(", ") + "}";
    if (fields.length <= 3 && col + oneLine.length <= ONE_LINE_LIMIT && !oneLine.includes("\n")) return oneLine;
    const inner = INDENT.repeat(level + 1);
    const pad = INDENT.repeat(level);
    return "{\n" + node.fields.map((f) => inner + f.name + ": " + this.expr(f.value, level + 1, inner.length) + ",").join("\n") + "\n" + pad + "}";
  }

  ifExpr(node, level, col) {
    let out = "if " + this.expr(node.condition, level, col + 3) + " " + (node.then ? this.block(node.then, level) : "{}");
    if (node.otherwise) {
      out += " else " + (node.otherwise.kind === "Block" ? this.block(node.otherwise, level) : this.expr(node.otherwise, level, col + 7));
    }
    return out;
  }

  matchExpr(node, level, col) {
    const inner = INDENT.repeat(level + 1);
    const pad = INDENT.repeat(level);
    const arms = node.arms.map((a) => inner + this.expr(a.pattern, level + 1, inner.length) + " => " + this.expr(a.body, level + 1, inner.length) + ",");
    return "match " + this.expr(node.subject, level, col + 6) + " {\n" + arms.join("\n") + "\n" + pad + "}";
  }
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const argv = process.argv.slice(2);
  const file = argv.find((a) => !a.startsWith("--"));
  if (!file) { console.log("usage: node src/format.mjs <file.hmyr> [--check]"); process.exit(1); }
  const source = fs.readFileSync(file, "utf8");
  const result = format(source, { quiet: argv.includes("--check") });
  if (!result.text) {
    for (const d of result.diagnostics.items) console.log("  " + d.severity + " " + d.code + "  " + d.message);
    process.exit(1);
  }
  if (argv.includes("--check")) {
    const same = result.text === source;
    console.log(path.basename(file) + (same ? ": already canonical" : ": would be reformatted"));
    process.exit(same ? 0 : 1);
  }
  process.stdout.write(result.text);
  for (const d of result.diagnostics.items) console.error("  " + d.severity + " " + d.code + "  " + d.message);
}
