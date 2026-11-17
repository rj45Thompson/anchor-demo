// A very small check harness, shared by the Node test files in this folder.
export function suite(name) {
  let pass = 0;
  const failures = [];
  const api = {
    check(label, ok, detail = "") {
      if (ok) pass++; else failures.push(`${label}${detail ? `: ${detail}` : ""}`);
      return ok;
    },
    eq(label, got, want) {
      const ok = Object.is(got, want);
      return api.check(label, ok, ok ? "" : `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
    },
    near(label, got, want, tol) {
      const ok = typeof got === "number" && Math.abs(got - want) <= tol;
      return api.check(label, ok, ok ? "" : `got ${got}, wanted ${want} +/-${tol}`);
    },
    deep(label, got, want) {
      const a = JSON.stringify(got), b = JSON.stringify(want);
      return api.check(label, a === b, a === b ? "" : `got ${a}, wanted ${b}`);
    },
    // Asserts fn throws, and that the message mentions `contains`.
    throws(label, fn, contains = "") {
      try { fn(); } catch (e) {
        return api.check(label, String(e.message).includes(contains), `threw "${e.message}", wanted it to mention "${contains}"`);
      }
      return api.check(label, false, "did not throw");
    },
    done() {
      console.log(`${name}: ${pass + failures.length} checks, ${failures.length} failed.`);
      for (const f of failures) console.log(`FAIL ${f}`);
      process.exit(failures.length ? 1 : 0);
    },
  };
  return api;
}
