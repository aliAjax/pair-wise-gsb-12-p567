<script setup lang="ts">
import { computed, ref } from "vue";
import { useDispatchStore } from "../store";
import { formatDateTime } from "../rules";
import type { LogType } from "../types";

const store = useDispatchStore();
const taskFilter = ref<string>("all");

const TYPE_META: Record<LogType, { label: string; color: string }> = {
  dispatch: { label: "派车", color: "#176b87" },
  depart: { label: "出发", color: "#1d6fd0" },
  arrive: { label: "到站", color: "#1d7a52" },
  return: { label: "退回", color: "#c84b31" },
  maintenance: { label: "资源变更", color: "#b26b00" },
  task: { label: "任务", color: "#6b5bd6" },
  system: { label: "系统", color: "#8a94a8" }
};

const logs = computed(() =>
  store.data.logs
    .filter((log) => taskFilter.value === "all" || log.taskId === taskFilter.value)
    .slice(0, 150)
);

function meta(type: LogType) {
  return TYPE_META[type] ?? TYPE_META.system;
}
</script>

<template>
  <section class="panel">
    <div class="panel-head">
      <h2>交接记录</h2>
      <el-select v-model="taskFilter" size="small" style="width: 220px">
        <el-option label="全部任务" value="all" />
        <el-option v-for="t in store.data.tasks" :key="t.id" :label="t.name" :value="t.id" />
      </el-select>
    </div>

    <el-empty v-if="logs.length === 0" description="暂无记录" :image-size="60" />

    <ol v-else class="log-timeline">
      <li v-for="log in logs" :key="log.id" class="log-item">
        <span class="log-dot" :style="{ background: meta(log.type).color }" />
        <div class="log-body">
          <div class="log-top">
            <span class="log-type" :style="{ color: meta(log.type).color }">{{ meta(log.type).label }}</span>
            <span class="log-time">{{ formatDateTime(log.at) }}</span>
            <span class="log-operator">{{ log.operator }}</span>
          </div>
          <p class="log-message">{{ log.message }}</p>
        </div>
      </li>
    </ol>
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
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.panel-head h2 {
  margin: 0;
  font-size: 19px;
}
.log-timeline {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 460px;
  overflow-y: auto;
}
.log-item {
  position: relative;
  display: grid;
  grid-template-columns: 14px 1fr;
  gap: 10px;
  padding: 0 0 14px;
}
.log-item:not(:last-child)::before {
  content: "";
  position: absolute;
  left: 5px;
  top: 14px;
  bottom: 0;
  width: 2px;
  background: #e2e9f2;
}
.log-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-top: 5px;
  z-index: 1;
}
.log-top {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
}
.log-type {
  font-weight: 700;
}
.log-time {
  color: #8a94a8;
}
.log-operator {
  color: #5b667a;
  background: #f1f5fa;
  border-radius: 999px;
  padding: 1px 8px;
}
.log-message {
  margin: 4px 0 0;
  font-size: 13px;
  color: #2c3650;
  line-height: 1.6;
}
</style>
