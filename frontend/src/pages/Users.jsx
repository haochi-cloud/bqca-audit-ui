import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowDown, ArrowUp, Info } from "lucide-react";
import { api, errorMessage } from "../api";
import { useFilters } from "../App";
import Chart from "../components/Chart";
import { Alert, Card, Empty, ErrorAlert, Skeleton } from "../components/ui";
import { fmtAgo, fmtCompact, fmtDateTime, fmtMs, fmtNum } from "../lib/format";

const COLS = [
  ["user_id", "User"], ["turns", "Turns"], ["sessions", "Sessions"], ["agents", "Agents"], ["tokens", "Tokens"],
  ["avg_ms", "Avg latency"], ["flagged_turns", "Flagged"], ["clarifying_turns", "Clarifying"], ["active_days", "Active days"],
  ["first_seen", "First seen"], ["last_seen", "Last seen"],
];

export default function Users() {
  const f = useFilters();
  const nav = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sort, setSort] = useState(["turns", "desc"]);

  const load = () => {
    setLoading(true);
    setError(null);
    api.users({ start: f.start, end: f.end, table: f.table, agent: f.agent })
      .then(setRows).catch((e) => setError(errorMessage(e))).finally(() => setLoading(false));
  };
  useEffect(load, [f.start, f.end, f.table, f.agent]); // eslint-disable-line

  const sorted = useMemo(() => {
    const [k, d] = sort;
    return [...rows].sort((a, b) => {
      const x = a[k] ?? ""; const y = b[k] ?? "";
      return (x < y ? -1 : x > y ? 1 : 0) * (d === "desc" ? -1 : 1);
    });
  }, [rows, sort]);
  const open = (u) => {
    const p = new URLSearchParams(f.sp);
    p.set("user", u);
    nav(`/conversations?${p}`);
  };
  const opaque = rows.some((r) => /^gaia:|^[a-z0-9-]+$/i.test(r.user_id || "") && !(r.user_id || "").includes("@"));

  return (
    <div className="space-y-5">
      <ErrorAlert error={error} onRetry={load} />
      {opaque && !loading && (
        <Alert tone="blue" icon={Info} title="User IDs are not emails">
          The logs carry GAIA IDs (<span className="font-mono">gaia:…</span>) or caller identities such as{" "}
          <span className="font-mono">data-assistant-eng</span>. Resolving them to people requires a directory lookup outside this dataset.
        </Alert>
      )}
      <Card title="Turns by user" subtitle="Top 15 users in range">
        {loading ? <Skeleton className="h-[260px]" /> : (
          <Chart
            height={260}
            onEvents={{ click: (p) => open(p.name) }}
            option={{
              legend: { top: 0 },
              grid: { left: 24, right: 24, top: 36, bottom: 8, containLabel: true },
              xAxis: { type: "value", minInterval: 1 },
              yAxis: { type: "category", inverse: true, data: sorted.slice(0, 15).map((r) => r.user_id || "(none)") },
              series: [
                { name: "Turns", type: "bar", stack: "t", barMaxWidth: 22, data: sorted.slice(0, 15).map((r) => r.turns - r.flagged_turns) },
                { name: "Flagged turns", type: "bar", stack: "t", barMaxWidth: 22, itemStyle: { color: "#f59e0b", borderRadius: [0, 3, 3, 0] }, data: sorted.slice(0, 15).map((r) => r.flagged_turns) },
              ],
            }}
          />
        )}
      </Card>
      <div className="card overflow-hidden">
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-zinc-100 text-left text-xs text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                {COLS.map(([k, l]) => (
                  <th key={k} className="cursor-pointer select-none px-3 py-2.5 font-medium whitespace-nowrap hover:text-zinc-800 dark:hover:text-zinc-200"
                      onClick={() => setSort(([sk, sd]) => [k, sk === k && sd === "desc" ? "asc" : "desc"])}>
                    <span className="inline-flex items-center gap-1">{l}{sort[0] === k && (sort[1] === "desc" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? [...Array(4)].map((_, i) => (
                <tr key={i}><td colSpan={COLS.length} className="px-3 py-3"><Skeleton className="h-5" /></td></tr>
              )) : sorted.map((r) => (
                <tr key={r.user_id} onClick={() => open(r.user_id)} className="cursor-pointer border-b border-zinc-100 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-800/60">
                  <td className="px-3 py-2.5 font-mono text-xs">{r.user_id || "(none)"}</td>
                  <td className="px-3 py-2.5 font-mono text-xs">{fmtNum(r.turns)}</td>
                  <td className="px-3 py-2.5 font-mono text-xs">{fmtNum(r.sessions)}</td>
                  <td className="px-3 py-2.5 font-mono text-xs" title={(r.tables || []).join(", ")}>{fmtNum(r.agents)}</td>
                  <td className="px-3 py-2.5 font-mono text-xs">{fmtCompact(r.tokens)}</td>
                  <td className="px-3 py-2.5 font-mono text-xs">{fmtMs(r.avg_ms)}</td>
                  <td className="px-3 py-2.5 font-mono text-xs">{r.flagged_turns ? <span className="text-amber-600 dark:text-amber-400">{r.flagged_turns}</span> : 0}</td>
                  <td className="px-3 py-2.5 font-mono text-xs">{fmtNum(r.clarifying_turns)}</td>
                  <td className="px-3 py-2.5 font-mono text-xs">{fmtNum(r.active_days)}</td>
                  <td className="px-3 py-2.5 text-xs whitespace-nowrap">{fmtDateTime(r.first_seen)}</td>
                  <td className="px-3 py-2.5 text-xs whitespace-nowrap" title={fmtDateTime(r.last_seen)}>{fmtAgo(r.last_seen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !rows.length && <Empty title="No users in range" />}
        </div>
      </div>
    </div>
  );
}
