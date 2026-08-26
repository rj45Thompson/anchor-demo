/* spec_en.test.js - 20 tests for the English -> spec translator.
 *
 * These are written to try to BREAK it, not to confirm it works. The two tests that matter most
 * are #1 (the bubble-sort underdetermination must be reported, not hidden) and #20 (the translator
 * must never emit code - that is the anti-cheat).
 *
 * Run: node spec_en.test.js
 */
require("../spec_en.js");
var S = globalThis.SpecEN;

var pass = 0, fail = 0, failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; }
  else { fail++; failures.push(name + (detail ? "  <- " + detail : "")); }
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
     "got " + JSON.stringify(got) + " want " + JSON.stringify(want));
}

/* ---- the reported bug ---------------------------------------------------- */
var bubble = S.interpret("write bubble sort");
ok("1  bubble sort is flagged underdetermined", bubble.underdetermined === true);
ok("2  bubble sort still resolves to the sort task", bubble.taskId === "sort_asc");
ok("3  the warning names the algorithm the user asked for",
   /bubble/i.test(bubble.why), bubble.why);
ok("4  the warning explains examples cannot pin an algorithm",
   /what comes out|one-line|simplest/i.test(bubble.why), bubble.why);

/* ---- a plain request must NOT be flagged --------------------------------- */
var plain = S.interpret("sort a list of numbers");
ok("5  a plain sort request is not flagged underdetermined", plain.underdetermined === false);
ok("6  plain sort still produces examples", plain.examples.length >= 2);

/* ---- specificity: the more precise pattern wins -------------------------- */
eq("7  descending beats ascending", S.interpret("sort descending").taskId, "sort_desc");
eq("8  'reverse order' is a sort, not a list reverse",
   S.interpret("sort in reverse order").taskId, "sort_desc");
eq("9  plain 'reverse a list' is the reverse task",
   S.interpret("reverse a list").taskId, "reverse");

/* ---- other tasks --------------------------------------------------------- */
eq("10 sum",        S.interpret("add up the numbers").taskId, "sum");
eq("11 max",        S.interpret("find the largest value").taskId, "max");
eq("12 unique",     S.interpret("remove duplicates").taskId, "unique");
eq("13 palindrome", S.interpret("is it a palindrome").taskId, "palindrome");
eq("14 evens",      S.interpret("keep only even numbers").taskId, "evens");

/* ---- failure behaviour must be honest ------------------------------------ */
var unknown = S.interpret("train a neural network to predict the weather");
ok("15 unknown input fails cleanly", unknown.ok === false && unknown.reason === "unknown");
ok("16 failure lists what it DOES understand",
   Array.isArray(unknown.known) && unknown.known.length > 5);
ok("17 empty input is its own case, not 'unknown'",
   S.interpret("").reason === "empty" && S.interpret("   ").reason === "empty");

/* ---- examples are well-formed and executable ----------------------------- */
var ex = S.interpret("sort a list").examples;
ok("18 every example is [args[], expected]",
   ex.every(function (p) { return Array.isArray(p) && p.length === 2 && Array.isArray(p[0]); }));
ok("19 examples include an edge case (empty or single)",
   ex.some(function (p) { return JSON.stringify(p[0]) === "[[]]" || JSON.stringify(p[0]) === "[[5]]"; }));

/* ---- THE ANTI-CHEAT ------------------------------------------------------ */
/* The translator must never hand back a program. If any spec field contains something that looks
   like code, the page would be able to present a generated answer as a search result. */
/* Detect CODE SYNTAX, not English words. An earlier version of this test used /\breturn\b/ and
   fired on the sentence "The search will return the simplest program", which is prose. The point
   is to catch a program leaking out of the translator, so require actual syntax: a return with a
   statement terminator, an arrow, a function literal, a call on a known builtin, or a loop head. */
var codey = /function\s*\([^)]*\)\s*\{|=>\s*[\{(]|\breturn\b[^.!?]*;|\.(sort|map|filter|reduce)\s*\(|\b(for|while)\s*\([^)]*;/;
var leaked = [];
["write bubble sort", "sort a list", "reverse a list", "sum the numbers", "remove duplicates",
 "is it a palindrome", "keep only even numbers", "uppercase the text"].forEach(function (q) {
  var sp = S.interpret(q);
  Object.keys(sp).forEach(function (k) {
    var v = sp[k];
    if (typeof v === "string" && codey.test(v)) leaked.push(q + " -> " + k + ": " + v);
  });
  if (codey.test(S.restate(sp))) leaked.push(q + " -> restate()");
});
ok("20 translator never emits anything resembling code", leaked.length === 0, leaked.join(" | "));

/* ---- report -------------------------------------------------------------- */
console.log("\n  spec_en: " + pass + " passed, " + fail + " failed  (" + (pass + fail) + " total)\n");
if (fail) {
  failures.forEach(function (f) { console.log("   FAIL  " + f); });
  process.exit(1);
}
