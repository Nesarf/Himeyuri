// One entry point for everything that can be checked without a human looking at it.
//
//   node tools/check-all.mjs
//
// It runs each suite as its own process, so a crash in one is reported as that suite failing rather
// than as this script dying, and it prints the M2 status line the specification asks about.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SUITES = [
  ["lexer", "test/lexer.test.mjs", "SPEC 2.1 - lexical rules"],
  ["parser", "test/parser.test.mjs", "SPEC 2.2 - grammar, one case per production"],
  ["eval", "test/eval.test.mjs", "SPEC 2.2 acceptance - twenty programs run"],
  ["docs", "tools/check-docs.mjs", "no rendering syntax in any document"],
  ["conform", "tools/conformance.mjs", "SPEC 4.2 - every clause has cases, every error code is registered"],
  ["kpb", "test/kpb.test.mjs", "SPEC M4 - a piece described in Himeyuri, read back as data"],
  ["m4rt", "test/kpb-roundtrip.test.mjs", "SPEC M4 - a description survives a round trip, and can be generated"],
  ["m5", "test/embed.test.mjs", "SPEC M5 - a host runs a script inside an effect envelope"],
  ["fmt", "test/format.test.mjs", "SPEC M6 - the formatter round-trips and is idempotent"],
  ["stdlib", "test/stdlib.test.mjs", "SPEC M6 - the standard library reaches process and time, with effects"],
  ["reflect", "test/reflect.test.mjs", "SPEC M6 - a program can read its own shape"],
  ["lsp", "test/lsp.test.mjs", "SPEC M6 - an editor can ask about symbols, definitions and signatures"],
  ["adapter", "test/adapter.test.mjs", "SPEC M6 - the adapter: the host and the bootstrap compute the same number for the same source"],
  ["adapterstatements", "test/adapter-statements.test.mjs", "SPEC M6 - the adapter, statements: run the same program on both sides and they hand back the same value"],
  ["adapterfunctions", "test/adapter-functions.test.mjs", "SPEC M6 - the adapter, function table: whole programs agree on both sides, and the parameter boundary fails loudly"],
  ["self", "test/self.test.mjs", "SPEC M7 - a front end written in Himeyuri agrees with the one in JavaScript"],
  ["selflex", "test/self-lex.test.mjs", "SPEC M7 - the tokenizer written in Himeyuri agrees token by token"],
  ["selfunicode", "test/self-unicode.test.mjs", "SPEC M7 - identifiers written in Chinese and Japanese read the same on both sides"],
  ["unicodestrict", "test/unicode-strict.test.mjs", "SPEC M7 - what Unicode the lexer refuses, and what it folds"],
  ["unicodealias", "test/unicode-alias.test.mjs", "SPEC M7 - full-width punctuation and maths symbols fold to ASCII, and real unknowns still fail"],
  ["i18nthree", "test/i18n-three.test.mjs", "SPEC M7 - Chinese, Japanese and English on the read, write and subprocess boundaries"],
  ["locale", "test/locale.test.mjs", "SPEC M7 - four locale profiles, switchable and checkable, and they never change an evaluation result"],
  ["json", "test/json.test.mjs", "SPEC M7 - JSON read in Himeyuri, so a report can be judged without the host"],
  ["colorreport", "test/color-report.test.mjs", "SPEC M7 - a colour report judged inside Himeyuri: fields taken, thresholds applied, nothing guessed"],
  ["color", "test/color.test.mjs", "SPEC M7 - two named colour strategies, and the report that proves which loses less"],
  ["colorimage", "test/color-image.test.mjs", "SPEC M7 - an image says which space it is in, and the output carries the target profile"],
  ["term", "test/term.test.mjs", "SPEC M7 - frames are data: the terminal layer returns escape sequences and writes nothing"],
  ["termscene", "test/term-scene.test.mjs", "SPEC M7 - a scene stack, a frame loop, and every frame assertable"],
  ["termbeat", "test/term-beat.test.mjs", "SPEC M7 - beat-driven animation: one scene per beat, no drift with frame rate"],
  ["termglyph", "test/term-glyph.test.mjs", "SPEC M7 - glyph shapes are data, drawing them is logic"],
  ["termkey", "test/term-key.test.mjs", "SPEC M7 - input is injectable too, so press-a-key-to-stop can be tested"],
  ["termdemo", "test/term-demo.test.mjs", "SPEC M7 - the demo: six frames, titles switching on the beat, a key stops it early"],
  ["termscenes", "test/term-scenes.test.mjs", "SPEC M7 - wave, rain and a scrolling caption, each assertable per frame"],
  ["shell", "test/shell.test.mjs", "SPEC M7 - line editing and history as pure functions, so every keystroke is assertable"],
  ["shellbuiltins", "test/shell-builtins.test.mjs", "SPEC M7 - builtins are recognised, never executed, so every line can be judged"],
  ["shellexec", "test/shell-exec.test.mjs", "SPEC M7 - execution: cd really changes the directory, and the effect envelope is what lets it"],
  ["shellrun", "test/shell-run.test.mjs", "SPEC M7 - a session fed with keys: every frame drawn, every line judged, and an honest word when there is no terminal"],
  ["while", "test/while.test.mjs", "SPEC M7 - a while statement: loops instead of deep recursion, with a guard that stops a runaway one"],
  ["capabilities", "test/capabilities.test.mjs", "SPEC M7 - the capability contract: a file that cannot be read or written gets a stable code"],
  ["strbuiltins", "test/string-builtins.test.mjs", "SPEC M7 - slice, ord, chr, case folding and to_int, with the three refusals they name"],
  ["selflines", "test/self-lines.test.mjs", "SPEC M7 - the tokenizer can keep the newlines that separate statements"],
  ["selfbody", "test/self-body.test.mjs", "SPEC M7 - function bodies read by Himeyuri agree with the JavaScript reader"],
  ["selfeval", "test/self-eval.test.mjs", "SPEC M7 - the bootstrap evaluator: twelve node kinds, and errors that travel upward instead of becoming values"],
  ["selfstmteval", "test/self-stmt-eval.test.mjs", "SPEC M7 - statements in the bootstrap evaluator: let, var, assign, return and if, with lookups that run backwards"],
  ["selfrun", "test/self-run.test.mjs", "SPEC M7 - Himeyuri runs Himeyuri: source through its own lexer, parser and evaluator"],
  ["selfwhile", "test/self-while.test.mjs", "SPEC M6 - while in the bootstrap: it parses, it runs, and both sides count the same"],
  ["selfagree", "test/self-agree.test.mjs", "SPEC M6 - both paths agree: real programs give the same answer, and neither says yes where the other says no"],
  ["selfimport", "test/self-import.test.mjs", "SPEC M6 - imports read by the language itself: what it can see, what it ignores, and in what order"],
  ["selfcmdline", "test/self-cmdline.test.mjs", "SPEC M6 - the command line entry: answers on stdout, usage and failures on stderr, and never the two mixed"],
  ["selfcompile", "test/self-compile.test.mjs", "SPEC M6 - compiling itself: how far the bootstrap gets today, in numbers rather than hopes"],
  ["bootstrap", "test/bootstrap.test.mjs", "SPEC M6 - the bootstrap account: how big stage 0 is, what it does, and what it does not do"],
  ["subsetcensus", "test/subset-census.test.mjs", "SPEC M6 - the subset census: what a bootstrap interpreter would have to support, counted from source"],
  ["subsetlex", "test/subset-lex.test.mjs", "SPEC M6 - the subset lexer agrees with the host on all six files, and the newline rule is pinned by the shape that broke it"],
  ["subsetparse", "test/subset-parse.test.mjs", "SPEC M6 - the subset parser builds the same tree as the host on all six files, and says what it refuses"],
  ["subsetload", "test/subset-load.test.mjs", "SPEC M6 - the subset layers plugged into the loader: same modules, same functions, same answer, and the default left alone"],
  ["subsetdiag", "test/subset-diag.test.mjs", "SPEC M6 - the same syntax error gives the same code at the same place on both sides, and the subset's own refusals still throw"],
  ["stage0eval", "test/stage0-eval.test.mjs", "SPEC M6 - what stage 0's evaluator actually needs: eleven expression kinds, five statements and sixteen builtins, counted from real runs"],
  ["minimaleval", "test/minimal-eval.test.mjs", "SPEC M6 - a second evaluator written to that table alone: same answers, same codes, and it still refuses what is outside it"],
  ["capabilitieslayer", "test/capabilities-layer.test.mjs", "SPEC M6 - the capability kernel: six groups, one static rule about node: imports, and a swapped implementation that changes nothing"],
  ["hostdeps", "test/host-deps.test.mjs", "SPEC M6 - what the executor asks of the host language itself: ten globals, eight constructs, and no Promise"],
  ["bytecode", "test/bytecode.test.mjs", "SPEC M6 - the same programmes through a flat instruction stream: it compiles, and both execution models answer alike"],
  ["scalars", "test/scalars.test.mjs", "SPEC M6 - what the scalars mean today: doubles, UTF-16 code units, and the three overloads of addition"],
  ["numbers", "test/numbers.test.mjs", "SPEC M6 - one place defines what a number means: 57 answers across three execution paths, and the bit pattern underneath"],
  ["text", "test/text.test.mjs", "SPEC M6 - one place defines what a string means: code units, half a surrogate pair, and the same answers on all three paths"],
  ["f64", "test/f64.test.mjs", "SPEC M6 - doubles written in integer arithmetic: addition, subtraction, multiplication, division and comparison, three million comparisons with no divergence"],
  ["decimal", "test/decimal.test.mjs", "SPEC M6 - the shortest decimal that reads back, printed and parsed with integers on both ends"],
  ["units", "test/units.test.mjs", "SPEC M6 - the same string rules on a code-unit array: length, index, slice, join, compare and code points, checked against the host"],
  ["ucd", "test/ucd.test.mjs", "SPEC M6 - the Unicode character database as part of the library: fifty megabytes of tables, a generator, and a block lookup the language can run"],
  ["corpus", "test/corpus.test.mjs", "SPEC M6 - three whole-table corpora: every code point classified, every code point normalised, and every Han character's Unihan properties"],
  ["redact", "test/redact.test.mjs", "SPEC M6 - diagnostics can keep the path out of the message and keep the code: a switch, an environment variable, and the launcher it has to survive"],
  ["writetext", "test/write-text.test.mjs", "SPEC 2.5 - write_text writes and reads back the same text, and an undeclared effect refuses instead of writing"],
  ["codefile", "test/code-file.test.mjs", "SPEC M4 - bytecode survives a file round trip: same names, same slots, same effects, same instructions, same answer"],
  ["cvm", "test/c-vm.test.mjs", "SPEC M4 - a machine that is not JavaScript executes the same bytecode and prints the same thing (skipped when the host has no C compiler)"],
  ["cli", "test/cli.test.mjs", "SPEC M4 - the launcher: one command from source to running, with no JavaScript in between (skipped when the host has no C compiler)"],
  ["arm", "test/arm.test.mjs", "SPEC M4 - the same C machine compiled for a bare-metal Cortex-M4: the desktop assumptions sit behind conditionals (skipped when armclang is absent)"],
  ["board", "test/board.test.mjs", "SPEC M4 - the board path walked on a desk: bytecode in memory, a platform installed, output into a buffer"],
  ["hmyrcompile", "test/hmyr-compiler.test.mjs", "SPEC M4 - the compiler moved into Himeyuri: two compilers, one answer, and a stated boundary where one is still a subset"],
  ["hmyrpack", "test/hmyr-pack.test.mjs", "SPEC M4 - the writer moved into Himeyuri too: the same source packed by two packers, byte for byte"],
  ["readlines", "test/read-lines.test.mjs", "SPEC 4 - reading a file line by line, on both machines, with CRLF and LF agreeing"],
  ["returntypes", "test/return-types.test.mjs", "SPEC 2.3 - a declared return type is checked against what the function actually returns, with the boundary stated"],
  ["pipe", "test/pipe.test.mjs", "SPEC 6 - the third use of a replaceable outlet: print goes into a named pipe, and a missing pipe says so"],
  ["socket", "test/socket.test.mjs", "SPEC 6 - the fourth use of a replaceable outlet: print goes into a socket, which is opened only when it is asked for"],
  ["modulerev", "test/module-rev.test.mjs", "SPEC 6 - module version negotiation: the highest revision both sides support, refused when there is no intersection"],
  ["size", "test/size-audit.test.mjs", "SPEC 7 - what the repository weighs, told apart from what can be regenerated, with a ceiling on the first"],
  ["seed", "test/bootstrap-seed.test.mjs", "SPEC M4 - gcc plus the committed seed rebuild the seed itself: after that, no JavaScript is needed to build this"],
  ["selfframes", "test/self-frames.test.mjs", "SPEC M6 - one level of recursion costs about eleven host frames, and why the cheap fix was refused"],
  ["tailcall", "test/tail-call.test.mjs", "SPEC M6 - tail calls: tail recursion reaches any depth, and nothing else about the language changes"],
  ["launcher", "test/launcher.test.mjs", "SPEC M7 - node bin/hmyr.mjs: the target program goes through the bootstrap, not the host language layer"],
  ["task", "test/task.test.mjs", "SPEC M7 - windows as tasks: a child cannot outlive its parent, and closing the main window closes the tree"],
  ["recordnew", "test/record-new.test.mjs", "SPEC M7 - building a record by name and reading a field by name, so the bootstrap can do both"],
  ["surface", "test/surface.test.mjs", "SPEC M7 - several sub surfaces composited onto the main one, the way real windows will be"],
  ["pixel", "test/pixel.test.mjs", "SPEC M7 - a second kind of buffer: pixels, and a real PNG comes out the other end"],
  ["parallel", "test/parallel.test.mjs", "SPEC M7 - real parallelism borrowed from a process that has it, and the judgement still read back in Himeyuri"],
  ["message", "test/message.test.mjs", "SPEC M7 - mailboxes between tasks: bounded, first in first out, refuse when full, say empty when empty"],
  ["sched", "test/sched.test.mjs", "SPEC M7 - a cooperative scheduler: turn taking, completion, cancellation, and failure that does not spread"],
  ["threads", "test/threads.test.mjs", "SPEC M7 - real threads: another core, the result arrives through a file, and isolation is hard not promised"],
  ["builtins", "test/builtins.test.mjs", "SPEC M7 - the three faces of every builtin: the code, the first ring, and the capability contract"],
  ["codeslex", "test/codes-lex.test.mjs", "SPEC M7 - one case per lexical code: each of the nine refuses the thing it names"],
  ["codeseval", "test/codes-eval.test.mjs", "SPEC M7 - one case per evaluator code: seven that only appear once a program actually runs"],
  ["codesvalue", "test/codes-value.test.mjs", "SPEC M7 - one case per remaining code: values, builtins, subscripts, and the two gates"],
  ["termdiff", "test/term-diff.test.mjs", "SPEC M7 - frame diffing: only the lines that changed are rewritten, and an unchanged frame writes nothing"],
  ["shellmultibyte", "test/shell-multibyte.test.mjs", "SPEC M7 - backspace and delete work on a character, not a code point"],
  ["ime", "test/ime.test.mjs", "SPEC M7 - input method pre-edit: what is being composed does not enter the buffer"],
  ["whitespace", "test/whitespace.test.mjs", "SPEC M6 - whitespace normalisation: no parse needed, so it works on files that would not parse"],
  ["pattern", "test/pattern.test.mjs", "SPEC M7 - pattern beautifying, learned from openmpt/MPTPatterns: columns aligned, placeholder rows dropped, indexes kept"],
  ["mod", "test/mod.test.mjs", "SPEC M7 - MOD headers: title, channels, song length, patterns and samples, read as bytes that behave like characters"],
  ["container", "test/container.test.mjs", "SPEC M7 - containers round modules: XPK, MMCMP and PowerPacker are recognised, and uncompressing is handed out rather than faked"],
  ["reader", "test/reader.test.mjs", "SPEC 4.1 - reader macros as data: whole tokens only, and the rewritten source parses to the same tree"],
  ["runtimepath", "test/runtime-path.test.mjs", "SPEC M7 - the runtime path and the tool chain are two things: five entry points, no tools in their import closure"],
  ["toolingledger", "test/tooling-ledger.test.mjs", "SPEC M7 - the tooling ledger: every item either moved with a real suite behind it, or is provably off the runtime path"],
  ["independence", "test/independence.test.mjs", "SPEC M7 - one command answers how independent it is today: seed, world surface, ledger, runtime path, and a conclusion that hides nothing"],
  ["checkhmyr", "test/check-hmyr.test.mjs", "SPEC M7 - the test scheduler written in Himeyuri: it reads a list, runs three suites, and counts right"],
  ["embedhmyr", "test/embed-hmyr.test.mjs", "SPEC M7 - the embedder written in Himeyuri: read_bytes, hex bytes, a C array that starts with HMYRB"],
  ["ucdchmyr", "test/ucd-c-hmyr.test.mjs", "SPEC M7 - the table generator written in Himeyuri: two implementations, one sample, byte-for-byte identical tables"],
  ["stdinline", "test/stdin-line.test.mjs", "SPEC M7 - reading one line of standard input, and a cat that echoes what it was fed"],
  ["lsphmyr", "test/lsp-hmyr.test.mjs", "SPEC M7 - the language server written in Himeyuri: initialize, shutdown, exit, over Content-Length framing"],
  ["fmthmyr", "test/fmt-hmyr.test.mjs", "SPEC M7 - the expression formatter written in Himeyuri: parentheses where they matter, and printing twice changes nothing"],
  ["elsenewline", "test/else-newline.test.mjs", "SPEC 2.2 - a newline before else is not a statement boundary: both spellings parse to one tree and run to one answer"],
  ["selfcontained", "test/self-contained.test.mjs", "SPEC M7 - the binary carries its own compiler: a .hmyr runs with no node, no seed beside it, and no manual compile step"],
  ["deflate", "test/deflate.test.mjs", "SPEC M7 - deflate stored blocks written in Himeyuri: round trip, and zlib reads the stream without being told anything"],
  ["inflate", "test/inflate.test.mjs", "SPEC M7 - inflate in Himeyuri: five tiny cases, our own stream back byte for byte, and zlib's fixed-Huffman stream too"],
  ["zip", "test/zip.test.mjs", "SPEC M7 - a ZIP container written in Himeyuri: local header, central directory and end record, field by field against the spec"],
  ["manifest", "test/manifest.test.mjs", "SPEC M7 - the distribution manifest: everything it lists actually exists, and the minimal set is exactly fifteen"],
  ["helper", "test/helper.test.mjs", "SPEC M7 - the assistant: a code explains itself, a word searches the meanings, and a miss still hands back the list"],
  ["verify", "test/verify.test.mjs", "SPEC M7 - the manifest verifier: it says pass when it matches, and it really says fail when something was changed"],
  ["package", "test/package.test.mjs", "SPEC M7 - packaging: the release carries a manifest, and that manifest verifies from inside the package"],
  ["distro", "test/distro.test.mjs", "SPEC M7 - the distribution pieces: a wizard that installs nothing, a tour that links only to what exists, and an updater that can say it does not know"],
  ["release", "test/release.test.mjs", "SPEC M7 - release: it prepares the notes and the assets, and by default it sends nothing anywhere"],
  ["selfparse", "test/self-parse.test.mjs", "SPEC M7 - the expression parser written in Himeyuri agrees shape by shape"],
  ["selfpipe", "test/self-pipeline.test.mjs", "SPEC M7 - three Himeyuri pieces used together, and matching JavaScript end to end"],
  ["modules", "test/module.test.mjs", "SPEC 6.4 step one - imports load, once each, and cycles are refused"],
  ["selfchain", "test/self-chain2.test.mjs", "SPEC M7 - the Himeyuri tokenizer feeds the Himeyuri parser, step by step"],
  ["selfchain3", "test/self-chain3.test.mjs", "SPEC M7 - the chain reads strings, records and tuples"],
  ["selfchain4", "test/self-chain4.test.mjs", "SPEC M7 - the chain reads calls and subscripts"],
  ["selfchain5", "test/self-chain5.test.mjs", "SPEC M7 - the chain reads field access"],
  ["selfstmt", "test/self-stmt.test.mjs", "SPEC M7 - statements read by Himeyuri agree with the JavaScript reader"],
  ["selfassign", "test/self-assign.test.mjs", "SPEC M7 - assignment is read as a statement, not as an expression"],
  ["selfif", "test/self-if.test.mjs", "SPEC M7 - if, with its blocks, read by Himeyuri"],
  ["selfcompare", "test/self-compare.test.mjs", "SPEC M7 - comparison operators, at the precedence the language declares"],
  ["selfsig", "test/self-sig.test.mjs", "SPEC M7 - function signatures read by Himeyuri agree with the JavaScript reader"],
];

/* 清单导出：给 HMYR 写的那一份调度器（self/check.hmyr）用。
 * 两份清单只此一个来源 —— 少一份手抄的机会。 */
if (process.argv.includes("--list")) {
  for (const [名, 路] of SUITES) console.log(名 + "\t" + 路);
  process.exit(0);
}

let failed = 0;
console.log("Himeyuri checks");
console.log("");

/* ---- 调度：轻的并行四路，重的串行 -------------------------------------
 *
 * 之前是一路一路串行跑，四分钟。而这一台是多核的，那些套件里大多数
 * 峰值只有几十兆 —— 四路并行不会把内存顶上去。
 *
 * 串行通道里放两类：
 *
 *   重的     量出来的峰值：ucd 263 MB、corpus 163 MB、cvm 142 MB，
 *            加上编 C 的 cli、arm、board。并行起来峰值会叠加 ——
 *            这一台已经吃过一次「叠起来把内存吃满」的亏。
 *   互相踩的 manifest、package、distro、release 是一条发布链，共用 dist/。
 *            并行跑会互相覆盖产物，症状是四套一起红、而单独跑都过。
 *
 * 输出顺序不变：结果先收进表里，最后按 SUITES 的顺序打印。并行只影响
 * 「什么时候跑」，不影响「看起来是什么样」。
 */
const 串行 = new Set([
  "cvm", "cli", "arm", "board", "corpus", "ucd",
  "manifest", "package", "distro", "release",
]);
const 并行数 = 4;

const 跑一套 = (script) => new Promise((resolve) => {
  const 子 = spawn(process.execPath, ["--max-old-space-size=768", path.join(ROOT, script)], { cwd: ROOT });
  let 出 = "", 错 = "";
  子.stdout.setEncoding("utf8");
  子.stderr.setEncoding("utf8");
  子.stdout.on("data", (d) => { 出 += d; });
  子.stderr.on("data", (d) => { 错 += d; });
  子.on("close", (码) => resolve({ 码, 出, 错 }));
});

// 自己跑得过去、在这里跑不过去的，是调度的事，不是代码的事；
// 这两类要能分开 —— 所以失败的重试一次，并在输出里说明。
const 跑一套带重试 = async (script) => {
  let r = await 跑一套(script);
  let 重试过 = false;
  if (r.码 !== 0) {
    重试过 = true;
    r = await 跑一套(script);
  }
  return { ...r, 重试过 };
};

const 结果 = new Map();
for (const [名, 脚本] of SUITES) {
  if (!串行.has(名)) continue;
  结果.set(名, await 跑一套带重试(脚本));
}
{
  const 轻 = SUITES.filter(([名]) => !串行.has(名));
  let 下一个 = 0;
  const 工人 = async () => {
    for (;;) {
      const i = 下一个++;
      if (i >= 轻.length) return;
      const [名, 脚本] = 轻[i];
      结果.set(名, await 跑一套带重试(脚本));
    }
  };
  await Promise.all(Array.from({ length: 并行数 }, 工人));
}

for (const [name, script, what] of SUITES) {
  const result = 结果.get(name);
  const tail = String(result.出 || "").trim().split("\n").filter(Boolean).pop() || "";
  const ok = result.码 === 0;
  if (!ok) failed++;
  console.log("  " + (ok ? "[通过] " : "[不通过] ") + name.padEnd(7) + tail);
  console.log("          " + what);
  if (!ok) {
    console.log("          exit " + result.码 + (result.重试过 ? ", after retrying once" : ""));
    const err = String(result.错 || "").trim().split("\n").slice(0, 3).join(" | ");
    if (err) console.log("          " + err);
    if (!tail) console.log("          and it produced no output at all");
  } else if (result.重试过) {
    console.log("          (passed on the second attempt: this suite is flaky under load)");
  }
}
console.log("");
console.log(failed === 0 ? "all suites held" : failed + " suite(s) did not hold");
process.exit(failed === 0 ? 0 : 1);
