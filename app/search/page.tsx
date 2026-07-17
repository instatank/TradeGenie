import Link from "next/link";
import { format } from "date-fns";
import { Search, Tag, X } from "lucide-react";
import { PageTitle } from "@/components/Fields";
import { TagPills } from "@/components/TagPills";
import {
  buildSearchIndex,
  parseQuery,
  searchIndex,
  searchKindLabels,
  searchKindOrder,
  tagUsage,
  type SearchKind,
  type SearchResult,
} from "@/lib/search";
import { normalizeTag } from "@/lib/tags";

const SECTION_LIMIT = 8;
const KIND_VIEW_LIMIT = 100;

// One search over everything: trades, captured notes, lessons, assets and
// their threads, daily journals, playbook, weekly reviews, imported rows.
// `#tag` tokens filter by exact tag; plain words are order-independent AND.
export default async function SearchPage({ searchParams }: { searchParams?: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams ?? {};
  const query = (params.q ?? "").trim();
  const kindFilter = isSearchKind(params.kind) ? params.kind : null;
  const docs = await buildSearchIndex();
  const results = query ? searchIndex(docs, query) : [];
  const visible = kindFilter ? results.filter((result) => result.kind === kindFilter) : results;
  const parsed = parseQuery(query);
  const countsByKind = new Map<SearchKind, number>();
  for (const result of results) countsByKind.set(result.kind, (countsByKind.get(result.kind) ?? 0) + 1);
  const allTags = tagUsage(docs);

  return (
    <main className="page-shell max-w-4xl">
      <PageTitle title="Search" subtitle="Everything you've written, one box away. Use #tags for exact matches, words to find any text." />

      <form action="/search" className="panel mb-5 flex flex-col gap-3 sm:flex-row">
        {kindFilter ? <input type="hidden" name="kind" value={kindFilter} /> : null}
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-forge-muted" aria-hidden="true" />
          <input
            name="q"
            type="search"
            defaultValue={query}
            placeholder="Try: btc funding · #breakout · #fomo stop loss"
            className="input w-full pl-9"
            autoFocus
          />
        </div>
        <button className="button" type="submit">Search</button>
      </form>

      {query ? (
        <>
          {/* Active #tag filters as dismissible chips (tap to drop just that tag). */}
          {parsed.tags.length ? (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {parsed.tags.map((tag) => (
                <Link
                  key={tag}
                  href={searchHref(removeTagFromQuery(query, tag), kindFilter)}
                  className="flex items-center gap-1.5 rounded-full border border-forge-blue/40 bg-sky-50 px-3 py-1 text-sm font-medium text-forge-blue transition hover:border-forge-blue"
                  title={`Remove #${tag} from this search`}
                >
                  #{tag}
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              ))}
            </div>
          ) : null}

          {/* Type filter tabs, with live counts for this query. */}
          <div className="mb-5 flex flex-wrap gap-1.5 text-sm">
            <KindTab href={searchHref(query, null)} active={!kindFilter} label={`All (${results.length})`} />
            {searchKindOrder
              .filter((kind) => countsByKind.get(kind))
              .map((kind) => (
                <KindTab
                  key={kind}
                  href={searchHref(query, kind)}
                  active={kindFilter === kind}
                  label={`${searchKindLabels[kind]} (${countsByKind.get(kind)})`}
                />
              ))}
          </div>

          {!visible.length ? (
            <div className="panel muted">
              No matches for <span className="font-medium text-forge-ink">{query}</span>.
              {parsed.tags.length ? " Tag searches are exact — check the tag list on the empty search page." : " Fewer or shorter words usually help."}
            </div>
          ) : kindFilter ? (
            <section className="space-y-2">
              {visible.slice(0, KIND_VIEW_LIMIT).map((result) => <ResultCard key={`${result.kind}-${result.id}`} result={result} />)}
              {visible.length > KIND_VIEW_LIMIT ? (
                <p className="muted text-sm">Showing the {KIND_VIEW_LIMIT} most recent of {visible.length} — narrow the search to see the rest.</p>
              ) : null}
            </section>
          ) : (
            <div className="space-y-5">
              {searchKindOrder
                .filter((kind) => countsByKind.get(kind))
                .map((kind) => {
                  const sectionResults = visible.filter((result) => result.kind === kind);
                  return (
                    <section key={kind} className="panel">
                      <h2 className="mb-3 font-semibold">
                        {searchKindLabels[kind]} <span className="text-sm font-normal text-forge-muted">({sectionResults.length})</span>
                      </h2>
                      <div className="space-y-2">
                        {sectionResults.slice(0, SECTION_LIMIT).map((result) => <ResultCard key={result.id} result={result} />)}
                      </div>
                      {sectionResults.length > SECTION_LIMIT ? (
                        <Link href={searchHref(query, kind)} className="mt-3 inline-block text-sm font-medium text-forge-blue hover:underline">
                          Show all {sectionResults.length} →
                        </Link>
                      ) : null}
                    </section>
                  );
                })}
            </div>
          )}
        </>
      ) : (
        <div className="space-y-5">
          {/* The tag index: every tag in use, browsable. Tap = exact-tag search. */}
          <section className="panel">
            <h2 className="flex items-center gap-2 font-semibold">
              <Tag className="h-4 w-4 text-forge-blue" aria-hidden="true" />
              Your tags
            </h2>
            {allTags.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {allTags.map(({ tag, count }) => (
                  <Link
                    key={tag}
                    href={searchHref(`#${tag}`, null)}
                    className="flex items-center gap-1.5 rounded-full border border-forge-line bg-white px-3 py-1.5 text-sm transition hover:border-forge-blue hover:bg-sky-50"
                  >
                    <span className="font-medium text-forge-blue">#{tag}</span>
                    <span className="text-xs text-forge-muted">{count}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="muted mt-2 text-sm">
                No tags yet. Type <span className="font-medium text-forge-ink">#hashtags</span> anywhere in a note, thesis, or lesson —
                like <span className="font-medium text-forge-ink">#breakout</span> or <span className="font-medium text-forge-ink">#news-day</span> —
                and they become tappable tags across the whole journal.
              </p>
            )}
          </section>

          <section className="panel text-sm text-forge-muted">
            <h2 className="font-semibold text-forge-ink">How search works</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li><span className="font-medium text-forge-ink">Words</span> match anywhere in anything — all words must appear, in any order. <span className="text-forge-ink">btc stop</span> finds a note with &quot;stopped out on BTC&quot;.</li>
              <li><span className="font-medium text-forge-ink">#tags</span> are exact — <span className="text-forge-ink">#win</span> never matches #winner. Mix them: <span className="text-forge-ink">#fomo btc</span>.</li>
              <li>Covers trades, captured notes, lessons, assets + their threads, daily journals, playbook setups, weekly reviews, and imported executions.</li>
            </ul>
          </section>
        </div>
      )}
    </main>
  );
}

function ResultCard({ result }: { result: SearchResult }) {
  return (
    <Link href={result.href} className="block rounded-md border border-forge-line p-3 transition hover:border-forge-blue hover:bg-forge-panel/40">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="font-medium">{result.title}</span>
        <span className="shrink-0 text-xs text-forge-muted">{format(result.date, "dd MMM yyyy")}</span>
      </div>
      {result.subtitle ? <div className="mt-0.5 text-xs text-forge-muted">{result.subtitle}</div> : null}
      {result.snippet ? (
        <p className="mt-1.5 text-sm text-forge-muted">
          <span className="mr-1 rounded bg-forge-panel px-1.5 py-0.5 text-xs font-medium">{result.snippet.fieldLabel}</span>
          {result.snippet.before}
          {result.snippet.match ? <mark className="rounded-sm bg-amber-100 px-0.5 font-medium text-forge-ink">{result.snippet.match}</mark> : null}
          {result.snippet.after}
        </p>
      ) : null}
      <TagPills tags={result.tags} className="mt-2" />
    </Link>
  );
}

function KindTab({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1 transition ${
        active ? "border-forge-ink bg-forge-ink font-medium text-white" : "border-forge-line bg-white text-forge-muted hover:border-forge-ink hover:text-forge-ink"
      }`}
    >
      {label}
    </Link>
  );
}

function searchHref(query: string, kind: SearchKind | null) {
  const search = new URLSearchParams();
  if (query) search.set("q", query);
  if (kind) search.set("kind", kind);
  const suffix = search.toString();
  return suffix ? `/search?${suffix}` : "/search";
}

function removeTagFromQuery(query: string, tag: string) {
  return query
    .split(/\s+/)
    .filter((token) => !(token.startsWith("#") && normalizeTag(token) === tag))
    .join(" ")
    .trim();
}

function isSearchKind(value: string | undefined): value is SearchKind {
  return Boolean(value && (searchKindOrder as string[]).includes(value));
}
