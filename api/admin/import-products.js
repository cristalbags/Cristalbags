import fs from "fs";
import path from "path";
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

function loadLocalProductsJson(){
  const filePath = path.join(process.cwd(), "data", "products.json");
  const raw = fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(raw);
  if(!Array.isArray(data)) throw new Error("/data/products.json must be an array");
  return data;
}

export async function POST(request) {
  const deny = requireAdmin(request);
  if(deny) return deny;

  try {
    const local = loadLocalProductsJson();
    const skus = local.map((p) => p.sku).filter(Boolean);

    // Find existing SKUs so we don't overwrite current stock.
    let existingSkus = new Set();
    try {
      const inList = skus.map((s) => encodeURIComponent(s)).join(",");
      const rows = await sbRequest(`products?select=sku&sku=in.(${inList})`);
      if (Array.isArray(rows)) existingSkus = new Set(rows.map((r) => r.sku));
    } catch {
      // If the table/column doesn't exist yet, the upsert below will fail with a helpful error.
    }

    const rowsToUpsert = local.map((p) => {
      const row = {
        sku: p.sku,
        name: p.name,
        category: p.category,
        price_cents: Number(p.price_cents) || null,
        price: p.price_cents ? Number(p.price_cents) / 100 : null,
        dimensions: p.dimensions || "",
        description: p.desc || "",
        image: p.image || "",
        premium: !!p.premium,
        variants: p.variants || null,
        default_variant: p.default_variant || null,
        active: true,
      };

      // New items get a generous default stock so the catalog doesn't become "esgotado" after import.
      if (!existingSkus.has(p.sku)) {
        row.stock = 999;
      }

      return row;
    });

    const inserted = await sbRequest("products?on_conflict=sku", {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: rowsToUpsert,
    });

    return json(200, { ok: true, count: Array.isArray(inserted) ? inserted.length : 0 }, { "Cache-Control": "no-store" });
  } catch (err) {
    return json(500, { error: "Failed to import products", details: safeJsonError(err) });
  }
}
