// Himeyuri parser - milestone M2, second piece. Tokens in, syntax tree out.
//
// It follows the EBNF in SPEC.txt section 2.2 production by production. Two things the spec leaves
// open are decided here and marked, rather than hidden:
//   - operator precedence, which the spec does not yet fix (see PRECEDENCE below): [议] pending text
//   - error recovery: a syntax error is reported once and the parser resynchronises at the next
//     newline or closing brace, so one mistake does not produce a cascade of invented errors
//
// Diagnostic codes in the E0100 range are syntax. The lexer owns E0001-E0006 and W0001; codes are
// never reused for a different meaning.
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { lex, Diagnostics } from "./lexer.mjs";

// [议] Binding power, highest last. Conventional, and to be written into the spec.
// Exported so the formatter brackets by the same table the parser binds by. Two copies would drift
// and a formatter that brackets differently changes what a program means.
export const PRECEDENCE = [
  ["||"],
  ["&&"],
  ["==", "!=", "<", "<=", ">", ">="],
  ["+", "-"],
  ["*", "/", "%"],
];

const ASSIGNLESS = new Set(["fn", "let", "var", "return", "if", "match", "import", "pub", "type", "const", "effect", "}", "eof"]);

export function parse(tokens, options = {}) {
  const diagnostics = options.diagnostics || new Diagnostics();
  let i = 0;
  // A parser that stops making progress is a bug in the parser, not in the input. Rather than spin
  // until memory runs out, count the steps and say so - a hang that reports itself is worth more
  // than one that does not.
  let steps = 0;
  const STEP_LIMIT = 200000;
  const noProgress = () => {
    diagnostics.error("HMYR-E0105", "the parser stopped making progress at " + describe(peek()), peek().line, peek().column);
  };

  const peek = (n = 0) => tokens[Math.min(i + n, tokens.length - 1)];
  const at = (type, value) => { const t = peek(); return t.type === type && (value === undefined || t.value === value); };
  const atPunct = (v) => at("punct", v);
  const advance = () => tokens[i++];

  function error(code, message) {
    const t = peek();
    diagnostics.error(code, message, t.line, t.column);
  }

  function expectPunct(value, what) {
    if (atPunct(value)) return advance();
    error("HMYR-E0101", "expected '" + value + "'" + (what ? " " + what : "") + ", found " + describe(peek()));
    return null;
  }

  function expect(type, what) {
    if (at(type)) return advance();
    error("HMYR-E0101", "expected " + (what || type) + ", found " + describe(peek()));
    return null;
  }

  const describe = (t) => t.type === "eof" ? "end of file" : (t.type + " " + JSON.stringify(t.value));

  // Newlines separate statements; they are insignificant everywhere else.
  const skipNewlines = () => { while (at("newline")) advance(); };
  const endStatement = () => {
    if (at("newline")) { skipNewlines(); return; }
    if (atPunct("}") || at("eof")) return;
    error("HMYR-E0102", "expected the end of the statement, found " + describe(peek()));
  };

  // Resynchronise: report once, then continue from something that can start a statement.
  function recover() {
    // Resynchronise, but never without progress. Stopping on a '}' and returning left the caller at
    // the same token, so one stray brace produced thousands of identical errors before the step guard
    // noticed. If the only thing in the way is a closer, take it.
    while (!at("eof")) {
      if (at("newline")) { skipNewlines(); return; }
      if (atPunct("}")) { advance(); return; }
      advance();
    }
  }

  function parseModule() {
    const imports = [], decls = [];
    skipNewlines();
    while (at("keyword", "import")) imports.push(parseImport());
    skipNewlines();
    while (!at("eof")) {
      if (++steps > STEP_LIMIT) { noProgress(); break; }
      const before = i;
      const decl = parseDecl();
      if (decl) decls.push(decl);
      if (i === before) { error("HMYR-E0103", "cannot start a declaration with " + describe(peek())); recover(); }
      skipNewlines();
    }
    return { kind: "Module", imports, decls };
  }

  function parseImport() {
    const kw = advance();
    const pathToken = expect("string", "a module path");
    let alias = null;
    if (at("keyword", "as")) { advance(); alias = expect("ident", "an alias"); }
    endStatement();
    return { kind: "Import", path: pathToken ? pathToken.value : "", alias: alias ? alias.value : null, line: kw.line, column: kw.column };
  }

  function parseDecl() {
    if (at("keyword", "pub")) {
      advance();
      const inner = parseDecl();
      if (inner) inner.pub = true;
      return inner;
    }
    if (at("keyword", "fn")) return parseFn();
    if (at("keyword", "type")) return parseTypeAlias();
    if (at("keyword", "const")) return parseConst();
    if (at("keyword", "effect")) return parseEffectDecl();
    return null;
  }

  function parseFn() {
    const kw = advance();
    const name = expect("ident", "a function name");
    const typeParams = atPunct("<") ? parseTypeParams() : [];
    expectPunct("(", "to open the parameter list");
    const params = atPunct(")") ? [] : parseParams();
    expectPunct(")", "to close the parameter list");
    let returns = null;
    if (atPunct("->")) { advance(); returns = parseType(); }
    let effects = null;
    if (at("keyword", "effects")) effects = parseEffects();
    const contracts = { requires: [], ensures: [] };
    // A contract may be written on its own line - the formatter does exactly that - so newlines are
    // allowed before and between them.
    while (true) {
      while (at("newline")) { const save = i; skipNewlines(); if (!(at("keyword", "requires") || at("keyword", "ensures"))) { i = save; break; } }
      if (!(at("keyword", "requires") || at("keyword", "ensures"))) break;
      const which = advance().value === "requires" ? "requires" : "ensures";
      contracts[which].push(parseExpr());
      if (at("newline")) skipNewlines();
    }
    const body = atPunct("{") ? parseBlock() : null;
    return { kind: "Fn", name: name ? name.value : "<error>", typeParams, params, returns, effects, contracts, body, pub: false, line: kw.line, column: kw.column };
  }

  function parseTypeParams() {
    expectPunct("<");
    const list = [];
    while (!atPunct(">") && !at("eof")) {
      const t = expect("ident", "a type parameter");
      if (t) list.push(t.value);
      if (atPunct(",")) advance();
    }
    expectPunct(">");
    return list;
  }

  function parseParams() {
    const list = [];
    while (!atPunct(")") && !at("eof")) {
      let passing = null;
      if (at("keyword", "own") || at("keyword", "borrow")) passing = advance().value;
      const name = expect("ident", "a parameter name");
      expectPunct(":", "after the parameter name");
      const type = parseType();
      let fallback = null;
      if (atPunct("=")) { advance(); fallback = parseExpr(); }
      // 参数也带上位置：它是唯一一个曾经不知道自己在哪儿的节点。
      // 曾经用类型的行代替它，那是个诱惑——而猜出来的位置比没有更坏。
      if (name) list.push({ name: name.value, type, passing, fallback, line: name.line, column: name.column });
      if (atPunct(",")) advance(); else break;
    }
    return list;
  }

  function parseEffects() {
    advance();
    expectPunct("(", "to open the effect list");
    const list = [];
    while (!atPunct(")") && !at("eof")) {
      const t = at("ident") || at("keyword") ? advance() : null;
      if (t) list.push(t.value);
      if (atPunct("(")) { advance(); while (!atPunct(")") && !at("eof")) advance(); expectPunct(")"); }
      if (atPunct(",")) advance(); else break;
    }
    expectPunct(")", "to close the effect list");
    return list;
  }

  function parseType() {
    const t = peek();
    if (atPunct("(")) {                       // tuple or grouped
      advance();
      const items = [];
      while (!atPunct(")") && !at("eof")) { items.push(parseType()); if (atPunct(",")) advance(); else break; }
      expectPunct(")");
      return items.length === 1 ? items[0] : { kind: "TupleType", items, line: t.line, column: t.column };
    }
    if (at("keyword", "fn")) {                // fn type
      advance();
      expectPunct("(");
      const params = [];
      while (!atPunct(")") && !at("eof")) { params.push(parseType()); if (atPunct(",")) advance(); else break; }
      expectPunct(")");
      expectPunct("->");
      return { kind: "FnType", params, returns: parseType(), line: t.line, column: t.column };
    }
    const name = expect("ident", "a type name");
    const args = [];
    if (atPunct("<")) {
      advance();
      while (!atPunct(">") && !at("eof")) { args.push(parseType()); if (atPunct(",")) advance(); else break; }
      expectPunct(">");
    }
    let nullable = false;
    if (atPunct("?")) { advance(); nullable = true; }
    return { kind: "TypeRef", name: name ? name.value : "<error>", args, nullable, line: t.line, column: t.column };
  }

  function parseTypeAlias() {
    const kw = advance();
    const name = expect("ident", "a type name");
    const params = atPunct("<") ? parseTypeParams() : [];
    expectPunct("=", "before the aliased type");
    const value = parseType();
    endStatement();
    return { kind: "TypeAlias", name: name ? name.value : "<error>", params, value, line: kw.line, column: kw.column };
  }

  function parseConst() {
    const kw = advance();
    const name = expect("ident", "a constant name");
    expectPunct("=", "before the value");
    const value = parseExpr();
    endStatement();
    return { kind: "Const", name: name ? name.value : "<error>", value, line: kw.line, column: kw.column };
  }

  function parseEffectDecl() {
    const kw = advance();
    const name = expect("ident", "an effect name");
    endStatement();
    return { kind: "EffectDecl", name: name ? name.value : "<error>", line: kw.line, column: kw.column };
  }

  function parseBlock() {
    const open = expectPunct("{", "to open the block");
    const statements = [];
    skipNewlines();
    while (!atPunct("}") && !at("eof")) {
      if (++steps > STEP_LIMIT) { noProgress(); break; }
      const before = i;
      const stmt = parseStatement();
      if (stmt) statements.push(stmt);
      if (i === before) { error("HMYR-E0103", "cannot start a statement with " + describe(peek())); recover(); }
      skipNewlines();
    }
    expectPunct("}", "to close the block");
    return { kind: "Block", statements, line: open ? open.line : peek().line };
  }

  function parseStatement() {
    const t = peek();
    // Assignment is the grammar's one way to change something, and only a name may be on its left.
    if (t.type === "ident" && peek(1).type === "punct" && peek(1).value === "=") {
      const name = advance();
      advance();
      const value = parseExpr();
      endStatement();
      return { kind: "Assign", name: name.value, value, line: name.line, column: name.column };
    }
    if (at("keyword", "let") || at("keyword", "var")) {
      const kw = advance();
      const name = expect("ident", "a name");
      let type = null;
      if (atPunct(":")) { advance(); type = parseType(); }
      expectPunct("=", "before the value");
      const value = parseExpr();
      endStatement();
      return { kind: kw.value === "let" ? "Let" : "Var", name: name ? name.value : "<error>", type, value, line: kw.line, column: kw.column };
    }
    if (at("keyword", "return")) {
      const kw = advance();
      const value = at("newline") || atPunct("}") || at("eof") ? null : parseExpr();
      endStatement();
      return { kind: "Return", value, line: kw.line, column: kw.column };
    }
    // A nested declaration inside a block is allowed (a local function, say).
    if (at("keyword", "fn") || at("keyword", "pub") || at("keyword", "type") || at("keyword", "const")) {
      const decl = parseDecl();
      return decl ? { kind: "DeclStmt", decl, line: t.line, column: t.column } : null;
    }
    const expr = parseExpr();
    endStatement();
    return { kind: "ExprStmt", expr, line: t.line, column: t.column };
  }

  function parseExpr() {
    return parseBinary(0);
  }

  function parseBinary(level) {
    if (level >= PRECEDENCE.length) return parseUnary();
    let left = parseBinary(level + 1);
    while (at("punct") && PRECEDENCE[level].includes(peek().value)) {
      const op = advance();
      const right = parseBinary(level + 1);
      left = { kind: "Binary", op: op.value, left, right, line: op.line, column: op.column };
    }
    return left;
  }

  function parseUnary() {
    if (atPunct("!") || atPunct("-")) {
      const op = advance();
      return { kind: "Unary", op: op.value, operand: parseUnary(), line: op.line, column: op.column };
    }
    return parsePostfix();
  }

  function parsePostfix() {
    let expr = parsePrimary();
    while (true) {
      if (atPunct("(")) {
        const open = advance();
        const args = [];
        while (!atPunct(")") && !at("eof")) {
          if (at("newline")) { skipNewlines(); continue; }
          args.push(parseExpr());
          if (atPunct(",")) advance(); else break;
        }
        expectPunct(")", "to close the argument list");
        expr = { kind: "Call", callee: expr, args, line: open.line, column: open.column };
        continue;
      }
      if (atPunct(".")) {
        advance();
        const name = at("ident") || at("keyword") ? advance() : expect("ident", "a field name");
        expr = { kind: "Field", target: expr, name: name ? name.value : "<error>", line: peek().line, column: peek().column };
        continue;
      }
      if (atPunct("[")) {
        const open = advance();
        const index = parseExpr();
        expectPunct("]", "to close the subscript");
        expr = { kind: "Index", target: expr, index, line: open.line, column: open.column };
        continue;
      }
      break;
    }
    return expr;
  }

  function parsePrimary() {
    const t = peek();

    if (t.type === "int" || t.type === "float") {
      advance();
      return { kind: "Literal", type: t.type, value: t.numeric !== undefined ? t.numeric : t.value, raw: t.value, line: t.line, column: t.column };
    }
    if (t.type === "string") { advance(); return { kind: "Literal", type: "string", value: t.value, raw: t.raw === true, line: t.line, column: t.column }; }
    if (at("keyword", "true") || at("keyword", "false")) { advance(); return { kind: "Literal", type: "bool", value: t.value === "true", line: t.line, column: t.column }; }
    if (at("keyword", "nil")) { advance(); return { kind: "Literal", type: "nil", value: null, line: t.line, column: t.column }; }

    if (at("keyword", "while")) {

      advance();

      const condition = parseExpr();

      const body = atPunct("{") ? parseBlock() : null;

      return { kind: "While", condition, body, line: t.line, column: t.column };

    }

    if (at("keyword", "if")) {
      advance();
      const condition = parseExpr();
      const then = atPunct("{") ? parseBlock() : null;
      let otherwise = null;
      if (at("keyword", "else")) {
        advance();
        otherwise = at("keyword", "if") ? parsePrimary() : parseBlock();
      }
      return { kind: "If", condition, then, otherwise, line: t.line, column: t.column };
    }

    if (at("keyword", "match")) {
      advance();
      const subject = parseExpr();
      expectPunct("{", "to open the match arms");
      const arms = [];
      skipNewlines();
      while (!atPunct("}") && !at("eof")) {
        const pattern = parseExpr();
        expectPunct("=>", "after the pattern");
        const body = parseExpr();
        arms.push({ pattern, body, line: pattern.line, column: pattern.column });
        if (atPunct(",")) advance();
        skipNewlines();
      }
      expectPunct("}", "to close the match arms");
      return { kind: "Match", subject, arms, line: t.line, column: t.column };
    }

    if (at("keyword", "arena")) {
      advance();
      const args = [];
      if (atPunct("(")) { advance(); while (!atPunct(")") && !at("eof")) { args.push(parseExpr()); if (atPunct(",")) advance(); else break; } expectPunct(")"); }
      return { kind: "Call", callee: { kind: "Ident", name: "arena", line: t.line, column: t.column }, args, line: t.line, column: t.column };
    }

    // A record literal and a block both start with {. They are told apart by looking ahead: a field
    // is "name :", and a block that begins with a label is not a thing this grammar has. [议] until
    // the specification fixes a rule, this is the rule.
    if (atPunct("{") && (((peek(1).type === "ident" || peek(1).type === "keyword") && peek(2).type === "punct" && peek(2).value === ":") ||
        (peek(1).type === "newline" && peek(2).type === "ident" && peek(3).type === "punct" && peek(3).value === ":"))) {
      const open = advance();
      const fields = [];
      // A record may be written across lines - that is the whole point of a data description - so
      // newlines are skipped inside it. (A block is different: there a newline ends a statement.)
      skipNewlines();
      while (!atPunct("}") && !at("eof")) {
        // A field name may be a keyword: the vocabulary of this language (type, pub, effects) is exactly
        // what a record describing a declaration wants to use, and a keyword carries no meaning in this
        // position. Keywords stay reserved everywhere they would be ambiguous.
        const name = at("ident") || at("keyword") ? advance() : expect("ident", "a field name");
        expectPunct(":", "after the field name");
        const value = parseExpr();
        if (name) fields.push({ name: name.value, value });
        skipNewlines();
        if (atPunct(",")) { advance(); skipNewlines(); } else break;
      }
      skipNewlines();
      expectPunct("}", "to close the record");
      return { kind: "Record", fields, line: open.line, column: open.column };
    }
    if (atPunct("{")) return parseBlock();

    if (atPunct("(")) {
      advance();
      const items = [];
      let trailingComma = false;
      while (!atPunct(")") && !at("eof")) {
        items.push(parseExpr());
        if (atPunct(",")) { advance(); trailingComma = atPunct(")"); }
        else break;
      }
      expectPunct(")");
      // (x) is a group; (x,) is a one-element tuple. Without the second form a description cannot hold
      // a sequence of tuples - joining a note to the rest would splice its elements instead.
      return items.length === 1 && !trailingComma ? items[0] : { kind: "Tuple", items, line: t.line, column: t.column };
    }

    if (t.type === "ident") { advance(); return { kind: "Ident", name: t.value, line: t.line, column: t.column }; }

    error("HMYR-E0104", "expected an expression, found " + describe(t));
    advance();
    // Resynchronise at the next statement or argument boundary. Without this, one missing expression
    // produces a second complaint from endStatement and then a third, which is exactly the cascade the
    // recovery is meant to prevent.
    while (!at("eof") && !at("newline") && !atPunct("}") && !atPunct(")") && !atPunct(",")) advance();
    return { kind: "Error", line: t.line, column: t.column };
  }

  const ast = parseModule();
  return { ast, diagnostics };
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const file = process.argv[2];
  if (!file) { console.log("usage: node parser.mjs <file.hmyr>"); process.exit(1); }
  const lexed = lex(fs.readFileSync(file, "utf8"), { path: file });
  const { ast, diagnostics } = parse(lexed.tokens, { diagnostics: lexed.diagnostics });
  console.log(file.split(/[\\/]/).pop() + ": " + ast.decls.length + " declaration(s), " + ast.imports.length + " import(s)");
  for (const decl of ast.decls) {
    const detail = decl.kind === "Fn"
      ? decl.params.map((p) => p.name + ": " + p.type.name + (p.type.nullable ? "?" : "")).join(", ")
      : "";
    console.log("  " + decl.kind + " " + (decl.name || "") + (detail ? " (" + detail + ")" : ""));
  }
  for (const d of diagnostics.items) console.log("  " + d.severity + " " + d.code + " " + d.line + ":" + d.column + "  " + d.message);
  console.log("  errors: " + diagnostics.errors.length + ", warnings: " + diagnostics.warnings.length);
  process.exit(diagnostics.errors.length ? 1 : 0);
}
