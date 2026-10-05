<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { useDispatchStore } from "../store";
import { BREAK_GAP_MS, FOUR_HOURS_MS } from "../seed";
import { driverChains, formatHours, isOccupying, toMs } from "../rules";

const props = defineProps<{ operator: string }>();
const store = useDispatchStore();

const showAdd = ref(false);
const form = reactive({ name: "", phone: "" });

interface DriverRow {
  id: string;
  name: string;
  phone: string;
  unavailable: boolean;
  unavailableReason: string;
  maxMs: number;
  legs: { seq: number; taskName: string; start: number; end: number; status: string; startAt: string | null; endAt: string | null }[];
}

const rows = computed<DriverRow[]>(() =>
  store.data.drivers.map((driver) => {
    const result = driverChains(store.data, driver.id);
    const legs = store.data.legs
      .filter((l) => l.driverId === driver.id && isOccupying(l.status))
      .sort((a, b) => (a.startAt ?? "").localeCompare(b.startAt ?? ""))
      .map((l) => ({
        seq: l.seq,
        taskName: store.taskById(l.taskId)?.name ?? "",
        start: toMs(l.startAt) ?? 0,
        end: toMs(l.endAt) ?? 0,
        status: l.status,
        startAt: l.startAt,
        endAt: l.endAt
      }));
    return {
      id: driver.id,
      name: driver.name,
      phone: driver.phone,
      unavailable: driver.unavailable,
      unavailableReason: driver.unavailableReason,
      maxMs: result.maxMs,
      legs
    };
  })
);

function percent(maxMs: number) {
  return Math.min(100, Math.round((maxMs / FOUR_HOURS_MS) * 100));
}

async function toggleUnavailable(driverId: string, current: boolean, operator: string) {
  if (current) {
    const r = store.setDriverUnavailable(driverId, false, "", operator);
    r.ok ? ElMessage.success("已恢复可用") : ElMessage.error(r.message);
    return;
  }
  try {
    const { value } = await ElMessageBox.prompt("请填写不可用原因（如连续在途超时、请假）", "司机不可用登记", {
      confirmButtonText: "确认",
      cancelButtonText: "取消",
      inputPlaceholder: "如：连续在途已超 4 小时，强制休息",
      inputValidator: (v) => (v && v.trim() ? true : "原因必填")
    });
    const r = store.setDriverUnavailable(driverId, true, value, operator);
    r.ok ? ElMessage.success("已标记不可用：未出发段退回待接力区，在途段到站后交接") : ElMessage.error(r.message);
  } catch {
    /* 取消 */
  }
}

function addDriver() {
  const r = store.addDriver({ name: form.name, phone: form.phone }, props.operator);
  if (r.ok) {
    ElMessage.success("司机已新增");
    form.name = "";
    form.phone = "";
    showAdd.value = false;
  } else {
    ElMessage.error(r.message);
  }
}

function fmtTime(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 与上一段间隔是否达到 30 分钟休息 */
function isRestGap(row: DriverRow, index: number): boolean {
  if (index === 0) return false;
  return row.legs[index].start - row.legs[index - 1].end >= BREAK_GAP_MS;
}
</script>

<template>
  <section class="panel">
    <div class="panel-head">
      <h2>司机与连续在途</h2>
      <el-button size="small" @click="showAdd = !showAdd">{{ showAdd ? "收起" : "新增司机" }}</el-button>
    </div>
    <p class="rule-hint">相邻两段间隔不足 30 分钟视为连续在途，累计超过 4 小时不能再接下段。</p>

    <div v-if="showAdd" class="add-box">
      <el-input v-model="form.name" placeholder="姓名" size="small" />
      <el-input v-model="form.phone" placeholder="联系电话（选填）" size="small" />
      <el-button type="primary" size="small" @click="addDriver">保存</el-button>
    </div>

    <div class="driver-list">
      <article v-for="row in rows" :key="row.id" class="driver-card" :class="{ off: row.unavailable }">
        <div class="driver-head">
          <div>
            <strong>{{ row.name }}</strong>
            <span class="phone">{{ row.phone || "未填电话" }}</span>
          </div>
          <el-tag v-if="row.unavailable" type="danger" size="small">不可用</el-tag>
          <el-tag v-else-if="row.maxMs > 0" :type="row.maxMs >= FOUR_HOURS_MS ? 'danger' : 'primary'" size="small">
            连续在途 {{ formatHours(row.maxMs) }}
          </el-tag>
          <el-tag v-else type="success" size="small">空闲</el-tag>
        </div>

        <p v-if="row.unavailable" class="off-reason">原因：{{ row.unavailableReason }}</p>

        <div v-if="row.legs.length" class="chain-box">
          <div class="chain-bar">
            <div
              class="chain-fill"
              :class="{ over: row.maxMs >= FOUR_HOURS_MS }"
              :style="{ width: `${percent(row.maxMs)}%` }"
            />
            <span class="chain-cap">4 小时上限</span>
          </div>
          <div class="chain-legs">
            <template v-for="(l, i) in row.legs" :key="i">
              <span v-if="isRestGap(row, i)" class="rest-gap">休息≥30分</span>
              <span class="chain-leg" :class="l.status">
                第{{ l.seq }}段 {{ fmtTime(l.startAt) }}-{{ fmtTime(l.endAt) }}
                （{{ l.status === "departed" ? "在途" : l.status === "arrived" ? "已到站" : "已派" }}）
              </span>
            </template>
          </div>
        </div>

        <div class="driver-foot">
          <el-button
            size="small"
            :type="row.unavailable ? 'success' : 'warning'"
            plain
            @click="toggleUnavailable(row.id, row.unavailable, operator)"
          >
            {{ row.unavailable ? "恢复可用" : "标记不可用" }}
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
  margin-bottom: 4px;
}
.panel-head h2 {
  margin: 0;
  font-size: 19px;
}
.rule-hint {
  margin: 0 0 12px;
  font-size: 12px;
  color: #8a94a8;
}
.add-box {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 8px;
  margin-bottom: 12px;
}
.driver-list {
  display: grid;
  gap: 10px;
}
.driver-card {
  border: 1px solid #e2e9f2;
  border-radius: 8px;
  padding: 12px;
  background: #fbfcfe;
}
.driver-card.off {
  border-color: #f0c4b8;
  background: #fdf6f4;
}
.driver-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.phone {
  margin-left: 10px;
  color: #8a94a8;
  font-size: 12px;
}
.off-reason {
  margin: 6px 0 0;
  font-size: 12px;
  color: #c84b31;
}
.chain-box {
  margin-top: 10px;
}
.chain-bar {
  position: relative;
  height: 10px;
  background: #e7edf4;
  border-radius: 999px;
  overflow: hidden;
}
.chain-fill {
  position: absolute;
  inset: 0 auto 0 0;
  background: linear-gradient(90deg, #176b87, #64b6ac);
  border-radius: inherit;
  transition: width .2s;
}
.chain-fill.over {
  background: linear-gradient(90deg, #c84b31, #e6836a);
}
.chain-cap {
  position: absolute;
  right: 6px;
  top: -3px;
  font-size: 9px;
  color: #8a94a8;
}
.chain-legs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.chain-leg {
  font-size: 11px;
  padding: 3px 7px;
  border-radius: 999px;
  background: #eaf3f8;
  color: #2f5f78;
}
.chain-leg.departed {
  background: #e4f0ff;
  color: #1d6fd0;
}
.chain-leg.arrived {
  background: #e6f6ee;
  color: #1d7a52;
}
.rest-gap {
  font-size: 11px;
  padding: 3px 7px;
  border-radius: 999px;
  background: #fff4e0;
  color: #b26b00;
}
.driver-foot {
  margin-top: 8px;
}
</style>
