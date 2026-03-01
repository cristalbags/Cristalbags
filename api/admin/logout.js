import { makeAdminClearCookie } from "../../lib/adminAuth.js";

function json(status, data, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

export async function POST(request) {
  return json(200, { ok: true }, { "set-cookie": makeAdminClearCookie(request) });
}
