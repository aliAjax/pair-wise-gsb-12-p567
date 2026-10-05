<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { Delete } from "@element-plus/icons-vue";
import { useDispatchStore } from "../store";

const props = defineProps<{ visible: boolean; operator: string }>();
const emit = defineEmits<{ (e: "update:visible", value: boolean): void }>();

const store = useDispatchStore();
const name = ref("");
const cargo = ref("");
const stations = reactive<string[]>(["", ""]);

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      name.value = "";
      cargo.value = "";
      stations.splice(0, stations.length, "", "");
    }
  }
);

function addStation() {
  stations.push("");
}
function removeStation(index: number) {
  stations.splice(index, 1);
}

function submit() {
  const r = store.createTask(
    { name: name.value, cargo: cargo.value, stations: [...stations] },
    props.operator
  );
  if (r.ok) {
    ElMessage.success("任务已按站点拆段，进入待接力区");
    emit("update:visible", false);
  } else {
    ElMessage.error(r.message);
  }
}
</script>

<template>
  <el-dialog
    title="新建任务（按站点拆段）"
    :model-value="visible"
    width="520px"
    @update:model-value="emit('update:visible', $event)"
  >
    <el-form label-width="84px">
      <el-form-item label="任务名称">
        <el-input v-model="name" placeholder="如：沪杭线商超补货" />
      </el-form-item>
      <el-form-item label="货物">
        <el-input v-model="cargo" placeholder="如：常温食品 3 吨" />
      </el-form-item>
      <el-form-item label="站点顺序">
        <div class="stations">
          <div v-for="(_, i) in stations" :key="i" class="station-row">
            <span class="station-index">{{ i + 1 }}</span>
            <el-input v-model="stations[i]" :placeholder="`第 ${i + 1} 站，如：上海嘉定仓`" size="small" />
            <el-button
              v-if="stations.length > 2"
              :icon="Delete"
              circle
              size="small"
              plain
              type="danger"
              @click="removeStation(i)"
            />
          </div>
          <el-button size="small" plain @click="addStation">+ 增加站点</el-button>
          <p class="seg-preview">将拆为 {{ stations.length - 1 }} 个接力段（相邻站点一段）</p>
        </div>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="emit('update:visible', false)">取消</el-button>
      <el-button type="primary" @click="submit">创建并拆段</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.stations {
  width: 100%;
  display: grid;
  gap: 8px;
}
.station-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.station-index {
  width: 18px;
  text-align: right;
  color: #8a94a8;
  font-size: 12px;
  flex-shrink: 0;
}
.seg-preview {
  margin: 0;
  font-size: 12px;
  color: #176b87;
}
</style>
