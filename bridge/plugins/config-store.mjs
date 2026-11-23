import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

/** One local, versioned settings file per trusted plugin. No credentials here. */
export class PluginConfigStore {
  constructor({ filename, validate, migrate }) {
    this.filename = filename;
    this.validate = validate;
    try {
      const value = JSON.parse(readFileSync(filename, "utf8"));
      if (value.schemaVersion !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0)
        throw new Error("不支持的插件配置版本");
      this.value = { schemaVersion: 1, revision: value.revision, ...validate(value) };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      this.value = { schemaVersion: 1, revision: 0, ...validate(migrate()) };
      this.persist(this.value);
    }
  }
  read() { return structuredClone(this.value); }
  persist(value) {
    mkdirSync(path.dirname(this.filename), { recursive: true });
    const temporary = `${this.filename}.tmp`;
    writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
    renameSync(temporary, this.filename);
  }
  save(value, revision) {
    if (revision !== this.value.revision)
      throw Object.assign(new Error("插件配置已更新，请重新载入后保存"), { statusCode: 409 });
    const next = { schemaVersion: 1, revision: revision + 1, ...this.validate(value) };
    this.persist(next);
    this.value = next;
    return this.read();
  }
}
