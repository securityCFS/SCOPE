/** Queue cancellation is atomic; remote receipts are archived before local history is hidden. */
export function taskArchiveActions({ store, adapters }) {
  const busy = new Set();
  return async (id, action) => {
    if (busy.has(id)) throw new Error("任务归档操作尚未完成");
    busy.add(id);
    try {
      let task;
      await store.update((state) => {
        task = state.tasks.find((t) => t.id === id);
        if (!task || task.kind === "manager")
          throw new Error("请选择普通任务；总调度消息保留在对话中");
        if (action === "archive" && task.status === "queued")
          task.status = "cancelled";
        if (
          !["completed", "failed", "cancelled", "released"].includes(
            task.status,
          )
        )
          throw new Error("任务尚未结束，请先核实执行状态");
        task.archiveError = null;
      });
      if (task.remote) {
        const operation = adapters[task.provider]?.[action];
        if (!operation) throw new Error("此 Agent 暂不支持远端归档");
        await operation(task);
      }
      await store.update((state) => {
        const record = state.tasks.find((t) => t.id === id);
        record.archivedAt =
          action === "archive" ? new Date().toISOString() : null;
        record.updatedAt = new Date().toISOString();
      });
    } catch (error) {
      await store
        .update((state) => {
          const task = state.tasks.find((t) => t.id === id);
          if (task) task.archiveError = error.message;
        })
        .catch(() => {});
      throw error;
    } finally {
      busy.delete(id);
    }
  };
}
