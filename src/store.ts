import { defineStore } from "pinia";
import type {
  ActionResult,
  DispatchState,
  Driver,
  HandoverLog,
  Leg,
  RootState,
  Task,
  Vehicle
} from "./types";
import { loadCurrent, restoreFromLatestSnapshot, saveAll } from "./storage";
import { seedState } from "./seed";
import {
  driverChains,
  formatHours,
  intervalsOverlap,
  isOccupying,
  legInterval,
  toMs
} from "./rules";

const MAX_LOGS = 300;

type LogInput = Omit<
  HandoverLog,
  "id" | "at" | "baseVersion" | "taskId" | "legId" | "vehicleId" | "driverId"
> &
  Partial<Pick<HandoverLog, "taskId" | "legId" | "vehicleId" | "driverId">>;

function appendLog(draft: DispatchState, log: LogInput, baseVersion: number) {
  const entry: HandoverLog = {
    ...{ taskId: null, legId: null, vehicleId: null, driverId: null },
    ...log,
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    baseVersion
  };
  draft.logs = [entry, ...draft.logs].slice(0, MAX_LOGS);
}

/** 把未出发段退回并写原因（车辆/司机变不可用时自动触发）；已出发/已到站段保留原绑定 */
function releaseAssignedLegs(
  draft: DispatchState,
  rootVersion: number,
  predicate: (l: Leg) => boolean,
  reason: (l: Leg) => string
) {
  for (const l of draft.legs) {
    if (l.status === "assigned" && predicate(l)) {
      const fullReason = reason(l);
      l.status = "returned";
      l.returnReason = fullReason;
      l.vehicleId = null;
      l.driverId = null;
      l.startAt = null;
      l.endAt = null;
      l.dispatchNo = 0;
      l.updatedAt = new Date().toISOString();
      appendLog(
        draft,
        {
          type: "return",
          operator: "系统",
          taskId: l.taskId,
          legId: l.id,
          message: `第${l.seq}段 未出发，${fullReason}，自动退回待接力区`
        },
        rootVersion
      );
    }
    // 在途段保留原绑定，仅记录，待下一站到站登记后交接；已到站段无需处理
    if (l.status === "departed" && predicate(l)) {
      appendLog(
        draft,
        {
          type: "maintenance",
          operator: "系统",
          taskId: l.taskId,
          legId: l.id,
          message: `第${l.seq}段 已出发，保留原绑定；${reason(l)}，车辆/司机待本站到站登记后再交接`
        },
        rootVersion
      );
    }
  }
}

function newRoot(): RootState {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    data: seedState()
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

interface DispatchPayload {
  legId: string;
  vehicleId: string;
  driverId: string;
  startAt: string;
  endAt: string;
  operator: string;
  /** 打开派车面板时该段的派车批次；在途期间别人已改派则本提交失效（先到先得） */
  ticket: number;
}

export const useDispatchStore = defineStore("dispatch", {
  state: () => ({
    root: loadCurrent() ?? newRoot(),
    committing: false,
    lastError: "",
    lastRestoredVersion: 0 as number | null
  }),

  getters: {
    data(state): DispatchState {
      return state.root.data;
    },
    vehicleById: (state) => (id: string | null) =>
      id ? state.root.data.vehicles.find((v) => v.id === id) ?? null : null,
    driverById: (state) => (id: string | null) =>
      id ? state.root.data.drivers.find((d) => d.id === id) ?? null : null,
    taskById: (state) => (id: string) =>
      state.root.data.tasks.find((t) => t.id === id) ?? null,
    legsOfTask: (state) => (taskId: string) =>
      state.root.data.legs
        .filter((leg) => leg.taskId === taskId)
        .sort((a, b) => a.seq - b.seq),
    pendingLegs(state): Leg[] {
      return state.root.data.legs
        .filter((leg) => leg.status === "pending" || leg.status === "returned")
        .sort((a, b) => a.taskId.localeCompare(b.taskId) || a.seq - b.seq);
    },
    logsOfTask: (state) => (taskId: string) =>
      state.root.data.logs.filter((log) => log.taskId === taskId),
    metrics(state) {
      const d = state.root.data;
      return {
        vehiclesTotal: d.vehicles.length,
        vehiclesBusy: d.vehicles.filter((v) =>
          d.legs.some((l) => l.vehicleId === v.id && isOccupying(l.status))
        ).length,
        vehiclesMaintenance: d.vehicles.filter((v) => v.underMaintenance).length,
        driversUnavailable: d.drivers.filter((dr) => dr.unavailable).length,
        legsDeparted: d.legs.filter((l) => l.status === "departed").length,
        legsWaiting: d.legs.filter((l) => l.status === "pending" || l.status === "returned").length
      };
    }
  },

  actions: {
    /* ---------------- 保存与恢复 ---------------- */

    /**
     * 提交变更：先在内存应用，再做完整保存。
     * 保存失败立即从最近完整记录恢复，本次变更作废。
     */
    commit(operator: string, message: string, mutate: (draft: DispatchState) => void): ActionResult {
      if (this.committing) {
        return { ok: false, message: "另一个派车提交正在保存，请稍候", conflict: true };
      }
      const backup = clone(this.root);
      const baseVersion = this.root.version;
      this.committing = true;
      try {
        const draft = this.root.data;
        mutate(draft);

        if (message) {
          const log: HandoverLog = {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            type: "system",
            operator,
            taskId: null,
            legId: null,
            vehicleId: null,
            driverId: null,
            message,
            baseVersion
          };
          draft.logs = [log, ...draft.logs].slice(0, MAX_LOGS);
        }

        this.root.version += 1;
        this.root.updatedAt = new Date().toISOString();

        saveAll(this.root); // 抛错即回滚
        return { ok: true, message };
      } catch (err) {
        // 保存失败：从最近完整记录恢复
        const restored = restoreFromLatestSnapshot();
        if (restored) {
          this.root = restored;
          this.lastRestoredVersion = restored.version;
        } else {
          this.root = backup;
        }
        const reason = err instanceof Error ? err.message : String(err);
        this.lastError = reason;
        return { ok: false, message: `保存失败，已从最近完整记录恢复（v${this.root.version}）：${reason}` };
      } finally {
        this.committing = false;
      }
    },

    /* ---------------- 派车（段绑定车/人/时段） ---------------- */

    validateDispatch(d: DispatchState, p: Omit<DispatchPayload, "operator">): string | null {
      const leg = d.legs.find((l) => l.id === p.legId);
      if (!leg) return "接力段不存在";
      if (leg.status !== "pending" && leg.status !== "returned" && leg.status !== "assigned") {
        return "该段已出发或已到站，改派须等到站登记后再交接";
      }
      // 先到先得：打开面板后该段已被别人成功派车
      if (leg.status === "assigned" && leg.dispatchNo !== 0 && p.ticket !== null && p.ticket !== leg.dispatchNo) {
        const v = this.vehicleById(leg.vehicleId);
        const dr = this.driverById(leg.driverId);
        return `该段已被其他调度员先派给 ${v?.plate ?? "?"} / ${dr?.name ?? "?"}，先到的一方保留`;
      }
      const start = toMs(p.startAt);
      const end = toMs(p.endAt);
      if (start === null || end === null) return "请填写起止时段";
      if (end <= start) return "结束时间必须晚于开始时间";

      const vehicle = d.vehicles.find((v) => v.id === p.vehicleId);
      const driver = d.drivers.find((dr) => dr.id === p.driverId);
      if (!vehicle) return "请选择车辆";
      if (!driver) return "请选择司机";
      if (vehicle.underMaintenance) return `车辆 ${vehicle.plate} 检修中（${vehicle.maintenanceReason || "原因未填"}），不能排入`;
      if (driver.unavailable) return `司机 ${driver.name} 不可用（${driver.unavailableReason || "原因未填"}），不能排班`;

      const candidate = { legId: leg.id, start, end };

      // 车辆时段冲突（含同一车辆其它已绑定段，端点相接允许）
      const vehicleClash = d.legs.find(
        (l) =>
          l.id !== leg.id &&
          l.vehicleId === vehicle.id &&
          isOccupying(l.status) &&
          (() => {
            const iv = legInterval(l);
            return iv && intervalsOverlap(iv, { legId: leg.id, start, end, status: "assigned" });
          })()
      );
      if (vehicleClash) return `车辆 ${vehicle.plate} 该时段已占用（第${vehicleClash.seq}段）`;

      // 司机时段冲突
      const driverClash = d.legs.find(
        (l) =>
          l.id !== leg.id &&
          l.driverId === driver.id &&
          isOccupying(l.status) &&
          (() => {
            const iv = legInterval(l);
            return iv && intervalsOverlap(iv, { legId: leg.id, start, end, status: "assigned" });
          })()
      );
      if (driverClash) return `司机 ${driver.name} 该时段已有任务（第${driverClash.seq}段），无法同时出车`;

      // 连续在途 > 4 小时不能再接下段
      const chains = driverChains(d, driver.id, candidate, leg.id);
      if (chains.exceeded) {
        return `司机 ${driver.name} 连续在途将达 ${formatHours(chains.maxMs)}，超过 4 小时上限，不能再接该段，请安排接力司机`;
      }

      return null;
    },

    dispatchLeg(payload: DispatchPayload): ActionResult {
      const invalid = this.validateDispatch(this.root.data, payload);
      if (invalid) return { ok: false, message: invalid, conflict: true };

      if (this.committing) {
        return { ok: false, message: "另一个派车提交正在保存，请稍候", conflict: true };
      }
      const backup = clone(this.root);
      const baseVersion = this.root.version;
      this.committing = true;
      try {
        // 在提交瞬间再校验一次，保证两人同时提交时先到的一方保留
        const recheck = this.validateDispatch(this.root.data, payload);
        if (recheck) return { ok: false, message: recheck, conflict: true };

        const d = this.root.data;
        const leg = d.legs.find((l) => l.id === payload.legId)!;
        const wasReturned = leg.status === "returned";
        d.dispatchSeq += 1;
        const vehicle = d.vehicles.find((v) => v.id === payload.vehicleId)!;
        const driver = d.drivers.find((dr) => dr.id === payload.driverId)!;

        leg.vehicleId = payload.vehicleId;
        leg.driverId = payload.driverId;
        leg.startAt = payload.startAt;
        leg.endAt = payload.endAt;
        leg.status = "assigned";
        leg.returnReason = null;
        leg.dispatchNo = d.dispatchSeq;
        leg.updatedAt = new Date().toISOString();

        appendLog(
          d,
          {
            type: "dispatch",
            operator: payload.operator,
            taskId: leg.taskId,
            legId: leg.id,
            vehicleId: vehicle.id,
            driverId: driver.id,
            message: `第${leg.seq}段 ${leg.fromStation}→${leg.toStation} 派给 ${vehicle.plate}/${driver.name}（${payload.startAt.replace("T", " ")} ~ ${payload.endAt.replace("T", " ")}）${wasReturned ? "，自待接力区改派" : ""}`
          },
          baseVersion
        );

        this.root.version += 1;
        this.root.updatedAt = new Date().toISOString();
        saveAll(this.root);
        return { ok: true, message: "派车成功" };
      } catch (err) {
        const restored = restoreFromLatestSnapshot();
        if (restored) {
          this.root = restored;
          this.lastRestoredVersion = restored.version;
        } else {
          this.root = backup;
        }
        const reason = err instanceof Error ? err.message : String(err);
        this.lastError = reason;
        return { ok: false, message: `保存失败，已从最近完整记录恢复（v${this.root.version}）：${reason}` };
      } finally {
        this.committing = false;
      }
    },

    /* ---------------- 出发 / 到站登记 ---------------- */

    departLeg(legId: string, operator: string): ActionResult {
      const leg = this.root.data.legs.find((l) => l.id === legId);
      if (!leg) return { ok: false, message: "段不存在" };
      if (leg.status !== "assigned") return { ok: false, message: "只有已派车未出发的段可以登记出发" };
      // 顺序约束：前一段须已到站（在到站站点交接）
      const prev = this.root.data.legs
        .filter((l) => l.taskId === leg.taskId && l.seq === leg.seq - 1)[0];
      if (prev && prev.status !== "arrived") {
        return { ok: false, message: `上一段（第${prev.seq}段）尚未到站登记，不能在该站交接出发` };
      }
      return this.commit(operator, "", (draft) => {
        const l = draft.legs.find((x) => x.id === legId)!;
        l.status = "departed";
        l.departedAt = new Date().toISOString();
        l.updatedAt = new Date().toISOString();
        appendLog(
          draft,
          {
            type: "depart",
            operator,
            taskId: l.taskId,
            legId: l.id,
            vehicleId: l.vehicleId,
            driverId: l.driverId,
            message: `第${l.seq}段 ${l.fromStation}→${l.toStation} 已出发，绑定冻结，改派须等到站登记`
          },
          this.root.version
        );
      });
    },

    arriveLeg(legId: string, operator: string): ActionResult {
      const leg = this.root.data.legs.find((l) => l.id === legId);
      if (!leg) return { ok: false, message: "段不存在" };
      if (leg.status !== "departed") return { ok: false, message: "只有在途段可以做到站登记" };
      return this.commit(operator, "", (draft) => {
        const l = draft.legs.find((x) => x.id === legId)!;
        l.status = "arrived";
        l.arrivedAt = new Date().toISOString();
        l.updatedAt = new Date().toISOString();
        appendLog(
          draft,
          {
            type: "arrive",
            operator,
            taskId: l.taskId,
            legId: l.id,
            vehicleId: l.vehicleId,
            driverId: l.driverId,
            message: `第${l.seq}段 已到 ${l.toStation} 完成到站登记，车辆/司机可在此交接给下一段`
          },
          this.root.version
        );
      });
    },

    /* ---------------- 退回待接力区 ---------------- */

    /** 未出发的段手动退回 */
    returnLeg(legId: string, operator: string, reason: string): ActionResult {
      const leg = this.root.data.legs.find((l) => l.id === legId);
      if (!leg) return { ok: false, message: "段不存在" };
      if (leg.status === "departed") return { ok: false, message: "已出发段保留原绑定，改派须等到站登记后再交接" };
      if (leg.status !== "assigned") return { ok: false, message: "只有已派车未出发的段可以退回" };
      if (!reason.trim()) return { ok: false, message: "请填写退回原因" };

      return this.commit(operator, "", (draft) => {
        const l = draft.legs.find((x) => x.id === legId)!;
        const vehicle = draft.vehicles.find((v) => v.id === l.vehicleId)?.plate ?? "?";
        const driver = draft.drivers.find((dr) => dr.id === l.driverId)?.name ?? "?";
        l.status = "returned";
        l.returnReason = reason.trim();
        l.vehicleId = null;
        l.driverId = null;
        l.startAt = null;
        l.endAt = null;
        l.dispatchNo = 0;
        l.updatedAt = new Date().toISOString();
        appendLog(
          draft,
          {
            type: "return",
            operator,
            taskId: l.taskId,
            legId: l.id,
            message: `第${l.seq}段 退回待接力区：${reason.trim()}（解除 ${vehicle}/${driver}）`
          },
          this.root.version
        );
      });
    },

    /* ---------------- 车辆检修 / 司机不可用 ---------------- */

    setVehicleMaintenance(vehicleId: string, under: boolean, reason: string, operator: string): ActionResult {
      const vehicle = this.root.data.vehicles.find((v) => v.id === vehicleId);
      if (!vehicle) return { ok: false, message: "车辆不存在" };
      if (under && !reason.trim()) return { ok: false, message: "请填写检修原因" };

      return this.commit(operator, "", (draft) => {
        const v = draft.vehicles.find((x) => x.id === vehicleId)!;
        v.underMaintenance = under;
        v.maintenanceReason = under ? reason.trim() : "";
        if (under) {
          // 检修车辆不能重新排入：未出发段退回，已出发段保留
          releaseAssignedLegs(
            draft,
            this.root.version,
            (l) => l.vehicleId === vehicleId,
            () => `车辆 ${v.plate} 进入检修（${v.maintenanceReason}）`
          );
          appendLog(
            draft,
            {
              type: "maintenance",
              operator,
              taskId: null,
              legId: null,
              vehicleId: v.id,
              message: `车辆 ${v.plate} 标记检修：${v.maintenanceReason}；未出发段已退回待接力区，已出发段到站后交接`
            },
            this.root.version
          );
        }
      });
    },

    setDriverUnavailable(driverId: string, unavailable: boolean, reason: string, operator: string): ActionResult {
      const driver = this.root.data.drivers.find((d) => d.id === driverId);
      if (!driver) return { ok: false, message: "司机不存在" };
      if (unavailable && !reason.trim()) return { ok: false, message: "请填写不可用原因" };

      return this.commit(operator, "", (draft) => {
        const dr = draft.drivers.find((x) => x.id === driverId)!;
        dr.unavailable = unavailable;
        dr.unavailableReason = unavailable ? reason.trim() : "";
        if (unavailable) {
          // 司机连续在途超时等不可用：未出发段退回，已在途段保留至到站交接
          releaseAssignedLegs(
            draft,
            this.root.version,
            (l) => l.driverId === driverId,
            () => `司机 ${dr.name} 不可用（${dr.unavailableReason}）`
          );
          appendLog(
            draft,
            {
              type: "maintenance",
              operator,
              taskId: null,
              legId: null,
              driverId: dr.id,
              message: `司机 ${dr.name} 标记不可用：${dr.unavailableReason}；未出发段已退回待接力区，在途段到站登记后交接`
            },
            this.root.version
          );
        }
      });
    },

    /* ---------------- 车辆 / 司机 / 任务 维护 ---------------- */

    addVehicle(input: { plate: string; model: string }, operator: string): ActionResult {
      if (!input.plate.trim()) return { ok: false, message: "车牌号必填" };
      if (this.root.data.vehicles.some((v) => v.plate === input.plate.trim()))
        return { ok: false, message: "车牌号已存在" };
      return this.commit(operator, `新增车辆 ${input.plate.trim()}`, (draft) => {
        draft.vehicles.push({
          id: crypto.randomUUID(),
          plate: input.plate.trim(),
          model: input.model.trim() || "未登记车型",
          underMaintenance: false,
          maintenanceReason: ""
        });
      });
    },

    addDriver(input: { name: string; phone: string }, operator: string): ActionResult {
      if (!input.name.trim()) return { ok: false, message: "姓名必填" };
      return this.commit(operator, `新增司机 ${input.name.trim()}`, (draft) => {
        draft.drivers.push({
          id: crypto.randomUUID(),
          name: input.name.trim(),
          phone: input.phone.trim(),
          unavailable: false,
          unavailableReason: ""
        });
      });
    },

    createTask(input: { name: string; cargo: string; stations: string[] }, operator: string): ActionResult {
      const stations = input.stations.map((s) => s.trim()).filter(Boolean);
      if (!input.name.trim()) return { ok: false, message: "任务名称必填" };
      if (stations.length < 2) return { ok: false, message: "至少需要两个站点才能拆段" };
      const uniq = new Set(stations);
      if (uniq.size !== stations.length) return { ok: false, message: "站点不能重复" };

      return this.commit(operator, "", (draft) => {
        const taskId = crypto.randomUUID();
        const task: Task = {
          id: taskId,
          name: input.name.trim(),
          cargo: input.cargo.trim() || "未填写货物",
          stations,
          createdAt: new Date().toISOString()
        };
        draft.tasks.push(task);
        const legs: Leg[] = [];
        for (let i = 0; i < stations.length - 1; i++) {
          legs.push({
            id: crypto.randomUUID(),
            taskId,
            seq: i + 1,
            fromStation: stations[i],
            toStation: stations[i + 1],
            status: "pending",
            vehicleId: null,
            driverId: null,
            startAt: null,
            endAt: null,
            departedAt: null,
            arrivedAt: null,
            dispatchNo: 0,
            returnReason: null,
            updatedAt: new Date().toISOString()
          });
        }
        draft.legs.push(...legs);
        appendLog(
          draft,
          {
            type: "task",
            operator,
            taskId,
            legId: null,
            message: `新建任务「${task.name}」，按 ${stations.length} 个站点拆为 ${legs.length} 个接力段，全部进入待接力区`
          },
          this.root.version
        );
      });
    },

    resetAll(): ActionResult {
      this.root = newRoot();
      try {
        saveAll(this.root);
        return { ok: true, message: "已重置为演示数据" };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) };
      }
    }
  }
});

export { failureSimulator } from "./storage";
export type { Vehicle, Driver };
