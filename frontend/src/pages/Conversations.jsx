import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, Download, ExternalLink, Search, SlidersHorizontal, X } from "lucide-react";
import { api, errorMessage } from "../api";
import { useFilters } from "../App";
import ConversationView from "../components/ConversationView";
import {
  Card, Empty, ErrorAlert, FLAG_META, FlagBadge, IconButton, MultiSelect, Pagination, Segmented, Select, Skeleton, Spinner,
} from "../components/ui";
import { fmtAgo, fmtCompact, fmtDateTime, fmtMs, highlight, shortAgent } from "../lib/format";

const LIMIT = 30;
const COLS = [
  { key: "start_ts", label: "Started", sortable: true, cls: "w-44" },
  { key: "user_id", label: "User", cls: "w-44" },
  { key: "source_table", label: "Agent", cls: "w-40" },
  { key: "first_question", label: "Conversation" },
  { key: "turns", label: "Turns", sortable: true, cls: "w-16 text-right" },
  { key: "total_tokens", label: "Tokens", sortable: true, cls: "w-20 text-right" },
  { key: "max_ms", label: "Max latency", sortable: true, cls: "w-24 text-right" },
  { key: "flags", label: "Flags", cls: "w-40" },
];

export default function Conversations() {
  const f = useFilters();
  const mode = f.get("mode", "session");
  const gap = f.get("gap", "30");
  const flags = f.get("flags") ? f.get("flags").split(",") : [];
  const q = f.get("q");
  const sort = f.get("sort", "start_ts");
  const dir = f.get("dir", "desc");
  const offset = Number(f.get("offset", "0"));
  const minMs = f.get("min_ms");
  const minTokens = f.get("min_tokens");
  const hasData = f.get("has_data") === "1";
  const sel = f.get("sel");

  const [qInput, setQInput] = useState(q);
  const [showMore, setShowMore] = useState(Boolean(minMs || minTokens || hasData));
  const [data, setData] = useState({ total: 0, rows: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => setQInput(q), [q]);
  useEffect(() => {
    const t = setTimeout(() => { if (qInput !== q) f.set({ q: qInput, offset: "", sel: "" }); }, 450);
    return () => clearTimeout(t);
  }, [qInput]); // eslint-disable-line

  const params = useMemo(() => ({
    start: f.start, end: f.end, mode, gap, table: f.table, agent: f.agent, user: f.user,
    flags, q, sort, dir, min_ms: minMs ? Number(minMs) * 1000 : "", min_tokens: minTokens, has_data: hasData,
  }), [f.start, f.end, mode, gap, f.table, f.agent, f.user, flags.join(","), q, sort, dir, minMs, minTokens, hasData]); // eslint-disable-line

  const load = () => {
    setLoading(true);
    setError(null);
    api.conversations({ ...params, limit: LIMIT, offset })
      .then(setData)
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  };
  useEffect(load, [params, offset]); // eslint-disable-line

  const selected = data.rows.find((r) => r.conv_key === sel);
  const toggleSort = (key) => {
    if (sort === key) f.set({ dir: dir === "desc" ? "asc" : "desc", offset: "" });
    else f.set({ sort: key, dir: "desc", offset: "" });
  };
  const activeFilters = [f.table, f.agent, f.user, q, ...flags, minMs, minTokens, hasData ? "1" : ""].filter(Boolean).length;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="card relative z-30 flex flex-wrap items-center gap-3 p-3">
        <div className="relative min-w-[260px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            className="input pl-9 pr-8"
            placeholder="Search prompts, answers, session or user IDs…"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
          />
          {qInput && (
            <button className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700" onClick={() => setQInput("")}><X className="h-4 w-4" /></button>
          )}
        </div>
        <Segmented
          value={mode}
          disabled={loading}
          onChange={(v) => f.set({ mode: v === "session" ? "" : v, offset: "", sel: "" })}
          options={[
            { value: "session", label: "By session", title: "One row per session_id" },
            { value: "thread", label: "By thread", title: "Heuristic: same user + agent, split after an inactivity gap" },
          ]}
        />
        {mode === "thread" && (
          <Select
            className="w-32"
            value={gap}
            placeholder={null}
            onChange={(v) => f.set({ gap: v === "30" ? "" : v, offset: "", sel: "" })}
            options={[5, 15, 30, 60, 240].map((m) => ({ value: String(m), label: `${m} min gap` }))}
          />
        )}
        <MultiSelect
          label="Flags"
          values={flags}
          disabled={loading}
          options={f.meta?.flags || Object.keys(FLAG_META)}
          onChange={(v) => f.set({ flags: v, offset: "", sel: "" })}
          renderOption={(o) => (
            <span className="flex flex-col gap-0.5"><FlagBadge flag={o} /><span className="text-[11px] text-zinc-500">{FLAG_META[o]?.desc}</span></span>
          )}
        />
        <button className={`btn-secondary ${showMore ? "!border-blue-500/60" : ""}`} onClick={() => setShowMore((s) => !s)}>
          <SlidersHorizontal className="h-4 w-4" /> More
        </button>
        <a className="btn-secondary" href={api.csvUrl(params)} title="Export current filter (max 10k rows)">
          <Download className="h-4 w-4" /> CSV
        </a>
        {showMore && (
          <div className="flex w-full flex-wrap items-end gap-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
            <div>
              <label className="label">Min latency (s)</label>
              <input type="number" min="0" className="input w-32" value={minMs} onChange={(e) => f.set({ min_ms: e.target.value, offset: "" })} />
            </div>
            <div>
              <label className="label">Min tokens</label>
              <input type="number" min="0" step="1000" className="input w-36" value={minTokens} onChange={(e) => f.set({ min_tokens: e.target.value, offset: "" })} />
            </div>
            <label className="flex cursor-pointer items-center gap-2 pb-2 text-sm">
              <input type="checkbox" className="accent-blue-500" checked={hasData} onChange={(e) => f.set({ has_data: e.target.checked ? "1" : "", offset: "" })} />
              Only answers with a data result
            </label>
            {activeFilters > 0 && (
              <button
                className="btn-ghost ml-auto"
                onClick={() => { setQInput(""); f.set({ table: "", agent: "", user: "", q: "", flags: "", min_ms: "", min_tokens: "", has_data: "", offset: "", sel: "" }); }}
              >
                Clear all filters
              </button>
            )}
          </div>
        )}
      </div>

      <ErrorAlert error={error} onRetry={load} />

      <div className="flex flex-col gap-4 lg:flex-row">
        {/* Table */}
        <div className={`card overflow-hidden transition-all duration-300 ${selected ? "lg:w-[55%]" : "w-full"}`}>
          <div className="max-h-[calc(100vh-300px)] min-h-[300px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-zinc-100 text-left text-xs text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                <tr>
                  {COLS.filter((c) => !selected || !["source_table", "total_tokens", "user_id"].includes(c.key)).map((c) => (
                    <th
                      key={c.key}
                      className={`px-3 py-2.5 font-medium ${c.cls || ""} ${c.sortable ? "cursor-pointer select-none hover:text-zinc-800 dark:hover:text-zinc-200" : ""}`}
                      onClick={c.sortable ? () => toggleSort(c.key) : undefined}
                    >
                      <span className="inline-flex items-center gap-1">
                        {c.label}
                        {sort === c.key && (dir === "desc" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && !data.rows.length
                  ? [...Array(6)].map((_, i) => (
                      <tr key={i} className="border-b border-zinc-100 dark:border-zinc-800">
                        <td colSpan={8} className="px-3 py-3"><Skeleton className="h-5" /></td>
                      </tr>
                    ))
                  : data.rows.map((r) => (
                      <tr
                        key={r.conv_key}
                        onClick={() => f.set({ sel: r.conv_key === sel ? "" : r.conv_key })}
                        className={`cursor-pointer border-b border-zinc-100 align-top transition-colors dark:border-zinc-800 ${
                          r.conv_key === sel
                            ? "bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/40 dark:hover:bg-blue-900/60"
                            : "hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
                        } ${loading ? "opacity-60" : ""}`}
                      >
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <div className="text-zinc-900 dark:text-zinc-200">{fmtDateTime(r.start_ts)}</div>
                          <div className="text-[11px] text-zinc-500">{fmtAgo(r.end_ts)}</div>
                        </td>
                        {!selected && <td className="px-3 py-2.5"><span className="font-mono text-xs whitespace-nowrap">{highlight(r.user_id || "—", q)}</span></td>}
                        {!selected && (
                          <td className="px-3 py-2.5">
                            <div className="text-xs font-medium">{r.source_table}</div>
                            <div className="mono-id mt-0.5 inline-block">{shortAgent(r.data_agent_id)}</div>
                          </td>
                        )}
                        <td className="px-3 py-2.5 min-w-[280px]">
                          <div className="line-clamp-1 font-medium text-zinc-900 dark:text-zinc-100">{highlight(r.first_question || "(no prompt)", q)}</div>
                          {r.turns > 1 && <div className="line-clamp-1 text-xs text-zinc-600 dark:text-zinc-400">↳ last: {highlight(r.last_question, q)}</div>}
                          <div className="line-clamp-1 text-xs text-zinc-500">{highlight(r.last_answer?.replace(/[#*`|]/g, "").slice(0, 240), q)}</div>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-xs">{r.turns}</td>
                        {!selected && <td className="px-3 py-2.5 text-right font-mono text-xs">{fmtCompact(r.total_tokens)}</td>}
                        <td className="px-3 py-2.5 text-right font-mono text-xs">{fmtMs(r.max_ms)}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap gap-1">{r.flags?.map((fl) => <FlagBadge key={fl} flag={fl} />)}</div>
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
            {!loading && data.rows.length === 0 && (
              <Empty title="No conversations match">Try widening the time range or clearing filters.</Empty>
            )}
          </div>
          <div className="flex items-center">
            <div className="flex-1">
              <Pagination offset={offset} limit={LIMIT} total={data.total} loading={loading} onChange={(o) => f.set({ offset: o || "", sel: "" })} />
            </div>
            {loading && data.rows.length > 0 && <Spinner className="mr-4 h-4 w-4 text-zinc-400" />}
          </div>
        </div>

        {/* Detail panel */}
        {selected && (
          <Card className="animate-slide-in lg:w-[45%] lg:sticky lg:top-4 self-start" bodyClass="p-5">
            <ConversationView
              compact
              key={selected.conv_key}
              table={selected.source_table}
              sessions={selected.session_ids.join(",")}
              start={selected.start_ts}
              end={selected.end_ts}
              q={q}
              headerExtra={
                <>
                  <Link
                    className="btn-ghost !px-2 !py-1 text-xs"
                    to={`/conversation/view?${new URLSearchParams({ table: selected.source_table, sessions: selected.session_ids.join(","), start: selected.start_ts, end: selected.end_ts, q })}`}
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> Full page
                  </Link>
                  <IconButton icon={X} title="Close" onClick={() => f.set({ sel: "" })} />
                </>
              }
            />
          </Card>
        )}
      </div>
    </div>
  );
}
