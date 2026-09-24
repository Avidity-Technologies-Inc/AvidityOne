"use client";

import { Activity, Clock3 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";

interface SystemHealthSummary {
  status: "ok" | "warning" | "error";
  severity: "green" | "orange" | "red";
  checkedAt: string;
  serverTime: string;
  timezone: string;
  dateFormat: string;
  timeFormat: "12h" | "24h";
  components: Array<{
    key: string;
    name: string;
    status: "ok" | "warning" | "error";
    message: string;
  }>;
}

function formatDate(date: Date, timezone: string, dateFormat: string, timeFormat: "12h" | "24h") {
  const dateParts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: dateFormat.includes("MMM") ? "short" : "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(dateParts.map((part) => [part.type, part.value]));
  const month = values.month ?? "";
  const day = values.day ?? "";
  const year = values.year ?? "";
  const formattedDate = dateFormat.includes("dd/MM") ? `${day}/${month}/${year}` : dateFormat.includes("MM/dd") ? `${month}/${day}/${year}` : `${month} ${day}, ${year}`;
  const formattedTime = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: timeFormat !== "24h"
  }).format(date);
  return `${formattedDate} ${formattedTime}`;
}

export function SystemStatusClock() {
  const [summary, setSummary] = useState<SystemHealthSummary | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let mounted = true;
    let timeout: number | undefined;

    async function load() {
      try {
        const response = await apiFetch<SystemHealthSummary>("/system-health/summary");
        if (mounted) {
          setSummary(response);
          setFailed(false);
        }
      } catch {
        if (mounted) {
          setFailed(true);
        }
      } finally {
        if (mounted) {
          timeout = window.setTimeout(load, 60_000);
        }
      }
    }

    void load();
    return () => {
      mounted = false;
      if (timeout) {
        window.clearTimeout(timeout);
      }
    };
  }, []);

  useEffect(() => {
    setNow(new Date());
    const interval = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const status = failed ? "error" : summary?.status ?? "unknown";
  const timezone = summary?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const dateFormat = summary?.dateFormat ?? "MMM dd, yyyy";
  const timeFormat = summary?.timeFormat ?? "12h";
  const label = now ? formatDate(now, timezone, dateFormat, timeFormat) : "Loading time";
  const title = useMemo(() => {
    if (failed) return "System health unavailable. Open System Health.";
    if (!summary) return "System health loading.";
    const componentSummary = summary.components.map((component) => `${component.name}: ${component.status}`).join(" | ");
    return `${summary.status.toUpperCase()} - ${componentSummary}`;
  }, [failed, summary]);

  return (
    <a className={`system-status-clock ${status}`} href="/settings?section=systemHealth" title={title} aria-label={`System health ${status}. ${label}`}>
      <span className="system-status-dot" aria-hidden="true" />
      <Clock3 size={15} aria-hidden="true" />
      <span className="system-status-time">{label}</span>
      <Activity className="system-status-icon" size={15} aria-hidden="true" />
    </a>
  );
}
