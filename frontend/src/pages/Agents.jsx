import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Bot, Clock, Coins, Database, Flag, MessagesSquare, Users as UsersIcon } from "lucide-react";
import { api, errorMessage } from "../api";
import { useFilters } from "../App";
import { Badge, Card, CopyButton, Empty, ErrorAlert, Skeleton } from "../components/ui";
import { fmtAgo, fmtCompact, fmtMs, fmtNum, fmtPct } from "../lib/format";

function Stat({ icon: Icon, label, value }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400"><Icon className="h-3.5 w-3.5" />{label}</div>
      <div className="mt-1 text-lg font-semibold tracking-tight">{value}</div>
    </div>
  );
}

export default function Agents() {
  const f = useFilters();
  const nav = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = () => {
    setLoading(true);
    setError(null);
    api.agents({ start: f.start, end: f.end, user: f.user })
      .then(setRows).catch((e) => setError(errorMessage(e))).finally(() => setLoading(false));
  };
  useEffect(load, [f.start, f.end, f.user]); // eslint-disable-line

  const open = (r) => {
    const p = new URLSearchParams(f.sp);
    p.set("table", r.source_table);
    if (r.data_agent_id) p.set("agent", r.data_agent_id);
    nav(`/conversations?${p}`);
  };

  return (
    <div className="space-y-5">
      <ErrorAlert error={error} onRetry={load} />
      {loading ? (
        <div className="grid gap-5 xl:grid-cols-2"><Skeleton className="h-72" /><Skeleton className="h-72" /></div>
      ) : rows.length === 0 ? (
        <Card><Empty title="No agent activity in range" /></Card>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {rows.map((r) => (
            <Card
              key={`${r.source_table}|${r.data_agent_id}`}
              className="transition-shadow hover:shadow-md"
              title={<span className="flex items-center gap-2"><Bot className="h-4 w-4 text-blue-500" />{r.source_table}</span>}
              subtitle={
                <span className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="mono-id">{r.data_agent_id}</span><CopyButton text={r.data_agent_id || ""} />
                  {r.published_context && <Badge>context: {r.published_context}</Badge>}
                  {r.models && <Badge tone="blue">{r.models}</Badge>}
                  <span>· last active {fmtAgo(r.last_active)}</span>
                </span>
              }
              actions={<button className="btn-secondary !py-1.5 text-xs" onClick={() => open(r)}><MessagesSquare className="h-3.5 w-3.5" /> Conversations</button>}
            >
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat icon={MessagesSquare} label="Turns" value={fmtNum(r.turns)} />
                <Stat icon={UsersIcon} label="Users" value={fmtNum(r.users)} />
                <Stat icon={Clock} label="p50 / p95" value={<span className="text-base">{fmtMs(r.p50_ms)} / {fmtMs(r.p95_ms)}</span>} />
                <Stat icon={Coins} label="Avg tokens / turn" value={fmtCompact(r.avg_tokens)} />
                <Stat icon={Coins} label="Total tokens" value={fmtCompact(r.tokens)} />
                <Stat icon={Coins} label="Prompt cache hit" value={fmtPct(r.cache_ratio)} />
                <Stat icon={Database} label="Answers w/ data" value={fmtPct(r.data_result_rate)} />
                <Stat icon={Flag} label="Flagged / clarifying" value={`${fmtNum(r.flagged_turns)} / ${fmtNum(r.clarifying_turns)}`} />
              </div>
              {!r.tool_events && (
                <div className="mt-3 flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5" /> No tool-call events logged for this agent — generated SQL is not auditable.
                </div>
              )}
              <div className="mt-2 truncate font-mono text-[11px] text-zinc-500" title={r.app_name}>{r.app_name}</div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
