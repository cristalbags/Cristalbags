import { getAdminSession } from "../../lib/adminAuth.js";
import { sbRequest, rowToProduct, safeJsonError } from "../../lib/supabase.js";

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
      "products?select=sku,name,category,price_cents,price,dimensions,description,image,premium,stock,variants,default_variant,active&order=created_at.asc"
    );

    const products = Array.isArray(rows) ? rows.map(rowToProduct) : [];

    return json(200, products, { "Cache-Control": "no-store" });
  } catch (err) {
    return json(500, { error: "Failed to load products", details: safeJsonError(err) });
  }
}

async function updateHandler(request){
  const deny = requireAdmin(request);
  if(deny) return deny;

  const body = await request.json().catch(()=> ({}));
  const { sku, stock, active, premium } = body || {};

  if (!sku) {
    return json(400, { error: "Missing sku" });
  }

  const patch = {};
  if (stock !== undefined) {
    const s = Number(stock);
    if (!Number.isFinite(s) || s < 0) {
      return json(400, { error: "Invalid stock" });
    }
    patch.stock = Math.floor(s);
  }
  if (active !== undefined) patch.active = !!active;
  if (premium !== undefined) patch.premium = !!premium;

  if (!Object.keys(patch).length) {
    return json(400, { error: "Nothing to update" });
  }

  try {
    const rows = await sbRequest(`products?sku=eq.${encodeURIComponent(sku)}`, {
      method: "PATCH",
      headers: {
        Prefer: "return=representation",
      },
      body: patch,
    });

    const updated = Array.isArray(rows) && rows[0] ? rowToProduct(rows[0]) : null;

    return json(200, { ok: true, product: updated }, { "Cache-Control": "no-store" });
  } catch (err) {
    return json(500, { error: "Failed to update product", details: safeJsonError(err) });
  }
}

export async function PATCH(request){
  return updateHandler(request);
}

// Some runtimes or proxies block PATCH. Allow POST as an alias.
export async function POST(request){
  return updateHandler(request);
}
