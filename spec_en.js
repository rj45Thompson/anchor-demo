/* spec_en.js - English -> executable spec, for the "Write a function" panel.
 *
 * WHAT THIS IS FOR
 * The panel was broken in two ways at once:
 *   1. it demanded the user hand-write `args -> expected` pairs, which is not how anyone asks
 *      for code, and
 *   2. when you did supply examples for "bubble sort", search returned a correct ONE-LINE sort,
 *      because examples constrain the OUTPUT and say nothing about the ALGORITHM.
 *
 * THE RULE THIS FILE OBEYS
 * This is a TRANSLATOR, never a code generator. It turns English into (a) a restatement the user
 * can check, and (b) concrete examples. The search engine still has to find the program by real
 * execution. If this file ever emitted the answer, the page would be claiming a search result it
 * did not earn - the whole point of the demo is that nothing is taken on trust.
 *
 * It is deterministic and has no model in it: a finite grammar of known task shapes, matched by
 * keyword, exactly like the rest of this project's no-weights posture.
 *
 * It also reports UNDERDETERMINATION honestly. "bubble sort" names an algorithm; examples cannot
 * pin an algorithm down. Rather than pretend, the spec carries `underdetermined` and the reason,
 * so the UI can say so out loud instead of quietly returning a one-liner.
 */
(function (root) {
  "use strict";

  var TASKS = [
    {
      id: "sort_asc",
      // "bubble"/"merge"/"quick" are captured so we can WARN, not so we can implement them
      match: /\b(sort|order|arrange)\b/i,
      algoNamed: /\b(bubble|merge|quick|insertion|selection|heap|radix)\b/i,
      desc: "sort a list of numbers into ascending order",
      examples: [
        [[[3, 1, 2]], [1, 2, 3]],
        [[[9, 4, 7]], [4, 7, 9]],
        [[[5]], [5]],
        [[[]], []]
      ],
      note: "Ascending unless you say descending."
    },
    {
      id: "sort_desc",
      match: /\b(sort|order|arrange)\b[\s\S]*\b(desc|descending|reverse order|largest first|high(est)? first)\b/i,
      desc: "sort a list of numbers into descending order",
      examples: [
        [[[3, 1, 2]], [3, 2, 1]],
        [[[9, 4, 7]], [9, 7, 4]]
      ]
    },
    {
      id: "reverse",
      match: /\breverse\b(?![\s\S]*\border\b)/i,
      desc: "reverse a list",
      examples: [
        [[[1, 2, 3]], [3, 2, 1]],
        [[["a", "b"]], ["b", "a"]],
        [[[]], []]
      ]
    },
    {
      id: "sum",
      match: /\b(sum|add up|total)\b/i,
      desc: "add up all the numbers in a list",
      examples: [[[[1, 2, 3]], 6], [[[10, -2]], 8], [[[]], 0]]
    },
    {
      id: "max",
      match: /\b(max|maximum|largest|biggest|greatest)\b/i,
      desc: "find the largest number in a list",
      examples: [[[[3, 9, 2]], 9], [[[-5, -1]], -1]]
    },
    {
      id: "min",
      match: /\b(min|minimum|smallest|least)\b/i,
      desc: "find the smallest number in a list",
      examples: [[[[3, 9, 2]], 2], [[[-5, -1]], -5]]
    },
    {
      id: "count",
      match: /\b(count|length|how many|size)\b/i,
      desc: "count how many items are in a list",
      examples: [[[[1, 2, 3]], 3], [[[]], 0]]
    },
    {
      id: "unique",
      match: /\b(unique|dedupe|duplicates|distinct)\b/i,
      desc: "remove duplicate values from a list, keeping the first of each",
      examples: [[[[1, 2, 2, 3]], [1, 2, 3]], [[[4, 4, 4]], [4]]]
    },
    {
      id: "evens",
      match: /\b(even)\b/i,
      desc: "keep only the even numbers in a list",
      examples: [[[[1, 2, 3, 4]], [2, 4]], [[[1, 3]], []]]
    },
    {
      id: "odds",
      match: /\b(odd)\b/i,
      desc: "keep only the odd numbers in a list",
      examples: [[[[1, 2, 3, 4]], [1, 3]], [[[2, 4]], []]]
    },
    {
      id: "upper",
      match: /\b(uppercase|upper case|capitali[sz]e|shout)\b/i,
      desc: "convert text to upper case",
      examples: [[["hello"], "HELLO"], [["aB"], "AB"]]
    },
    {
      id: "palindrome",
      match: /\bpalindrome\b/i,
      desc: "decide whether the text reads the same backwards",
      examples: [[["racecar"], true], [["hello"], false]]
    }
  ];

  /* Order matters: the more specific pattern must win. sort_desc before sort_asc, and the
     "reverse a list" task must not swallow "reverse order" (that is a sort). */
  var ORDER = ["sort_desc", "palindrome", "unique", "evens", "odds", "upper",
               "reverse", "sum", "max", "min", "count", "sort_asc"];

  function byId(id) {
    for (var i = 0; i < TASKS.length; i++) if (TASKS[i].id === id) return TASKS[i];
    return null;
  }

  /**
   * interpret(english) -> spec
   *   {ok, taskId, desc, examples, underdetermined, why, english}
   * Never returns code. Never guesses silently: unknown input returns ok:false with a list of
   * what it does understand, so the UI can say so instead of failing mysteriously.
   */
  function interpret(english) {
    var q = String(english == null ? "" : english).trim();
    if (!q) {
      return { ok: false, reason: "empty", english: q,
               known: ORDER.map(function (id) { return byId(id).desc; }) };
    }
    for (var i = 0; i < ORDER.length; i++) {
      var t = byId(ORDER[i]);
      if (!t.match.test(q)) continue;
      if (t.id === "sort_asc" && byId("sort_desc").match.test(q)) continue;

      var spec = {
        ok: true, taskId: t.id, desc: t.desc, note: t.note || "",
        examples: t.examples, english: q, underdetermined: false, why: ""
      };
      // the bubble-sort problem, stated rather than hidden
      if (t.algoNamed && t.algoNamed.test(q)) {
        var named = q.match(t.algoNamed)[0].toLowerCase();
        spec.underdetermined = true;
        spec.why = 'You named an algorithm ("' + named + '"). Examples can only describe what comes '
          + 'out, so any correct ' + (t.id.indexOf("sort") === 0 ? "sort" : "solution")
          + ' satisfies them - including a one-line one. The search will return the simplest program '
          + 'that passes, which will probably not be ' + named + '. Constraining the algorithm needs '
          + 'a different kind of spec than input/output pairs.';
      }
      return spec;
    }
    return { ok: false, reason: "unknown", english: q,
             known: ORDER.map(function (id) { return byId(id).desc; }) };
  }

  /** Human-readable restatement, shown to the user BEFORE any search runs. */
  function restate(spec) {
    if (!spec.ok) {
      return spec.reason === "empty"
        ? "Nothing to interpret yet."
        : 'I could not turn that into a spec. I currently understand: ' + spec.known.join("; ") + ".";
    }
    return "I understood this as: " + spec.desc + "."
      + (spec.note ? " " + spec.note : "");
  }

  /** The derived examples, formatted the way the existing panel expects. */
  function exampleLines(spec) {
    if (!spec.ok) return "";
    return spec.examples.map(function (p) {
      return JSON.stringify(p[0]).slice(1, -1) + " -> " + JSON.stringify(p[1]);
    }).join("\n");
  }

  root.SpecEN = { interpret: interpret, restate: restate, exampleLines: exampleLines,
                  _tasks: TASKS, _order: ORDER };
})(typeof window !== "undefined" ? window : globalThis);
