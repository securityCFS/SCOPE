export function portForwardRoutes({
  portForwards,
  readJsonBody,
  jsonResponse,
}) {
  return async function handlePortForwards(request, response, url) {
    if (request.method === "GET" && url.pathname === "/api/port-forwards") {
      const host = (url.searchParams.get("host") || "").trim();
      const cwd = (url.searchParams.get("cwd") || "").trim();
      const scan = url.searchParams.get("scan") === "1";
      const force = url.searchParams.get("force") === "1";
      if (!host) {
        jsonResponse(response, 200, portForwards.state());
        return true;
      }
      try {
        const result = scan
          ? await portForwards.scan(host, { cwd, force })
          : portForwards.state(host);
        jsonResponse(response, 200, result);
      } catch (error) {
        jsonResponse(response, 400, { error: error.message });
      }
      return true;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/port-forwards/forward"
    ) {
      try {
        const body = await readJsonBody(request);
        const result = await portForwards.forward({
          host: String(body?.host || "").trim(),
          remotePort: body?.remotePort,
          localPort: body?.localPort ?? null,
          label: typeof body?.label === "string" ? body.label.trim() : "",
          auto: false,
        });
        jsonResponse(response, 200, {
          ok: true,
          ...result,
          state: portForwards.state(String(body?.host || "").trim()),
        });
      } catch (error) {
        jsonResponse(response, 400, { error: error.message });
      }
      return true;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/port-forwards/stop"
    ) {
      try {
        const body = await readJsonBody(request);
        const host = String(body?.host || "").trim();
        const state = portForwards.stopForward(host, body?.remotePort);
        jsonResponse(response, 200, { ok: true, state });
      } catch (error) {
        jsonResponse(response, 400, { error: error.message });
      }
      return true;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/port-forwards/auto"
    ) {
      try {
        const body = await readJsonBody(request);
        const host = String(body?.host || "").trim();
        const cwd = typeof body?.cwd === "string" ? body.cwd.trim() : "";
        const state = await portForwards.setAutoForward(
          host,
          Boolean(body?.enabled),
          { cwd },
        );
        jsonResponse(response, 200, { ok: true, state });
      } catch (error) {
        jsonResponse(response, 400, { error: error.message });
      }
      return true;
    }

    return false;
  };
}
