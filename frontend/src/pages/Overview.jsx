import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity, AlertTriangle, Bot, Coins, Flag, Gauge, Info, MessagesSquare, RefreshCw, Users as UsersIcon,
} from "lucide-react";
import { api, errorMessage } from "../api";
import { useFilters } from "../App";
import Chart from "../components/Chart";
import { Alert, BarList, Card, ErrorAlert, FLAG_META, Kpi, Skeleton, Spinner } from "../components/ui";
import { fmtAgo, fmtCompact, fmtMs, fmtNum, fmtPct, pctChange, shortAgent } from "../lib/format";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const toneFor = (flag) => ({ rose: "bg-rose-500", amber: "bg-amber-500", blue: "bg-blue-500" }[FLAG_META[flag]?.cls] || "bg-zinc-500");

export default function Overview() {
  const f = useFilters();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = () => {
    setLoading(true);
    setError(null);
    api.overview({ start: f.start, end: f.end, table: f.table, agent: f.agent, user: f.user })
      .then(setData)
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  };
  useEffect(load, [f.start, f.end, f.table, f.agent, f.user]); // eslint-disable-line

  const goConv = (patch) => {
    const p = new URLSearchParams(f.sp);
    Object.entries(patch).forEach(([k, v]) => p.set(k, v));
    nav(`/conversations?${p}`);
  };

  const k = data?.kpis || {};
  const pk = data?.prev_kpis || {};
  const singleTurnSessions = k.sessions && k.turns === k.sessions;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="h6">Summary</h2>
        <button className="btn-secondary !py-1.5" onClick={() => { f.refresh(); }} disabled={loading}>
          {loading ? <Spinner /> : <RefreshCw className="h-4 w-4" />} Refresh
        </button>
      </div>
      <ErrorAlert error={error} onRetry={load} />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Kpi loading={loading} icon={MessagesSquare} label="Turns (questions)" value={fmtNum(k.turns)} delta={pctChange(k.turns, pk.turns)} sub={`${fmtNum(k.sessions)} sessions`} />
        <Kpi loading={loading} icon={UsersIcon} label="Active users" value={fmtNum(k.users)} delta={pctChange(k.users, pk.users)} sub={`${fmtNum(k.agents)} data agents`} />
        <Kpi loading={loading} icon={Gauge} label="p95 latency" value={fmtMs(k.p95_ms)} delta={pctChange(k.p95_ms, pk.p95_ms)} invert sub={`p50 ${fmtMs(k.p50_ms)} · TTFT ${fmtMs(k.avg_ttft_ms)}`} />
        <Kpi loading={loading} icon={Coins} label="Tokens" value={fmtCompact(k.total_tokens)} delta={pctChange(k.total_tokens, pk.total_tokens)} invert sub={`${fmtCompact(k.avg_tokens_per_turn)} / turn · ${fmtPct(k.prompt_tokens ? k.cached_tokens / k.prompt_tokens : null)} cached`} />
        <Kpi loading={loading} icon={Flag} label="Flagged turns" value={fmtNum(k.flagged_turns)} delta={pctChange(k.flagged_turns, pk.flagged_turns)} invert sub={`${fmtNum(k.error_turns)} errors · ${fmtNum(k.clarifying_turns)} clarifying`} />
        <Kpi loading={loading} icon={Activity} label="Answers with data" value={fmtPct(k.turns ? k.data_result_turns / k.turns : null)} sub={`${fmtNum(k.data_result_turns)} of ${fmtNum(k.turns)} turns`} />
      </div>

      {!loading && k.turns > 0 && (
        <div className="grid gap-3 lg:grid-cols-2">
          {!k.tool_events && (
            <Alert title="Logging gap: tool calls / SQL are not captured">
              No TOOL_STARTING / TOOL_COMPLETED events were logged in this range, so the generated SQL and the data the agent read
              can't be audited here. Answers only reference a <span className="font-mono">data_result_artifact_name</span>.
            </Alert>
          )}
          {singleTurnSessions && (
            <Alert tone="blue" icon={Info} title="Every session has exactly one turn">
              BQCA appears to issue a new <span className="font-mono">session_id</span> per question. Use{" "}
              <button className="underline font-medium" onClick={() => goConv({ mode: "thread" })}>Thread grouping</button>{" "}
              in Conversations to stitch turns by user + agent + inactivity gap.
            </Alert>
          )}
        </div>
      )}

      <Card title="Activity" subtitle={`Turns, users and flagged turns per ${data?.bucket?.toLowerCase() || "bucket"}`}>
        {loading ? <Skeleton className="h-[300px]" /> : (
          <Chart
            height={300}
            option={{
              xAxis: { type: "time" },
              yAxis: [{ type: "value", name: "count", minInterval: 1 }],
              series: [
                { name: "Turns", type: "bar", barMaxWidth: 28, itemStyle: { borderRadius: [3, 3, 0, 0] }, data: (data?.timeseries || []).map((r) => [r.bucket, r.turns]) },
                { name: "Users", type: "line", smooth: true, symbolSize: 6, data: (data?.timeseries || []).map((r) => [r.bucket, r.users]) },
                { name: "Flagged", type: "bar", barMaxWidth: 28, itemStyle: { color: "#f59e0b", borderRadius: [3, 3, 0, 0] }, data: (data?.timeseries || []).map((r) => [r.bucket, r.flagged]) },
              ],
            }}
          />
        )}
      </Card>

      <Card title="Latency & tokens" subtitle="p50 / p95 end-to-end turn latency and token volume">
        {loading ? <Skeleton className="h-[300px]" /> : (
          <Chart
            height={300}
            option={{
              tooltip: { valueFormatter: undefined },
              xAxis: { type: "time" },
              yAxis: [
                { type: "value", name: "ms", axisLabel: { formatter: (v) => fmtMs(v) } },
                { type: "value", name: "tokens", axisLabel: { formatter: (v) => fmtCompact(v) }, splitLine: { show: false } },
              ],
              series: [
                { name: "p50 latency", type: "line", smooth: true, data: (data?.timeseries || []).map((r) => [r.bucket, r.p50_ms]) },
                { name: "p95 latency", type: "line", smooth: true, lineStyle: { type: "dashed" }, data: (data?.timeseries || []).map((r) => [r.bucket, r.p95_ms]) },
                { name: "Tokens", type: "bar", yAxisIndex: 1, barMaxWidth: 28, itemStyle: { color: "#8b5cf6", opacity: 0.5, borderRadius: [3, 3, 0, 0] }, data: (data?.timeseries || []).map((r) => [r.bucket, r.tokens]) },
              ],
            }}
          />
        )}
      </Card>

      <Card title="When are people asking?" subtitle="Turns by weekday × hour (UTC)">
        {loading ? <Skeleton className="h-[260px]" /> : (
          <Chart
            height={260}
            option={{
              legend: false,
              tooltip: { trigger: "item", formatter: (p) => `${DOW[p.value[1]]} ${p.value[0]}:00 UTC — ${p.value[2]} turns` },
              grid: { left: 48, right: 24, top: 10, bottom: 56, containLabel: true },
              xAxis: { type: "category", data: [...Array(24).keys()].map(String), splitLine: { show: false } },
              yAxis: { type: "category", data: DOW, splitLine: { show: false } },
              visualMap: {
                min: 0, max: Math.max(1, ...(data?.heatmap || []).map((h) => h.n)), calculable: false, orient: "horizontal",
                left: "center", bottom: 0, itemHeight: 120, inRange: { color: ["rgba(113,113,122,0.12)", "#60a5fa", "#1d4ed8"] }, textStyle: { color: "#71717a" },
              },
              series: [{
                type: "heatmap",
                data: (() => {
                  const m = {};
                  (data?.heatmap || []).forEach((h) => { m[`${h.hour}|${h.dow - 1}`] = h.n; });
                  const out = [];
                  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) out.push([h, d, m[`${h}|${d}`] || 0]);
                  return out;
                })(),
                itemStyle: { borderRadius: 3, borderColor: "transparent", borderWidth: 2 },
                emphasis: { itemStyle: { shadowBlur: 6, shadowColor: "rgba(0,0,0,.3)" } },
              }],
            }}
          />
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Top questions" subtitle="Most frequent prompts (normalized). Click to search.">
          {loading ? <Skeleton className="h-40" /> : (data?.top_questions || []).length === 0 ? (
            <p className="text-sm text-zinc-500">No questions in range.</p>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {data.top_questions.map((q, i) => (
                <li
                  key={i}
                  className="flex cursor-pointer items-center justify-between gap-3 py-2 text-sm transition-colors hover:text-blue-600 dark:hover:text-blue-400"
                  onClick={() => goConv({ q: q.question.slice(0, 120) })}
                >
                  <span className="line-clamp-1">{q.question}</span>
                  <span className="shrink-0 text-xs text-zinc-500 font-mono">{q.n}× · {q.users}u · {fmtAgo(q.last_asked)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Review flags" subtitle="Rule-based signals worth a human look. Click to filter.">
          {loading ? <Skeleton className="h-40" /> : (data?.flags || []).length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400"><AlertTriangle className="h-4 w-4" /> No flagged turns in range.</div>
          ) : (
            <BarList
              items={data.flags.map((x) => ({ label: `${x.flag} — ${FLAG_META[x.flag]?.desc || ""}`, n: x.n, flag: x.flag, tone: toneFor(x.flag) }))}
              onClick={(it) => goConv({ flags: it.flag })}
            />
          )}
        </Card>

        <Card title="By data agent" subtitle="Turns per agent table / data agent. Click to filter.">
          {loading ? <Skeleton className="h-40" /> : (
            <BarList
              items={(data?.by_agent || []).map((a) => ({
                label: <span><span className="font-medium">{a.source_table}</span> <span className="mono-id">{shortAgent(a.data_agent_id)}</span> · {fmtNum(a.users)} users · avg {fmtMs(a.avg_ms)}</span>,
                n: a.turns, agent: a.data_agent_id, table: a.source_table,
              }))}
              onClick={(it) => f.set({ table: it.table, agent: it.agent })}
            />
          )}
        </Card>

        <Card title="Most active users" subtitle="Click to filter conversations by user.">
          {loading ? <Skeleton className="h-40" /> : (
            <BarList
              tone="bg-emerald-500"
              items={(data?.by_user || []).map((u) => ({
                label: <span><span className="font-mono">{u.user_id || "(none)"}</span> · {fmtNum(u.sessions)} sessions · {fmtCompact(u.tokens)} tok · {fmtAgo(u.last_seen)}</span>,
                n: u.turns, user: u.user_id,
              }))}
              onClick={(it) => goConv({ user: it.user })}
            />
          )}
        </Card>

        <Card title="Latency distribution" subtitle="Turns by end-to-end latency (2 s buckets)">
          {loading ? <Skeleton className="h-[220px]" /> : (
            <Chart
              height={220}
              option={{
                legend: false,
                xAxis: { type: "category", data: (data?.latency_hist || []).map((h) => `${h.bucket_s}–${h.bucket_s + 2}s`) },
                yAxis: { type: "value", minInterval: 1 },
                series: [{ type: "bar", name: "Turns", barMaxWidth: 36, itemStyle: { color: "#06b6d4", borderRadius: [3, 3, 0, 0] }, data: (data?.latency_hist || []).map((h) => h.n) }],
              }}
            />
          )}
        </Card>

        <Card title="Models" subtitle="Turns and tokens by model version">
          {loading ? <Skeleton className="h-[220px]" /> : (
            <BarList
              tone="bg-violet-500"
              items={(data?.models || []).map((m) => ({ label: <span className="font-mono">{m.model} · {fmtCompact(m.tokens)} tokens</span>, n: m.turns }))}
            />
          )}
        </Card>
      </div>
      {!loading && k.turns === 0 && (
        <Card><div className="flex items-center gap-2 text-sm text-zinc-500"><Bot className="h-4 w-4" /> No conversations in the selected range. Try widening the time range.</div></Card>
      )}
    </div>
  );
}
