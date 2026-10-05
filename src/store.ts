import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type {
  Driver,
  Persisted,
  RelayKind,
  RelayOrder,
  Segment,
  SnapshotState,
  Task,
  TaskStatus,
  Vehicle
} from "./types";

export const STORAGE_KEY = "dfwlfront-3-dispatch";
/** 司机连续在途上限：4 小时，达到后不能再接下段 */
export const MAX_ONROAD_MINUTES = 4 * 60;

function uid() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function fmtMinutes(min: number) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}小时${m > 0 ? `${m}分` : ""}` : `${m}分`;
}

/** 段的计划时长（分钟），用于司机连续在途计时 */
export function plannedMinutes(seg: Segment) {
  if (!seg.planStart || !seg.planEnd) return 60;
  const ms = new Date(seg.planEnd).getTime() - new Date(seg.planStart).getTime();
  return ms > 0 ? Math.max(1, Math.round(ms / 60000)) : 60;
}

function blankSegment(taskId: string, seq: number, from: string, to: string): Segment {
  return {
    id: uid(),
    taskId,
    seq,
    from,
    to,
    status: "待派车",
    vehicleId: null,
    driverId: null,
    planStart: null,
    planEnd: null,
    departAt: null,
    arriveAt: null,
    relayReason: null,
    needHandover: false
  };
}

function seedState(): SnapshotState {
  const now = Date.now();
  const iso = (t: number) => new Date(t).toISOString();
  const vehicles: Vehicle[] = [
    { id: "veh-a", plate: "沪A-82L6", status: "空闲", note: "可立即派车" },
    { id: "veh-b", plate: "沪B-73K9", status: "执行中", note: "商超补货任务在途" },
    { id: "veh-c", plate: "沪C-51M2", status: "检修", note: "发动机检修，暂停排班" },
    { id: "veh-d", plate: "沪D-66Q8", status: "空闲", note: "可立即派车" }
  ];
  const drivers: Driver[] = [
    { id: "drv-dong", name: "董飞", status: "空闲", onRoadMinutes: 0 },
    { id: "drv-zhou", name: "周航", status: "在途", onRoadMinutes: 150 },
    { id: "drv-chen", name: "陈默", status: "休息", onRoadMinutes: 260 },
    { id: "drv-lin", name: "林岚", status: "空闲", onRoadMinutes: 0 }
  ];
  const tasks: Task[] = [
    { id: "task-buhuo", name: "商超补货", zone: "城北", stations: ["集配仓", "城北站", "大学城站"], createdAt: iso(now - 26 * 3600e3) },
    { id: "task-yiyao", name: "医药配送", zone: "城东", stations: ["集配仓", "人民医院", "高新区站"], createdAt: iso(now - 5 * 3600e3) }
  ];
  const segB1: Segment = {
    ...blankSegment("task-buhuo", 1, "集配仓", "城北站"),
    status: "在途",
    vehicleId: "veh-b",
    driverId: "drv-zhou",
    planStart: iso(now - 2 * 3600e3),
    planEnd: iso(now + 30 * 60e3),
    departAt: iso(now - 2 * 3600e3)
  };
  const segB2: Segment = {
    ...blankSegment("task-buhuo", 2, "城北站", "大学城站"),
    status: "待出发",
    vehicleId: "veh-b",
    driverId: "drv-zhou",
    planStart: iso(now + 3600e3),
    planEnd: iso(now + 3 * 3600e3)
  };
  const segments: Segment[] = [
    segB1,
    segB2,
    blankSegment("task-yiyao", 1, "集配仓", "人民医院"),
    blankSegment("task-yiyao", 2, "人民医院", "高新区站")
  ];
  return { vehicles, drivers, tasks, segments, relays: [] };
}

export const useDispatchStore = defineStore("dispatch", () => {
  const vehicles = ref<Vehicle[]>([]);
  const drivers = ref<Driver[]>([]);
  const tasks = ref<Task[]>([]);
  const segments = ref<Segment[]>([]);
  const relays = ref<RelayOrder[]>([]);
  /** 当前内存数据基于的存储版本，保存时比对，不一致说明他人已先提交 */
  const revision = ref(0);
  const savedAt = ref("");
  const notice = ref("");
  const conflictMsg = ref("");

  let flashTimer: ReturnType<typeof setTimeout> | undefined;
  function flash(kind: "notice" | "conflict", msg: string) {
    if (kind === "notice") notice.value = msg;
    else conflictMsg.value = msg;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      notice.value = "";
      conflictMsg.value = "";
    }, 6000);
  }

  function snapshot(): SnapshotState {
    return JSON.parse(
      JSON.stringify({
        vehicles: vehicles.value,
        drivers: drivers.value,
        tasks: tasks.value,
        segments: segments.value,
        relays: relays.value
      })
    ) as SnapshotState;
  }

  function apply(state: SnapshotState) {
    vehicles.value = state.vehicles;
    drivers.value = state.drivers;
    tasks.value = state.tasks;
    segments.value = state.segments;
    relays.value = state.relays;
  }

  function restoreFrom(p: Persisted) {
    apply(p.state);
    revision.value = p.revision;
    savedAt.value = p.savedAt;
  }

  function load() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const p = JSON.parse(raw) as Persisted;
        if (p && typeof p.revision === "number" && p.state && Array.isArray(p.state.vehicles) && Array.isArray(p.state.segments)) {
          restoreFrom(p);
          return;
        }
      } catch {
        // 记录损坏时落到种子数据，保证页面可继续
      }
    }
    const seed = seedState();
    apply(seed);
    const p: Persisted = { revision: 1, savedAt: new Date().toISOString(), state: seed };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
    } catch {
      // 存储不可用时仅保留内存态
    }
    revision.value = 1;
    savedAt.value = p.savedAt;
  }

  /**
   * 乐观并发提交：两人同时派车时先到的一方保留；
   * 版本不一致说明他人已先写入，本次保存失败，从最近完整记录恢复。
   */
  function commit(): boolean {
    let stored: Persisted | null = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) stored = JSON.parse(raw) as Persisted;
    } catch {
      stored = null;
    }
    if (stored && typeof stored.revision === "number" && stored.revision !== revision.value) {
      restoreFrom(stored);
      flash("conflict", "保存失败：另一调度员已先提交，已从最近完整记录恢复");
      return false;
    }
    const next: Persisted = { revision: revision.value + 1, savedAt: new Date().toISOString(), state: snapshot() };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      if (stored && stored.state) restoreFrom(stored);
      flash("conflict", "保存失败：本地存储不可用，已从最近完整记录恢复");
      return false;
    }
    revision.value = next.revision;
    savedAt.value = next.savedAt;
    return true;
  }

  load();

  // 另一个标签页（另一位调度员）提交后，同步最近完整记录
  if (typeof window !== "undefined") {
    window.addEventListener("storage", (event) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return;
      try {
        const p = JSON.parse(event.newValue) as Persisted;
        if (p && p.state && typeof p.revision === "number" && p.revision !== revision.value) {
          restoreFrom(p);
          flash("notice", "已同步其他调度员提交的最新记录");
        }
      } catch {
        // 忽略损坏数据
      }
    });
  }

  // ---------- 查询 ----------

  const relaySegments = computed(() => segments.value.filter((s) => s.status === "待接力"));

  const metrics = computed(() => ({
    vehicles: vehicles.value.length,
    onRoad: segments.value.filter((s) => s.status === "在途").length,
    relay: relaySegments.value.length,
    idleVehicles: vehicles.value.filter((v) => v.status === "空闲").length
  }));

  function segmentsOf(taskId: string) {
    return segments.value.filter((s) => s.taskId === taskId).sort((a, b) => a.seq - b.seq);
  }

  function relaysOf(taskId: string) {
    return relays.value.filter((r) => r.taskId === taskId);
  }

  function taskName(taskId: string) {
    return tasks.value.find((t) => t.id === taskId)?.name ?? "未知任务";
  }

  function taskStatus(taskId: string): TaskStatus {
    const segs = segmentsOf(taskId);
    if (segs.length > 0 && segs.every((s) => s.status === "已到达")) return "已完成";
    if (segs.every((s) => s.status === "待派车")) return "待调度";
    return "进行中";
  }

  function activeSegmentsOfVehicle(vehicleId: string) {
    return segments.value.filter((s) => s.vehicleId === vehicleId && (s.status === "待出发" || s.status === "在途"));
  }

  function activeSegmentsOfDriver(driverId: string) {
    return segments.value.filter((s) => s.driverId === driverId && (s.status === "待出发" || s.status === "在途"));
  }

  // ---------- 内部辅助 ----------

  function pushRelay(seg: Segment, kind: RelayKind, detail: string, reason: string) {
    relays.value.unshift({
      id: uid(),
      taskId: seg.taskId,
      segmentId: seg.id,
      seq: seg.seq,
      kind,
      detail,
      reason,
      at: new Date().toISOString()
    });
  }

  function refreshVehicleStatus(vehicle: Vehicle) {
    if (vehicle.status === "检修") return;
    vehicle.status = activeSegmentsOfVehicle(vehicle.id).length > 0 ? "执行中" : "空闲";
  }

  /** 未出发的段退回待接力区并写清原因，原绑定记入接力单 */
  function bounceSegment(seg: Segment, reason: string) {
    const vehicle = seg.vehicleId ? vehicles.value.find((v) => v.id === seg.vehicleId) : undefined;
    const driver = seg.driverId ? drivers.value.find((d) => d.id === seg.driverId) : undefined;
    pushRelay(
      seg,
      "退回待接力",
      `第${seg.seq}段 ${seg.from}→${seg.to} 退回待接力区（原绑定：${vehicle?.plate ?? "未派车"} / ${driver?.name ?? "未派车"}）`,
      reason
    );
    seg.status = "待接力";
    seg.relayReason = reason;
    seg.vehicleId = null;
    seg.driverId = null;
    seg.planStart = null;
    seg.planEnd = null;
    if (vehicle) refreshVehicleStatus(vehicle);
  }

  function bounceDriverSegments(driverId: string, reason: string) {
    for (const seg of segments.value) {
      if (seg.driverId === driverId && seg.status === "待出发") bounceSegment(seg, reason);
    }
  }

  // ---------- 动作（验证 → 变更 → 提交，保存失败自动恢复） ----------

  function addTask(name: string, zone: string, stationsText: string): string | null {
    if (!name.trim()) return "请填写任务名称";
    const stations = stationsText.split(/[\s,，、;；→>|-]+/).map((s) => s.trim()).filter(Boolean);
    if (stations.length < 2) return "至少填写两个站点才能拆段";
    const task: Task = { id: uid(), name: name.trim(), zone, stations, createdAt: new Date().toISOString() };
    tasks.value.unshift(task);
    stations.slice(0, -1).forEach((from, i) => {
      segments.value.push(blankSegment(task.id, i + 1, from, stations[i + 1]));
    });
    if (!commit()) return "保存冲突，已从最近完整记录恢复";
    flash("notice", `任务「${task.name}」已创建，按站点拆为 ${stations.length - 1} 段`);
    return null;
  }

  function addVehicle(plate: string): string | null {
    const p = plate.trim();
    if (!p) return "请填写车牌号";
    if (vehicles.value.some((v) => v.plate === p)) return "车牌已存在";
    vehicles.value.push({ id: uid(), plate: p, status: "空闲", note: "新登记车辆" });
    if (!commit()) return "保存冲突，已从最近完整记录恢复";
    flash("notice", `车辆 ${p} 已登记`);
    return null;
  }

  function addDriver(name: string): string | null {
    const n = name.trim();
    if (!n) return "请填写司机姓名";
    if (drivers.value.some((d) => d.name === n)) return "司机已存在";
    drivers.value.push({ id: uid(), name: n, status: "空闲", onRoadMinutes: 0 });
    if (!commit()) return "保存冲突，已从最近完整记录恢复";
    flash("notice", `司机 ${n} 已登记`);
    return null;
  }

  /** 派车/改派：段绑定车辆、司机和起止时段 */
  function assignSegment(segmentId: string, vehicleId: string, driverId: string, planStart: string, planEnd: string): string | null {
    const seg = segments.value.find((s) => s.id === segmentId);
    if (!seg) return "段不存在";
    if (seg.status !== "待派车" && seg.status !== "待接力") return "当前段状态不能派车";
    const vehicle = vehicles.value.find((v) => v.id === vehicleId);
    const driver = drivers.value.find((d) => d.id === driverId);
    if (!vehicle) return "请选择车辆";
    if (!driver) return "请选择司机";
    if (vehicle.status === "检修") return `车辆 ${vehicle.plate} 检修中，不能重新排入`;
    if (driver.status === "休息" || driver.onRoadMinutes >= MAX_ONROAD_MINUTES) {
      return `司机 ${driver.name} 连续在途已超过4小时，不能再接下段`;
    }
    if (!planStart || !planEnd) return "请填写起止时段";
    if (new Date(planEnd).getTime() <= new Date(planStart).getTime()) return "结束时间必须晚于开始时间";
    const relayReason = seg.relayReason;
    const wasRelay = seg.status === "待接力";
    seg.vehicleId = vehicle.id;
    seg.driverId = driver.id;
    seg.planStart = planStart;
    seg.planEnd = planEnd;
    seg.relayReason = null;
    seg.status = "待出发";
    vehicle.status = "执行中";
    if (wasRelay) {
      pushRelay(seg, "改派", `第${seg.seq}段 ${seg.from}→${seg.to} 改派 ${vehicle.plate} / ${driver.name}（${fmtTimeShort(planStart)}~${fmtTimeShort(planEnd)}）`, relayReason ?? "待接力段重新派车");
    }
    if (!commit()) return "保存冲突，已从最近完整记录恢复";
    flash("notice", `第${seg.seq}段已派车：${vehicle.plate} / ${driver.name}`);
    return null;
  }

  function departSegment(segmentId: string): string | null {
    const seg = segments.value.find((s) => s.id === segmentId);
    if (!seg) return "段不存在";
    if (seg.status !== "待出发") return "仅待出发的段可以出发";
    const vehicle = seg.vehicleId ? vehicles.value.find((v) => v.id === seg.vehicleId) : undefined;
    const driver = seg.driverId ? drivers.value.find((d) => d.id === seg.driverId) : undefined;
    if (vehicle && vehicle.status === "检修") return `车辆 ${vehicle.plate} 检修中，不能出发，请改派`;
    if (driver && (driver.status === "休息" || driver.onRoadMinutes >= MAX_ONROAD_MINUTES)) {
      return `司机 ${driver.name} 连续在途已超过4小时，不能出发，请改派`;
    }
    seg.status = "在途";
    seg.departAt = new Date().toISOString();
    if (driver) driver.status = "在途";
    if (vehicle) vehicle.status = "执行中";
    if (!commit()) return "保存冲突，已从最近完整记录恢复";
    flash("notice", `第${seg.seq}段 ${seg.from}→${seg.to} 已出发`);
    return null;
  }

  /** 到站登记：累计司机连续在途，超4小时自动休息并退回其未出发段；需交接的段在此交接 */
  function arriveSegment(segmentId: string): string | null {
    const seg = segments.value.find((s) => s.id === segmentId);
    if (!seg) return "段不存在";
    if (seg.status !== "在途") return "仅在途的段可以到站登记";
    seg.status = "已到达";
    seg.arriveAt = new Date().toISOString();
    const driver = seg.driverId ? drivers.value.find((d) => d.id === seg.driverId) : undefined;
    if (driver) {
      driver.onRoadMinutes += plannedMinutes(seg);
      if (driver.onRoadMinutes >= MAX_ONROAD_MINUTES && driver.status !== "休息") {
        driver.status = "休息";
        bounceDriverSegments(driver.id, `司机 ${driver.name} 连续在途 ${fmtMinutes(driver.onRoadMinutes)}，超过4小时上限`);
      } else if (driver.status !== "休息" && !segments.value.some((s) => s.driverId === driver.id && s.status === "在途")) {
        driver.status = "空闲";
      }
    }
    const vehicle = seg.vehicleId ? vehicles.value.find((v) => v.id === seg.vehicleId) : undefined;
    if (seg.needHandover) {
      seg.needHandover = false;
      pushRelay(
        seg,
        "到站交接",
        `第${seg.seq}段到达 ${seg.to}，原绑定 ${vehicle?.plate ?? "无"} / ${driver?.name ?? "无"} 完成到站交接`,
        seg.relayReason ?? "车辆或司机不可用，到站后交接"
      );
      seg.relayReason = null;
    }
    if (vehicle) refreshVehicleStatus(vehicle);
    if (!commit()) return "保存冲突，已从最近完整记录恢复";
    flash("notice", `第${seg.seq}段已到站登记${driver ? `，${driver.name} 连续在途 ${fmtMinutes(driver.onRoadMinutes)}` : ""}`);
    return null;
  }

  /** 标记/解除检修：未出发段退回待接力区，在途段保留原绑定待到站交接 */
  function toggleMaintenance(vehicleId: string): string | null {
    const vehicle = vehicles.value.find((v) => v.id === vehicleId);
    if (!vehicle) return "车辆不存在";
    if (vehicle.status === "检修") {
      vehicle.status = "空闲";
      vehicle.note = "检修完成，恢复可用";
      refreshVehicleStatus(vehicle);
      if (!commit()) return "保存冲突，已从最近完整记录恢复";
      flash("notice", `车辆 ${vehicle.plate} 已恢复（当前${vehicle.status}）`);
      return null;
    }
    const reason = `车辆 ${vehicle.plate} 检修，不能继续排班`;
    let bounced = 0;
    let kept = 0;
    for (const seg of segments.value) {
      if (seg.vehicleId !== vehicle.id) continue;
      if (seg.status === "待出发") {
        bounceSegment(seg, reason);
        bounced++;
      } else if (seg.status === "在途") {
        seg.needHandover = true;
        seg.relayReason = reason;
        kept++;
      }
    }
    vehicle.status = "检修";
    vehicle.note = "检修中，暂停排班";
    if (!commit()) return "保存冲突，已从最近完整记录恢复";
    flash("notice", `车辆 ${vehicle.plate} 已标记检修：${bounced} 个未出发段退回待接力区，${kept} 个在途段保留原绑定待到站交接`);
    return null;
  }

  /** 司机不可用：未出发段退回待接力区，在途段保留原绑定待到站交接 */
  function markDriverRest(driverId: string): string | null {
    const driver = drivers.value.find((d) => d.id === driverId);
    if (!driver) return "司机不存在";
    if (driver.status === "休息") return "司机已在休息中";
    const reason = `司机 ${driver.name} 不可用（休息）`;
    let bounced = 0;
    let kept = 0;
    for (const seg of segments.value) {
      if (seg.driverId !== driver.id) continue;
      if (seg.status === "待出发") {
        bounceSegment(seg, reason);
        bounced++;
      } else if (seg.status === "在途") {
        seg.needHandover = true;
        seg.relayReason = reason;
        kept++;
      }
    }
    driver.status = "休息";
    if (!commit()) return "保存冲突，已从最近完整记录恢复";
    flash("notice", `司机 ${driver.name} 已标记休息：${bounced} 个未出发段退回待接力区，${kept} 个在途段保留原绑定待到站交接`);
    return null;
  }

  /** 休息复位：连续在途清零，可重新接段 */
  function resetDriver(driverId: string): string | null {
    const driver = drivers.value.find((d) => d.id === driverId);
    if (!driver) return "司机不存在";
    if (segments.value.some((s) => s.driverId === driver.id && s.status === "在途")) return "司机仍在途，到站登记后才能复位";
    driver.onRoadMinutes = 0;
    driver.status = "空闲";
    if (!commit()) return "保存冲突，已从最近完整记录恢复";
    flash("notice", `司机 ${driver.name} 已休息复位，连续在途清零`);
    return null;
  }

  return {
    vehicles,
    drivers,
    tasks,
    segments,
    relays,
    revision,
    savedAt,
    notice,
    conflictMsg,
    metrics,
    relaySegments,
    segmentsOf,
    relaysOf,
    taskName,
    taskStatus,
    activeSegmentsOfVehicle,
    activeSegmentsOfDriver,
    addTask,
    addVehicle,
    addDriver,
    assignSegment,
    departSegment,
    arriveSegment,
    toggleMaintenance,
    markDriverRest,
    resetDriver
  };
});

function fmtTimeShort(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
