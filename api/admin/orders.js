import { getAdminSession } from "../../lib/adminAuth.js";
import { sbRequest, safeJsonError } from "../../lib/supabase.js";

function json(status, data, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

function requireAdmin(request){
  const session = getAdminSession(request);
  if(!session.ok){
    return json(session.status, { error: session.error });
  }
  return null;
}

export async function GET(request) {
  const deny = requireAdmin(request);
  if(deny) return deny;

  try {
    const rows = await sbRequest(
      "orders?select=payment_id,status,total_cents,total,items,payer_name,payer_email,method,card_last4,external_reference,created_at,stock_reduced&order=created_at.desc&limit=200"
    );

    return json(200, Array.isArray(rows) ? rows : [], { "Cache-Control": "no-store" });
  } catch (err) {
    return json(500, { error: "Failed to load orders", details: safeJsonError(err) });
  }
}
