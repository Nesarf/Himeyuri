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
  { code: "HMYR-R0221", stage: "host", checkedBy: "test/threads.test.mjs", meaning: "a thread handle that does not exist" },
  { code: "HMYR-R0222", stage: "host", checkedBy: "test/threads.test.mjs", meaning: "a thread that did not finish within the given time" },
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
  { code: "HMYR-W0001", stage: "lex", meaning: "an identifier mixes writing systems" },
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
  { code: "HMYR-R0120", stage: "run", meaning: "division by zero" },
  { code: "HMYR-R0130", stage: "run", meaning: "a number was expected" },
  { code: "HMYR-R0131", stage: "run", meaning: "two values cannot be compared" },
  { code: "HMYR-R0140", stage: "run", meaning: "len() was given something without a length" },
  { code: "HMYR-R0141", stage: "run", meaning: "int() could not read the value" },
  { code: "HMYR-R0201", stage: "run", meaning: "a call uses an effect the caller did not declare" },
  { code: "HMYR-R0202", stage: "run", checkedBy: "test/embed.test.mjs", meaning: "the script declares an effect the host did not grant" },

  { code: "HMYR-R0150", stage: "run", meaning: "assignment to something that is not a variable declared with var" },
  { code: "HMYR-R0151", stage: "run", meaning: "a subscript is outside the length of the value" },
  { code: "HMYR-R0152", stage: "run", meaning: "the value being subscripted has no elements" },

  { code: "HMYR-E0301", stage: "link", checkedBy: "test/module.test.mjs", meaning: "a circular import: the file is already being loaded" },
  { code: "HMYR-E0302", stage: "link", checkedBy: "test/module.test.mjs", meaning: "an imported file does not exist" },
  { code: "HMYR-W0301", stage: "link", checkedBy: "test/module.test.mjs", meaning: "an import that is not a path; the package manager owns that" },
  { code: "HMYR-W0302", stage: "link", checkedBy: "test/module.test.mjs", meaning: "two modules declare the same name, and the flat table means the later one wins" },
  // Planned: registered so the identifier is reserved and searchable, exempt from the "every registered
  // code is emitted" check until the zone model of design/MEMORY.txt exists.
  { code: "HMYR-R0301", stage: "run", planned: true, meaning: "a value escaped the arena it was allocated in" },
];
