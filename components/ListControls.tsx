import Link from "next/link";

type QueryParams = Record<string, string | undefined>;

export type ViewTab = {
  label: string;
  value: string;
};

export function ViewTabs({
  basePath,
  current,
  params,
  tabs,
}: {
  basePath: string;
  current: string;
  params: QueryParams;
  tabs: ViewTab[];
}) {
  return (
    <nav className="mb-4 flex gap-1 overflow-x-auto rounded-lg border border-forge-line bg-white p-1 shadow-soft">
      {tabs.map((tab) => {
        const isActive = current === tab.value;
        return (
          <Link
            key={tab.value}
            href={hrefWithParams(basePath, params, { view: tab.value, page: undefined })}
            className={`whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition ${
              isActive ? "bg-forge-ink text-white" : "text-forge-muted hover:bg-forge-panel hover:text-forge-ink"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function PaginationControls({
  basePath,
  params,
  page,
  pageSize,
  total,
}: {
  basePath: string;
  params: QueryParams;
  page: number;
  pageSize: number;
  total: number;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const start = total ? (page - 1) * pageSize + 1 : 0;
  const end = Math.min(total, page * pageSize);

  return (
    <div className="mt-4 flex flex-col gap-3 rounded-lg border border-forge-line bg-white p-3 text-sm shadow-soft sm:flex-row sm:items-center sm:justify-between">
      <div className="text-forge-muted">
        Showing <span className="font-medium text-forge-ink">{start}-{end}</span> of <span className="font-medium text-forge-ink">{total}</span>
      </div>
      <div className="flex items-center gap-2">
        <Link
          href={hrefWithParams(basePath, params, { page: String(Math.max(1, page - 1)) })}
          className={`button-secondary ${page <= 1 ? "pointer-events-none opacity-50" : ""}`}
          aria-disabled={page <= 1}
        >
          Previous
        </Link>
        <span className="text-forge-muted">
          Page {page} / {pageCount}
        </span>
        <Link
          href={hrefWithParams(basePath, params, { page: String(Math.min(pageCount, page + 1)) })}
          className={`button-secondary ${page >= pageCount ? "pointer-events-none opacity-50" : ""}`}
          aria-disabled={page >= pageCount}
        >
          Next
        </Link>
      </div>
    </div>
  );
}

export function normalizePage(value: string | undefined) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

export function normalizePageSize(value: string | undefined, allowed = [10, 25, 50], fallback = 25) {
  const parsed = Number(value);
  return allowed.includes(parsed) ? parsed : fallback;
}

export function paginate<T>(items: T[], page: number, pageSize: number) {
  return items.slice((page - 1) * pageSize, page * pageSize);
}

function hrefWithParams(basePath: string, params: QueryParams, patch: QueryParams) {
  const nextParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) nextParams.set(key, value);
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value) nextParams.set(key, value);
    else nextParams.delete(key);
  }
  const query = nextParams.toString();
  return query ? `${basePath}?${query}` : basePath;
}
