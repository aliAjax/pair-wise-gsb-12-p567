<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { useDispatchStore } from "../store";
import { formatDateTime, isOccupying, legDurationMs } from "../rules";
import type { Leg } from "../types";

const props = defineProps<{ operator: string }>();
const store = useDispatchStore();

const showAdd = ref(false);
const form = reactive({ plate: "", model: "" });

interface OccupancyRow {
  leg: Leg;
  driverName: string;
  taskName: string;
}

const rows = computed(() =>
  store.data.vehicles.map((vehicle) => {
    const occ = store.data.legs
      .filter((l) => l.vehicleId === vehicle.id && isOccupying(l.status))
      .sort((a, b) => (a.startAt ?? "").localeCompare(b.startAt ?? ""));
    const busy = occ.some((l) => l.status === "departed" || l.status === "assigned");
    return {
      vehicle,
      busy,
      occupancy: occ.map((leg): OccupancyRow => ({
        leg,
        driverName: store.driverById(leg.driverId)?.name ?? "—",
        taskName: store.taskById(leg.taskId)?.name ?? "未知任务"
      }))
    };
  })
);

function durationText(leg: Leg) {
  const ms = legDurationMs(leg);
  return ms === null ? "" : `${Math.round(ms / 60000)} 分钟`;
}

async function toggleMaintenance(vehicleId: string, current: boolean, operator: string) {
  if (current) {
    const r = store.setVehicleMaintenance(vehicleId, false, "", operator);
    r.ok ? ElMessage.success("已解除检修，可重新排班") : ElMessage.error(r.message);
    return;
  }
  try {
    const { value } = await ElMessageBox.prompt("请填写检修原因", "车辆检修登记", {
      confirmButtonText: "标记检修",
      cancelButtonText: "取消",
      inputPlaceholder: "如：制动异响 / 保养到期",
      inputValidator: (v) => (v && v.trim() ? true : "原因必填")
    });
    const r = store.setVehicleMaintenance(vehicleId, true, value, operator);
    r.ok ? ElMessage.success("已标记检修：未出发段退回待接力区，在途段保留绑定") : ElMessage.error(r.message);
  } catch {
    /* 取消 */
  }
}

function addVehicle() {
  const r = store.addVehicle({ plate: form.plate, model: form.model }, props.operator);
  if (r.ok) {
    ElMessage.success("车辆已新增");
    form.plate = "";
    form.model = "";
    showAdd.value = false;
  } else {
    ElMessage.error(r.message);
  }
}
</script>

<template>
  <section class="panel">
    <div class="panel-head">
      <h2>车辆与占用</h2>
      <el-button size="small" @click="showAdd = !showAdd">{{ showAdd ? "收起" : "新增车辆" }}</el-button>
    </div>

    <div v-if="showAdd" class="add-box">
      <el-input v-model="form.plate" placeholder="车牌号" size="small" />
      <el-input v-model="form.model" placeholder="车型（选填）" size="small" />
      <el-button type="primary" size="small" @click="addVehicle">保存</el-button>
    </div>

    <div class="vehicle-list">
      <article v-for="row in rows" :key="row.vehicle.id" class="vehicle-card" :class="{ maintenance: row.vehicle.underMaintenance }">
        <div class="vehicle-head">
          <div>
            <strong class="plate">{{ row.vehicle.plate }}</strong>
            <span class="model">{{ row.vehicle.model }}</span>
          </div>
          <el-tag v-if="row.vehicle.underMaintenance" type="danger" size="small">检修中</el-tag>
          <el-tag v-else-if="row.busy" type="primary" size="small">占用</el-tag>
          <el-tag v-else type="success" size="small">可用</el-tag>
        </div>
        <p v-if="row.vehicle.underMaintenance" class="maintenance-reason">检修原因：{{ row.vehicle.maintenanceReason }}</p>

        <div v-if="row.occupancy.length" class="occ-list">
          <div v-for="o in row.occupancy" :key="o.leg.id" class="occ-row">
            <span class="occ-seq">第{{ o.leg.seq }}段</span>
            <span class="occ-driver">{{ o.driverName }}</span>
            <span class="occ-time">{{ formatDateTime(o.leg.startAt).slice(5) }}~{{ formatDateTime(o.leg.endAt).slice(5) }} · {{ durationText(o.leg) }}</span>
            <el-tag
              size="small"
              :type="o.leg.status === 'departed' ? 'primary' : o.leg.status === 'arrived' ? 'success' : 'warning'"
            >
              {{ o.leg.status === "departed" ? "在途" : o.leg.status === "arrived" ? "已到站" : "已派未发" }}
            </el-tag>
          </div>
        </div>

        <div class="vehicle-foot">
          <el-button
            size="small"
            :type="row.vehicle.underMaintenance ? 'success' : 'danger'"
            plain
            @click="toggleMaintenance(row.vehicle.id, row.vehicle.underMaintenance, operator)"
          >
            {{ row.vehicle.underMaintenance ? "解除检修" : "标记检修" }}
          </el-button>
        </div>
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
  justify-content: space-between;
  margin-bottom: 12px;
}
.panel-head h2 {
  margin: 0;
  font-size: 19px;
}
.add-box {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 8px;
  margin-bottom: 12px;
}
.vehicle-list {
  display: grid;
  gap: 10px;
}
.vehicle-card {
  border: 1px solid #e2e9f2;
  border-radius: 8px;
  padding: 12px;
  background: #fbfcfe;
}
.vehicle-card.maintenance {
  border-color: #f0c4b8;
  background: #fdf6f4;
}
.vehicle-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.plate {
  font-size: 15px;
  margin-right: 8px;
}
.model {
  color: #8a94a8;
  font-size: 12px;
}
.maintenance-reason {
  margin: 6px 0 0;
  color: #c84b31;
  font-size: 12px;
}
.occ-list {
  margin-top: 8px;
  display: grid;
  gap: 6px;
}
.occ-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  background: #f1f5fa;
  border-radius: 6px;
  padding: 5px 8px;
  flex-wrap: wrap;
}
.occ-seq {
  font-weight: 700;
  color: #176b87;
}
.occ-driver {
  min-width: 42px;
}
.occ-time {
  color: #5b667a;
  flex: 1;
}
.vehicle-foot {
  margin-top: 8px;
}
</style>
