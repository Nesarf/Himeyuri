// A language server - M6's last piece.
//
// It speaks the Language Server Protocol over stdio with the usual Content-Length framing, and it is
// deliberately thin: everything it knows about a program comes from src/reflect.mjs, so the editor and
// the formatter and the tests all read the same shape. A second parser living inside an editor plugin
// is how the two drift apart.
//
// What it offers for now, honestly limited:
//   textDocumentSync        1 (full): the document is reparsed on each change. Cheap for the file sizes
//                           this language is meant for, and it removes a whole class of stale-state bugs.
//   documentSymbol          the declarations, from reflect
//   definition              the declaration of the name under the cursor
//   hover                   a plain-text signature
//
// Replies are plain text, not Markdown: a tooltip has no business carrying rendering syntax either.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { lex } from "./lexer.mjs";
import { parse } from "./parser.mjs";
import { symbols, references, typeName } from "./reflect.mjs";

const documents = new Map();   // uri -> text

function parseDocument(uri) {
  const text = documents.get(uri);
  if (typeof text !== "string") return { symbols: [], ast: null };
  const diagnostics = { items: [], errors: [], add() {}, error() {}, warn() {} };
  const { ast } = parse(lex(text, {}).tokens, { diagnostics });
  return { symbols: symbols(ast), ast };
}

/** The word under a position. Positions are line + character, both zero-based, as the protocol says. */
function wordAt(text, position) {
  const lines = text.split("\n");
  const line = lines[position.line];
  if (line === undefined) return null;
  const isWord = (c) => c !== undefined && /[\p{L}\p{N}_]/u.test(c);
  let start = position.character;
  while (start > 0 && isWord(line[start - 1])) start--;
  let end = position.character;
  while (end < line.length && isWord(line[end])) end++;
  const word = line.slice(start, end);
  return word ? { word, line: position.line, start, end } : null;
}

// ---- 跨模块：uri 与路径 ----
// 编辑器的 uri 是 file:// 的，文件系统要的是路径；换算只做这一处。
const 位置 = (uri, s) => ({
  uri,
  range: { start: { line: Math.max(0, s.line - 1), character: 0 }, end: { line: Math.max(0, s.line - 1), character: 0 } },
});

// import 的路径相对当前文档所在目录，与加载器同一条规矩。
function resolveImport(uri, 相对) {
  try {
    return path.resolve(path.dirname(fileURLToPath(uri)), 相对);
  } catch {
    return null;
  }
}

// 别的文件的符号。按绝对路径缓存：同一份文件被问第二次时不再解析一遍。
const 文件符号 = new Map();
function symbolsOfFile(路) {
  if (文件符号.has(路)) return 文件符号.get(路);
  let 出 = [];
  try {
    const 文 = fs.readFileSync(路, "utf8");
    const diagnostics = { items: [], errors: [], add() {}, error() {}, warn() {} };
    const { ast } = parse(lex(文, {}).tokens, { diagnostics });
    出 = symbols(ast);
  } catch {
    出 = [];
  }
  文件符号.set(路, 出);
  return 出;
}

function signatureOf(symbol) {
  if (symbol.kind !== "fn") return symbol.kind + " " + symbol.name + (symbol.aliases ? " = " + symbol.aliases : "");
  const params = symbol.params.map((p) => (p.passing ? p.passing + " " : "") + p.name + (p.type ? ": " + p.type : "")).join(", ");
  const effects = symbol.effects && symbol.effects.length ? " effects(" + symbol.effects.join(", ") + ")" : "";
  const nested = symbol.nestedIn ? "  [declared inside " + symbol.nestedIn + "]" : "";
  return "fn " + symbol.name + "(" + params + ")" + (symbol.returns ? " -> " + symbol.returns : "") + effects + nested;
}

function handle(message) {
  const { id, method, params } = message;
  const reply = (result) => ({ jsonrpc: "2.0", id, result });
  const fail = (code, text) => ({ jsonrpc: "2.0", id, error: { code, message: text } });

  switch (method) {
    case "initialize":
      return reply({
        capabilities: {
          textDocumentSync: 1,
          documentSymbolProvider: true,
          definitionProvider: true,
          hoverProvider: true,
          completionProvider: { resolveProvider: false },
        },
        serverInfo: { name: "himeyuri", version: "0.1.0-m6" },
      });

    case "initialized":
      return null;

    case "textDocument/didOpen":
      documents.set(params.textDocument.uri, params.textDocument.text);
      return null;

    case "textDocument/didChange": {
      const change = (params.contentChanges || [])[0];
      if (change && typeof change.text === "string") documents.set(params.textDocument.uri, change.text);
      return null;
    }

    case "textDocument/didClose":
      documents.delete(params.textDocument.uri);
      return null;

    case "textDocument/documentSymbol": {
      const uri = params.textDocument.uri;
      const { symbols: found } = parseDocument(uri);
      return reply(found.map((s) => ({
        name: s.name,
        kind: s.kind === "fn" ? 12 : s.kind === "type" ? 5 : s.kind === "const" ? 14 : 7,   // Function, Class, Constant, Property
        location: { uri, range: { start: { line: Math.max(0, s.line - 1), character: 0 }, end: { line: Math.max(0, s.line - 1), character: 0 } } },
        containerName: s.nestedIn || (s.pub ? "pub" : undefined),
      })));
    }

    case "textDocument/completion": {
      // 补全的候选就是这份文档里的声明。没有上下文排序，也不做「按前缀过滤」——
      // 过滤是客户端的事，编辑器自己会按已经敲下的几个字筛。
      // kind 用的是 CompletionItemKind，与上面 documentSymbol 的 SymbolKind 不是同一张表：
      // 那边 fn 是 12，这边是 3。两张表各自成立，混用会让编辑器把函数显示成变量。
      const uri = params.textDocument.uri;
      const { symbols: found } = parseDocument(uri);
      return reply({
        isIncomplete: false,
        items: found.map((s) => ({
          label: s.name,
          kind: s.kind === "fn" ? 3 : s.kind === "type" ? 7 : s.kind === "const" ? 21 : 6,   // Function, Class, Constant, Variable
          detail: signatureOf(s),
        })),
      });
    }

    case "textDocument/definition": {
      const uri = params.textDocument.uri;
      const text = documents.get(uri) || "";
      const word = wordAt(text, params.position);
      if (!word) return reply(null);
      const 本文 = parseDocument(uri);
      const 本地 = 本文.symbols.find((s) => s.name === word.word);
      if (本地) return reply(位置(uri, 本地));
      // 跨模块：按 import 语句去目标文件里找。本地优先 —— 同名符号优先离得近的那一个，
      // 那也是编辑器里人的预期。
      for (const imp of (本文.ast && 本文.ast.imports) || []) {
        const 目标 = resolveImport(uri, imp.path);
        if (!目标) continue;
        const 命中 = symbolsOfFile(目标).find((s) => s.name === word.word);
        if (命中) return reply(位置(pathToFileURL(目标).href, 命中));
      }
      return reply(null);
    }

    case "textDocument/hover": {
      const uri = params.textDocument.uri;
      const text = documents.get(uri) || "";
      const word = wordAt(text, params.position);
      if (!word) return reply(null);
      const { symbols: found } = parseDocument(uri);
      const target = found.find((s) => s.name === word.word);
      if (!target) return reply(null);
      return reply({ contents: { kind: "plaintext", value: signatureOf(target) } });
    }

    case "shutdown":
      return reply(null);

    case "exit":
      return { __exit: true };

    default:
      // A request gets an error; a notification is simply ignored, which is what the protocol wants.
      return id === undefined ? null : fail(-32601, "method not implemented: " + method);
  }
}

// ---- framing ----
export function createConnection(input, output) {
  let buffer = Buffer.alloc(0);
  input.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = buffer.slice(0, headerEnd).toString("utf8");
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) { buffer = buffer.slice(headerEnd + 4); continue; }
      const length = Number(match[1]);
      const start = headerEnd + 4;
      if (buffer.length < start + length) return;
      const body = buffer.slice(start, start + length).toString("utf8");
      buffer = buffer.slice(start + length);

      let message = null;
      try { message = JSON.parse(body); } catch { continue; }
      const response = handle(message);
      if (response && response.__exit) { output.end(); process.exit(0); }
      if (response) {
        const payload = Buffer.from(JSON.stringify(response), "utf8");
        output.write("Content-Length: " + payload.length + "\r\n\r\n");
        output.write(payload);
      }
    }
  });
}

/** Send one framed message; exported so tests can drive the server without a socket. */
export function frame(message) {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  return Buffer.concat([Buffer.from("Content-Length: " + payload.length + "\r\n\r\n", "utf8"), payload]);
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const argv = process.argv.slice(2);
  if (argv.includes("--stdio") || argv.length === 0) createConnection(process.stdin, process.stdout);
  else console.log("usage: node src/lsp.mjs --stdio");
}
