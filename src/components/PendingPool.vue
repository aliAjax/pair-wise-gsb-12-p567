<script setup lang="ts">
import { Warning } from "@element-plus/icons-vue";
import { useDispatchStore } from "../store";
import type { Leg } from "../types";

defineEmits<{ (e: "dispatch", leg: Leg): void }>();
const store = useDispatchStore();

function taskName(id: string) {
  return store.taskById(id)?.name ?? "未知任务";
}
</script>

<template>
  <section class="panel pool-panel">
    <div class="panel-head">
      <h2>待接力区</h2>
      <el-badge :value="store.pendingLegs.length" :hidden="store.pendingLegs.length === 0" type="danger" />
    </div>
    <p class="pool-hint">
      未派车或被退回的段都在这里，写明原因，等可用车辆/司机接力；已出发段不会出现在这里。
    </p>

    <el-empty v-if="store.pendingLegs.length === 0" description="暂无待接力段" :image-size="60" />

    <div v-else class="pool-list">
      <article v-for="leg in store.pendingLegs" :key="leg.id" class="pool-item" :class="{ returned: leg.status === 'returned' }">
        <div class="pool-main">
          <p class="pool-task">{{ taskName(leg.taskId) }} · 第{{ leg.seq }}段</p>
          <p class="pool-route">{{ leg.fromStation }} <b>→</b> {{ leg.toStation }}</p>
          <p v-if="leg.returnReason" class="pool-reason">
            <el-icon><Warning /></el-icon>{{ leg.returnReason }}
          </p>
        </div>
        <el-button type="primary" size="small" @click="$emit('dispatch', leg)">
          {{ leg.status === "returned" ? "接力派车" : "派车" }}
        </el-button>
      </article>
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
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}
.panel-head h2 {
  margin: 0;
  font-size: 19px;
}
.pool-hint {
  margin: 0 0 12px;
  color: #8a94a8;
  font-size: 12px;
  line-height: 1.6;
}
.pool-list {
  display: grid;
  gap: 10px;
}
.pool-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid #e2e9f2;
  border-radius: 8px;
  padding: 10px 12px;
  background: #fbfcfe;
}
.pool-item.returned {
  border-color: #f0c4b8;
  background: #fdf6f4;
}
.pool-task {
  margin: 0;
  font-size: 13px;
  color: #176b87;
  font-weight: 700;
}
.pool-route {
  margin: 3px 0 0;
  font-size: 14px;
}
.pool-reason {
  margin: 6px 0 0;
  font-size: 12px;
  color: #c84b31;
  display: flex;
  align-items: center;
  gap: 4px;
}
</style>
