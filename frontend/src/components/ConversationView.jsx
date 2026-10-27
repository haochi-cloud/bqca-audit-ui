import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Bot, ChevronDown, ChevronRight, Clock, Coins, Cpu, Database, HelpCircle, Lightbulb, Link2, ShieldCheck,
  ShieldAlert, Sparkles, User as UserIcon,
} from "lucide-react";
import { api, errorMessage } from "../api";
import { Badge, CopyButton, Empty, ErrorAlert, FlagBadge, Skeleton } from "./ui";
import { fmtDateTime, fmtMs, fmtNum, fmtTime, highlight, toDate } from "../lib/format";

const EVENT_TONE = {
  USER_MESSAGE_RECEIVED: "bg-emerald-500",
  INVOCATION_STARTING: "bg-zinc-400",
  LLM_REQUEST: "bg-violet-300",
  LLM_RESPONSE: "bg-violet-500",
  TOOL_STARTING: "bg-amber-300",
  TOOL_COMPLETED: "bg-amber-500",
  AGENT_RESPONSE: "bg-blue-500",
  INVOCATION_COMPLETED: "bg-zinc-500",
};

function Md({ children }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children || ""}</ReactMarkdown>
    </div>
  );
}

function AgentAnswer({ response }) {
  const r = response?.response;
  if (!r) return <p className="text-sm italic text-zinc-500">No agent response recorded.</p>;
  return (
    <div className="space-y-2.5">
      {r.clarifying_question && (
        <div className="flex gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm dark:border-blue-800/30 dark:bg-blue-900/20">
          <HelpCircle className="h-4 w-4 shrink-0 text-blue-600 mt-0.5" />
          <div><div className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-0.5">Clarifying question</div>{r.clarifying_question}</div>
        </div>
      )}
      {(r.parts || []).map((p, i) => {
        if (p.markdown) return <Md key={i}>{p.markdown}</Md>;
        if (p.insight)
          return (
            <div key={i} className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800/30 dark:bg-amber-900/15">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300"><Lightbulb className="h-3.5 w-3.5" /> Insight</div>
              <Md>{p.insight}</Md>
            </div>
          );
        if (p.data_result_artifact_name)
          return (
            <div key={i} className="flex items-center gap-2 rounded-lg border border-dashed border-zinc-300 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
              <Database className="h-4 w-4 text-blue-500" />
              Data result: <span className="font-mono">{p.data_result_artifact_name}</span>
              <span className="ml-auto italic opacity-70">rows/SQL not logged</span>
            </div>
          );
        return <pre key={i} className="text-xs font-mono whitespace-pre-wrap">{JSON.stringify(p, null, 2)}</pre>;
      })}
      {(r.followup_questions || []).length > 0 && (
        <div className="pt-1">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Suggested follow-ups</div>
          <div className="flex flex-wrap gap-1.5">
            {r.followup_questions.map((q, i) => (
              <span key={i} className="rounded-full border border-zinc-200 px-2.5 py-1 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">{q}</span>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-1.5 pt-1">
        {["skip_data_queries", "skip_data_result", "skip_chart"].map((k) =>
          r[k] !== undefined ? <Badge key={k} tone={r[k] ? "zinc" : "green"}>{k.replace("skip_", "")}: {r[k] ? "skipped" : "yes"}</Badge> : null,
        )}
      </div>
    </div>
  );
}

function TurnMeta({ t }) {
  const items = [
    { icon: Clock, label: "Latency", value: `${fmtMs(t.total_ms)}${t.max_ttft_ms ? ` · TTFT ${fmtMs(t.max_ttft_ms)}` : ""}` },
    { icon: Coins, label: "Tokens", value: `${fmtNum(t.total_tokens)} (in ${fmtNum(t.prompt_tokens)} · out ${fmtNum(t.completion_tokens)} · think ${fmtNum(t.thought_tokens)} · cached ${fmtNum(t.cached_tokens)})` },
    { icon: Cpu, label: "Model", value: `${t.models || "—"} · ${t.llm_calls} call${t.llm_calls === 1 ? "" : "s"}${t.finish_reasons ? ` · ${t.finish_reasons}` : ""}` },
  ];
  const checks = t.security_checks ? Object.entries(t.security_checks) : [];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-zinc-100 pt-2.5 text-[11px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
      {items.map(({ icon: Icon, label, value }) => (
        <span key={label} className="inline-flex items-center gap-1" title={label}><Icon className="h-3.5 w-3.5" />{value}</span>
      ))}
      {checks.length > 0 && (
        <span className="inline-flex items-center gap-1" title="Tool-call security checks (session state)">
          {checks.every(([, v]) => v === "ALLOW") ? <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" /> : <ShieldAlert className="h-3.5 w-3.5 text-rose-500" />}
          {checks.length} tool check{checks.length === 1 ? "" : "s"}: {[...new Set(checks.map(([, v]) => v))].join(", ")}
        </span>
      )}
      {t.flags?.map((fl) => <FlagBadge key={fl} flag={fl} />)}
      {t.error_messages && <span className="text-rose-600 dark:text-rose-400">Error: {t.error_messages}</span>}
    </div>
  );
}

function Transcript({ turns, q }) {
  if (!turns.length) return <Empty title="No turns" />;
  return (
    <div className="space-y-6">
      {turns.map((t, idx) => (
        <div key={t.invocation_id} className="space-y-3">
          <div className="flex items-center gap-2 text-[11px] text-zinc-500">
            <span className="font-semibold uppercase tracking-wider">Turn {idx + 1}</span>
            <span>· {fmtDateTime(t.start_ts)}</span>
            <span className="mono-id" title="session_id">{t.session_id}</span>
            <CopyButton text={t.session_id} />
          </div>
          <div className="flex gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"><UserIcon className="h-4 w-4" /></div>
            <div className="rounded-xl rounded-tl-sm bg-zinc-100 px-3.5 py-2.5 text-sm dark:bg-zinc-800/70 max-w-full">
              <div className="mb-0.5 text-[11px] font-medium text-zinc-500">{t.user_id || "unknown user"}</div>
              <div className="whitespace-pre-wrap break-words">{highlight(t.question, q) || <i className="text-zinc-500">(no prompt recorded)</i>}</div>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"><Bot className="h-4 w-4" /></div>
            <div className="min-w-0 flex-1 rounded-xl rounded-tl-sm border border-zinc-200 px-3.5 py-3 dark:border-zinc-800">
              <AgentAnswer response={t.response} />
              <div className="mt-3"><TurnMeta t={t} /></div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Per-turn waterfall built from event timestamps and latency_ms. */
function Timeline({ turns, events }) {
  const byInv = useMemo(() => {
    const m = {};
    events.forEach((e) => { (m[e.invocation_id] = m[e.invocation_id] || []).push(e); });
    return m;
  }, [events]);
  return (
    <div className="space-y-6">
      {turns.map((t, idx) => {
        const evs = byInv[t.invocation_id] || [];
        const spans = evs.map((e) => {
          const endMs = toDate(e.timestamp).getTime();
          const dur = e.latency_ms?.total_ms || 0;
          return { e, s: endMs - dur, en: endMs, dur };
        });
        const t0 = Math.min(...spans.map((s) => s.s));
        const t1 = Math.max(...spans.map((s) => s.en));
        const total = Math.max(1, t1 - t0);
        return (
          <div key={t.invocation_id}>
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="font-semibold">Turn {idx + 1} <span className="font-normal text-zinc-500">· trace <span className="font-mono">{t.trace_id}</span></span></span>
              <span className="text-zinc-500">{fmtMs(total)} span</span>
            </div>
            <div className="space-y-1">
              {spans.map(({ e, s, en, dur }) => (
                <div key={e.event_id} className="grid grid-cols-[180px_1fr_70px] items-center gap-2 text-[11px]">
                  <span className="truncate font-mono text-zinc-600 dark:text-zinc-400" title={`span ${e.span_id} ← ${e.parent_span_id || "root"}`}>
                    {e.parent_span_id ? "└ " : ""}{e.event_type}
                  </span>
                  <div className="relative h-4 rounded-sm bg-zinc-100 dark:bg-zinc-800/60">
                    <div
                      className={`absolute top-0 h-4 rounded-sm ${EVENT_TONE[e.event_type] || "bg-zinc-400"} ${dur ? "" : "w-1.5"}`}
                      style={{ left: `${Math.min(dur ? 100 : 99, ((s - t0) / total) * 100)}%`, width: dur ? `${Math.max(0.8, ((en - s) / total) * 100)}%` : undefined }}
                      title={`${e.event_type} @ ${fmtTime(e.timestamp)}${dur ? ` · ${fmtMs(dur)}` : ""}`}
                    />
                  </div>
                  <span className="text-right font-mono text-zinc-500">{dur ? fmtMs(dur) : `+${fmtMs(en - t0)}`}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      <p className="text-[11px] text-zinc-500">Bars are derived from each event's timestamp and <span className="font-mono">latency_ms.total_ms</span>; zero-duration events are shown as markers.</p>
    </div>
  );
}

function RawEvents({ events }) {
  const [open, setOpen] = useState({});
  return (
    <div className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
      {events.map((e) => (
        <div key={e.event_id}>
          <button
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900"
            onClick={() => setOpen((o) => ({ ...o, [e.event_id]: !o[e.event_id] }))}
          >
            {open[e.event_id] ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            <span className={`h-2 w-2 rounded-full ${EVENT_TONE[e.event_type] || "bg-zinc-400"}`} />
            <span className="font-mono font-medium">{e.event_type}</span>
            <span className="text-zinc-500">{fmtTime(e.timestamp)}</span>
            <Badge tone={e.status === "OK" ? "green" : "rose"}>{e.status || "—"}</Badge>
            {e.is_truncated && <Badge tone="rose">truncated</Badge>}
            <span className="ml-auto font-mono text-zinc-400">{e.event_id}</span>
          </button>
          {open[e.event_id] && (
            <div className="relative bg-zinc-50 px-3 py-2 dark:bg-zinc-950">
              <CopyButton text={e} className="absolute right-2 top-2" />
              <pre className="max-h-96 overflow-auto font-mono text-[11px] leading-relaxed text-zinc-700 dark:text-zinc-300">{JSON.stringify(e, null, 2)}</pre>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function ConversationView({ table, sessions, start, end, q, compact = false, headerExtra }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("transcript");

  const load = () => {
    setLoading(true);
    setError(null);
    api.conversation({ table, sessions, start, end })
      .then(setData)
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  };
  useEffect(load, [table, sessions, start, end]); // eslint-disable-line

  const turns = data?.turns || [];
  const first = turns[0];
  const totals = useMemo(() => ({
    tokens: turns.reduce((a, t) => a + (t.total_tokens || 0), 0),
    ms: turns.reduce((a, t) => a + (t.total_ms || 0), 0),
  }), [turns]);
  const link = `${window.location.origin}/conversation/view?${new URLSearchParams({ table, sessions, start, end })}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-blue-500" />
            <h3 className="text-base font-semibold tracking-tight">{loading ? "Loading conversation…" : first?.question?.slice(0, 90) || "Conversation"}</h3>
          </div>
          {first && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
              <span>{fmtDateTime(first.start_ts)}</span>
              <span>· {turns.length} turn{turns.length === 1 ? "" : "s"}</span>
              <span>· {fmtNum(totals.tokens)} tokens</span>
              <span>· {fmtMs(totals.ms)} total</span>
              <span>· <span className="font-medium">{table}</span></span>
              <span className="mono-id" title={first.app_name}>{first.data_agent_id}</span>
              <span className="font-mono">{first.user_id}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => navigator.clipboard?.writeText(link)} title="Copy shareable link">
            <Link2 className="h-3.5 w-3.5" /> Copy link
          </button>
          {headerExtra}
        </div>
      </div>

      <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {[["transcript", "Transcript"], ["timeline", "Timeline"], ["events", `Raw events${data ? ` (${data.events.length})` : ""}`]].map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
              tab === k ? "border-blue-500 text-blue-600 dark:text-blue-400" : "border-transparent text-zinc-500 hover:border-blue-500/50 hover:text-zinc-800 dark:hover:text-zinc-200"
            }`}
          >
            {l}
          </button>
        ))}
      </div>

      <ErrorAlert error={error} onRetry={load} />
      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-12 w-2/3" />
          <Skeleton className="h-32" />
          <Skeleton className="h-12 w-1/2" />
        </div>
      ) : data ? (
        <div className={compact ? "max-h-[calc(100vh-260px)] overflow-y-auto pr-1" : ""}>
          {tab === "transcript" && <Transcript turns={turns} q={q} />}
          {tab === "timeline" && <Timeline turns={turns} events={data.events} />}
          {tab === "events" && <RawEvents events={data.events} />}
        </div>
      ) : null}
    </div>
  );
}
