import { BREAK_GAP_MS, FOUR_HOURS_MS } from "./seed";
import type { DispatchState, Leg } from "./types";

export interface Interval {
  legId: string;
  start: number;
  end: number;
  status: Leg["status"];
}

export function toMs(value: string | null): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

/** 段实际占用时长：已到站按实际出发-到站，否则按计划起止 */
export function legDurationMs(leg: Leg): number | null {
  if (leg.arrivedAt && leg.departedAt) {
    return toMs(leg.arrivedAt)! - toMs(leg.departedAt)!;
  }
  const s = toMs(leg.startAt);
  const e = toMs(leg.endAt);
  if (s === null || e === null) return null;
  return e - s;
}

export function legInterval(leg: Leg): Interval | null {
  const s = toMs(leg.startAt);
  const e = toMs(leg.endAt);
  if (s === null || e === null) return null;
  return { legId: leg.id, start: s, end: e, status: leg.status };
}

/** 与资源（车辆/司机）仍有占用关系的段：已派/在途/已到站；待接力与退回不占资源 */
export function isOccupying(status: Leg["status"]): boolean {
  return status === "assigned" || status === "departed" || status === "arrived";
}

export function intervalsOverlap(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end; // 端点相接不算冲突
}

export interface CandidateLeg {
  legId: string;
  start: number;
  end: number;
}

export interface ChainResult {
  chains: { start: number; end: number; totalMs: number }[];
  maxMs: number;
  exceeded: boolean;
}

/**
 * 计算司机连续在途链：
 * 相邻占用段间隔不足 BREAK_GAP_MS（30 分钟）视为未休息、连续在途；
 * 任一链累计（含待派的候选段）超过 4 小时即不能再接下段。
 */
export function driverChains(
  data: DispatchState,
  driverId: string,
  candidate?: CandidateLeg,
  excludeLegId?: string
): ChainResult {
  const intervals: Interval[] = data.legs
    .filter((leg) => leg.driverId === driverId && isOccupying(leg.status) && leg.id !== excludeLegId)
    .map(legInterval)
    .filter((v): v is Interval => v !== null);

  if (candidate) {
    intervals.push({ legId: candidate.legId, start: candidate.start, end: candidate.end, status: "assigned" });
  }

  intervals.sort((a, b) => a.start - b.start);

  const chains: { start: number; end: number; totalMs: number }[] = [];
  for (const iv of intervals) {
    const dur = iv.end - iv.start;
    const last = chains[chains.length - 1];
    if (last && iv.start - last.end < BREAK_GAP_MS) {
      last.end = Math.max(last.end, iv.end);
      last.totalMs += dur;
    } else {
      chains.push({ start: iv.start, end: iv.end, totalMs: dur });
    }
  }

  const maxMs = chains.reduce((m, c) => Math.max(m, c.totalMs), 0);
  return { chains, maxMs, exceeded: maxMs > FOUR_HOURS_MS };
}

export function formatHours(ms: number): string {
  return `${(ms / 3_600_000).toFixed(2)} 小时`;
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function nowLocalInput(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
