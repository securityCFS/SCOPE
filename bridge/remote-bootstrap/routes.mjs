export function remoteBootstrapRoutes({ bootstrap, readJsonBody, jsonResponse }) {
  return async (request, response, url) => {
    if (url.pathname !== "/api/remote-bootstrap") return false;

    if (request.method === "GET") {
      const host = String(url.searchParams.get("host") || "").trim();
      jsonResponse(response, 200, bootstrap.state(host));
      return true;
    }

    if (request.method === "POST") {
      try {
        const body = await readJsonBody(request);
        const host = String(body.host || "").trim();
        const action = String(body.action || "inspect").trim();
        if (action === "inspect") {
          jsonResponse(response, 200, await bootstrap.inspect(host));
        } else if (action === "deploy") {
          jsonResponse(
            response,
            200,
            await bootstrap.deploy(host, {
              remotePort: body.remotePort,
              registerMcp: body.registerMcp !== false,
            }),
          );
        } else if (action === "remove") {
          jsonResponse(response, 200, await bootstrap.remove(host));
        } else {
          jsonResponse(response, 400, { error: "不支持的操作类型" });
        }
      } catch (error) {
        jsonResponse(response, 400, { error: error.message });
      }
      return true;
    }

    jsonResponse(response, 405, { error: "不支持的请求方法" });
    return true;
  };
}
