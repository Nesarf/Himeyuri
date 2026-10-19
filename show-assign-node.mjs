const { lex } = await import("file:///E:/himeyuri/src/lexer.mjs");
const { parse } = await import("file:///E:/himeyuri/src/parser.mjs");
const d = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
const { ast } = parse(lex("fn t() {\n  n = n + 1\n}\n", {}).tokens, { diagnostics: d });
const st = ast.decls[0].body.statements[0];
console.log("  kind=" + st.kind + "  keys=" + Object.keys(st).join(","));
console.log("  " + JSON.stringify(st).slice(0, 180));
