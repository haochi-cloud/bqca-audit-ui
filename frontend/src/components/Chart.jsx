import { useEffect, useState } from "react";
import ReactECharts from "echarts-for-react";

export const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1"];

function useDark() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    const h = () => setDark(document.documentElement.classList.contains("dark"));
    window.addEventListener("themechange", h);
    return () => window.removeEventListener("themechange", h);
  }, []);
  return dark;
}

/** ECharts wrapper that applies the shared theme and dark-mode colours. */
export default function Chart({ option, height = 300, onEvents }) {
  const dark = useDark();
  const axisColor = dark ? "#71717a" : "#71717a";
  const splitColor = dark ? "#1e1e24" : "#f4f4f5";
  const themed = {
    color: COLORS,
    textStyle: { fontFamily: "DM Sans, sans-serif", color: dark ? "#a1a1aa" : "#52525b" },
    grid: { left: 48, right: 24, top: 36, bottom: 32, containLabel: true },
    tooltip: {
      trigger: "axis",
      backgroundColor: dark ? "rgba(24,24,27,0.95)" : "rgba(255,255,255,0.95)",
      borderColor: dark ? "#27272a" : "#e2e8f0",
      textStyle: { color: dark ? "#fafafa" : "#0f172a", fontSize: 12 },
      ...(option.tooltip || {}),
    },
    legend: { top: 0, textStyle: { color: axisColor }, icon: "roundRect", itemWidth: 10, itemHeight: 10, ...(option.legend || {}) },
    ...option,
  };
  const fixAxis = (ax) =>
    ax && (Array.isArray(ax) ? ax : [ax]).map((a) => ({
      axisLine: { lineStyle: { color: splitColor } },
      axisLabel: { color: axisColor, ...(a.axisLabel || {}) },
      splitLine: { lineStyle: { color: splitColor } },
      ...a,
    }));
  if (option.xAxis) themed.xAxis = fixAxis(option.xAxis);
  if (option.yAxis) themed.yAxis = fixAxis(option.yAxis);
  if (option.tooltip) themed.tooltip = { ...themed.tooltip, ...option.tooltip };
  if (option.legend === false) delete themed.legend;
  return (
    <ReactECharts
      option={themed}
      style={{ height, width: "100%" }}
      notMerge
      lazyUpdate
      onEvents={onEvents}
      opts={{ renderer: "canvas" }}
    />
  );
}
