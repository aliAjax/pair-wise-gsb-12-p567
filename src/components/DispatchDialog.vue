<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import type { Driver, Leg, Vehicle } from "../types";
import { useDispatchStore } from "../store";

const props = defineProps<{
  visible: boolean;
  leg: Leg | null;
  operator: string;
}>();
const emit = defineEmits<{
  (e: "update:visible", value: boolean): void;
  (e: "dispatched"): void;
}>();

const store = useDispatchStore();

const vehicleId = ref("");
const driverId = ref("");
const timeRange = ref<[string, string] | null>(null);
/** 打开面板时该段的派车批次：提交后若批次已变，说明别人先派成功 */
const ticket = ref(0);

function defaultRange(leg: Leg): [string, string] {
  if (leg.startAt && leg.endAt) return [leg.startAt, leg.endAt];
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start.getTime() + 2 * 3600_000);
  return [fmt(start), fmt(end)];
}

watch(
  () => [props.visible, props.leg] as const,
  ([visible]) => {
    if (visible && props.leg) {
      vehicleId.value = props.leg.vehicleId ?? "";
      driverId.value = props.leg.driverId ?? "";
      timeRange.value = defaultRange(props.leg);
      ticket.value = props.leg.dispatchNo;
    }
  },
  { immediate: true }
);

const liveError = computed(() => {
  if (!props.leg || !timeRange.value) return "";
  return (
    store.validateDispatch(store.data, {
      legId: props.leg.id,
      vehicleId: vehicleId.value,
      driverId: driverId.value,
      startAt: timeRange.value[0],
      endAt: timeRange.value[1],
      ticket: ticket.value
    }) ?? ""
  );
});

const title = computed(() => {
  if (!props.leg) return "派车";
  const action =
    props.leg.status === "returned"
      ? "接力派车（待接力区）"
      : props.leg.status === "assigned"
        ? "改派"
        : "派车";
  return `${action} · 第${props.leg.seq}段`;
});

function vehicleLabel(v: Vehicle): string {
  return v.underMaintenance ? `${v.plate} · ${v.model}（检修中：${v.maintenanceReason}）` : `${v.plate} · ${v.model}`;
}
function driverLabel(d: Driver): string {
  return d.unavailable ? `${d.name}（不可用：${d.unavailableReason}）` : d.name;
}

function close() {
  emit("update:visible", false);
}

function submit() {
  if (!props.leg || !timeRange.value) return;
  const result = store.dispatchLeg({
    legId: props.leg.id,
    vehicleId: vehicleId.value,
    driverId: driverId.value,
    startAt: timeRange.value[0],
    endAt: timeRange.value[1],
    operator: props.operator,
    ticket: ticket.value
  });
  if (result.ok) {
    ElMessage.success(result.message);
    emit("dispatched");
    close();
  } else {
    ElMessage.error(result.message);
    // 票据失效后同步最新批次（面板已被他人先派）
    const fresh = store.data.legs.find((l) => l.id === props.leg?.id);
    if (fresh) ticket.value = fresh.dispatchNo;
  }
}
</script>

<template>
  <el-dialog :model-value="visible" :title="title" width="520px" @update:model-value="emit('update:visible', $event)">
    <div v-if="leg" class="dispatch-leg-info">
      <strong>{{ leg.fromStation }}</strong>
      <span class="arrow">→</span>
      <strong>{{ leg.toStation }}</strong>
      <el-tag v-if="leg.status === 'returned'" type="warning" size="small" class="ml8">已退回</el-tag>
      <p v-if="leg.returnReason" class="return-reason">退回原因：{{ leg.returnReason }}</p>
    </div>

    <el-form label-width="84px" class="dispatch-form">
      <el-form-item label="车辆">
        <el-select v-model="vehicleId" placeholder="选择车辆" style="width: 100%">
          <el-option
            v-for="v in store.data.vehicles"
            :key="v.id"
            :label="vehicleLabel(v)"
            :value="v.id"
            :disabled="v.underMaintenance"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="司机">
        <el-select v-model="driverId" placeholder="选择司机" style="width: 100%">
          <el-option
            v-for="d in store.data.drivers"
            :key="d.id"
            :label="driverLabel(d)"
            :value="d.id"
            :disabled="d.unavailable"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="起止时段">
        <el-date-picker
          v-model="timeRange"
          type="datetimerange"
          range-separator="至"
          start-placeholder="出发时间"
          end-placeholder="到站时间"
          format="MM-DD HH:mm"
          value-format="YYYY-MM-DDTHH:mm"
          style="width: 100%"
        />
      </el-form-item>
    </el-form>

    <el-alert
      v-if="liveError"
      :title="liveError"
      type="error"
      :closable="false"
      show-icon
      class="live-check"
    />
    <el-alert
      v-else
      title="校验通过：车辆时段不冲突、司机连续在途未超过 4 小时"
      type="success"
      :closable="false"
      show-icon
      class="live-check"
    />

    <template #footer>
      <el-button @click="close">取消</el-button>
      <el-button type="primary" :disabled="!!liveError" @click="submit">
        确认派车（{{ operator }}）
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.dispatch-leg-info {
  background: #f4f8fc;
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 14px;
  font-size: 15px;
}
.arrow {
  margin: 0 10px;
  color: #176b87;
}
.ml8 {
  margin-left: 8px;
}
.return-reason {
  margin: 8px 0 0;
  color: #b26b00;
  font-size: 13px;
}
.live-check {
  margin-top: 4px;
}
</style>
