// The language server's acceptance: real requests over stdio, with the protocol's own framing.
//
// The server is driven the way an editor drives it, not called as a function - a server that only works
// when its pieces are called directly is a server nobody can plug in.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { frame } from "../src/lsp.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const SOURCE = `fn note(key: Int, start: Int, length: Int) -> Int {
  return (key, start, length)
}

fn rise(n: Int, key: Int, start: Int, step: Int) -> Int {
  if n == 0 { return () }
  return (note(key, start, step),) + rise(n - 1, key + 2, start + step, step)
}

fn main() -> Int {
  return rise(4, 60, 0, 240)
}
`;

/** Send a list of messages and collect the replies that carry an id. */
function session(messages) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, "src/lsp.mjs"), "--stdio"], { stdio: ["pipe", "pipe", "inherit"] });
    let buffer = Buffer.alloc(0);
    const replies = [];
    const timer = setTimeout(() => { child.kill(); reject(new Error("the server did not answer in time; got " + JSON.stringify(replies))); }, 20000);
    child.stdout.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const end = buffer.indexOf("\r\n\r\n");
        if (end < 0) break;
        const length = Number(/Content-Length:\s*(\d+)/i.exec(buffer.slice(0, end).toString())[1]);
        if (buffer.length < end + 4 + length) break;
        const body = buffer.slice(end + 4, end + 4 + length).toString("utf8");
        buffer = buffer.slice(end + 4 + length);
        replies.push(JSON.parse(body));
      }
    });
    child.on("close", () => { clearTimeout(timer); resolve(replies); });
    for (const m of messages) child.stdin.write(frame(m));
    child.stdin.end();
  });
}

const uri = "file:///virtual/etude.hmyr";
console.log("a session, the way an editor has one");
const replies = await session([
  { jsonrpc: "2.0", id: 1, method: "initialize", params: { capabilities: {} } },
  { jsonrpc: "2.0", method: "initialized", params: {} },
  { jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { uri, languageId: "himeyuri", version: 1, text: SOURCE } } },
  { jsonrpc: "2.0", id: 2, method: "textDocument/documentSymbol", params: { textDocument: { uri } } },
  { jsonrpc: "2.0", id: 3, method: "textDocument/definition", params: { textDocument: { uri }, position: { line: 6, character: 12 } } },
  { jsonrpc: "2.0", id: 4, method: "textDocument/hover", params: { textDocument: { uri }, position: { line: 6, character: 11 } } },
  { jsonrpc: "2.0", id: 5, method: "textDocument/hover", params: { textDocument: { uri }, position: { line: 0, character: 4 } } },
  { jsonrpc: "2.0", id: 6, method: "textDocument/definition", params: { textDocument: { uri }, position: { line: 6, character: 38 } } },
  { jsonrpc: "2.0", id: 7, method: "textDocument/definition", params: { textDocument: { uri }, position: { line: 1, character: 3 } } },
  { jsonrpc: "2.0", id: 8, method: "textDocument/hover", params: { textDocument: { uri }, position: { line: 100, character: 0 } } },
  { jsonrpc: "2.0", id: 9, method: "workspace/nonsense", params: {} },
  { jsonrpc: "2.0", id: 10, method: "shutdown" },
  { jsonrpc: "2.0", method: "exit" },
]);

const byId = new Map(replies.filter((r) => r.id !== undefined).map((r) => [r.id, r]));
ok("the server answered every request that had an id", byId.size === 10, String(byId.size));

console.log("\ncapabilities");
{
  const caps = byId.get(1)?.result?.capabilities;
  ok("it advertises full document sync", caps?.textDocumentSync === 1);
  ok("and symbols, definitions and hover", caps?.documentSymbolProvider === true && caps?.definitionProvider === true && caps?.hoverProvider === true);
  ok("and names itself", /himeyuri/i.test(byId.get(1)?.result?.serverInfo?.name || ""));
}

console.log("\nsymbols");
{
  const list = byId.get(2)?.result || [];
  const names = list.map((s) => s.name);
  ok("all three functions are reported", ["note", "rise", "main"].every((n) => names.includes(n)), names.join(","));
  ok("with zero-based lines, as the protocol counts", list.every((s) => s.location.range.start.line >= 0));
  ok("and a kind the editor understands", list.every((s) => typeof s.kind === "number" && s.kind > 0));
}

console.log("\ndefinition");
{
  const def = byId.get(3)?.result;
  const note = (byId.get(2)?.result || []).find((s) => s.name === "note");
  ok("a call to note resolves to its declaration", def && note && def.range.start.line === note.location.range.start.line,
    JSON.stringify(def));
}
{
  const def = byId.get(6)?.result;
  const rise = (byId.get(2)?.result || []).find((s) => s.name === "rise");
  ok("two names on one line resolve to their own declarations", def && rise && def.range.start.line === rise.location.range.start.line, JSON.stringify(def));
}
{
  const def = byId.get(7)?.result;
  ok("a name with no declaration answers with nothing, not an error", def === null, JSON.stringify(def));
}

console.log("\nhover");
{
  const hover = byId.get(4)?.result;
  ok("a call shows the signature", /fn note\(key: Int, start: Int, length: Int\) -> Int/.test(hover?.contents?.value || ""), JSON.stringify(hover));
  ok("and it is plain text, not a rendering syntax", hover?.contents?.kind === "plaintext");
}
{
  const hover = byId.get(5)?.result;
  ok("the declaration shows the same signature", /fn note\(/.test(hover?.contents?.value || ""));
}
{
  ok("hovering past the end answers with nothing", byId.get(8)?.result === null);
}

console.log("\nthe protocol's own manners");
{
  ok("an unknown method is an error, not a crash", byId.get(9)?.error?.code === -32601);
  ok("shutdown answers", byId.get(10)?.result === null || byId.get(10)?.result === undefined);
  ok("no reply is sent for notifications", replies.filter((r) => r.id === undefined).length === 0);
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
