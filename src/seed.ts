import type { DispatchState, Leg, LegStatus, Task, Vehicle, Driver } from "./types";

export const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
/** 相邻两段间隔达到该时长视为已休息，连续在途重新起算 */
export const BREAK_GAP_MS = 30 * 60 * 1000;

function isoTodayAt(hour: number, minute = 0): string {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  // datetime-local 格式
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hour)}:${pad(minute)}`;
}

export function seedState(): DispatchState {
  const vehicles: Vehicle[] = [
    { id: "v1", plate: "沪A-82L6", model: "9.6米厢车", underMaintenance: false, maintenanceReason: "" },
    { id: "v2", plate: "沪B-73K9", model: "冷藏车", underMaintenance: false, maintenanceReason: "" },
    { id: "v3", plate: "沪C-15D2", model: "7.8米厢车", underMaintenance: true, maintenanceReason: "制动片异响，进厂检修" },
    { id: "v4", plate: "沪D-90F8", model: "4.2米轻卡", underMaintenance: false, maintenanceReason: "" }
  ];

  const drivers: Driver[] = [
    { id: "d1", name: "董飞", phone: "13800001111", unavailable: false, unavailableReason: "" },
    { id: "d2", name: "周航", phone: "13800002222", unavailable: false, unavailableReason: "" },
    { id: "d3", name: "李磊", phone: "13800003333", unavailable: false, unavailableReason: "" },
    { id: "d4", name: "王珂", phone: "13800004444", unavailable: true, unavailableReason: "家中急事请假两天" }
  ];

  const task: Task = {
    id: "t1",
    name: "沪宁线医药冷链配送",
    cargo: "冷藏药品 6.2 吨",
    stations: ["上海嘉定仓", "昆山中转站", "苏州园区站", "无锡惠山站", "常州新北仓"],
    createdAt: new Date().toISOString()
  };

  const mkLeg = (
    seq: number,
    status: LegStatus,
    extra: Partial<Leg>
  ): Leg => ({
    id: `t1-l${seq}`,
    taskId: "t1",
    seq,
    fromStation: task.stations[seq - 1],
    toStation: task.stations[seq],
    status,
    vehicleId: null,
    driverId: null,
    startAt: null,
    endAt: null,
    departedAt: null,
    arrivedAt: null,
    dispatchNo: 0,
    returnReason: null,
    updatedAt: new Date().toISOString(),
    ...extra
  });

  const legs: Leg[] = [
    mkLeg(1, "arrived", {
      vehicleId: "v2",
      driverId: "d2",
      startAt: isoTodayAt(7, 0),
      endAt: isoTodayAt(8, 40),
      departedAt: isoTodayAt(7, 2),
      arrivedAt: isoTodayAt(8, 46)
    }),
    mkLeg(2, "departed", {
      vehicleId: "v2",
      driverId: "d2",
      startAt: isoTodayAt(9, 0),
      endAt: isoTodayAt(10, 50),
      departedAt: isoTodayAt(9, 5)
    }),
    mkLeg(3, "assigned", {
      vehicleId: "v1",
      driverId: "d1",
      startAt: isoTodayAt(11, 10),
      endAt: isoTodayAt(12, 40),
      dispatchNo: 1
    }),
    mkLeg(4, "pending", {}),
    mkLeg(5, "returned", {
      returnReason: "原派司机王珂请假不可用，退回待接力区"
    })
  ];

  return {
    vehicles,
    drivers,
    tasks: [task],
    legs,
    logs: [
      {
        id: "log-seed-1",
        at: isoTodayAt(7, 2),
        type: "dispatch",
        operator: "调度员A",
        taskId: "t1",
        legId: "t1-l1",
        vehicleId: "v2",
        driverId: "d2",
        message: "第1段 上海嘉定仓→昆山中转站 派给 沪B-73K9/周航",
        baseVersion: null
      },
      {
        id: "log-seed-2",
        at: isoTodayAt(9, 5),
        type: "depart",
        operator: "调度员A",
        taskId: "t1",
        legId: "t1-l2",
        vehicleId: "v2",
        driverId: "d2",
        message: "第2段 昆山中转站→苏州园区站 已出发",
        baseVersion: null
      }
    ],
    dispatchSeq: 1
  };
}
