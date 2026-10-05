// 车辆调度 · 接力派车领域模型

/** 段（接力单）状态 */
export type LegStatus =
  | "pending" // 待接力：尚未绑定车/人，等待派车
  | "assigned" // 已派车：绑定了车辆+司机+起止时段，尚未出发
  | "departed" // 在途：已出发，绑定冻结，改派须等到站登记
  | "arrived" // 已到站：完成到站登记，资源释放
  | "returned"; // 退回待接力区：原派车因车/人不可用被撤回

export interface Vehicle {
  id: string;
  plate: string;
  model: string;
  /** 检修中：不可重新排入任何段，已在途段保留绑定 */
  underMaintenance: boolean;
  maintenanceReason: string;
}

export interface Driver {
  id: string;
  name: string;
  phone: string;
  /** 司机不可用（请假/离岗等），已在途段保留绑定，未出发段退回 */
  unavailable: boolean;
  unavailableReason: string;
}

export interface Task {
  id: string;
  name: string;
  cargo: string;
  /** 站点顺序，段由相邻站点构成：站点0→站点1 是第1段 */
  stations: string[];
  createdAt: string;
}

export interface Leg {
  id: string;
  taskId: string;
  seq: number; // 从 1 开始
  fromStation: string;
  toStation: string;
  status: LegStatus;
  vehicleId: string | null;
  driverId: string | null;
  /** 计划起止时段（ISO 字符串，本地时间录入） */
  startAt: string | null;
  endAt: string | null;
  /** 实际出发 / 到站登记时间 */
  departedAt: string | null;
  arrivedAt: string | null;
  /** 当前绑定的派车批次，先到先得时用于判定 */
  dispatchNo: number;
  /** 被退回待接力区的原因 */
  returnReason: string | null;
  updatedAt: string;
}

export type LogType = "dispatch" | "depart" | "arrive" | "return" | "maintenance" | "task" | "system";

export interface HandoverLog {
  id: string;
  at: string;
  type: LogType;
  operator: string;
  taskId: string | null;
  legId: string | null;
  vehicleId: string | null;
  driverId: string | null;
  message: string;
  /** 提交时基于的版本号，用于核对并发 */
  baseVersion: number | null;
}

export interface DispatchState {
  vehicles: Vehicle[];
  drivers: Driver[];
  tasks: Task[];
  legs: Leg[];
  logs: HandoverLog[];
  dispatchSeq: number;
}

export interface RootState {
  version: number; // 每次完整保存 +1
  updatedAt: string;
  data: DispatchState;
}

/** 每次成功保存后的完整快照，保存失败时从最近完整记录恢复 */
export interface Snapshot {
  version: number;
  savedAt: string;
  root: RootState;
}

export interface ActionResult {
  ok: boolean;
  message: string;
  conflict?: boolean;
}
