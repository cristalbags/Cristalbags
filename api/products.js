import fs from "fs";
import path from "path";
import { hasSupabaseEnv, sbRequest, rowToProduct, safeJsonError } from "../lib/supabase.js";

function json(status, data, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

function loadLocalCatalog(){
  try{
    const filePath = path.join(process.cwd(), "data", "products.json");
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  }catch{
    return [];
  }
}

export async function GET(request) {
  try {
    // If Supabase isn't configured yet, serve the local JSON file.
    if (!hasSupabaseEnv()) {
      return json(
        200,
        loadLocalCatalog(),
        { "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300" }
      );
    }

    const rows = await sbRequest(
      "products?select=sku,name,category,price_cents,price,dimensions,description,image,premium,stock,variants,default_variant,active&active=is.true&order=created_at.asc"
    );

    const products = Array.isArray(rows) ? rows.map(rowToProduct) : [];

    return json(200, products, {
      "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
    });
  } catch (err) {
    return json(500, { error: "Failed to load products", details: safeJsonError(err) });
  }
}
