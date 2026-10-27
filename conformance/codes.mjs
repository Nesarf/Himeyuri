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
  { code: "HMYR-R0204", stage: "host", checkedBy: "test/i18n-three.test.mjs", meaning: "a character that does not exist in the target encoding: refused rather than replaced" },
  { code: "HMYR-R0210", stage: "host", checkedBy: "test/while.test.mjs", meaning: "a while loop that ran past a million iterations without ending: stopped rather than hanging forever" },
  { code: "HMYR-R0215", stage: "host", checkedBy: "test/record-new.test.mjs", meaning: "field_get given something that is not a record" },
  { code: "HMYR-R0216", stage: "host", checkedBy: "test/record-new.test.mjs", meaning: "field_get asked for a field that record does not have: refused rather than handing back nothing" },
  { code: "HMYR-R0217", stage: "host", checkedBy: "test/record-new.test.mjs", meaning: "field_names given something that is not a record: with no fields to list there is no name list to hand back" },
  { code: "HMYR-R0218", stage: "host", checkedBy: "test/index.test.mjs", meaning: "index_get asked for a key the index does not hold: refused rather than handing back nothing" },
  { code: "HMYR-R0219", stage: "host", checkedBy: "test/index.test.mjs", meaning: "an index operation given something that is not an index: refused rather than guessing" },
  { code: "HMYR-R0221", stage: "host", checkedBy: "test/threads.test.mjs", meaning: "a thread handle that does not exist" },
  { code: "HMYR-R0222", stage: "host", checkedBy: "test/threads.test.mjs", meaning: "a thread that did not finish within the given time" },
  { code: "HMYR-R0223", stage: "host", checkedBy: "test/profile.test.mjs", meaning: "the thread pool is full: steady gives one slot, elastic gives the compile-time number" },
  { code: "HMYR-R0214", stage: "host", checkedBy: "test/record-new.test.mjs", meaning: "record_new given something that is not a (name, value) tuple, or a name a record cannot hold: records are not hashmaps" },
  { code: "HMYR-R0213", stage: "host", checkedBy: "test/capabilities.test.mjs", meaning: "run_program with an empty program name: refused with a code instead of the host's bare exception" },
  { code: "HMYR-R0211", stage: "host", checkedBy: "test/capabilities.test.mjs", meaning: "a file that cannot be read: the host reason is carried, not swallowed" },
  { code: "HMYR-R0212", stage: "host", checkedBy: "test/capabilities.test.mjs", meaning: "a file that cannot be written: refused with the host reason" },
  { code: "HMYR-R0209", stage: "host", checkedBy: "test/shell-exec.test.mjs", meaning: "chdir to a directory that cannot be entered: refused with the host's own reason" },
  { code: "HMYR-R0206", stage: "host", checkedBy: "test/string-builtins.test.mjs", meaning: "ord of an empty string: refused rather than returning a made-up zero" },
  { code: "HMYR-R0207", stage: "host", checkedBy: "test/string-builtins.test.mjs", meaning: "chr of something outside the code point range" },
  { code: "HMYR-R0208", stage: "host", checkedBy: "test/string-builtins.test.mjs", meaning: "to_int of a string that is not an integer literal: refused rather than parsed loosely" },
  { code: "HMYR-R0205", stage: "host", checkedBy: "test/locale.test.mjs", meaning: "a locale profile name that does not exist: refused rather than falling back to the default" },
  { code: "HMYR-E0008", stage: "host", checkedBy: "test/i18n-three.test.mjs", meaning: "an encoding name this runtime does not know: refused rather than guessed" },
  { code: "HMYR-R0203", stage: "host", checkedBy: "test/i18n-three.test.mjs", meaning: "writing in an encoding this runtime cannot produce: refused rather than writing wrong bytes" },
  { code: "HMYR-E0001", stage: "lex", checkedBy: "test/codes-lex.test.mjs", meaning: "a string is never closed" },
  { code: "HMYR-E0002", stage: "lex", checkedBy: "test/codes-lex.test.mjs", meaning: "a block comment is never closed" },
  { code: "HMYR-E0003", stage: "lex", checkedBy: "test/codes-lex.test.mjs", meaning: "a numeric literal is malformed (bad digit for its base, or a misplaced separator)" },
  { code: "HMYR-E0004", stage: "lex", checkedBy: "test/codes-lex.test.mjs", meaning: "brackets do not balance" },
  { code: "HMYR-E0005", stage: "lex", checkedBy: "test/codes-lex.test.mjs", meaning: "an escape sequence is not recognised" },
  { code: "HMYR-E0006", stage: "lex", checkedBy: "test/codes-lex.test.mjs", meaning: "a character cannot start a token" },
  { code: "HMYR-W0001", stage: "lex", checkedBy: "test/codes-value.test.mjs", meaning: "an identifier mixes writing systems" },
  { code: "HMYR-W0100", stage: "tool", checkedBy: "test/format.test.mjs", meaning: "the formatter dropped comments, because it has nowhere to attach them yet" },

  { code: "HMYR-E0101", stage: "parse", checkedBy: "test/codes-lex.test.mjs", meaning: "a token was expected and something else was found" },
  { code: "HMYR-E0102", stage: "parse", checkedBy: "test/codes-lex.test.mjs", meaning: "a statement was not terminated at the end of its line" },
  { code: "HMYR-E0103", stage: "parse", internal: true, meaning: "the parser cannot start a declaration or statement here" },
  { code: "HMYR-E0104", stage: "parse", checkedBy: "test/codes-lex.test.mjs", meaning: "an expression was expected" },
  { code: "HMYR-E0105", stage: "parse", internal: true, meaning: "the parser stopped making progress (a fault in the parser, not in the input)" },

  { code: "HMYR-R0100", stage: "run", checkedBy: "test/codes-eval.test.mjs", meaning: "the module has no main function" },
  { code: "HMYR-R0101", stage: "run", checkedBy: "test/codes-eval.test.mjs", meaning: "a call passes the wrong number of arguments" },
  { code: "HMYR-R0102", stage: "run", internal: true, meaning: "the program ran for too long without finishing" },
  { code: "HMYR-R0103", stage: "run", internal: true, meaning: "a syntax error reached the evaluator" },
  { code: "HMYR-R0104", stage: "run", checkedBy: "test/codes-eval.test.mjs", meaning: "a name is not in scope" },
  { code: "HMYR-R0105", stage: "run", checkedBy: "test/codes-eval.test.mjs", meaning: "no match arm accepted the value" },
  { code: "HMYR-R0106", stage: "run", checkedBy: "test/codes-eval.test.mjs", meaning: "a field does not exist on that value" },
  { code: "HMYR-R0107", stage: "run", checkedBy: "test/codes-eval.test.mjs", meaning: "the value being called is not callable" },
  { code: "HMYR-R0108", stage: "run", checkedBy: "test/codes-eval.test.mjs", meaning: "the call depth limit was exceeded" },
  { code: "HMYR-R0110", stage: "run", internal: true, meaning: "the evaluator met a node kind it does not implement" },
  { code: "HMYR-R0111", stage: "run", internal: true, meaning: "the evaluator met an operator it does not implement" },
  { code: "HMYR-R0120", stage: "run", checkedBy: "test/codes-value.test.mjs", meaning: "division by zero" },
  { code: "HMYR-R0130", stage: "run", checkedBy: "test/codes-value.test.mjs", meaning: "a number was expected" },
  { code: "HMYR-R0131", stage: "run", checkedBy: "test/codes-value.test.mjs", meaning: "two values cannot be compared" },
  { code: "HMYR-R0140", stage: "run", checkedBy: "test/codes-value.test.mjs", meaning: "len() was given something without a length" },
  { code: "HMYR-R0141", stage: "run", checkedBy: "test/codes-value.test.mjs", meaning: "int() could not read the value" },
  { code: "HMYR-R0201", stage: "run", checkedBy: "test/codes-value.test.mjs", meaning: "a call uses an effect the caller did not declare" },
  { code: "HMYR-R0202", stage: "run", checkedBy: "test/embed.test.mjs", meaning: "the script declares an effect the host did not grant" },

  { code: "HMYR-R0150", stage: "run", checkedBy: "test/codes-value.test.mjs", meaning: "assignment to something that is not a variable declared with var" },
  { code: "HMYR-R0151", stage: "run", checkedBy: "test/codes-value.test.mjs", meaning: "a subscript is outside the length of the value" },
  { code: "HMYR-R0152", stage: "run", checkedBy: "test/codes-value.test.mjs", meaning: "the value being subscripted has no elements" },

  { code: "HMYR-E0301", stage: "link", checkedBy: "test/module.test.mjs", meaning: "a circular import: the file is already being loaded" },
  { code: "HMYR-E0302", stage: "link", checkedBy: "test/module.test.mjs", meaning: "an imported file does not exist" },
  { code: "HMYR-E0303", stage: "link", checkedBy: "test/module-rev.test.mjs", meaning: "the import asks for a revision the module does not offer: no version both sides support, so the link is refused rather than guessed" },
  { code: "HMYR-W0301", stage: "link", checkedBy: "test/module.test.mjs", meaning: "an import that is not a path; the package manager owns that" },
  { code: "HMYR-W0302", stage: "link", checkedBy: "test/module.test.mjs", meaning: "two modules declare the same name, and the flat table means the later one wins" },
  { code: "HMYR-W0303", stage: "link", checkedBy: "test/namespace.test.mjs", meaning: "a declaration without pub is used from another module; the flat table still lets it through, so this is a notice and not a refusal, and it names the file to change when namespaces arrive" },
  { code: "HMYR-E0304", stage: "link", checkedBy: "test/pkg-manifest.test.mjs", meaning: "a package manifest is missing or does not make sense: not JSON, not an object, a name that disagrees with its directory, a version that is not an integer, an empty licence, a hash that is not sha256 with 64 lowercase hex, or a version that disagrees with the entry file's rev" },
  { code: "HMYR-E0320", stage: "link", checkedBy: "test/realtime.test.mjs", meaning: "a function that declares the realtime profile does something that profile forbids: it allocates in the managed zone, touches the file, process or thread world, owns a loop whose condition is a constant true value, or calls a function that does not declare realtime itself" },
  { code: "HMYR-E0321", stage: "link", checkedBy: "test/owned-check.test.mjs", meaning: "an owned holder is put into twice in a straight line, or taken from twice: the state is knowable at load time, and the run-time codes R0305 and R0306 are what it would have been" },
  { code: "HMYR-R0305", stage: "run", checkedBy: "test/owned.test.mjs", meaning: "an owned holder was asked to hold a value twice, or was used after it was closed: a holder owns one value at a time and stops working once closed" },
  { code: "HMYR-R0306", stage: "run", checkedBy: "test/owned.test.mjs", meaning: "an owned holder was asked for a value it does not hold: taking is also the transfer, so an empty holder has nothing to give" },
  // Planned: registered so the identifier is reserved and searchable, exempt from the "every registered
  // code is emitted" check until the zone model of design/MEMORY.txt exists.
  // The escape code was registered as planned while the zone model had only its bookkeeping half.
  // The static check (src/zone-check.mjs, run when a module is loaded) now emits it, so it is a real
  // code and no longer exempt. Its stage is link rather than run: it is found before the program starts.
  { code: "HMYR-R0301", stage: "link", checkedBy: "test/zone-static.test.mjs", meaning: "a value escaped the arena it was allocated in: the block was never handed over, so returning it would let it outlive the arena" },
  { code: "HMYR-W0310", stage: "link", checkedBy: "test/zone-static.test.mjs", meaning: "an arena is built inside a loop: every round allocates a new one, so the total grows with the number of rounds" },
  { code: "HMYR-W0311", stage: "link", checkedBy: "test/zone-static.test.mjs", meaning: "a block of an arena is handed to a function whose body is not in the source being checked: nothing here promises it will not keep the block, which is the shape section 4.2 of the memory note describes" },
  { code: "HMYR-R0304", stage: "link", checkedBy: "test/zone-static.test.mjs", meaning: "a block of an arena is stored in a record: the record can be handed on or returned while the arena stays behind, so the block would outlive the zone that owns it" },
  // The two below are reachable today: the zone model has its bookkeeping half, so a wrong
  // conversion is a runtime refusal rather than a paragraph in a design paper.
  { code: "HMYR-R0302", stage: "run", checkedBy: "test/zone.test.mjs", meaning: "a zone conversion was handed something that is not a live block of that arena: the block belongs elsewhere, or its arena is already closed" },
  { code: "HMYR-R0303", stage: "run", checkedBy: "test/zone.test.mjs", meaning: "a block was adopted into a second arena that is still open: its lifetime would be owned in two places" },
];
