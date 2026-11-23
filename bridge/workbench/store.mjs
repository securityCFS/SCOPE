import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  defaultWorkbenchConfig,
  validateWorkbenchConfig,
} from "../../lib/workbench-config.js";

/** One serialized transaction stream; persist before exposing state or starting work. */
export class WorkbenchStore {
  constructor(filename, { configFile } = {}) {
    this.filename = filename;
    this.configFile = configFile;
    this.tail = Promise.resolve();
  }
  async load() {
    try {
      this.value = JSON.parse(await readFile(this.filename, "utf8"));
      this.value.config = validateWorkbenchConfig(this.value.config);
      if (
        this.value.version !== 1 ||
        !Array.isArray(this.value.tasks) ||
        !Array.isArray(this.value.messages)
      )
        throw new Error("工作台状态格式无效");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      this.value = {
        version: 1,
        revision: 0,
        configRevision: 0,
        config: this.configFile
          ? validateWorkbenchConfig(
              JSON.parse(await readFile(this.configFile, "utf8")),
            )
          : defaultWorkbenchConfig(),
        tasks: [],
        messages: [],
        managerSession: null,
      };
    }
    return this;
  }
  read() {
    return structuredClone(this.value);
  }
  update(change) {
    const operation = this.tail.then(async () => {
      const next = this.read();
      const result = change(next);
      if (JSON.stringify(next) === JSON.stringify(this.value)) return result;
      next.revision += 1;
      await mkdir(path.dirname(this.filename), { recursive: true });
      const temporary = `${this.filename}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify(next, null, 2), {
        mode: 0o600,
      });
      await rename(temporary, this.filename);
      this.value = next;
      return result;
    });
    this.tail = operation.catch(() => {});
    return operation;
  }
}
