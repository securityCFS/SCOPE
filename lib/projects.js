import { LOCAL_HOST, workingDirectory } from "./execution-host.js";
/** A project is a directory on one execution host, never a directory name alone. */
export function projectIdentity(host, cwd) {
  const cleanHost = typeof host === "string" ? host.trim() : "";
  const rawCwd = typeof cwd === "string" ? cwd : "";
  let cleanCwd;
  try {
    cleanCwd =
      cleanHost === LOCAL_HOST
        ? workingDirectory(cleanHost, rawCwd)
        : rawCwd.replace(/\/+$/, "") || (rawCwd ? "/" : "");
  } catch {
    return null;
  }
  if (cleanHost !== LOCAL_HOST && !cleanCwd.startsWith("/")) return null;
  if (!cleanHost || /[\u0000-\u001f\u007f]/.test(cleanHost + cleanCwd))
    return null;
  return {
    host: cleanHost,
    cwd: cleanCwd,
    key: JSON.stringify([cleanHost, cleanCwd]),
  };
}

export function normalizeProjects(projects) {
  if (!Array.isArray(projects)) return [];
  const seen = new Set();
  return projects.flatMap((project) => {
    const identity = projectIdentity(project?.host, project?.cwd);
    if (!identity || seen.has(identity.key)) return [];
    seen.add(identity.key);
    return [
      {
        host: identity.host,
        cwd: identity.cwd,
        name:
          typeof project.name === "string"
            ? project.name.trim().slice(0, 80)
            : "",
      },
    ];
  });
}

export function projectList(pinned, sessions) {
  const entries = new Map();
  for (const project of normalizeProjects(pinned)) {
    const identity = projectIdentity(project.host, project.cwd);
    entries.set(identity.key, {
      ...project,
      key: identity.key,
      pinned: true,
      sessions: [],
    });
  }
  for (const session of sessions || []) {
    const identity = projectIdentity(session.host, session.cwd);
    if (!identity) continue;
    if (!entries.has(identity.key))
      entries.set(identity.key, {
        ...identity,
        name: "",
        pinned: false,
        sessions: [],
      });
    entries.get(identity.key).sessions.push(session);
  }
  return [...entries.values()].sort(
    (a, b) =>
      Number(b.pinned) - Number(a.pinned) ||
      a.cwd.localeCompare(b.cwd) ||
      a.host.localeCompare(b.host),
  );
}
