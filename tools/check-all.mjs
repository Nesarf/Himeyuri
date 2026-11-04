// One entry point for everything that can be checked without a human looking at it.
//
//   node tools/check-all.mjs
//
// It runs each suite as its own process, so a crash in one is reported as that suite failing rather
// than as this script dying, and it prints the M2 status line the specification asks about.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SUITES = [
  ["lexer", "test/lexer.test.mjs", "SPEC 2.1 - lexical rules"],
  ["parser", "test/parser.test.mjs", "SPEC 2.2 - grammar, one case per production"],
  ["eval", "test/eval.test.mjs", "SPEC 2.2 acceptance - twenty programs run"],
  ["docs", "tools/check-docs.mjs", "no rendering syntax in any document"],
  ["docshmyr", "test/docs-hmyr.test.mjs", "M7 - the document checker written in Himeyuri agrees with the JavaScript one on the same tree: the same documents, the same verdict on each, and no rendering syntax either way (skipped when the host has no C compiler)"],
  ["docstatshmyr", "test/doc-stats-hmyr.test.mjs", "M7 - the document-line counter written in Himeyuri agrees with a direct count: the same number of .txt files under design/, the same line total with the same end-of-file rule, and the same average (skipped when the host has no C compiler)"],
  ["conform", "tools/conformance.mjs", "SPEC 4.2 - every clause has cases, every error code is registered"],
  ["kpb", "test/kpb.test.mjs", "SPEC M4 - a piece described in Himeyuri, read back as data"],
  ["m4rt", "test/kpb-roundtrip.test.mjs", "SPEC M4 - a description survives a round trip, and can be generated"],
  ["m5", "test/embed.test.mjs", "SPEC M5 - a host runs a script inside an effect envelope"],
  ["fmt", "test/format.test.mjs", "SPEC M6 - the formatter round-trips and is idempotent"],
  ["stdlib", "test/stdlib.test.mjs", "SPEC M6 - the standard library reaches process and time, with effects"],
  ["reflect", "test/reflect.test.mjs", "SPEC M6 - a program can read its own shape"],
  ["lsp", "test/lsp.test.mjs", "SPEC M6 - an editor can ask about symbols, definitions and signatures"],
  ["lspsymbol", "test/lsp-symbol-hmyr.test.mjs", "M6 - the language server symbols: two real processes, node and the C machine, answer the same documentSymbol request with the same names, kinds and locations"],
  ["lspcompletion", "test/lsp-completion-hmyr.test.mjs", "M6 - the language server completion: two real processes offer the same candidates for the same document, keyed by the CompletionItemKind table rather than the SymbolKind one"],
  ["lspmodule", "test/lsp-module.test.mjs", "M6 - the language server beyond one file: a name that is only in an imported file resolves there, a local name stays local, and a name in neither is null rather than an error"],
  ["macro", "test/macro.test.mjs", "M6 - hygienic macros: one-line declarations, parameter substitution, macros inside macros, and an argument-count mistake that names itself instead of becoming an undefined call"],
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
  // color 三套的 ICC 两台都有。sRGB 那张仓库自带（deps/color/profiles/），
  // CMYK 那张两台各有一份真的：Windows 是系统自带的 RSWOP.icm，POSIX 上是 colord
  // 带的 /usr/share/color/icc/colord/SWOP_TR003_coated_3.icc —— 同一个印刷条件。
  // 2026-11-03 量过之后撤掉了这条「缺 ICC」的标注。
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
  ["bytecode", "test/bytecode.test.mjs", "SPEC M6 - the same programmes through a flat instruction stream: it compiles, and three execution models answer alike on six real paths - the minimal evaluator, the JS bytecode machine, and the VM written in Himeyuri itself (the third needs gcc and steps aside when there is none)"],
  ["scalars", "test/scalars.test.mjs", "SPEC M6 - what the scalars mean today: doubles, UTF-16 code units, and the three overloads of addition"],
  ["numbers", "test/numbers.test.mjs", "SPEC M6 - one place defines what a number means: 57 answers across three execution paths, and the bit pattern underneath"],
  ["text", "test/text.test.mjs", "SPEC M6 - one place defines what a string means: code units, half a surrogate pair, and the same answers on all three paths"],
  ["f64", "test/f64.test.mjs", "SPEC M6 - doubles written in integer arithmetic: addition, subtraction, multiplication, division and comparison, three million comparisons with no divergence"],
  ["decimal", "test/decimal.test.mjs", "SPEC M6 - the shortest decimal that reads back, printed and parsed with integers on both ends"],
  ["units", "test/units.test.mjs", "SPEC M6 - the same string rules on a code-unit array: length, index, slice, join, compare and code points, checked against the host"],
  ["ucd", "test/ucd.test.mjs", "SPEC M6 - the Unicode character database as part of the library: fifty megabytes of tables, a generator, and a block lookup the language can run"],
  ["corpus", "test/corpus.test.mjs", "SPEC M6 - three whole-table corpora: every code point classified, every code point normalised, and every Han character's Unihan properties"],
  ["redact", "test/redact.test.mjs", "SPEC M6 - diagnostics can keep the path out of the message and keep the code: a switch, an environment variable, and the launcher it has to survive"],
  ["redacthmyr", "test/redact-hmyr.test.mjs", "M7 - redaction written twice: src/redact.mjs and tools/redact.hmoca agree on twelve messages with both quote kinds, an unpaired quote, a number that must survive and a plain word that must not be touched"],
  ["writetext", "test/write-text.test.mjs", "SPEC 2.5 - write_text writes and reads back the same text, and an undeclared effect refuses instead of writing"],
  ["codefile", "test/code-file.test.mjs", "SPEC M4 - bytecode survives a file round trip: same names, same slots, same effects, same instructions, same answer"],
  ["cvm", "test/c-vm.test.mjs", "SPEC M4 - a machine that is not JavaScript executes the same bytecode and prints the same thing (skipped when the host has no C compiler)"],
  // 线程：两台字节码机都有了自己的实例。JS 那台 2026-10-25，C 那台次日 ——
  // C 那台靠的是线程局部的 g_机：一个线程一个 Hmyr机器，线程里编译、装载、跑，
  // 结果写成文本交回。板子那一支不编线程，thr_* 仍如实说没有。
  ["threadscvm", "test/threads-c-vm.test.mjs", "SPEC M4 - threads on both bytecode machines: two threads alive at once, hard isolation, and a handle that is gone after join"],
  ["cli", "test/cli.test.mjs", "SPEC M4 - the launcher: one command from source to running, with no JavaScript in between (skipped when the host has no C compiler)"],
  // 这一条不标 需要：套件自己就带那份候选清单（绝对路径 + PATH 名），
  // 缺编译器时它会打印「跳过」并以 0 退出。在这里再标一次，等于把同一件事
  // 写进两处 —— 而 2026-11-02 第一次标上去就出了错：Windows 上那台编译器
  // 在绝对路径里、不在 PATH 里，于是这里误判成缺席，而它本来是过的。
  ["arm", "test/arm.test.mjs", "SPEC M4 - the same C machine compiled for bare metal: Cortex-M4 and Cortex-M7 (mfpu=fpv5-d16), the desktop assumptions sit behind conditionals, the image links against a linker script and a startup file, and it runs on either arm-none-eabi-gcc or armclang (skipped when neither is present)"],
  ["board", "test/board.test.mjs", "SPEC M4 - the board path walked on a desk: bytecode in memory, a platform installed, output into a buffer"],
  ["hmyrcompile", "test/hmyr-compiler.test.mjs", "SPEC M4 - the compiler moved into Himeyuri: two compilers, one answer, and a stated boundary where one is still a subset"],
  ["hmyrpack", "test/hmyr-pack.test.mjs", "SPEC M4 - the writer moved into Himeyuri too: the same source packed by two packers, byte for byte"],
  ["readlines", "test/read-lines.test.mjs", "SPEC 4 - reading a file line by line, on both machines, with CRLF and LF agreeing"],
  ["returntypes", "test/return-types.test.mjs", "SPEC 2.3 - a declared return type is checked against what the function actually returns, with the boundary stated"],
  ["contracts", "test/contracts.test.mjs", "SPEC 2.4 - contracts: requires is checked on entry and ensures on exit, and turning the check on changes no other behaviour (design/CONTRACTS.txt)"],
  ["invariants", "test/invariants.test.mjs", "SPEC 2.4 - the third of the three things: an invariant is checked on entry and again before every return, and the order with requires and ensures is observable (design/INVARIANTS.txt)"],
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
  ["index", "test/index.test.mjs", "design/INDEX.txt - an index is built, filled, read and asked about; keys are arbitrary strings, a repeated set overwrites without moving the key"],
  ["zone", "test/zone.test.mjs", "design/MEMORY.txt - the bookkeeping half of the zone model: a block carries its zone, freeze hands it to the managed zone, adopt takes it back, and a wrong conversion names itself"],
  ["zonestatic", "test/zone-static.test.mjs", "design/MEMORY.txt - the compile-time half of the zone model: an escape is refused while the module is being loaded, an arena built inside a loop is a warning, and the rest of the repository reads clean"],
  ["zoneself", "test/zone-self.test.mjs", "design/MEMORY.txt - the zone model on the bootstrap layer: arena, alloc, close, freeze and adopt work on the default path, a closed arena really kills the blocks it owns, and the two evaluators give the same answer"],
  ["globalvar", "test/global-var.test.mjs", "design/GLOBALS.txt - a module-level var reads and writes on all four machines, a const refuses to be rebound, and the two machines that compile agree on the answer"],
  ["realtime", "test/realtime.test.mjs", "design/MEMORY.txt section 3 - the realtime profile's static half: allocating, blocking, an endless loop and an unclosed call chain are all refused while the module is being loaded"],
  ["owned", "test/owned.test.mjs", "design/MEMORY.txt section 2 - the third zone: a holder owns one value at a time, taking is the transfer, and a second put or an empty take names itself"],
  ["ownedcheck", "test/owned-check.test.mjs", "design/MEMORY.txt section 2 - the load-time half of the owned zone: a second put or a second take in a straight line is refused while the module loads, and anything the checker cannot see is left alone"],
  ["ffi", "test/ffi.test.mjs", "design/FFI.txt - the smallest shape of the three answers: a window that copies nothing, out of range is HMYR-行-018, and the machines that have it agree"],
  ["cembed", "test/c-embed.test.mjs", "design/EMBED.txt - a C host embeds the machine: the library builds, the program builds, the host receives forty-two, HMYR running the same file also exits with forty-two, and a load failure or an unknown function is a returned code rather than a dead host"],
  ["ownedstate", "test/owned-state.test.mjs", "design/MEMORY.txt section 2 - the owned state machine in two languages: the JavaScript table is the only truth, the HMYR mirror is hand-written, and both answer the same on the same input"],
  ["namespace", "test/namespace.test.mjs", "SPEC 6.4 step two, first half - a declaration without pub that is used from another module gets a notice (HMYR-載-006), and the notice names both files so the namespace work has a list to start from"],
  ["pkgmanifest", "test/pkg-manifest.test.mjs", "design/PKGMAN.txt - a package says who it is: four fields, a shape check while loading (HMYR-載-007), and a hash check by a tool that is allowed to borrow a crypto library"],
  ["packbytes", "test/pack-bytes.test.mjs", "design/COMPILER.txt - two packers, one bytecode: self/pack.hmoca and src/code-file.mjs write the same bytes for the same source; and two compilers, the JavaScript one and the bootstrap one, agree on what the program prints"],
  ["hmget", "test/hmget.test.mjs", "design/HMGET.txt - taking a package: a local directory or a file URL as the source, the manifest hash checked before anything moves, an existing different package refused unless asked, and http refused by name because the criterion has to be reproducible"],
  ["pkge2e", "test/pkg-e2e.test.mjs", "SPEC M7 - a package from disk to a running program: hmget installs it, 引入 finds it through the package root, the packaged function is called and prints 42, and after hmget --remove the loader refuses the import by naming the missing package"],
  // surface 的两台各一份后端：Windows 是 deps/surface/win.ps1（WPF 真窗口），POSIX 是
  // deps/surface/win.py —— 那一份只做 -NoShow 那条路（参数、图像尺寸、帧计划、事件），
  // 真开窗要一份 X11 绑定，那是它自己的一件活。而套件走的正是 -NoShow：
  // 呈现进程、呈现图像、会话在毫秒 0 时都不弹窗，所以四十九项都能在 Linux 上跑。
  // 这一条 2026-11-03 量过：DISPLAY=:0 与 /mnt/wslg 都在，libX11 也在，缺的只是绑定。
  ["surface", "test/surface.test.mjs", "SPEC M7 - several sub surfaces composited onto the main one, the way real windows will be"],
  ["pixel", "test/pixel.test.mjs", "SPEC M7 - a second kind of buffer: pixels, and a real PNG comes out the other end", { 需要: ["python-pil"] }],
  // parallel 现在两台各一份脚本（parallel.ps1 / parallel.sh），而 parallel.hmoca
  // 先试 powershell、失败再试 bash —— 所以它不再需要 powershell 这一项能力。
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
  ["crosscheck", "test/crosscheck.test.mjs", "SPEC M7 - the number-reporting tools have to agree with each other: the seed's byte count matches in three places, the builtin ledger's seventh column is not empty, two readings of the runtime path say zero together, and the tooling ledger's halves add up - with a broken header value to prove the identities can fail"],
  ["readme", "test/readme.test.mjs", "SPEC M7 - the three numbers on the front page are true: the suite count matches the suite list, the design-document count matches design/, and the error-code count matches the registry - with one of them written wrong on purpose to prove the check can go red"],
  ["agenda", "test/agenda.test.mjs", "SPEC M7 - no undecided item is left in the design documents: every [议] in design/ is a historical mention or the check goes red, and the ten decisions of this round each carry how it would be verified or why it stays open"],
  ["errors", "test/errors.test.mjs", "SPEC M7 - the alarm clock for a debt that is deliberately unpaid: the ask-then-read workarounds in self/ are counted, and the check goes red above ten of them (the point where the benefit would match the cost) or at zero (the point where this observation has nothing left to watch)"],
  ["examples", "test/examples.test.mjs", "SPEC M7 - every file under examples/ has to run: the ten samples that are actually samples, through the default path with a zero exit, plus a check that a missing file is reported as a failure rather than passing quietly"],
  ["probes", "test/probes.test.mjs", "SPEC M7 - the fourteen diagnostic probes under probes/ all compile (they are not run: two of them load the whole bootstrap, which is why they left examples/), and examples/ keeps none of them"],
  ["maps", "test/maps.test.mjs", "SPEC M7 - the collection library: map and set on top of the host index, with insert, overwrite, delete, arbitrary string keys, union/intersection/difference and the alias behaviour of an index - every item compared against the host's Map and Set"],
  ["checkhmyr", "test/check-hmyr.test.mjs", "SPEC M7 - the test scheduler written in Himeyuri: it reads a list, runs three suites, and counts right"],
  ["embedhmyr", "test/embed-hmyr.test.mjs", "SPEC M7 - the embedder written in Himeyuri: read_bytes, hex bytes, a C array that starts with HMYRB"],
  ["ucdchmyr", "test/ucd-c-hmyr.test.mjs", "SPEC M7 - the table generator written in Himeyuri: two implementations, one sample, byte-for-byte identical tables"],
  ["stdinline", "test/stdin-line.test.mjs", "SPEC M7 - reading one line of standard input, and a cat that echoes what it was fed"],
  ["lsphmyr", "test/lsp-hmyr.test.mjs", "SPEC M7 - the language server written in Himeyuri: initialize, shutdown, exit, over Content-Length framing"],
  ["fmthmyr", "test/fmt-hmyr.test.mjs", "SPEC M7 - the expression formatter written in Himeyuri: parentheses where they matter, and printing twice changes nothing"],
  ["elsenewline", "test/else-newline.test.mjs", "SPEC 2.2 - a newline before else, and between a signature and its block, is not a statement boundary: both spellings parse to one tree and run to one answer"],
  ["selfcontained", "test/self-contained.test.mjs", "SPEC M7 - the binary carries its own compiler: a .hmyr runs with no node, no seed beside it, and no manual compile step"],
  // 种子与内置表同步：2026-10-25 量到它只认得七十二个内置里的三十一个，
  // 而 self-contained 那一套用的例子只用 print 与 str，所以它一直是绿的。
  // 同一天把 self/compile.hmyr 的「是内置」补齐并重建种子，这条现在是账。
  ["seedgap", "test/seed-gap.test.mjs", "SPEC M7 - the committed seed keeps up with the builtin table: every builtin name the host defines is also known to the seed compiler"],
  // 改名第一步的验收：新名与旧名指的是同一件事，两台机器都得认两套拼法。
  // 第二步（批量 git mv）之后这一套仍然该绿 —— 那时它证明的是「旧的接了没」。
  ["names", "test/names.test.mjs", "design/FILETYPE.txt - the rename's first step: .hmyr with .hmoca, .hmyrb with .hmoks, and .hmtn for the seed, all naming the same things on both machines"],
  ["filekindhmyr", "test/file-kind-hmyr.test.mjs", "M7 - the suffix rule written twice: tools/file-kind-reference.mjs and tools/file-kind.hmoca answer the same on seventeen names, including the empty string, upper case, a trailing slash and the retired spellings"],
  // 两档：hmsnp 与 hmhsr 是同一份内容的两档入口，档位由名字定。
  ["profile", "test/profile.test.mjs", "design/FILETYPE.txt section four - the two entries really differ: the profile comes from the suffix, steady and elastic land on different resource presets, a plain .hmoca keeps the number it always had, and both run to the same output"],
  // 容器格式的骨架：三条规矩都是格式的一部分，所以各有判据。
  // ittgn 的两条转换都按平台：POSIX 用 src/zip-writer.mjs 压、用 python3 的 zipfile 解。
  // 解那一侧不用 unzip，因为它不认 ZIP 的 UTF-8 标志，中文成员名会解成乱码 —— 那正是
  // 上一轮「根目录既没有 往.hmsnp」的根因。
  ["ittgn", "test/ittgn.test.mjs", "design/FILETYPE.txt - the container format's skeleton: bytes go in and come out unchanged, depth is counted per container with a ceiling of twelve, and hmsnp or hmhsr is refused as a member because those two are the container's own logic"],
  ["deflate", "test/deflate.test.mjs", "SPEC M7 - deflate stored blocks written in Himeyuri: round trip, and zlib reads the stream without being told anything"],
  ["tree", "test/tree.test.mjs", "SPEC M7 - the Huffman tree alone: all three code-length tables must sum to a complete Kraft total"],
  ["array", "test/array.test.mjs", "SPEC 2.2 - a mutable array beside the immutable tuple: write, read, out of range, and the tuple it came from stays put"],
  ["inflate", "test/inflate.test.mjs", "SPEC M7 - inflate in Himeyuri: five tiny cases, our own stream back byte for byte, and zlib's fixed-Huffman stream too"],
  ["zip", "test/zip.test.mjs", "SPEC M7 - a ZIP container written in Himeyuri: local header, central directory and end record, field by field against the spec"],
  ["zipmulti", "test/zip-multi.test.mjs", "SPEC M7 - several members in one archive: N central entries with their own offsets, read back by parsing the archive ourselves"],
  ["bitops", "test/bitops.test.mjs", "SPEC M7 - 32-bit bit operations written without bit operators, every answer checked against node's own"],
  ["sha256", "test/sha256.test.mjs", "SPEC M7 - SHA-256 in Himeyuri: empty, one byte, abc, and three sizes that straddle the block boundary, all against node"],
  ["verifyhmyr", "test/verify-hmyr.test.mjs", "SPEC M7 - a manifest is verified in Himeyuri: every entry's hash, and the entry main is not stolen by the imported self-test"],
  ["readdir", "test/readdir.test.mjs", "SPEC 2.2 - read_dir: names come back sorted, a Chinese name crosses the encoding, and three implementations agree"],
  ["isdir", "test/isdir.test.mjs", "SPEC 2.2 - is_dir: a directory, a file, a Chinese-named directory and a missing path, answered the same by all three"],
  ["packagehmyr", "test/package-hmyr.test.mjs", "SPEC M7 - a package built in Himeyuri: EOCD, central directory and every member read back by offset, byte for byte against the source"],
  ["crc", "test/crc.test.mjs", "SPEC 2.2 - the CRC32 builtin: three implementations agree with each other and with node, and a blocked tuple equals the flat one"],
  ["releasehmyr", "test/release-hmyr.test.mjs", "SPEC M7 - release: manifest, archive and notes from one command, and the notes answer the three questions"],
  ["bigint", "test/bigint.test.mjs", "SPEC M7 - 256-bit integers built from 24-bit words: add, subtract, multiply and compare, checked against node's BigInt"],
  ["wide", "test/wide.test.mjs", "SPEC M7 - 840-bit integers for decimal assembly: shift left and right with a sticky bit, multiply and divide by a small integer and the bit length, checked against node's BigInt"],
  ["rational", "test/lib-rational.test.mjs", "SPEC M7 - rational numbers on top of bigint: a third plus two thirds is exactly one, a third times three is one too, and a broken check hands back which line it was"],
  ["f64bits", "test/f64-hmyr.test.mjs", "SPEC M7 - the eight bytes of a double read back into a number, bootstrap side: round trips over regular, subnormal and infinite bit patterns, and a broken round trip names its line"],
  ["f64dec", "test/f64-dec.test.mjs", "SPEC M7 - decimal to double from integers, bootstrap side: the mantissa and decimal exponent are assembled through 840-bit integers and one round to nearest even, and the eight bytes match src/decimal.mjs on regular, subnormal, overflow and underflow samples"],
  ["declit", "test/dec-lit.test.mjs", "SPEC M7 - decimal literals through the Himeyuri-written compiler: twelve texts including four subnormals are parsed by 数字值 and printed, and every one of them has to match String(Number(text)) on the host; breaking the slow path back to dividing by a power of ten has to turn 1e-320 into 0"],
  ["vmload", "test/vm-load.test.mjs", "SPEC M4 - the loader of an HMYR-written VM: three real .hmoks files come back with the same function table the JS reader gives, line for line, and bad headers are refused with a reason"],
  ["vmrun", "test/vm-run.test.mjs", "SPEC M4 - the instruction loop of an HMYR-written VM: six small programs run through it and through src/vm.mjs, the two answers must be the same, and the opcodes it does not implement yet have to say so"],
  ["vmboot", "test/vm-boot.test.mjs", "SPEC M4 - the HMYR-written VM carrying the bootstrap itself: runtime/run.hmoks is loaded and its 命令行入口 compiles and runs examples/hello.hmoca, printing the same 5 bin/hmyr.mjs prints; conformance/vm-hands.hmoca then exercises the forty-odd builtins hello never touches and its sum has to match src/vm.mjs; a made-up entry name has to say so"],
  ["interval", "test/lib-interval.test.mjs", "SPEC M7 - interval arithmetic over doubles: an exact sum keeps its endpoints unchanged, a computed one is never narrower than the truth, and a broken check hands back which line it was"],
  ["time", "test/lib-time.test.mjs", "SPEC M7 - the time library: milliseconds to a civil date and back, ISO 8601 out and in, twelve samples spanning the epoch, a negative millisecond, both century boundaries, a leap day and 9999-12-31, all matching Date's toISOString and getUTCDay; a string that is not a date is refused rather than guessed"],
  ["curve", "test/curve.test.mjs", "SPEC M7 - the Ed25519 curve: 0 and 1 times the base point, and every result from 2 to 8 landing on the curve equation"],
  ["sha512", "test/sha512.test.mjs", "SPEC M7 - SHA-512 over four samples: empty, three bytes, the padding boundary, and a two-block input, all against node's crypto"],
  ["ssh", "test/ssh.test.mjs", "SPEC M7 - the OpenSSH signature wire format: base64 decoded and every section of the SSHSIG structure matched byte for byte"],
  ["sign", "test/sign.test.mjs", "SPEC M7 - a real release signature verified by Himeyuri itself: the signed data built from PROTOCOL.sshsig section 3, and the judge refuses a message changed by one byte"],
  ["signgen", "test/sign-gen.test.mjs", "SPEC M7 - the other half of the OpenSSH bridge: HMYR signs from a seed, and RFC 8032's two published vectors come out byte for byte"],
  ["signbridge", "test/sign-bridge.test.mjs", "SPEC M7 - the first arrow of the ssh-keygen bridge: HMYR writes an OpenSSH private key from a seed, and ssh-keygen -y reads back the same public key"],
  ["selfcov", "tools/self-coverage.mjs", "FULLSELF - the evaluator written in HMYR agrees with the host on fourteen programs"],
  ["selfratiohmyr", "test/self-ratio-hmyr.test.mjs", "M7 - the bootstrap ratio measured twice: the JavaScript version and the HMYR one count the same lines in the same five groups, and agree on the total (skipped when the host has no C compiler)"],
  ["selfload", "tools/self-loader.mjs", "FULLSELF - the loading half: the lexer and parser written in HMYR accept the same 27 real files the host loader accepts"],
  ["selfmod", "tools/self-load.mjs", "FULLSELF - module loading semantics: four real import trees give the same order position by position, and a missing import or a cycle is refused with the same code as the host loader"],
  ["impact", "test/impact.test.mjs", "SPEC M7 - the project map answers which suites a change touches: the count matches the suite list, the bytecode-product routes report everything, and every name it hands back is a real suite"],
  // 两份地图各说各话时不会报错，只会让人按错的那张去跑套件 —— 所以它对一遍。
  // MIM 不在的那台机器上这一套跳过（以 0 退出并说清是跳过），而不是变红。
  ["mapagree", "tools/map-agree.mjs", "SPEC M7 - the two project maps agree file by file: this repository's impact.mjs and mega-index-map's library_project hand back the same suites for the same change (skipped when mega-index-map is not on this machine)"],
  ["selfpos", "tools/self-positions.mjs", "FULLSELF - the lexer's positions: six samples agree with the host lexer token for token on text, line and column"],
  ["selfbridge", "tools/self-bridge-check.mjs", "FULLSELF - the bridge: loadUnit replaced by HMYR's own loader agrees with the host loader on acceptance, function names, import order and the refusal of a missing file"],
  ["selfvmeval", "tools/self-vm-eval.mjs", "FULLSELF - the evaluator on the bytecode machine: the self-hosted lexer, parser and evaluator run as bytecode and interpret four programs to the same answers as the host"],
  ["selfvmcompile", "tools/self-vm-compile.mjs", "SELFVMC - the packer on the bytecode machine: compile and pack run as bytecode and produce the same byte streams as the JavaScript packer"],
  ["selfvmfmt", "tools/self-vm-fmt.mjs", "SELFVMF - the formatter on the bytecode machine: self/fmt.hmyr as bytecode rewrites four sources to the same text the host evaluator produces"],
  ["fmtwholehmyr", "test/fmt-whole-hmyr.test.mjs", "M6 - the whole-file formatter in HMYR: byte-identical to the host on comment-free files, keeps the comments the host drops, and does not leak carriage returns"],
  ["ucdnfchmyr", "test/ucd-nfc-hmyr.test.mjs", "CORPUS - the HMYR-written NFC table generator runs on the bytecode machine and produces vm/ucd-nfc.h byte for byte, which is also the index builtins\u0027 first real user"],
  ["ucdcasehmyr", "test/ucd-case-hmyr.test.mjs", "CORPUS - the HMYR-written case table generator runs on the bytecode machine and produces vm/ucd-case.h byte for byte"],
  ["selfnodes", "tools/self-nodes.mjs", "FULLSELF - nodes and declarations: every node the HMYR parser produces sits where the host tree has one, and Module/Fn/Block match the host field for field, in six samples"],
  ["selftree", "tools/self-tree.mjs", "FULLSELF - a lockstep walk: the Module built by HMYR and the host ast are compared node by node over eight samples including imports and literals, and the walk stops at the first mismatch"],
  ["selfhandoff", "tools/self-handoff.mjs", "FULLSELF - the handoff: a Module built by HMYR is handed straight to the host Runtime, registerModule then callFunction with no adapter at all, and five programs produce the expected value"],
  ["manifesthmyr", "test/manifest-hmyr.test.mjs", "SPEC M7 - the manifest built by Himeyuri: valid JSON, a digest that matches the standard indentation, and a loop closed by its own verifier"],
  ["manifest", "test/manifest.test.mjs", "SPEC M7 - the distribution manifest: everything it lists actually exists, and the minimal set is exactly fifteen"],
  ["helper", "test/helper.test.mjs", "SPEC M7 - the assistant: a code explains itself, a word searches the meanings, and a miss still hands back the list"],
  ["verify", "test/verify.test.mjs", "SPEC M7 - the manifest verifier: it says pass when it matches, and it really says fail when something was changed"],
  ["package", "test/package.test.mjs", "SPEC M7 - packaging: the release carries a manifest, and that manifest verifies from inside the package"],
  ["distro", "test/distro.test.mjs", "SPEC M7 - the distribution pieces: a wizard that installs nothing, a tour that links only to what exists, and an updater that can say it does not know"],
  // release 那条链的最后一步曾经是 powershell 压 zip，现在 tools/package.mjs
  // 在 POSIX 上走 src/zip-writer.mjs，所以这一套不再需要 powershell。
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
  ["suitelist", "test/suite-list.test.mjs", "the two suite lists agree: check-all.mjs --list and tools/suite-list.txt hold the same names, the same scripts, no duplicates, and every path that does not exist is named"],
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
// 真正必须串行的六套 —— 判据只有一条：它们会不会写到同一个地方。
//
//   manifest / package / distro / release   四套都写 dist/，并行会互相覆盖产物，
//                                           症状是四套一起红、而单独跑都过。
//   hostdeps / text                         两套要在临时目录里写同一份文件再读回来。
//
// 而另外七套原来也在这张表里，2026-11-03 挪了出去：
//
//   cvm / cli / arm / board   编 C，但各自在 mkdtemp 里出产物 —— 不冲突，只是抢 CPU，
//                             而抢 CPU 正是并行池该管的事。
//   corpus / ucd              读 deps/ 下的表，只读。
//   subsetparse               与 subsetload 读同一批 self/ 源码，也是读。
//
// 那七套合计约一百秒，原来全在串行里，等于把并行池空着等它们。
const 串行 = new Set([
  "manifest", "package", "distro", "release",
  "hostdeps", "text",
]);
// 并行数：八路。这台是 12 核 16 GB，八路留四核给系统与 gcc 的子进程，
// 同时把内存峰值压在 8 × 768 MB 的名义上限之内。
// 原来写死四路，等于让八核闲着，而全量的墙钟由最慢那一套决定。
//
// 2026-11-01：改成可配置，而且在「宿主 loader 换成自举替身」那一档默认降到一路。
// 为什么：那一档里每一次 loadUnit 都要起一个 C 机器进程，于是八路并行会把机器上的
// node 进程推到几百个并持续创建（实测过一次，内存被吃满，整台机器发卡）。
// 想快就自己说 HMYR_JOBS=8 —— 但那时要自己盯着进程数。
const 并行数 = (() => {
  const 要 = Number(process.env.HMYR_JOBS);
  if (Number.isFinite(要) && 要 > 0) return Math.floor(要);
  return process.env.HMYR_LOADER === "self" ? 1 : 8;
})();

// ---- 只跑该跑的 ----
//
// 全量是十几分钟，而改一个 self/*.hmyr 只影响用到它的那几套。所以：
//   --only a,b,c    只跑这几套
//   --skip a,b      跳过这几套
//   --affects <文件>  从 import 图反推：哪些测试 import 了这个文件（或其传递依赖）
// 判据是保守的：图上有一条路就选中。宁可多跑一套，不可漏掉一套。
const 参 = process.argv.slice(2);
const 取值 = (旗) => {
  const i = 参.indexOf(旗);
  return i >= 0 && i + 1 < 参.length ? 参[i + 1] : null;
};
const 分号 = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);
const 只跑 = 分号(取值("--only"));
const 跳过 = new Set(分号(取值("--skip")));

// 从某个测试文件出发，顺着相对 import 与路径字面量收集它依赖的所有仓库内文件。
// 两种都要扫：有的套件 import 源码，有的套件是 spawn 一个 self/*.hmyr 去跑
// （比如 curve 套件跑标量乘、package 套件跑打包）—— 后者在 import 图里是隐形的。
const 依赖表 = new Map();
const 收依赖 = (文件, 见过) => {
  if (见过.has(文件)) return 见过;
  见过.add(文件);
  let 文 = "";
  try { 文 = readFileSync(path.join(ROOT, 文件), "utf8"); } catch { return 见过; }
  for (const m of 文.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
    const 指 = m[1];
    if (!指.startsWith(".")) continue;
    const 绝对 = path.resolve(path.dirname(path.join(ROOT, 文件)), 指);
    const 相对 = path.relative(ROOT, 绝对).split(path.sep).join("/");
    if (!相对.startsWith("..")) 收依赖(相对, 见过);
  }
  for (const m of 文.matchAll(/["'`]((?:self|src|tools|test|bin|vm)\/[A-Za-z0-9_.\/-]+\.(?:hmyr|mjs|c|txt|json))["'`]/g)) {
    收依赖(m[1], 见过);
  }
  return 见过;
};
const 依赖于 = (文件) => {
  if (!依赖表.has(文件)) 依赖表.set(文件, 收依赖(文件, new Set()));
  return 依赖表.get(文件);
};

const 改过的 = 分号(取值("--affects"));
let 选中 = SUITES;
if (只跑.length) 选中 = SUITES.filter(([名]) => 只跑.includes(名));
if (改过的.length) {
  选中 = SUITES.filter(([名, 脚本]) => {
    const 依赖 = 依赖于(脚本);
    return 改过的.some((f) => 依赖.has(f) || f === 脚本);
  });
}
if (跳过.size) 选中 = 选中.filter(([名]) => !跳过.has(名));
const 名单 = new Set(选中.map(([名]) => 名));

// ---- 平台能力：这一套件在「这一台」上能不能跑 ----
//
// 为什么要有这一段：在第二个系统上跑全量时，「缺 powershell」与「平台假设写错了」
// 在报告里长得一模一样 —— 而处置完全不同：前者记明即可，后者要改代码。
// 2026-11-02 在 WSL（Nyarch Linux）上第一次跑全量时才需要这条区分，于是 SUITES
// 表的第四项（原本只放 knownMissing）多了 需要 这个字段。
//
// 探测全在本地做，不装任何东西：缺就是缺，报「设计缺席」，不计入失败。
const 能力 = (() => {
  const 有 = (cmd, args) => {
    try { return spawnSync(cmd, args, { encoding: "utf8", timeout: 15000 }).status === 0; } catch { return false; }
  };
  return {
    powershell: 有("powershell", ["-NoProfile", "-Command", "exit 0"]),
    "arm-gcc": 有("arm-none-eabi-gcc", ["--version"]),
    "python-pil": 有("python", ["-c", "import PIL"]),
    cmd: process.platform === "win32",
    // 三套颜色套件要用 Windows 自带的那两个 ICC 配置文件（sRGB 与 SWOP）。
    // 别的系统上没有它们，而替代物不是随手能编出来的 —— 所以那一侧是环境缺件，
    // 报「设计缺席」而不是「不通过」（2026-11-03 在 WSL 上第一次分清这两件事）。
    "windows-icc": existsSync("C:/Windows/System32/spool/drivers/color/sRGB Color Space Profile.icm"),
  };
})();
const 缺什么 = (标记) => (((标记 && 标记.需要) || []).filter((x) => !能力[x]));
const 缺席 = [];
选中 = 选中.filter(([名, , , 标记]) => {
  const 缺 = 缺什么(标记);
  if (缺.length) { 缺席.push([名, 缺]); return false; }
  return true;
});

const 跑一套 = (script) => new Promise((resolve) => {
  /* 每个工人的堆上限。2026-11-01 从写死的 768 改成可配置，缺省 512。
   *
   * 为什么：八路 × 768 MB 就是 6 GB 的名义上限，而每套件内部还会起子进程
   * （cvm 编 gcc、launcher 反复起 bin/hmyr.mjs），16 GB 的机器很容易被吃满 ——
   * 那是「内存持续爆满」的一半来源，另一半是子进程本身。
   * 512 仍然容得下全库最重的那几套；真撞上就 HMYR_HEAP_MB 调回去。 */
  const 堆 = Number(process.env.HMYR_HEAP_MB) > 0 ? Number(process.env.HMYR_HEAP_MB) : 512;
  const 子 = spawn(process.execPath, ["--max-old-space-size=" + 堆, path.join(ROOT, script)], { cwd: ROOT });
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
  const 起 = Date.now();
  let r = await 跑一套(script);
  let 重试过 = false;
  if (r.码 !== 0) {
    重试过 = true;
    r = await 跑一套(script);
  }
  return { ...r, 重试过, 耗时: Date.now() - 起 };
};

const 结果 = new Map();
for (const [名, 脚本] of 选中) {
  if (!串行.has(名)) continue;
  结果.set(名, await 跑一套带重试(脚本));
}
{
  const 轻 = 选中.filter(([名]) => !串行.has(名));
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

const 慢的 = [];
let 已知缺 = 0, 意外通过 = 0;
for (const [name, script, what, 标记] of 选中) {
  const result = 结果.get(name);
  const tail = String(result.出 || "").trim().split("\n").filter(Boolean).pop() || "";
  const ok = result.码 === 0;
  // known-missing：这一套是「目标验收」——它验的是还没做的东西，所以现在该红。
  // 红不算失败，而绿了要报出来：那是账该改的信号，不是好消息。
  // 与 conformance 里 xfail 的语义一致，理由也一样：缺的东西要能被看见，不能靠沉默。
  const 是目标 = !!(标记 && 标记.knownMissing);
  if (ok && 是目标) { 意外通过++; }
  else if (!ok && !是目标) failed++;
  else if (!ok && 是目标) 已知缺++;
  慢的.push([result.耗时, name]);
  const 标签 = ok ? (是目标 ? "[目标已达成] " : "[通过] ") : (是目标 ? "[已知缺] " : "[不通过] ");
  console.log("  " + 标签 + name.padEnd(12) + tail +
    (result.耗时 >= 1000 ? "  (" + (result.耗时 / 1000).toFixed(1) + "s)" : ""));
  console.log("          " + what);
  if (是目标) console.log("          " + (ok ? "这一套本以为还做不到：把账改掉" : "还没做到，理由：" + 标记.knownMissing));
  if (!ok && !是目标) {
    console.log("          exit " + result.码 + (result.重试过 ? ", after retrying once" : ""));
    const err = String(result.错 || "").trim().split("\n").slice(0, 3).join(" | ");
    if (err) console.log("          " + err);
    if (!tail) console.log("          and it produced no output at all");
  } else if (ok && result.重试过) {
    console.log("          (passed on the second attempt: this suite is flaky under load)");
  }
}
if (缺席.length) {
  // 「设计缺席」与「不通过」是两件事：前者是这一台没有那个能力（缺 powershell、
  // 缺 arm gcc、缺 python 的 PIL），后者是代码或判据有问题。混在一起报，读的人
  // 就得自己去猜哪一种是该修的。
  for (const [名, 缺] of 缺席) {
    console.log("  [设计缺席] " + 名.padEnd(12) + "这台没有：" + 缺.join(" / "));
  }
  console.log("");
  console.log(缺席.length + " suite(s) are absent by design on this machine: counted here, not failed");
  console.log("");
}
console.log("");
// 最慢的五套：知道时间花在哪，才知道下一次该不该跑全量。
慢的.sort((a, b) => b[0] - a[0]);
const 慢五 = 慢的.slice(0, 5).filter(([毫]) => 毫 >= 500);
if (慢五.length) {
  console.log("慢的五套：" + 慢五.map(([毫, 名]) => 名 + " " + (毫 / 1000).toFixed(1) + "s").join(" · "));
  console.log("");
}
// 全表：慢的五套只够回答「要不要跑全量」，回答不了「下一次该改哪一套」。
//
// 那要的是总工作量的分布，因为墙钟是总工作量除以并行数 —— 一套省下的时间要再除以
// 并行数才落到墙钟上。inflate 快了四倍而墙钟只动了噪声那么多，差的就是这个除法。
// 设了 HMYR_TIMES 就落一份降序全表，一行一套、毫秒在前，直接能排序。
if (process.env.HMYR_TIMES) {
  const 总毫 = 慢的.reduce((n, [毫]) => n + 毫, 0);
  writeFileSync(process.env.HMYR_TIMES,
    慢的.map(([毫, 名]) => 毫 + "\t" + 名).join("\n") + "\n", "utf8");
  console.log("全表落在 " + process.env.HMYR_TIMES + "：" + 慢的.length + " 套，合计 "
    + (总毫 / 1000).toFixed(1) + " 秒工作量（除以并行数 " + 并行数 + " 才是墙钟的量级）");
  console.log("");
}
if (已知缺) console.log(已知缺 + " suite(s) are known missing: counted here, not failed — they are the target acceptance");
if (意外通过) console.log(意外通过 + " suite(s) passed although the table says they cannot yet: fix the bookkeeping, not the suite");
console.log(failed === 0 ? "all suites held" : failed + " suite(s) did not hold");
process.exit(failed === 0 ? 0 : 1);
