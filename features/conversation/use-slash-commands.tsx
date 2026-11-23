"use client";
import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { conversationRequest } from "./use-session-catalog";
import "./slash-commands.css";

type Command = { name: string; description?: string; argumentHint?: string; kind?: string; insertion?: string };
const local: Command[] = [
  {name:"model", description:"选择下一轮模型",kind:"local"},
  {name:"effort", description:"调整推理强度",kind:"local"},
  {name:"permissions", description:"调整会话权限",kind:"local"},
  {name:"stop", description:"停止当前生成",kind:"local"},
  {name:"help", description:"浏览此会话可用命令",kind:"local"},
];
export function useSlashCommands({ provider, host, cwd, sessionId, draft, setDraft, onLocal, disabled, liveCommands }: {
  provider:string; host:string; cwd:string; sessionId?:string | null; draft:string; setDraft:(value:string)=>void;
  onLocal:(name:string)=>void; disabled?:boolean; liveCommands?:Command[];
}) {
  const id = useId();
  const [catalog, setCatalog] = useState<{key:string; items:Command[];notice?:string}>({key:"",items:[]});
  const [failure, setFailure] = useState<{key:string;message:string} | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const key = JSON.stringify([provider,host,cwd,sessionId]);
  const error = failure?.key === `${key}:${refresh}` ? failure.message : "";
  const querying = /^\/[\w:-]*$/.test(draft);
  const open = !disabled && querying && dismissed !== draft;
  useEffect(() => {
    if (!open || liveCommands || catalog.key === `${key}:${refresh}`) return;
    const controller = new AbortController();
    const query = new URLSearchParams({host,cwd,provider,sessionId:sessionId || "",refresh:String(refresh > 0 ? 1 : 0)});
    conversationRequest<{commands:Command[];notice?:string}>(`${provider === "codex" ? "/api/session/commands" : "/api/cli-conversations/commands"}?${query}`)
      .then(value => {if (!controller.signal.aborted) setCatalog({key:`${key}:${refresh}`,items:value.commands,notice:value.notice});})
      .catch(cause => {if (!controller.signal.aborted) setFailure({key:`${key}:${refresh}`,message:cause.message});});
    return () => controller.abort();
  }, [open,key,refresh,provider,host,cwd,sessionId,liveCommands,catalog.key]);
  const native = liveCommands || (catalog.key === `${key}:${refresh}` ? catalog.items : []);
  const entries = [...local, ...(provider === "codex" ? [{name:"compact",description:"压缩当前会话上下文",kind:"local"}] : []),
    ...native.filter(c => !local.some(item => item.name === c.name))];
  const filtered = entries.filter(c => c.name.toLowerCase().includes(draft.slice(1).toLowerCase()));
  const active = Math.min(selected, Math.max(0,filtered.length - 1));
  useEffect(() => { if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({block:"nearest"}); },[active,id,open]);
  function choose(command:Command) {
    setDismissed(null); setSelected(0);
    if (command.kind === "local") {setDraft(command.name === "help" ? "/" : ""); if(command.name !== "help")onLocal(command.name);}
    else setDraft(command.insertion || `/${command.name} `);
  }
  function handleLocal() {
    if (disabled) return false;
    const match = /^\/([\w:-]+)\s*$/.exec(draft);
    const command = entries.find(c => c.kind === "local" && c.name === match?.[1]);
    if (!command) return false;
    choose(command); return true;
  }
  function onKeyDown(event:KeyboardEvent<HTMLTextAreaElement>) {
    if (!open || event.nativeEvent.isComposing) return false;
    if (event.key === "Escape") {setDismissed(draft);event.preventDefault();return true;}
    if (["ArrowDown","ArrowUp"].includes(event.key)) {setSelected((active + (event.key === "ArrowDown" ? 1 : -1) + filtered.length) % (filtered.length || 1));event.preventDefault();return true;}
    if ((event.key === "Enter" && !event.shiftKey || event.key === "Tab") && filtered[active]) {choose(filtered[active]);event.preventDefault();return true;}
    return false;
  }
  const panel = open && <section className="scope-commands" aria-label="可用命令">
    <header><span>{provider === "antigravity" ? "Antigravity" : provider === "claude" ? "Claude" : "Codex"} · 命令与技能</span>
      {!liveCommands && <button type="button" onClick={() => setRefresh(v => v+1)}>刷新</button>}</header>
    <div role="listbox" id={id} aria-label="命令列表">
      {filtered.map((command,index) => <button type="button" role="option" aria-selected={active===index} key={command.name} id={`${id}-${index}`}
        onMouseEnter={() => setSelected(index)} onClick={() => choose(command)}>
        <span><strong>/{command.name}</strong><small>{command.kind === "local" ? "设置" : command.kind === "skill" ? "技能" : "原生命令"}</small></span>
        <p>{command.description || command.argumentHint || "由当前 Agent 提供"}</p>
      </button>)}
      {!filtered.length && <p className="scope-command-note">没有匹配的网页命令。终端专用命令请在终端使用。</p>}
    </div>
    {error && <p className="scope-command-note" role="alert">{error}</p>}
    {!liveCommands && catalog.key === `${key}:${refresh}` && catalog.notice && <p className="scope-command-note">{catalog.notice}</p>}
    {!liveCommands && catalog.key !== `${key}:${refresh}` && !error && <p className="scope-command-note">正在读取远端命令…</p>}
    <footer>↑ ↓ 选择 · Enter 填入 · Esc 关闭</footer>
  </section>;
  return {panel,onKeyDown,handleLocal, inputProps: {"aria-controls":open?id:undefined,"aria-expanded":open,"aria-autocomplete":"list" as const,"aria-activedescendant":open&&filtered.length?`${id}-${active}`:undefined}};
}
