"use client";
import { useState, useEffect, useRef } from "react";
import {
  ArrowUp,
  Check,
  Folder,
  FolderPlus,
  LoaderCircle,
  X,
} from "lucide-react";
import { bridgeUrl } from "@/features/workspace/shared";
import type { WorkspaceController } from "@/features/workspace/use-workspace-controller";

export function DirectoryPicker({
  workspace: w,
}: {
  workspace: WorkspaceController;
}) {
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const browser = w.newTaskDirectoryBrowser;
  async function browse(path: string) {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    w.setNewTaskDirectoryBrowser((value) => ({
      ...value,
      open: true,
      loading: true,
      error: "",
    }));
    try {
      const response = await fetch(
        bridgeUrl(`/api/remote/directories?host=${encodeURIComponent(host)}&path=${encodeURIComponent(path)}`),
        { signal: controller.signal, cache: "no-store" },
      );
      const listing = await response.json();
      if (!response.ok) throw new Error(listing.error || "读取目录失败");
      if (!controller.signal.aborted)
        w.setNewTaskDirectoryBrowser({
          open: true,
          loading: false,
          error: "",
          listing,
        });
    } catch (failure) {
      if (!controller.signal.aborted)
        w.setNewTaskDirectoryBrowser((value) => ({
          ...value,
          loading: false,
          error: (failure as Error).message,
        }));
    }
  }
  const host = w.newTaskDraft.host;
  async function create() {
    const parent = browser.listing?.cwd;
    if (!parent || !name.trim() || creating) return;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setCreating(true);
    setError("");
    try {
      const response = await fetch(bridgeUrl("/api/remote/directories"), {
        signal: controller.signal,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ host, parent, name: name.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "创建目录失败");
      if (!controller.signal.aborted) {
        w.chooseNewTaskDirectory(result.cwd);
        setName("");
      }
    } catch (failure) {
      if (!controller.signal.aborted) setError((failure as Error).message);
    } finally {
      if (!controller.signal.aborted) setCreating(false);
    }
  }
  return (
    <div className="new-conversation-directory">
      <label htmlFor="conversation-cwd">工作目录</label>
      <div className="directory-input-row">
        <input
          id="conversation-cwd"
          required
          placeholder="/workspace/my-project"
          value={w.newTaskDraft.cwd}
          onChange={(e) =>
            w.setNewTaskDraft((value) => ({ ...value, cwd: e.target.value }))
          }
        />
        <button
          type="button"
          disabled={!host || creating}
          onClick={() => void browse(w.newTaskDraft.cwd || "")}
        >
          <Folder size={15} />
          选择目录
        </button>
      </div>
      {browser.open && (
        <section className="directory-picker" aria-label="选择工作目录">
          <header>
            <span title={browser.listing?.cwd}>
              {browser.listing?.cwd || w.newTaskDraft.cwd || "/"}
            </span>
            <button
              type="button"
              aria-label="关闭目录选择"
              disabled={creating}
              onClick={() => {
                pending.current?.abort();
                w.setNewTaskDirectoryBrowser((value) => ({
                  ...value,
                  open: false,
                  loading: false,
                }));
              }}
            >
              <X size={15} />
            </button>
          </header>
          {browser.loading ? (
            <p>
              <LoaderCircle size={15} className="is-spinning" />
              正在读取…
            </p>
          ) : browser.error ? (
            <p role="alert">{browser.error}</p>
          ) : (
            browser.listing && (
              <>
                <div className="directory-picker-actions">
                  <button
                    type="button"
                    disabled={!browser.listing.parent || creating}
                    onClick={() => void browse(browser.listing!.parent!)}
                  >
                    <ArrowUp size={14} />
                    上一级
                  </button>
                  <button
                    type="button"
                    disabled={creating}
                    onClick={() =>
                      w.chooseNewTaskDirectory(browser.listing!.cwd)
                    }
                  >
                    <Check size={14} />
                    使用此目录
                  </button>
                </div>
                <div className="directory-picker-list">
                  {browser.listing.directories.map((entry) => (
                    <button
                      type="button"
                      key={entry.path}
                      disabled={creating}
                      onClick={() => void browse(entry.path)}
                    >
                      <Folder size={14} />
                      {entry.name}
                    </button>
                  ))}
                  {!browser.listing.directories.length && <p>没有子目录</p>}
                </div>
                {browser.listing.truncated && (
                  <small>目录较多，可输入完整路径定位。</small>
                )}
                <div className="directory-create">
                  <input
                    aria-label="新目录名称"
                    placeholder="新建文件夹名称"
                    value={name}
                    disabled={creating}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        void create();
                      }
                    }}
                  />
                  <button
                    type="button"
                    disabled={!name.trim() || creating}
                    onClick={() => void create()}
                  >
                    {creating ? (
                      <LoaderCircle size={14} className="is-spinning" />
                    ) : (
                      <FolderPlus size={14} />
                    )}
                    新建并使用
                  </button>
                </div>
                <small>仅创建文件夹，不初始化仓库或启动 Agent。</small>
              </>
            )
          )}
          {error && <p role="alert">{error}</p>}
        </section>
      )}
    </div>
  );
}
