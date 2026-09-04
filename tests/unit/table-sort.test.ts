// Per-table sorting. The promise is that a table with its own sort is the only
// one affected, and that there is always a way back to inheriting the page.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clearTableSorts,
  countCustomTableSorts,
  nextTableSort,
  resolveTableSort,
  tableSortParams,
} from "@/lib/table-sort";

const page = { sort: "natural", direction: "desc" } as const;

describe("resolveTableSort", () => {
  it("inherits the page-wide sort when the table has none of its own", () => {
    const resolved = resolveTableSort({}, "setup", { sort: "winRate", direction: "asc" });
    assert.deepEqual(resolved, { sort: "winRate", direction: "asc", own: false });
  });

  it("gives a table its own sort without touching its neighbours", () => {
    const params = { s_setup: "netPnl", d_setup: "asc" };
    assert.deepEqual(resolveTableSort(params, "setup", page), { sort: "netPnl", direction: "asc", own: true });
    assert.deepEqual(resolveTableSort(params, "session", page), { sort: "natural", direction: "desc", own: false });
  });

  it("ignores a sort it does not recognise rather than rendering an arbitrary order", () => {
    assert.equal(resolveTableSort({ s_setup: "nonsense" }, "setup", page).own, false);
  });
});

describe("nextTableSort — the click cycle", () => {
  it("goes best-first, then reversed, then back to inheriting the page", () => {
    const inherited = resolveTableSort({}, "setup", page);
    const first = nextTableSort(inherited, "netPnl");
    assert.deepEqual(first, { sort: "netPnl", direction: "desc" });

    const second = nextTableSort({ sort: "netPnl", direction: "desc", own: true }, "netPnl");
    assert.deepEqual(second, { sort: "netPnl", direction: "asc" });

    const third = nextTableSort({ sort: "netPnl", direction: "asc", own: true }, "netPnl");
    assert.deepEqual(third, { sort: null, direction: null }, "a third click must hand the table back, not trap it");
  });

  it("starts names A→Z and numbers best-first", () => {
    const inherited = resolveTableSort({}, "setup", page);
    assert.equal(nextTableSort(inherited, "label").direction, "asc");
    assert.equal(nextTableSort(inherited, "winRate").direction, "desc");
  });

  it("switching column restarts the cycle rather than inheriting the old direction", () => {
    const current = { sort: "netPnl", direction: "asc", own: true } as const;
    assert.deepEqual(nextTableSort(current, "winRate"), { sort: "winRate", direction: "desc" });
  });
});

describe("counting, clearing and carrying table sorts", () => {
  const params = { s_setup: "netPnl", d_setup: "asc", s_session: "count", direction: "LONG", sort: "winRate" };

  it("counts only the tables that really deviate", () => {
    assert.equal(countCustomTableSorts(params), 2);
    assert.equal(countCustomTableSorts({ s_setup: "nonsense" }), 0);
  });

  it("clearing table sorts keeps the filters", () => {
    const cleared = clearTableSorts(params);
    assert.equal(cleared.s_setup, undefined);
    assert.equal(cleared.d_setup, undefined);
    assert.equal(cleared.direction, "LONG", "clearing a sort must never drop a filter");
    assert.equal(cleared.sort, "winRate", "the page-wide sort is not a table sort");
  });

  it("carries table sorts through a filter submit", () => {
    // Otherwise narrowing a date range would silently reset every table.
    const carried = Object.fromEntries(tableSortParams(params));
    assert.ok(!("direction" in carried), "a filter is not a table sort");
    assert.ok(!("sort" in carried), "the page-wide sort is not a table sort");
    assert.deepEqual(carried, { s_setup: "netPnl", d_setup: "asc", s_session: "count" });
  });
});
