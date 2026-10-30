// Reflection - M6's third piece, and the one the platform paper calls the prerequisite for building
// languages on top: a program has to be able to read its own shape.
//
// It answers, about a file: what is declared here, where, with which parameters and effects; and where
// a name is used. That is the same information an editor needs, so this is deliberately the layer the
// LSP will sit on rather than a parallel one.
//
//   node src/reflect.mjs kpb/piece.hymr --symbols
//   node src/reflect.mjs kpb/piece.hymr --references note
//   node src/reflect.mjs kpb/piece.hymr --json
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { lex } from "./lexer.mjs";
import { parse } from "./parser.mjs";

/** Walk every node of a tree, calling visit(node) for each object that has a `kind`. */
function walk(node, visit, parent = null, key = null) {
  if (Array.isArray(node)) { for (const item of node) walk(item, visit, parent, key); return; }
  if (!node || typeof node !== "object") return;
  if (typeof node.kind === "string") visit(node, parent, key);
  for (const [k, v] of Object.entries(node)) {
    if (k === "line" || k === "column") continue;
    walk(v, visit, node, k);
  }
}

export function symbols(ast) {
  const out = [];
  const param = (p) => ({
    name: p.name,
    type: p.type ? typeName(p.type) : null,
    passing: p.passing || null,
    hasDefault: !!p.fallback,
  });
  for (const decl of ast.decls) {
    if (decl.kind === "Fn") {
      out.push({
        name: decl.name, kind: "fn", line: decl.line, pub: !!decl.pub,
        params: decl.params.map(param),
        returns: decl.returns ? typeName(decl.returns) : null,
        effects: decl.effects || [],
        contracts: { requires: (decl.contracts?.requires || []).length, ensures: (decl.contracts?.ensures || []).length },
        body: !!decl.body,
      });
      // a function declared inside another is a symbol too, and says whose it is
      if (decl.body) {
        walk(decl.body, (node) => {
          if (node.kind === "DeclStmt" && node.decl.kind === "Fn") {
            out.push({ name: node.decl.name, kind: "fn", line: node.decl.line, pub: false, nestedIn: decl.name,
              params: node.decl.params.map(param), returns: node.decl.returns ? typeName(node.decl.returns) : null,
              effects: node.decl.effects || [], contracts: { requires: 0, ensures: 0 }, body: !!node.decl.body });
          }
        });
      }
    } else if (decl.kind === "TypeAlias") {
      out.push({ name: decl.name, kind: "type", line: decl.line, pub: !!decl.pub, params: (decl.params || []).map((p) => ({ name: p })), aliases: typeName(decl.value) });
    } else if (decl.kind === "Const") {
      out.push({ name: decl.name, kind: "const", line: decl.line, pub: !!decl.pub });
    } else if (decl.kind === "EffectDecl") {
      out.push({ name: decl.name, kind: "effect", line: decl.line, pub: !!decl.pub });
    }
  }
  return out;
}

export function typeName(t) {
  if (!t) return null;
  switch (t.kind) {
    case "类型名": return t.name + (t.args && t.args.length ? "<" + t.args.map(typeName).join(", ") + ">" : "") + (t.nullable ? "?" : "");
    case "组类型": return "(" + t.items.map(typeName).join(", ") + ")";
    case "函数类型": return "fn(" + t.params.map(typeName).join(", ") + ") -> " + typeName(t.returns);
    default: return t.kind;
  }
}

export function references(ast, name) {
  const out = [];
  walk(ast, (node) => {
    if (node.kind === "名" && node.name === name) out.push({ line: node.line, use: "name" });
    if (node.kind === "调用" && node.callee && node.callee.kind === "名" && node.callee.name === name) {
      out.push({ line: node.line, use: "call" });
    }
    if (node.kind === "Field" && node.name === name) out.push({ line: node.line, use: "field" });
  });
  // a declaration is not a use of itself
  const declaredAt = new Set(symbols(ast).filter((s) => s.name === name).map((s) => s.line));
  return out.filter((r) => !(r.use === "name" && declaredAt.has(r.line) && out.filter((o) => o.line === r.line).length > 1));
}

export function outline(source, file = "<memory>") {
  const diagnostics = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
  const { ast } = parse(lex(source, {}).tokens, { diagnostics });
  return { file, imports: ast.imports.map((i) => ({ path: i.path, alias: i.alias })), symbols: symbols(ast) };
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const argv = process.argv.slice(2);
  const file = argv.find((a) => !a.startsWith("--"));
  if (!file) { console.log("usage: node src/reflect.mjs <file.hmyr> [--symbols|--references <name>|--json]"); process.exit(1); }
  const source = fs.readFileSync(file, "utf8");
  const view = outline(source, file);
  const at = argv.indexOf("--references");
  if (at >= 0) {
    const name = argv[at + 1];
    for (const r of references(parse(lex(source, {}).tokens, { diagnostics: { add() {}, error() {}, warn() {}, items: [], errors: [], warnings: [] } }).ast, name)) {
      console.log("  " + name + " used at line " + r.line + " (" + r.use + ")");
    }
    process.exit(0);
  }
  if (argv.includes("--json")) { console.log(JSON.stringify(view, null, 2)); process.exit(0); }
  console.log(path.basename(file) + ": " + view.symbols.length + " symbol(s), " + view.imports.length + " import(s)");
  for (const s of view.symbols) {
    const detail = s.kind === "fn"
      ? "(" + s.params.map((p) => p.name + (p.type ? ": " + p.type : "")).join(", ") + ")" + (s.returns ? " -> " + s.returns : "") + (s.effects.length ? " effects(" + s.effects.join(", ") + ")" : "")
      : s.kind === "type" ? "= " + s.aliases : "";
    console.log("  line " + String(s.line).padStart(4) + "  " + s.kind.padEnd(6) + (s.pub ? "pub " : "    ") + s.name + " " + detail + (s.nestedIn ? "  [in " + s.nestedIn + "]" : ""));
  }
}
