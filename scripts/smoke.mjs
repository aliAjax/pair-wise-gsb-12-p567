// 业务规则冒烟测试：用 esbuild 把 TS store 打包后在 Node 中运行
import { build } from "esbuild";
import { writeFileSync, mkdirSync } from "node:fs";

const result = await build({
  entryPoints: ["src/store.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  external: ["pinia"],
  define: { "import.meta.env.MODE": '"test"' }
});

mkdirSync(".tmp-test", { recursive: true });
const bundlePath = ".tmp-test/store.bundle.mjs";
writeFileSync(bundlePath, result.outputFiles[0].text);

// ---- 浏览器环境桩 ----
const memStore = new Map();
globalThis.localStorage = {
  getItem: (k) => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => memStore.set(k, String(v)),
  removeItem: (k) => memStore.delete(k),
  clear: () => memStore.clear()
};
if (!globalThis.crypto?.randomUUID) {
  globalThis.crypto = { randomUUID: () => "id-" + Math.random().toString(36).slice(2, 10) };
}

// pinia 在无组件环境下需要 active pinia
const { createPinia, setActivePinia } = await import("pinia");
setActivePinia(createPinia());
const mod = await import("../.tmp-test/store.bundle.mjs");
const { useDispatchStore, failureSimulator } = mod;

let pass = 0;
let fail = 0;
function check(name, cond, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.error(`  ❌ ${name} ${extra}`);
  }
}

function freshStore() {
  localStorage.clear();
  setActivePinia(createPinia());
  return useDispatchStore();
}

function leg(store, seq, taskId = store.data.tasks[0].id) {
  return store.legsOfTask(taskId).find((l) => l.seq === seq);
}

function at(h, m = 0) {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(h)}:${pad(m)}`;
}

/* ---------------- 测试 ---------------- */

console.log("1. 派车成功并写入绑定");
{
  const s = freshStore();
  const l4 = leg(s, 4);
  const r = s.dispatchLeg({ legId: l4.id, vehicleId: "v4", driverId: "d3", startAt: at(13), endAt: at(14, 30), operator: "A", ticket: 0 });
  check("派车返回成功", r.ok, r.message);
  check("段状态=已派车", leg(s, 4).status === "assigned");
  check("绑定车辆司机", leg(s, 4).vehicleId === "v4" && leg(s, 4).driverId === "d3");
}

console.log("2. 连续在途超 4 小时不能接下段（间隔<30分钟计入连续）");
{
  const s = freshStore();
  // 第4段：周航(d2) 在途段 09:05-10:50；若给 d2 再派 11:00-13:30（间隔10分，累计 1h45+2h30=4h15）
  const l4 = leg(s, 4);
  const r = s.dispatchLeg({ legId: l4.id, vehicleId: "v4", driverId: "d2", startAt: at(11), endAt: at(13, 30), operator: "A", ticket: 0 });
  check("拒绝并提示 4 小时", !r.ok && r.message.includes("4 小时"), r.message);
  // 换一名司机就可以
  const r2 = s.dispatchLeg({ legId: l4.id, vehicleId: "v4", driverId: "d3", startAt: at(13, 30), endAt: at(15), operator: "A", ticket: 0 });
  check("换司机可派", r2.ok, r2.message);
}

console.log("3. 间隔 ≥30 分钟视为休息，连续在途重新起算");
{
  const s = freshStore();
  const l4 = leg(s, 4);
  // d2 上一段计划到 10:50，新段 12:00 开始（间隔70分），即使新段 3 小时也不连续
  const r = s.dispatchLeg({ legId: l4.id, vehicleId: "v4", driverId: "d2", startAt: at(12), endAt: at(14, 50), operator: "A", ticket: 0 });
  check("休息后可派 3 小时段", r.ok, r.message);
}

console.log("4. 检修车辆不能排入，且未出发段自动退回，在途段保留");
{
  const s = freshStore();
  // v1 绑定了第3段（已派未发），v2 跑第2段（在途）
  const r = s.setVehicleMaintenance("v1", true, "刹车异响", "A");
  check("标记检修成功", r.ok, r.message);
  check("第3段未出发→退回", leg(s, 3).status === "returned");
  check("退回原因写明", (leg(s, 3).returnReason ?? "").includes("刹车异响"));
  check("第3段解除绑定", leg(s, 3).vehicleId === null);
  check("在途第2段保留原绑定", leg(s, 2).status === "departed" && leg(s, 2).vehicleId === "v2");
  // 检修车不能再派
  const r2 = s.dispatchLeg({ legId: leg(s, 3).id, vehicleId: "v1", driverId: "d3", startAt: at(15), endAt: at(16), operator: "A", ticket: 0 });
  check("检修车辆派车被拒", !r2.ok && r2.message.includes("检修"), r2.message);
}

console.log("5. 已出发段不能改派/退回，到站登记后才能交接");
{
  const s = freshStore();
  const r1 = s.returnLeg(leg(s, 2).id, "A", "test");
  check("在途段不能退回", !r1.ok);
  // 到站登记
  const r2 = s.arriveLeg(leg(s, 2).id, "A");
  check("到站登记成功", r2.ok);
  check("第2段已到站", leg(s, 2).status === "arrived");
}

console.log("6. 两人同时派车：先到保留，后到者收到冲突提示");
{
  const s = freshStore();
  const l4 = leg(s, 4);
  // A、B 同时打开面板（ticket 都是 0）
  const a = s.dispatchLeg({ legId: l4.id, vehicleId: "v4", driverId: "d3", startAt: at(13), endAt: at(14), operator: "A", ticket: 0 });
  check("先到的 A 成功", a.ok, a.message);
  const b = s.dispatchLeg({ legId: l4.id, vehicleId: "v1", driverId: "d1", startAt: at(14), endAt: at(15), operator: "B", ticket: 0 });
  check("后到的 B 被拒绝", !b.ok && b.conflict, b.message);
  check("保留 A 的绑定", leg(s, 4).vehicleId === "v4" && leg(s, 4).driverId === "d3");
}

console.log("7. 保存失败：从最近完整记录恢复，本次变更作废");
{
  const s = freshStore();
  const versionBefore = s.root.version;
  failureSimulator.failNextWrites(1);
  const l4 = leg(s, 4);
  const r = s.dispatchLeg({ legId: l4.id, vehicleId: "v4", driverId: "d3", startAt: at(13), endAt: at(14), operator: "A", ticket: 0 });
  check("保存失败被捕获并提示", !r.ok && r.message.includes("恢复"), r.message);
  check("内存已回滚到最近完整版本", s.root.version === versionBefore, `version=${s.root.version}`);
  check("派车未生效", leg(s, 4).status === "pending");
  // 下一次正常保存可成功（状态一致）
  const r2 = s.dispatchLeg({ legId: l4.id, vehicleId: "v4", driverId: "d3", startAt: at(13), endAt: at(14), operator: "A", ticket: 0 });
  check("恢复后可继续正常派车", r2.ok, r2.message);
}

console.log("8. 车辆时段重叠拒绝，端点相接允许");
{
  const s = freshStore();
  // v1 第3段 11:10-12:40；给第4段也派 v1 12:00-13:00 → 冲突
  const r = s.dispatchLeg({ legId: leg(s, 4).id, vehicleId: "v1", driverId: "d3", startAt: at(12), endAt: at(13), operator: "A", ticket: 0 });
  check("车辆时段重叠被拒", !r.ok && r.message.includes("占用"), r.message);
  // 12:40 端点相接不重叠（但 d3 无连续问题，v1 12:40-13:40 允许）
  const r2 = s.dispatchLeg({ legId: leg(s, 4).id, vehicleId: "v1", driverId: "d3", startAt: at(12, 40), endAt: at(13, 40), operator: "A", ticket: 0 });
  check("端点相接可派", r2.ok, r2.message);
}

console.log("9. 新建任务按站点拆段");
{
  const s = freshStore();
  const r = s.createTask({ name: "测试任务", cargo: "货", stations: ["A站", "B站", "B站", "C站"] }, "A");
  check("重复站点拒绝", !r.ok);
  const r2 = s.createTask({ name: "测试任务", cargo: "货", stations: ["A站", "B站", "C站"] }, "A");
  check("3站点拆2段", r2.ok && s.data.legs.filter((l) => l.taskId === s.data.tasks[1].id).length === 2, r2.message);
  check("新段全部待接力", s.data.legs.filter((l) => l.taskId === s.data.tasks[1].id).every((l) => l.status === "pending"));
}

console.log("10. 出发顺序：上一段未到站不能交接出发");
{
  const s = freshStore();
  // 第3段已派车，但第2段在途未到站
  const r = s.departLeg(leg(s, 3).id, "A");
  check("前段未到站，不能出发", !r.ok && r.message.includes("到站"), r.message);
  s.arriveLeg(leg(s, 2).id, "A");
  const r2 = s.departLeg(leg(s, 3).id, "A");
  check("前段到站后可登记出发", r2.ok, r2.message);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
