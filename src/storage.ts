import type { RootState, Snapshot } from "./types";

/**
 * 持久化：
 * - current  最近一次「完整保存」的完整记录
 * - history  最近若干条完整快照，保存失败时从最近完整记录恢复
 * localStorage 本身不会写失败，用 failNextWrites 模拟保存失败（如存储被占满/写入异常）。
 */
const CURRENT_KEY = "dfwl-dispatch-root-v1";
const HISTORY_KEY = "dfwl-dispatch-snapshots-v1";
const MAX_SNAPSHOTS = 20;

/** 测试/演示用：让接下来 n 次保存失败，验证“保存失败后从最近完整记录恢复” */
export const failureSimulator = {
  pending: 0,
  failNextWrites(n = 1) {
    this.pending += n;
  },
  consume(): boolean {
    if (this.pending > 0) {
      this.pending -= 1;
      return true;
    }
    return false;
  }
};

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function loadCurrent(): RootState | null {
  return safeParse<RootState>(localStorage.getItem(CURRENT_KEY));
}

export function loadSnapshots(): Snapshot[] {
  return safeParse<Snapshot[]>(localStorage.getItem(HISTORY_KEY)) ?? [];
}

export function latestSnapshot(): Snapshot | null {
  const snapshots = loadSnapshots();
  return snapshots.length ? snapshots[snapshots.length - 1] : null;
}

/**
 * 完整保存：先写历史再写当前，两者都成功才算成功。
 * 任何一步失败都抛出，调用方据此恢复到最近完整记录。
 */
export function saveAll(root: RootState): void {
  if (failureSimulator.consume()) {
    throw new Error("写入失败（模拟存储异常）");
  }
  const snapshot: Snapshot = {
    version: root.version,
    savedAt: new Date().toISOString(),
    root
  };
  const snapshots = [...loadSnapshots(), snapshot].slice(-MAX_SNAPSHOTS);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(snapshots));
  // 二次校验：模拟写坏的场景，保证 current 与 history 一致
  if (failureSimulator.consume()) {
    throw new Error("主记录写入失败（模拟存储异常）");
  }
  localStorage.setItem(CURRENT_KEY, JSON.stringify(root));
}

/** 从最近完整记录恢复 */
export function restoreFromLatestSnapshot(): RootState | null {
  const snapshot = latestSnapshot();
  if (snapshot) {
    localStorage.setItem(CURRENT_KEY, JSON.stringify(snapshot.root));
    return snapshot.root;
  }
  return null;
}

export function clearAll(): void {
  localStorage.removeItem(CURRENT_KEY);
  localStorage.removeItem(HISTORY_KEY);
}
