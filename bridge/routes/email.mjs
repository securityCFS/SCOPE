export function emailRoutes({ emailNotifier, readJsonBody, jsonResponse, onChanged }) {
  return async (request, response, url) => {
    if (url.pathname === "/api/email/settings" && request.method === "GET") {
      jsonResponse(response, 200, emailNotifier.configView());
      return true;
    }

    if (url.pathname === "/api/email/settings" && request.method === "POST") {
      try {
        const body = await readJsonBody(request);
        const settings = await emailNotifier.saveConfig(body);
        onChanged?.();
        jsonResponse(response, 200, { ok: true, settings });
      } catch (error) {
        jsonResponse(response, 400, { error: error.message });
      }
      return true;
    }

    if (url.pathname === "/api/email/verify" && request.method === "POST") {
      try {
        await emailNotifier.verify();
        onChanged?.();
        jsonResponse(response, 200, { ok: true, settings: emailNotifier.configView() });
      } catch (error) {
        onChanged?.();
        jsonResponse(response, 400, { error: error.message, settings: emailNotifier.configView() });
      }
      return true;
    }

    if (url.pathname === "/api/email/test" && request.method === "POST") {
      try {
        const result = await emailNotifier.sendTest();
        onChanged?.();
        jsonResponse(response, 200, {
          ok: true,
          messageId: result.messageId || null,
          settings: emailNotifier.configView(),
        });
      } catch (error) {
        onChanged?.();
        jsonResponse(response, 400, { error: error.message, settings: emailNotifier.configView() });
      }
      return true;
    }

    return false;
  };
}
