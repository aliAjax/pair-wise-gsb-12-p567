<script setup lang="ts">
import { ElMessage, ElMessageBox } from "element-plus";
import { useDispatchStore } from "../store";
import { formatDateTime } from "../rules";
import type { Leg, LegStatus } from "../types";

defineProps<{ operator: string }>();
const emit = defineEmits<{
  (e: "dispatch", leg: Leg): void;
}>();

const store = useDispatchStore();

const STATUS_META: Record<LegStatus, { label: string; type: "info" | "primary" | "warning" | "success" | "danger" }> = {
  pending: { label: "待接力", type: "info" },
  returned: { label: "退回待接力", type: "danger" },
  assigned: { label: "已派车", type: "warning" },
  departed: { label: "在途", type: "primary" },
  arrived: { label: "已到站", type: "success" }
};

function vehicleName(id: string | null) {
  return store.vehicleById(id)?.plate ?? "—";
}
function driverName(id: string | null) {
  return store.driverById(id)?.name ?? "—";
}

async function depart(leg: Leg, operator: string) {
  const r = store.departLeg(leg.id, operator);
  r.ok ? ElMessage.success("已登记出发，绑定冻结") : ElMessage.error(r.message);
}
async function arrive(leg: Leg, operator: string) {
  const r = store.arriveLeg(leg.id, operator);
  r.ok ? ElMessage.success("到站登记完成，可在本站交接") : ElMessage.error(r.message);
}
async function returnLeg(leg: Leg, operator: string) {
  try {
    const { value } = await ElMessageBox.prompt("请填写退回待接力区的原因", `退回第${leg.seq}段`, {
      confirmButtonText: "退回",
      cancelButtonText: "取消",
      inputPlaceholder: "如：车辆临时检修 / 司机连续在途超时 / 派车有误",
      inputValidator: (v) => (v && v.trim() ? true : "原因必填")
    });
    const r = store.returnLeg(leg.id, operator, value);
    r.ok ? ElMessage.success("已退回待接力区") : ElMessage.error(r.message);
  } catch {
    /* 取消 */
  }
}
</script>

<template>
  <section class="panel task-board">
    <div class="panel-head">
      <h2>任务与接力段</h2>
      <span class="hint">任务按站点拆段，每段绑定车辆、司机与起止时段</span>
    </div>

    <div v-for="task in store.data.tasks" :key="task.id" class="task-block">
      <div class="task-title">
        <div>
          <h3>{{ task.name }}</h3>
          <p>货物：{{ task.cargo }} · {{ task.stations.length }} 个站点 · {{ task.stations.length - 1 }} 段</p>
        </div>
      </div>

      <div class="station-line">
        <template v-for="(station, i) in task.stations" :key="station">
          <div class="station-dot">
            <span class="dot" :class="{ reached: store.legsOfTask(task.id).some((l, idx) => idx < i && l.status === 'arrived') }" />
            <span class="station-name">{{ station }}</span>
          </div>
          <div v-if="i < task.stations.length - 1" class="station-link" />
        </template>
      </div>

      <div class="leg-list">
        <article v-for="leg in store.legsOfTask(task.id)" :key="leg.id" class="leg-card" :class="`leg-${leg.status}`">
          <div class="leg-head">
            <span class="leg-seq">第{{ leg.seq }}段</span>
            <el-tag :type="STATUS_META[leg.status].type" size="small">{{ STATUS_META[leg.status].label }}</el-tag>
          </div>
          <p class="leg-route">{{ leg.fromStation }} <b>→</b> {{ leg.toStation }}</p>

          <dl class="leg-bind">
            <div><dt>车辆</dt><dd :class="{ muted: !leg.vehicleId }">{{ vehicleName(leg.vehicleId) }}</dd></div>
            <div><dt>司机</dt><dd :class="{ muted: !leg.driverId }">{{ driverName(leg.driverId) }}</dd></div>
            <div><dt>时段</dt><dd>{{ leg.startAt ? `${formatDateTime(leg.startAt)} ~ ${formatDateTime(leg.endAt)}` : "—" }}</dd></div>
          </dl>

          <div v-if="leg.departedAt" class="leg-time">出发：{{ formatDateTime(leg.departedAt) }}</div>
          <div v-if="leg.arrivedAt" class="leg-time ok">到站：{{ formatDateTime(leg.arrivedAt) }}</div>
          <div v-if="leg.returnReason" class="leg-return-reason">退回原因：{{ leg.returnReason }}</div>

          <div class="leg-actions">
            <el-button
              v-if="leg.status === 'pending' || leg.status === 'returned'"
              type="primary"
              size="small"
              @click="emit('dispatch', leg)"
            >
              {{ leg.status === "returned" ? "接力派车" : "派车" }}
            </el-button>
            <el-button
              v-if="leg.status === 'assigned'"
              size="small"
              @click="emit('dispatch', leg)"
            >
              改派
            </el-button>
            <el-button v-if="leg.status === 'assigned'" type="primary" size="small" @click="depart(leg, operator)">
              登记出发
            </el-button>
            <el-button v-if="leg.status === 'departed'" type="success" size="small" @click="arrive(leg, operator)">
              到站登记
            </el-button>
            <el-button v-if="leg.status === 'departed'" size="small" disabled title="已出发段保留原绑定，等到站登记后再交接">
              在途锁定
            </el-button>
            <el-button v-if="leg.status === 'assigned'" size="small" plain type="danger" @click="returnLeg(leg, operator)">
              退回
            </el-button>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>

<style scoped>
.panel {
  background: #fff;
  border: 1px solid #dfe7f1;
  border-radius: 10px;
  padding: 18px;
}
.panel-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 14px;
}
.panel-head h2 {
  margin: 0;
  font-size: 19px;
}
.hint {
  color: #8a94a8;
  font-size: 12px;
}
.task-block {
  border: 1px solid #e7edf5;
  border-radius: 10px;
  padding: 16px;
  margin-bottom: 16px;
}
.task-block:last-child {
  margin-bottom: 0;
}
.task-title h3 {
  margin: 0 0 4px;
  font-size: 17px;
}
.task-title p {
  margin: 0;
  color: #69758c;
  font-size: 13px;
}
.station-line {
  display: flex;
  align-items: flex-start;
  margin: 16px 0;
  overflow-x: auto;
  padding-bottom: 4px;
}
.station-dot {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  min-width: 96px;
  text-align: center;
}
.dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #c6d2e2;
  border: 2px solid #fff;
  box-shadow: 0 0 0 2px #c6d2e2;
}
.dot.reached {
  background: #2f9e6e;
  box-shadow: 0 0 0 2px #2f9e6e;
}
.station-name {
  font-size: 12px;
  color: #445069;
  line-height: 1.3;
}
.station-link {
  flex: 1;
  min-width: 28px;
  height: 2px;
  margin-top: 6px;
  background: #d5deea;
}
.leg-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}
.leg-card {
  border: 1px solid #dfe7f1;
  border-radius: 10px;
  padding: 13px 14px;
  background: #fbfcfe;
  border-left-width: 4px;
}
.leg-pending { border-left-color: #9aa8bd; }
.leg-returned { border-left-color: #c84b31; background: #fdf6f4; }
.leg-assigned { border-left-color: #e6a23c; }
.leg-departed { border-left-color: #409eff; }
.leg-arrived { border-left-color: #2f9e6e; }
.leg-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.leg-seq {
  font-weight: 700;
  font-size: 14px;
}
.leg-route {
  margin: 8px 0 10px;
  font-size: 14px;
  color: #172033;
}
.leg-bind {
  display: grid;
  gap: 4px;
  margin: 0 0 8px;
  font-size: 13px;
}
.leg-bind > div {
  display: grid;
  grid-template-columns: 42px 1fr;
  gap: 8px;
}
.leg-bind dt {
  color: #8a94a8;
}
.leg-bind dd {
  margin: 0;
  color: #2c3650;
}
.muted {
  color: #aab4c6 !important;
}
.leg-time {
  font-size: 12px;
  color: #5b667a;
}
.leg-time.ok {
  color: #2f9e6e;
}
.leg-return-reason {
  margin-top: 6px;
  font-size: 12px;
  color: #c84b31;
  background: #fbeae6;
  border-radius: 6px;
  padding: 6px 8px;
}
.leg-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
</style>
