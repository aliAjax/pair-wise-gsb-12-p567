<script setup lang="ts">
import { computed, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { useDispatchStore } from "./store";
import { failureSimulator } from "./storage";
import type { Leg } from "./types";
import TaskBoard from "./components/TaskBoard.vue";
import PendingPool from "./components/PendingPool.vue";
import VehiclesPanel from "./components/VehiclesPanel.vue";
import DriversPanel from "./components/DriversPanel.vue";
import HandoverLog from "./components/HandoverLog.vue";
import DispatchDialog from "./components/DispatchDialog.vue";
import CreateTaskDialog from "./components/CreateTaskDialog.vue";

const store = useDispatchStore();

const operator = ref("调度员A");
const operators = ["调度员A", "调度员B"];

const dispatchVisible = ref(false);
const activeLeg = ref<Leg | null>(null);
const createVisible = ref(false);

function openDispatch(leg: Leg) {
  activeLeg.value = leg;
  dispatchVisible.value = true;
}

/** 演示用：模拟接下来一次保存失败（验证“保存失败后从最近完整记录恢复”） */
function simulateFailOnce() {
  failureSimulator.failNextWrites(1);
  ElMessage.warning("已让下一次保存失败：提交派车/登记后将自动回滚到最近完整记录");
}

async function resetAll() {
  try {
    await ElMessageBox.confirm("将清空本地数据并恢复演示数据，是否继续？", "重置数据", {
      confirmButtonText: "重置",
      cancelButtonText: "取消",
      type: "warning"
    });
    const r = store.resetAll();
    r.ok ? ElMessage.success(r.message) : ElMessage.error(r.message);
  } catch {
    /* 取消 */
  }
}

const metrics = computed(() => store.metrics);
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">物流 · 接力派车</p>
          <h1>车辆调度与接力单</h1>
          <p class="subtitle">
            任务按站点拆段，每段绑定车辆、司机和起止时段；司机连续在途超过 4 小时强制接力，
            检修车辆不得排入。资源不可用时未出发段退回待接力区，在途段到站登记后再交接。
          </p>
        </div>
        <div class="top-actions">
          <el-select v-model="operator" style="width: 130px">
            <el-option v-for="o in operators" :key="o" :label="o" :value="o" />
          </el-select>
          <el-button @click="createVisible = true">新建任务</el-button>
          <el-button plain @click="simulateFailOnce">模拟一次保存失败</el-button>
          <el-button plain type="info" @click="resetAll">重置数据</el-button>
        </div>
      </header>

      <section class="metrics">
        <article class="metric">
          <span>车辆（检修 {{ metrics.vehiclesMaintenance }}）</span>
          <strong>{{ metrics.vehiclesBusy }}/{{ metrics.vehiclesTotal }}</strong>
          <em>占用/总数</em>
        </article>
        <article class="metric">
          <span>在途段</span>
          <strong>{{ metrics.legsDeparted }}</strong>
          <em>绑定冻结</em>
        </article>
        <article class="metric">
          <span>待接力段</span>
          <strong>{{ metrics.legsWaiting }}</strong>
          <em>等待车/人</em>
        </article>
        <article class="metric">
          <span>不可用司机</span>
          <strong>{{ metrics.driversUnavailable }}</strong>
          <em>已自动退段</em>
        </article>
      </section>

      <section class="layout">
        <div class="col-main">
          <TaskBoard :operator="operator" @dispatch="openDispatch" />
        </div>
        <aside class="col-side">
          <PendingPool @dispatch="openDispatch" />
          <VehiclesPanel :operator="operator" class="mt14" />
          <DriversPanel :operator="operator" class="mt14" />
        </aside>
      </section>

      <section class="mt14">
        <HandoverLog />
      </section>

      <footer class="foot">
        <p>
          数据版本 v{{ store.root.version }} · 最近更新 {{ new Date(store.root.updatedAt).toLocaleString("zh-CN") }}
          · 完整快照保存在浏览器 localStorage，重开页面可继续；保存失败时自动从最近完整记录恢复。
        </p>
      </footer>
    </div>

    <DispatchDialog v-model:visible="dispatchVisible" :leg="activeLeg" :operator="operator" />
    <CreateTaskDialog v-model:visible="createVisible" :operator="operator" />
  </main>
</template>

<style scoped>
.app {
  min-height: 100vh;
  padding: 28px;
  background: #eef2f7;
}
.shell {
  max-width: 1280px;
  margin: 0 auto;
}
.topbar {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 20px;
  align-items: end;
  margin-bottom: 20px;
}
.eyebrow {
  margin: 0 0 8px;
  color: #176b87;
  font-weight: 700;
  font-size: 13px;
}
h1 {
  margin: 0;
  font-size: clamp(26px, 3.4vw, 38px);
}
.subtitle {
  margin: 10px 0 0;
  max-width: 760px;
  color: #5b667a;
  line-height: 1.7;
  font-size: 14px;
}
.top-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}
.metric {
  background: #fff;
  border: 1px solid #dfe7f1;
  border-radius: 10px;
  padding: 14px 16px;
}
.metric span {
  display: block;
  color: #69758c;
  font-size: 13px;
}
.metric strong {
  display: block;
  margin: 6px 0 2px;
  font-size: 30px;
  line-height: 1.1;
}
.metric em {
  font-style: normal;
  color: #a0abc0;
  font-size: 12px;
}
.layout {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(340px, 1fr);
  gap: 14px;
  align-items: start;
}
.col-side {
  display: grid;
  gap: 0;
}
.mt14 {
  margin-top: 14px;
}
.foot {
  margin-top: 16px;
  color: #8a94a8;
  font-size: 12px;
  text-align: center;
}
.foot p {
  margin: 0;
}
@media (max-width: 1000px) {
  .layout {
    grid-template-columns: 1fr;
  }
  .metrics {
    grid-template-columns: repeat(2, 1fr);
  }
  .topbar {
    grid-template-columns: 1fr;
  }
}
</style>
