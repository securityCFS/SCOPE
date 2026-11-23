export async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 256000)
      throw Object.assign(new Error("请求内容过大"), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("请求必须是有效 JSON"), { statusCode: 400 });
  }
}

export function jsonResponse(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

export function requestHandler(
  handle,
  { host, trustedOrigins, onError = console.error },
) {
  return async (request, response) => {
    try {
      const origin = request.headers.origin;
      if (origin && trustedOrigins.has(origin)) {
        response.setHeader("Access-Control-Allow-Origin", origin);
        response.setHeader("Vary", "Origin");
      }
      response.setHeader("Access-Control-Allow-Headers", "Content-Type");
      response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
      }
      if (
        !["GET", "HEAD"].includes(request.method || "") &&
        origin &&
        !trustedOrigins.has(origin)
      ) {
        jsonResponse(response, 403, {
          error: "拒绝来自非本机 SCOPE 页面的位置写入",
        });
        return;
      }
      const url = new URL(
        request.url || "/",
        `http://${request.headers.host || host}`,
      );
      await handle(request, response, url);
    } catch (error) {
      onError("[scope-http] request failed", error.message);
      if (response.headersSent) {
        response.destroy();
        return;
      }
      jsonResponse(response, error.statusCode || 500, {
        error: error.statusCode ? error.message : "请求处理失败，请重试",
      });
    }
  };
}
