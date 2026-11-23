import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import ts from "typescript";
import { JSDOM } from "jsdom";
import { CONVERSATION_LOCATION_KEY as key, readConversationLocation, findConversationLocation } from "../lib/conversation-location.js";

const saved = { version: 1, section: "projects", projectHost: "all", host: "lab", cwd: "/work", session: { id: "old-process", sessionId: "durable-id", provider: "codex" } };
const project = { key: "lab-work", host: "lab", cwd: "/work", sessions: [{ id: "new-process", sessionId: "durable-id", provider: "codex", historical: false }] };
test("location validation ignores corrupt storage and strips unrelated fields", () => {
  for (const raw of [null, "{", "{}", JSON.stringify({ ...saved, session: { ...saved.session, provider: "unknown" } })]) assert.equal(readConversationLocation(raw), null);
  assert.deepEqual(readConversationLocation(JSON.stringify({ ...saved, secret: "not persisted" })), saved);
});
test("restoration uses host, provider and durable session ID, not title or process ID", () => {
  assert.equal(findConversationLocation([{ ...project, host: "other" }, { ...project, sessions: [{ ...project.sessions[0], provider: "claude" }] }], saved), null);
  assert.equal(findConversationLocation([project], saved).session.id, "new-process");
  assert.equal(findConversationLocation([{ ...project, sessions: [] }], saved), null);
  assert.equal(findConversationLocation([project], { ...saved, session: null }).project, project);
});

const hookUrl = new URL("../features/conversation/use-conversation-location.ts", import.meta.url).href;
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier === "@/lib/conversation-location") return { url: new URL("../lib/conversation-location.js", import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}, load(url, context, next) {
  if (url !== hookUrl) return next(url, context);
  return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText };
} });
const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost" });
globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.sessionStorage = dom.window.sessionStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { act, createElement: h, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useConversationLocation } = await import(hookUrl);
hooks.deregister();

test("refresh waits for inventory, restores Codex once, and preserves identity during loading", async () => {
  sessionStorage.setItem(key, JSON.stringify(saved));
  let api, calls = 0;
  let connected = false;
  const root = createRoot(document.getElementById("root"));
  function App() {
    const [section, setSection] = useState("manager");
    const [projectHost, setProjectHost] = useState("all");
    const [agent, setAgent] = useState(null);
    api = useConversationLocation({ section, setSection, projectHost, setProjectHost,
      workspace: { bridgeState: connected ? "connected" : "offline", selectedAgent: agent, selectedAgentId: agent?.id, hostFilter: "all", cwdFilter: "all",
        selectProjectSession(p, s) { calls++; setAgent({ id: s.id, host: p.host, cwd: p.cwd, rollout: { id: s.sessionId } }); } },
      catalog: { loaded: connected, projects: connected ? [project] : [], selected: null },
    });
    return h("p", null, section);
  }
  try {
    await act(async () => { root.render(h(App)); });
    assert.equal(document.querySelector("p").textContent, "projects");
    assert.equal(calls, 0); assert.deepEqual(JSON.parse(sessionStorage.getItem(key)), saved);
    connected = true;
    await act(async () => { root.render(h(App)); });
    assert.equal(calls, 1); assert.equal(api.message, "");
    assert.equal(JSON.parse(sessionStorage.getItem(key)).session.id, "new-process");
    await act(async () => { root.render(h(App)); });
    assert.equal(calls, 1);
  } finally { await act(() => root.unmount()); }
});

test("missing sessions stay recoverable and explicit navigation cancels a late selection", async () => {
  const native = { ...saved, session: { ...saved.session, provider: "claude" } };
  sessionStorage.setItem(key, JSON.stringify(native));
  let api, navigate, projects = [], finish, allowed;
  const root = createRoot(document.getElementById("root"));
  function App() {
    const [section, setSection] = useState("manager");
    const [projectHost, setProjectHost] = useState("all");
    navigate = setSection;
    api = useConversationLocation({ section, setSection, projectHost, setProjectHost,
      workspace: { bridgeState: "connected", hostFilter: "all", cwdFilter: "all" },
      catalog: { loaded: true, projects, selected: null, select: async (_id, guard) => { await new Promise(resolve => { finish = resolve; }); allowed = guard(); return allowed; } },
    });
    return h("p", null, section);
  }
  try {
    await act(async () => { root.render(h(App)); });
    assert.match(api.message, /暂时不可用/);
    assert.deepEqual(JSON.parse(sessionStorage.getItem(key)), native);
    projects = [{ ...project, sessions: [{ ...project.sessions[0], catalog: true, provider: "claude" }] }];
    await act(async () => { root.render(h(App)); });
    await act(() => { api.cancel(); navigate("settings"); });
    await act(async () => { finish(); });
    assert.equal(allowed, false);
    assert.equal(document.querySelector("p").textContent, "settings");
    assert.equal(JSON.parse(sessionStorage.getItem(key)).section, "settings");
  } finally { await act(() => root.unmount()); }
});

for (const provider of ["claude", "antigravity"]) test(`${provider}: refresh restores the native conversation after its inventory key changes`, async () => {
  sessionStorage.setItem(key, JSON.stringify({ ...saved, session: { ...saved.session, provider } }));
  const session = { ...project.sessions[0], id: "cli:new-managed-key", provider, catalog: true };
  let calls = 0;
  const root = createRoot(document.getElementById("root"));
  function App() {
    const [section, setSection] = useState("manager");
    const [projectHost, setProjectHost] = useState("all");
    const [selected, setSelected] = useState(null);
    useConversationLocation({ section, setSection, projectHost, setProjectHost,
      workspace: { bridgeState: "connected", hostFilter: "all", cwdFilter: "all" },
      catalog: { loaded: true, projects: [{ ...project, sessions: [session] }], selected,
        async select(id) { calls++; setSelected({ ...session, key: id, host: project.host, cwd: project.cwd }); return true; } },
    });
    return h("p", null, selected?.key);
  }
  try {
    await act(async () => { root.render(h(App)); });
    assert.equal(calls, 1);
    assert.equal(document.querySelector("p").textContent, session.id);
    assert.equal(JSON.parse(sessionStorage.getItem(key)).session.provider, provider);
    assert.equal(JSON.parse(sessionStorage.getItem(key)).session.id, session.id);
  } finally { await act(() => root.unmount()); }
});
