// The error-code registry.
//
// SPEC 4.2: error identifiers are stable and searchable, and a code is never reused for a different
// meaning. That is a promise about the whole language, and it is only kept if something checks it -
// so the registry lists every code with what it means, and the runner checks the sources against it in
// both directions: a code in the sources that is not registered, and a registered code nobody emits,
// are both reported.
// A code is one of three things, and the difference matters when asking whether it is exercised:
//   - exercised by a conformance case (the default)
//   - internal: it reports a fault in the implementation, so no program can trigger it on purpose
//   - planned: reserved for a rule that is not implemented yet
export const CODES = [
  { code: "HMYR-內-004", stage: "host", checkedBy: "test/i18n-three.test.mjs", meaning: "a character that does not exist in the target encoding: refused rather than replaced" },
  { code: "HMYR-內-010", stage: "host", checkedBy: "test/while.test.mjs", meaning: "a while loop that ran past a million iterations without ending: stopped rather than hanging forever" },
  { code: "HMYR-內-015", stage: "host", checkedBy: "test/record-new.test.mjs", meaning: "field_get given something that is not a record" },
  { code: "HMYR-內-016", stage: "host", checkedBy: "test/record-new.test.mjs", meaning: "field_get asked for a field that record does not have: refused rather than handing back nothing" },
  { code: "HMYR-內-017", stage: "host", checkedBy: "test/record-new.test.mjs", meaning: "field_names given something that is not a record: with no fields to list there is no name list to hand back" },
  { code: "HMYR-內-018", stage: "host", checkedBy: "test/index.test.mjs", meaning: "index_get asked for a key the index does not hold: refused rather than handing back nothing" },
  { code: "HMYR-內-019", stage: "host", checkedBy: "test/index.test.mjs", meaning: "an index operation given something that is not an index: refused rather than guessing" },
  { code: "HMYR-內-020", stage: "host", checkedBy: "test/threads.test.mjs", meaning: "a thread handle that does not exist" },
  { code: "HMYR-內-021", stage: "host", checkedBy: "test/threads.test.mjs", meaning: "a thread that did not finish within the given time" },
  { code: "HMYR-內-022", stage: "host", checkedBy: "test/profile.test.mjs", meaning: "the thread pool is full: steady gives one slot, elastic gives the compile-time number" },
  { code: "HMYR-內-014", stage: "host", checkedBy: "test/record-new.test.mjs", meaning: "record_new given something that is not a (name, value) tuple, or a name a record cannot hold: records are not hashmaps" },
  { code: "HMYR-內-013", stage: "host", checkedBy: "test/capabilities.test.mjs", meaning: "run_program with an empty program name: refused with a code instead of the host's bare exception" },
  { code: "HMYR-內-011", stage: "host", checkedBy: "test/capabilities.test.mjs", meaning: "a file that cannot be read: the host reason is carried, not swallowed" },
  { code: "HMYR-內-012", stage: "host", checkedBy: "test/capabilities.test.mjs", meaning: "a file that cannot be written: refused with the host reason" },
  { code: "HMYR-內-009", stage: "host", checkedBy: "test/shell-exec.test.mjs", meaning: "chdir to a directory that cannot be entered: refused with the host's own reason" },
  { code: "HMYR-內-006", stage: "host", checkedBy: "test/string-builtins.test.mjs", meaning: "ord of an empty string: refused rather than returning a made-up zero" },
  { code: "HMYR-內-007", stage: "host", checkedBy: "test/string-builtins.test.mjs", meaning: "chr of something outside the code point range" },
  { code: "HMYR-內-008", stage: "host", checkedBy: "test/string-builtins.test.mjs", meaning: "to_int of a string that is not an integer literal: refused rather than parsed loosely" },
  { code: "HMYR-內-005", stage: "host", checkedBy: "test/locale.test.mjs", meaning: "a locale profile name that does not exist: refused rather than falling back to the default" },
  { code: "HMYR-詞-008", stage: "host", checkedBy: "test/i18n-three.test.mjs", meaning: "an encoding name this runtime does not know: refused rather than guessed" },
  { code: "HMYR-內-003", stage: "host", checkedBy: "test/i18n-three.test.mjs", meaning: "writing in an encoding this runtime cannot produce: refused rather than writing wrong bytes" },
  { code: "HMYR-詞-001", stage: "lex", checkedBy: "test/codes-lex.test.mjs", meaning: "a string is never closed" },
  { code: "HMYR-詞-003", stage: "lex", checkedBy: "test/codes-lex.test.mjs", meaning: "a block comment is never closed" },
  { code: "HMYR-詞-004", stage: "lex", checkedBy: "test/codes-lex.test.mjs", meaning: "a numeric literal is malformed (bad digit for its base, or a misplaced separator)" },
  { code: "HMYR-詞-005", stage: "lex", checkedBy: "test/codes-lex.test.mjs", meaning: "brackets do not balance" },
  { code: "HMYR-詞-006", stage: "lex", checkedBy: "test/codes-lex.test.mjs", meaning: "an escape sequence is not recognised" },
  { code: "HMYR-詞-007", stage: "lex", checkedBy: "test/codes-lex.test.mjs", meaning: "a character cannot start a token" },
  { code: "HMYR-詞-002", stage: "lex", checkedBy: "test/codes-value.test.mjs", meaning: "an identifier mixes writing systems" },
  { code: "HMYR-形-001", stage: "tool", checkedBy: "test/format.test.mjs", meaning: "the formatter dropped comments, because it has nowhere to attach them yet" },

  { code: "HMYR-形-002", stage: "parse", checkedBy: "test/codes-lex.test.mjs", meaning: "a token was expected and something else was found" },
  { code: "HMYR-形-003", stage: "parse", checkedBy: "test/codes-lex.test.mjs", meaning: "a statement was not terminated at the end of its line" },
  { code: "HMYR-形-004", stage: "parse", internal: true, meaning: "the parser cannot start a declaration or statement here" },
  { code: "HMYR-形-005", stage: "parse", checkedBy: "test/codes-lex.test.mjs", meaning: "an expression was expected" },
  { code: "HMYR-形-006", stage: "parse", internal: true, meaning: "the parser stopped making progress (a fault in the parser, not in the input)" },

  { code: "HMYR-行-001", stage: "run", checkedBy: "test/codes-eval.test.mjs", meaning: "the module has no main function" },
  { code: "HMYR-行-002", stage: "run", checkedBy: "test/codes-eval.test.mjs", meaning: "a call passes the wrong number of arguments" },
  { code: "HMYR-行-003", stage: "run", internal: true, meaning: "the program ran for too long without finishing" },
  { code: "HMYR-行-004", stage: "run", internal: true, meaning: "a syntax error reached the evaluator" },
  { code: "HMYR-行-005", stage: "run", checkedBy: "test/codes-eval.test.mjs", meaning: "a name is not in scope" },
  { code: "HMYR-行-006", stage: "run", checkedBy: "test/codes-eval.test.mjs", meaning: "no match arm accepted the value" },
  { code: "HMYR-行-007", stage: "run", checkedBy: "test/codes-eval.test.mjs", meaning: "a field does not exist on that value" },
  { code: "HMYR-行-008", stage: "run", checkedBy: "test/codes-eval.test.mjs", meaning: "the value being called is not callable" },
  { code: "HMYR-行-009", stage: "run", checkedBy: "test/codes-eval.test.mjs", meaning: "the call depth limit was exceeded" },
  { code: "HMYR-行-010", stage: "run", internal: true, meaning: "the evaluator met a node kind it does not implement" },
  { code: "HMYR-行-011", stage: "run", internal: true, meaning: "the evaluator met an operator it does not implement" },
  { code: "HMYR-行-012", stage: "run", checkedBy: "test/codes-value.test.mjs", meaning: "division by zero" },
  { code: "HMYR-行-013", stage: "run", checkedBy: "test/codes-value.test.mjs", meaning: "a number was expected" },
  { code: "HMYR-行-014", stage: "run", checkedBy: "test/codes-value.test.mjs", meaning: "two values cannot be compared" },
  { code: "HMYR-行-015", stage: "run", checkedBy: "test/codes-value.test.mjs", meaning: "len() was given something without a length" },
  { code: "HMYR-行-016", stage: "run", checkedBy: "test/codes-value.test.mjs", meaning: "int() could not read the value" },
  { code: "HMYR-內-001", stage: "run", checkedBy: "test/codes-value.test.mjs", meaning: "a call uses an effect the caller did not declare" },
  { code: "HMYR-內-002", stage: "run", checkedBy: "test/embed.test.mjs", meaning: "the script declares an effect the host did not grant" },

  { code: "HMYR-行-017", stage: "run", checkedBy: "test/codes-value.test.mjs", meaning: "assignment to something that is not a variable declared with var" },
  { code: "HMYR-行-018", stage: "run", checkedBy: "test/codes-value.test.mjs", meaning: "a subscript is outside the length of the value" },
  { code: "HMYR-行-019", stage: "run", checkedBy: "test/codes-value.test.mjs", meaning: "the value being subscripted has no elements" },

  { code: "HMYR-載-001", stage: "link", checkedBy: "test/module.test.mjs", meaning: "a circular import: the file is already being loaded" },
  { code: "HMYR-載-003", stage: "link", checkedBy: "test/module.test.mjs", meaning: "an imported file does not exist" },
  { code: "HMYR-載-005", stage: "link", checkedBy: "test/module-rev.test.mjs", meaning: "the import asks for a revision the module does not offer: no version both sides support, so the link is refused rather than guessed" },
  { code: "HMYR-載-002", stage: "link", checkedBy: "test/module.test.mjs", meaning: "an import that is not a path; the package manager owns that" },
  { code: "HMYR-載-004", stage: "link", checkedBy: "test/module.test.mjs", meaning: "two modules declare the same name, and the flat table means the later one wins" },
  { code: "HMYR-載-006", stage: "link", checkedBy: "test/namespace.test.mjs", meaning: "a declaration without pub is used from another module; the flat table still lets it through, so this is a notice and not a refusal, and it names the file to change when namespaces arrive" },
  { code: "HMYR-載-007", stage: "link", checkedBy: "test/pkg-manifest.test.mjs", meaning: "a package manifest is missing or does not make sense: not JSON, not an object, a name that disagrees with its directory, a version that is not an integer, an empty licence, a hash that is not sha256 with 64 lowercase hex, or a version that disagrees with the entry file's rev" },
  { code: "HMYR-內-023", stage: "run", checkedBy: "test/namespace.test.mjs", meaning: "a name without pub is called from another module: the ownership table says where each name came from, the parser records pub, and the two disagreeing is a refusal now that the library marks its exports; the same check runs for a tail call, which does not pass through the ordinary call path" },
  { code: "HMYR-載-009", stage: "link", checkedBy: "test/pkg-manifest.test.mjs", meaning: "a package depends on another package that is not beside it in the package root; a missing dependency is not a warning, because the program would otherwise fail somewhere far from the manifest" },
  { code: "HMYR-載-011", stage: "link", checkedBy: "test/pkg-manifest.test.mjs", meaning: "a package needs a dependency at a minimum version higher than the one it offers; revisions only move forward, so a lower one cannot satisfy a higher request" },
  { code: "HMYR-載-010", stage: "link", checkedBy: "test/pkg-manifest.test.mjs", meaning: "a package depends on another without recording that package's hash; the hash is what makes a swapped dependency visible, so a dependency without one is a dependency you cannot check" },
  { code: "HMYR-載-012", stage: "link", checkedBy: "test/pkg-manifest.test.mjs", meaning: "a package is signed, but there is no trust table beside it or no public key for that package in it; a signature with nothing to check it against proves nothing, and the anchor has to live outside the thing it vouches for" },
  { code: "HMYR-載-013", stage: "link", checkedBy: "test/hmget.test.mjs", meaning: "an install was asked for a package that is not in the given source, or the package there is missing its manifest or its entry file; a source is a directory and a missing package there is a plain refusal" },
  { code: "HMYR-載-014", stage: "link", checkedBy: "test/hmget.test.mjs", meaning: "the entry file's sha256 does not match the hash its manifest declares, so the package in the source is not the package the manifest describes; this is the check that catches a source that was modified after it was published" },
  { code: "HMYR-載-015", stage: "link", checkedBy: "test/hmget.test.mjs", meaning: "the destination already holds a package of that name with different contents; overwriting is an explicit act and needs --force, because a tool that silently replaces an installed package is the most common way this kind of tool goes wrong" },
  { code: "HMYR-載-017", stage: "link", checkedBy: "test/hmget.test.mjs", meaning: "an uninstall was asked for a package that is not in the package root; removing something that is not there is a refusal rather than a silent success, because the caller usually believes the opposite" },
  { code: "HMYR-載-019", stage: "link", checkedBy: "test/hmget.test.mjs", meaning: "another package in the same root depends on the one being removed; the tool names the dependants and refuses, and --force removes it anyway while saying which packages it just broke" },
  { code: "HMYR-載-020", stage: "link", checkedBy: "test/realtime.test.mjs", meaning: "a function that declares the realtime profile does something that profile forbids: it allocates in the managed zone, touches the file, process or thread world, owns a loop whose condition is a constant true value, or calls a function that does not declare realtime itself" },
  { code: "HMYR-載-021", stage: "link", checkedBy: "test/owned-check.test.mjs", meaning: "an owned holder is put into twice in a straight line, or taken from twice: the state is knowable at load time, and the run-time codes R0305 and R0306 are what it would have been" },
  { code: "HMYR-碼-005", stage: "run", checkedBy: "test/owned.test.mjs", meaning: "an owned holder was asked to hold a value twice, or was used after it was closed: a holder owns one value at a time and stops working once closed" },
  { code: "HMYR-碼-006", stage: "run", checkedBy: "test/owned.test.mjs", meaning: "an owned holder was asked for a value it does not hold: taking is also the transfer, so an empty holder has nothing to give" },
  // Planned: registered so the identifier is reserved and searchable, exempt from the "every registered
  // code is emitted" check until the zone model of design/MEMORY.txt exists.
  // The escape code was registered as planned while the zone model had only its bookkeeping half.
  // The static check (src/zone-check.mjs, run when a module is loaded) now emits it, so it is a real
  // code and no longer exempt. Its stage is link rather than run: it is found before the program starts.
  { code: "HMYR-碼-001", stage: "link", checkedBy: "test/zone-static.test.mjs", meaning: "a value escaped the arena it was allocated in: the block was never handed over, so returning it would let it outlive the arena" },
  { code: "HMYR-載-016", stage: "link", checkedBy: "test/zone-static.test.mjs", meaning: "an arena is built inside a loop: every round allocates a new one, so the total grows with the number of rounds" },
  { code: "HMYR-載-018", stage: "link", checkedBy: "test/zone-static.test.mjs", meaning: "a block of an arena is handed to a function whose body is not in the source being checked: nothing here promises it will not keep the block, which is the shape section 4.2 of the memory note describes" },
  { code: "HMYR-碼-004", stage: "link", checkedBy: "test/zone-static.test.mjs", meaning: "a block of an arena is stored in a record: the record can be handed on or returned while the arena stays behind, so the block would outlive the zone that owns it" },
  // The two below are reachable today: the zone model has its bookkeeping half, so a wrong
  // conversion is a runtime refusal rather than a paragraph in a design paper.
  { code: "HMYR-碼-002", stage: "run", checkedBy: "test/zone.test.mjs", meaning: "a zone conversion was handed something that is not a live block of that arena: the block belongs elsewhere, or its arena is already closed" },
  { code: "HMYR-碼-003", stage: "run", checkedBy: "test/zone.test.mjs", meaning: "a block was adopted into a second arena that is still open: its lifetime would be owned in two places" },
];
