import { isBucketSort, type BucketSort, type SortDirection } from "@/lib/metrics";

/**
 * Sorting for the analytics tables, in two layers.
 *
 * The page-wide control answers "show me my worst buckets everywhere". A click
 * on one table's heading answers "order THIS question my way" and leaves the
 * rest of the page alone. A table with no sort of its own inherits the
 * page-wide one, so a single control still moves everything by default and the
 * per-table sorts are pure opt-in.
 *
 * Both layers live in the URL — `sort`/`dir` for the page, `s_<id>`/`d_<id>`
 * per table — so a page poked into exactly the shape you want is a bookmark
 * and a saved view, not session state that evaporates. The `s_`/`d_` prefixes
 * are what keep a table id from ever colliding with a filter dimension.
 */
export type SortParams = Record<string, string | undefined>;

export type ResolvedSort = {
  sort: BucketSort;
  direction: SortDirection;
  /** True when this table carries its own sort rather than inheriting. */
  own: boolean;
};

export const TABLE_SORT_PREFIX = "s_";
export const TABLE_DIR_PREFIX = "d_";

export function resolveTableSort(params: SortParams, id: string, page: { sort: BucketSort; direction: SortDirection }): ResolvedSort {
  const own = params[`${TABLE_SORT_PREFIX}${id}`];
  if (!isBucketSort(own)) return { ...page, own: false };
  return {
    sort: own,
    direction: params[`${TABLE_DIR_PREFIX}${id}`] === "asc" ? "asc" : "desc",
    own: true,
  };
}

/**
 * What clicking a column heading should do next, as the params to change.
 *
 * The cycle is best-first → reversed → back to inheriting the page, so there is
 * always a way out of a per-table sort without hunting for a reset. Names read
 * A→Z on the first click and numbers read best-first, because that is what each
 * one means by "sort this".
 */
export function nextTableSort(current: ResolvedSort, column: BucketSort): { sort: BucketSort | null; direction: SortDirection | null } {
  if (!current.own || current.sort !== column) {
    return { sort: column, direction: column === "label" ? "asc" : "desc" };
  }
  if (current.direction === "desc") return { sort: column, direction: "asc" };
  return { sort: null, direction: null };
}

/** How many tables deviate from the page-wide sort — what the "reset" offer counts. */
export function countCustomTableSorts(params: SortParams): number {
  return Object.entries(params).filter(([key, value]) => key.startsWith(TABLE_SORT_PREFIX) && isBucketSort(value)).length;
}

/** Drop every per-table sort, keeping the filters. The one tap back to a page
 *  that reads consistently after a session of poking at headings. */
export function clearTableSorts(params: SortParams): SortParams {
  return Object.fromEntries(
    Object.entries(params).filter(([key]) => !key.startsWith(TABLE_SORT_PREFIX) && !key.startsWith(TABLE_DIR_PREFIX)),
  );
}

/** The per-table sorts, to be carried through a filter submit: they are the
 *  trader's furniture, not filters, so narrowing a date range must not silently
 *  reset every table. */
export function tableSortParams(params: SortParams): [string, string][] {
  return Object.entries(params).filter(
    (entry): entry is [string, string] =>
      Boolean(entry[1]) && (entry[0].startsWith(TABLE_SORT_PREFIX) || entry[0].startsWith(TABLE_DIR_PREFIX)),
  );
}
