// Minimal Supabase REST helper (no external deps)
// Uses SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (server-only)

function stripTrailingSlash(url) {
  return url ? url.replace(/\/+$/, "") : url;
}

export function getSupabaseEnv() {
  const url = stripTrailingSlash(process.env.SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { url, key };
}

export function hasSupabaseEnv() {
  const { url, key } = getSupabaseEnv();
  return !!(url && key);
}

export async function sbRequest(path, { method = "GET", headers = {}, body } = {}) {
  const { url, key } = getSupabaseEnv();

  if (!url || !key) {
    const err = new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    err.code = "SUPABASE_ENV_MISSING";
    throw err;
  }

  const res = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    const err = new Error(`Supabase request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

export function rowToProduct(row) {
  // Convert DB row to the same shape as /data/products.json
  return {
    sku: row.sku,
    name: row.name,
    category: row.category,
    price_cents: row.price_cents,
    price: (row && row.price != null) ? row.price : undefined, // optional legacy field
    dimensions: (row && row.dimensions != null) ? row.dimensions : "",
    desc: (row && row.description != null) ? row.description : "",
    image: (row && row.image != null) ? row.image : "",
    premium: !!row.premium,
    stock: typeof row.stock === "number" ? row.stock : null,
    variants: (row && row.variants != null) ? row.variants : null,
    default_variant: (row && row.default_variant != null) ? row.default_variant : null,
    active: (row && row.active != null) ? row.active : true,
  };
}

export function safeJsonError(err) {
  return {
    message: (err && err.message) ? err.message : "Unknown error",
    status: err && err.status ? err.status : undefined,
    code: err && err.code ? err.code : undefined,
    data: err && err.data ? err.data : undefined,
  };
}
