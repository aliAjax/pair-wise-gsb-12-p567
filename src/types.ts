export type VehicleStatus = "空闲" | "执行中" | "检修";
export type DriverStatus = "空闲" | "在途" | "休息";
export type SegmentStatus = "待派车" | "待接力" | "待出发" | "在途" | "已到达";
export type TaskStatus = "待调度" | "进行中" | "已完成";
export type RelayKind = "退回待接力" | "改派" | "到站交接";

export interface Vehicle {
  id: string;
  plate: string;
  status: VehicleStatus;
  note: string;
}

export interface Driver {
  id: string;
  name: string;
  status: DriverStatus;
  /** 连续在途分钟数，达到 4 小时上限后必须休息复位才能再接段 */
  onRoadMinutes: number;
}

export interface Task {
  id: string;
  name: string;
  zone: string;
  /** 按经过顺序排列的站点，相邻两站拆为一段 */
  stations: string[];
  createdAt: string;
}

export interface Segment {
  id: string;
  taskId: string;
  seq: number;
  from: string;
  to: string;
  status: SegmentStatus;
  vehicleId: string | null;
  driverId: string | null;
  /** 计划起止时段 */
  planStart: string | null;
  planEnd: string | null;
  departAt: string | null;
  arriveAt: string | null;
  /** 退回待接力区的原因 */
  relayReason: string | null;
  /** 已出发但车辆/司机不可用，保留原绑定，等到站登记后交接 */
  needHandover: boolean;
}

export interface RelayOrder {
  id: string;
  taskId: string;
  segmentId: string;
  seq: number;
  kind: RelayKind;
  detail: string;
  reason: string;
  at: string;
}

export interface SnapshotState {
  vehicles: Vehicle[];
  drivers: Driver[];
  tasks: Task[];
  segments: Segment[];
  relays: RelayOrder[];
}

/** 持久化信封：revision 用于两人同时提交时的乐观并发控制 */
export interface Persisted {
  revision: number;
  savedAt: string;
  state: SnapshotState;
}
