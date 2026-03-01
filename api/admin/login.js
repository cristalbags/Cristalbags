import { createSessionToken, makeAdminSetCookie, verifyPassword } from "../../lib/adminAuth.js";

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
  const body = await request.json().catch(() => ({}));
  const password = body && body.password ? body.password : undefined;

  if (!password) {
    return json(400, { error: "Missing password" });
  }

  if (!verifyPassword(password)) {
    // Small delay to reduce brute-force speed
    await new Promise((r) => setTimeout(r, 250));
    return json(401, { error: "Invalid password" });
  }

  const secret = process.env.ADMIN_PASSWORD;
  const token = createSessionToken(secret);

  return json(200, { ok: true }, { "set-cookie": makeAdminSetCookie(token, request) });
}
