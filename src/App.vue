<script setup lang="ts">
import { reactive, ref } from "vue";
import { MAX_ONROAD_MINUTES, fmtMinutes, plannedMinutes, useDispatchStore } from "./store";
import type { Driver, Segment, SegmentStatus, Vehicle } from "./types";

const store = useDispatchStore();

const zones = ["城北", "城东", "城南"];

// ---------- 新增任务 ----------
const taskForm = reactive({ name: "", zone: zones[0], stations: "" });
const taskError = ref("");
function submitTask() {
  const err = store.addTask(taskForm.name, taskForm.zone, taskForm.stations);
  if (err) {
    taskError.value = err;
    return;
  }
  taskError.value = "";
  taskForm.name = "";
  taskForm.stations = "";
}

// ---------- 登记车辆 / 司机 ----------
const vehicleForm = reactive({ plate: "" });
const vehicleError = ref("");
function submitVehicle() {
  const err = store.addVehicle(vehicleForm.plate);
  if (err) {
    vehicleError.value = err;
    return;
  }
  vehicleError.value = "";
  vehicleForm.plate = "";
}

const driverForm = reactive({ name: "" });
const driverError = ref("");
function submitDriver() {
  const err = store.addDriver(driverForm.name);
  if (err) {
    driverError.value = err;
    return;
  }
  driverError.value = "";
  driverForm.name = "";
}

// ---------- 派车 / 改派 ----------
const assigningId = ref<string | null>(null);
const assignForm = reactive({ vehicleId: "", driverId: "", planStart: "", planEnd: "" });
const assignError = ref("");

function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function openAssign(seg: Segment) {
  assigningId.value = seg.id;
  assignError.value = "";
  assignForm.vehicleId = "";
  assignForm.driverId = "";
  assignForm.planStart = toLocalInput(new Date(Date.now() + 30 * 60000));
  assignForm.planEnd = toLocalInput(new Date(Date.now() + 150 * 60000));
}

function submitAssign() {
  if (!assigningId.value) return;
  const err = store.assignSegment(assigningId.value, assignForm.vehicleId, assignForm.driverId, assignForm.planStart, assignForm.planEnd);
  if (err) {
    assignError.value = err;
    return;
  }
  assigningId.value = null;
}

// ---------- 段/资源动作 ----------
const actionError = ref("");
let actionTimer: ReturnType<typeof setTimeout> | undefined;
function run(fn: () => string | null) {
  const err = fn();
  actionError.value = err ?? "";
  if (err) {
    clearTimeout(actionTimer);
    actionTimer = setTimeout(() => (actionError.value = ""), 5000);
  }
}

// ---------- 展示辅助 ----------
function fmtTime(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function vehiclePlate(id: string | null) {
  if (!id) return "未派车";
  return store.vehicles.find((v) => v.id === id)?.plate ?? "已删除车辆";
}

function driverName(id: string | null) {
  if (!id) return "未派司机";
  return store.drivers.find((d) => d.id === id)?.name ?? "已删除司机";
}

function occupancyText(segs: Segment[]) {
  if (!segs.length) return "无";
  return segs.map((s) => `${store.taskName(s.taskId)}第${s.seq}段（${s.status}）`).join("、");
}

function vehicleBlocked(v: Vehicle) {
  return v.status === "检修";
}

function driverBlocked(d: Driver) {
  return d.status === "休息" || d.onRoadMinutes >= MAX_ONROAD_MINUTES;
}

function vehicleOptionLabel(v: Vehicle) {
  return `${v.plate}（${v.status}${v.status === "检修" ? "·不能排入" : ""}）`;
}

function driverOptionLabel(d: Driver) {
  const over = d.onRoadMinutes >= MAX_ONROAD_MINUTES;
  return `${d.name}（${d.status} · 连续在途${fmtMinutes(d.onRoadMinutes)}${over ? " · 超4小时" : ""}）`;
}

const SEG_STATUS_CLASS: Record<SegmentStatus, string> = {
  待派车: "st-pending",
  待接力: "st-relay",
  待出发: "st-ready",
  在途: "st-onroad",
  已到达: "st-done"
};

function segClass(seg: Segment) {
  return SEG_STATUS_CLASS[seg.status];
}

function vehicleClass(v: Vehicle) {
  return v.status === "检修" ? "st-maint" : v.status === "执行中" ? "st-ready" : "st-onroad";
}

function driverClass(d: Driver) {
  return d.status === "休息" ? "st-rest" : d.status === "在途" ? "st-ready" : "st-onroad";
}

function taskClass(status: string) {
  return status === "已完成" ? "st-done" : status === "进行中" ? "st-onroad" : "st-pending";
}

function relayClass(kind: string) {
  return kind === "退回待接力" ? "st-relay" : kind === "改派" ? "st-ready" : "st-onroad";
}
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">物流行业前端最小闭环</p>
          <h1>车辆调度接力台</h1>
          <p class="subtitle">
            任务按站点拆段，每段绑定车辆、司机和起止时段；司机连续在途超4小时或车辆检修时，未出发段自动退回待接力区，已出发段保留原绑定、到站登记后再交接。
          </p>
        </div>
        <div class="stack">
          <span class="tag">Vue3</span>
          <span class="tag">Vite</span>
          <span class="tag">TypeScript</span>
          <span class="tag">Pinia</span>
        </div>
      </header>

      <p v-if="store.conflictMsg" class="banner conflict">{{ store.conflictMsg }}</p>
      <p v-else-if="store.notice" class="banner ok">{{ store.notice }}</p>
      <p v-if="actionError" class="banner conflict">{{ actionError }}</p>

      <section class="metrics">
        <article class="metric">
          <span>车辆总数</span>
          <strong>{{ store.metrics.vehicles }}</strong>
        </article>
        <article class="metric">
          <span>在途段</span>
          <strong>{{ store.metrics.onRoad }}</strong>
        </article>
        <article class="metric">
          <span>待接力段</span>
          <strong>{{ store.metrics.relay }}</strong>
        </article>
        <article class="metric">
          <span>空闲车辆</span>
          <strong>{{ store.metrics.idleVehicles }}</strong>
        </article>
      </section>

      <section class="workspace">
        <aside class="side">
          <form class="panel" @submit.prevent="submitTask">
            <h2>新增配送任务</h2>
            <div class="form-grid">
              <label>
                任务名称
                <input v-model="taskForm.name" required placeholder="如：商超补货" />
              </label>
              <label>
                配送区域
                <select v-model="taskForm.zone">
                  <option v-for="z in zones" :key="z">{{ z }}</option>
                </select>
              </label>
              <label>
                站点顺序（按经过顺序）
                <textarea v-model="taskForm.stations" required placeholder="如：集配仓 → 城北站 → 大学城站" />
              </label>
              <p class="hint">按站点自动拆段，每段单独绑定车辆、司机和起止时段。</p>
              <p v-if="taskError" class="error">{{ taskError }}</p>
              <button type="submit">创建任务并拆段</button>
            </div>
          </form>

          <section class="panel relay-panel">
            <h2>待接力区 <span class="count">{{ store.relaySegments.length }}</span></h2>
            <div v-if="store.relaySegments.length === 0" class="empty">暂无待接力段</div>
            <article v-for="seg in store.relaySegments" :key="seg.id" class="relay-item">
              <p class="relay-title">{{ store.taskName(seg.taskId) }} · 第{{ seg.seq }}段 {{ seg.from }}→{{ seg.to }}</p>
              <p class="relay-reason">原因：{{ seg.relayReason }}</p>
              <button type="button" @click="openAssign(seg)">改派</button>
            </article>
          </section>

          <section class="panel">
            <h2>车辆</h2>
            <form class="inline-form" @submit.prevent="submitVehicle">
              <input v-model="vehicleForm.plate" placeholder="新登记车牌号" />
              <button type="submit">登记</button>
            </form>
            <p v-if="vehicleError" class="error">{{ vehicleError }}</p>
            <article v-for="v in store.vehicles" :key="v.id" class="res-item">
              <div class="res-head">
                <strong>{{ v.plate }}</strong>
                <span class="status" :class="vehicleClass(v)">{{ v.status }}</span>
              </div>
              <p class="res-note">{{ v.note }}</p>
              <p class="res-occ">占用：{{ occupancyText(store.activeSegmentsOfVehicle(v.id)) }}</p>
              <button class="secondary" type="button" @click="run(() => store.toggleMaintenance(v.id))">
                {{ v.status === "检修" ? "检修完成·恢复" : "标记检修" }}
              </button>
            </article>
          </section>

          <section class="panel">
            <h2>司机</h2>
            <form class="inline-form" @submit.prevent="submitDriver">
              <input v-model="driverForm.name" placeholder="新登记司机姓名" />
              <button type="submit">登记</button>
            </form>
            <p v-if="driverError" class="error">{{ driverError }}</p>
            <article v-for="d in store.drivers" :key="d.id" class="res-item">
              <div class="res-head">
                <strong>{{ d.name }}</strong>
                <span class="status" :class="driverClass(d)">{{ d.status }}</span>
              </div>
              <div class="roadtime">
                <span>连续在途 {{ fmtMinutes(d.onRoadMinutes) }} / 4小时</span>
                <div class="bar-track">
                  <div
                    class="bar-fill"
                    :class="{ over: d.onRoadMinutes >= MAX_ONROAD_MINUTES }"
                    :style="{ width: `${Math.min(100, (d.onRoadMinutes / MAX_ONROAD_MINUTES) * 100)}%` }"
                  />
                </div>
              </div>
              <p class="res-occ">排班：{{ occupancyText(store.activeSegmentsOfDriver(d.id)) }}</p>
              <p v-if="d.onRoadMinutes >= MAX_ONROAD_MINUTES" class="error">连续在途超4小时，不能再接下段</p>
              <div class="actions">
                <button v-if="d.status !== '休息'" class="secondary" type="button" @click="run(() => store.markDriverRest(d.id))">标记休息</button>
                <button v-else type="button" @click="run(() => store.resetDriver(d.id))">休息复位</button>
              </div>
            </article>
          </section>
        </aside>

        <section class="list-panel">
          <div class="toolbar">
            <h2>任务与分段</h2>
            <span class="hint">共 {{ store.tasks.length }} 个任务</span>
          </div>

          <div class="record-grid">
            <div v-if="store.tasks.length === 0" class="empty">暂无任务，请先在左侧创建</div>
            <article v-for="task in store.tasks" :key="task.id" class="record">
              <div class="record-head">
                <p class="record-title">
                  {{ task.name }}
                  <span class="zone">{{ task.zone }}</span>
                </p>
                <span class="status" :class="taskClass(store.taskStatus(task.id))">{{ store.taskStatus(task.id) }}</span>
              </div>
              <p class="stations">{{ task.stations.join(" → ") }}</p>

              <div class="seg-list">
                <div v-for="seg in store.segmentsOf(task.id)" :key="seg.id" class="seg">
                  <div class="seg-main">
                    <span class="seg-seq">第{{ seg.seq }}段</span>
                    <strong>{{ seg.from }} → {{ seg.to }}</strong>
                    <span class="status" :class="segClass(seg)">{{ seg.status }}</span>
                    <span v-if="seg.needHandover" class="status st-relay">资源不可用·到站后交接</span>
                  </div>
                  <div class="seg-meta">
                    <span>车辆：{{ vehiclePlate(seg.vehicleId) }}</span>
                    <span>司机：{{ driverName(seg.driverId) }}</span>
                    <span>
                      时段：{{ fmtTime(seg.planStart) }} ~ {{ fmtTime(seg.planEnd) }}
                      <template v-if="seg.planStart && seg.planEnd">（{{ fmtMinutes(plannedMinutes(seg)) }}）</template>
                    </span>
                    <span v-if="seg.departAt">出发：{{ fmtTime(seg.departAt) }}</span>
                    <span v-if="seg.arriveAt">到达：{{ fmtTime(seg.arriveAt) }}</span>
                  </div>
                  <p v-if="seg.status === '待接力' && seg.relayReason" class="relay-reason">退回原因：{{ seg.relayReason }}</p>
                  <div class="actions">
                    <button v-if="seg.status === '待派车'" type="button" @click="openAssign(seg)">派车</button>
                    <button v-if="seg.status === '待接力'" type="button" @click="openAssign(seg)">改派</button>
                    <button v-if="seg.status === '待出发'" type="button" @click="run(() => store.departSegment(seg.id))">出发</button>
                    <button v-if="seg.status === '在途'" type="button" @click="run(() => store.arriveSegment(seg.id))">到站登记</button>
                  </div>

                  <form v-if="assigningId === seg.id" class="assign-form" @submit.prevent="submitAssign">
                    <label>
                      车辆
                      <select v-model="assignForm.vehicleId" required>
                        <option value="" disabled>请选择车辆</option>
                        <option v-for="v in store.vehicles" :key="v.id" :value="v.id" :disabled="vehicleBlocked(v)">
                          {{ vehicleOptionLabel(v) }}
                        </option>
                      </select>
                    </label>
                    <label>
                      司机
                      <select v-model="assignForm.driverId" required>
                        <option value="" disabled>请选择司机</option>
                        <option v-for="d in store.drivers" :key="d.id" :value="d.id" :disabled="driverBlocked(d)">
                          {{ driverOptionLabel(d) }}
                        </option>
                      </select>
                    </label>
                    <label>
                      开始时间
                      <input v-model="assignForm.planStart" type="datetime-local" required />
                    </label>
                    <label>
                      结束时间
                      <input v-model="assignForm.planEnd" type="datetime-local" required />
                    </label>
                    <p v-if="assignError" class="error">{{ assignError }}</p>
                    <div class="actions">
                      <button type="submit">确认派车</button>
                      <button class="secondary" type="button" @click="assigningId = null">取消</button>
                    </div>
                  </form>
                </div>
              </div>

              <div class="relay-log">
                <h3>交接记录</h3>
                <p v-if="store.relaysOf(task.id).length === 0" class="hint">暂无交接记录</p>
                <ul>
                  <li v-for="r in store.relaysOf(task.id)" :key="r.id">
                    <span class="status" :class="relayClass(r.kind)">{{ r.kind }}</span>
                    <span>{{ r.detail }}</span>
                    <span class="hint">{{ r.reason }} · {{ fmtTime(r.at) }}</span>
                  </li>
                </ul>
              </div>
            </article>
          </div>
        </section>
      </section>

      <footer class="footer">
        记录版本 rev {{ store.revision }} · 最近保存 {{ fmtTime(store.savedAt) }} ·
        两人同时提交派车时先到的一方保留，保存失败会自动从最近完整记录恢复 · 数据保存在本机 localStorage，重开页面可继续
      </footer>
    </div>
  </main>
</template>
