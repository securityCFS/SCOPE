import { bridgeSource } from "./helpers/bridge-source.mjs";
import { workspaceSource } from "./helpers/workspace-source.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { modelCatalogTarget, modelCatalogHomeCommands } from "../bridge/model-catalog.mjs";

test("catalog probes isolate each profile and retain the host default", () => {
  const host = modelCatalogTarget("gpu-box");
  const first = modelCatalogTarget("gpu-box", "account-pro-lite");
  const second = modelCatalogTarget("gpu-box", "account-pro-plus");
  assert.equal(host.home, "$HOME/.codex");
  assert.equal(first.home, "$HOME/.codex/scope-auth-profiles/pro-lite/home");
  assert.equal(new Set([host.key, first.key, second.key]).size, 3);
  assert.equal(modelCatalogHomeCommands(host).length, 1);
  assert.match(modelCatalogHomeCommands(first)[1], /auth\.json/);
  assert.throws(() => modelCatalogTarget("gpu-box", "account-../bad"));
});

test("both model discovery and validation use the fresh profile probe", () => {
  const code = bridgeSource();
  const models = code.slice(code.indexOf('url.pathname === "/api/models"'), code.indexOf('url.pathname === "/api/session/profile"'));
  const select = code.slice(code.indexOf('url.pathname === "/api/session/model"'), code.indexOf('url.pathname === "/api/host/model"'));
  assert.match(models, /readInstalledModels\(\s*host,[\s\S]*managedSession\?\.connectionKey/);
  assert.match(select, /readInstalledModels\(\s*host,[\s\S]*managedSession\?\.connectionKey/);
  assert.doesNotMatch(models, /appServerManager\.listModels/);
});

test("the UI keeps session and connection catalogs separate", () => {
  const page = workspaceSource();
  assert.match(page, /function sessionModelCatalogKey\(\s*host: string,\s*sessionId: string,\s*connectionKey\?/);
  assert.match(page, /sessionModelCatalogKey\(\s*modelCatalogHost,\s*modelCatalogSessionId,\s*modelCatalogConnectionKey,?\s*\)/);
  assert.match(page, /sessionModelCatalogKey\(\s*agent\.host,\s*agent\.rollout\.id,\s*workspace\.modelCatalogConnectionKey,?\s*\)/);
  assert.match(page, /window\.setInterval\(load, 60_000\)/);
});
