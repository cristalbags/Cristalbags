import { MercadoPagoConfig, Preference } from "mercadopago";
import fs from "fs";
import path from "path";
import { hasSupabaseEnv, sbRequest, safeJsonError } from "../lib/supabase.js";

function json(status, data, extraHeaders) {
  return new Response(JSON.stringify(data), {
    status: status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(extraHeaders || {}),
    },
  });
}

function publicBaseUrl(request) {
  const env = process.env.PUBLIC_URL || process.env.NEXT_PUBLIC_SITE_URL;
  if (env) return env.replace(/\/+$/, "");

  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) return "https://" + vercelUrl;

  const host = request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") || "https";
  if (host) return proto + "://" + host;

  return "";
}

function loadLocalCatalog() {
  try {
    const filePath = path.join(process.cwd(), "data", "products.json");
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function loadCatalogBySkus(skus) {
  if (!hasSupabaseEnv()) return null;

  try {
    const inList = skus.map((s) => encodeURIComponent(s)).join(",");
    const rows = await sbRequest(
      "products?select=sku,name,price_cents,price,stock,variants,default_variant,active,image&sku=in.(" +
        inList +
        ")&active=is.true"
    );

    if (!Array.isArray(rows)) return null;

    const map = new Map();
    for (const r of rows) {
      map.set(r.sku, r);
    }
    return map;
  } catch {
    return null;
  }
}

function parsePriceToCents(value) {
  if (value === null || value === undefined) return 0;

  // Number: 55.9 -> 5590
  if (typeof value === "number" && isFinite(value)) {
    return Math.round(value * 100);
  }

  // String: "R$ 55,90" or "55.90"
  const s = String(value).trim();
  if (!s) return 0;

  // keep digits, dot, comma
  const m = s.match(/(\d+[.,]?\d*)/g);
  if (!m) return 0;
  // join first/last? We'll take first full number occurrence
  const raw = m[0];
  const normalized = raw.replace(/\./g, "").replace(",", ".");
  const n = Number(normalized);
  if (!isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

function normalizeCartItems(raw) {
  if (!Array.isArray(raw)) return [];

  return raw
    .map(function (it) {
      if (!it) return null;

      var sku = it.sku ? String(it.sku).trim() : "";
      var quantityRaw = it.quantity != null ? it.quantity : it.qty;
      var quantity = Math.max(1, Math.min(99, parseInt(quantityRaw, 10) || 1));
      var variantId =
        it.variantId != null ? it.variantId : it.variant != null ? it.variant : null;

      if (!sku) return null;

      return { sku: sku, quantity: quantity, variantId: variantId };
    })
    .filter(Boolean);
}

export async function POST(request) {
  try {
    const token = process.env.MP_ACCESS_TOKEN;
    if (!token) {
      return json(500, { error: "Missing MP_ACCESS_TOKEN" });
    }

    const body = await request.json().catch(function () {
      return {};
    });

    const cartItems = normalizeCartItems(body.items);
    if (!cartItems.length) {
      return json(400, { error: "Cart empty" });
    }

    const skus = Array.from(new Set(cartItems.map(function (i) { return i.sku; })));

    const sbMap = await loadCatalogBySkus(skus);
    const localCatalog = sbMap ? null : loadLocalCatalog();

    function findLocal(sku) {
      if (!Array.isArray(localCatalog)) return null;
      return localCatalog.find(function (p) {
        return p.sku === sku;
      });
    }

    const baseUrl = publicBaseUrl(request);
    const mpItems = [];

    for (const it of cartItems) {
      const p = sbMap ? sbMap.get(it.sku) : findLocal(it.sku);
      if (!p) {
        return json(400, { error: "Produto não encontrado: " + it.sku });
      }

      var priceCents = 0;

      if (p.price_cents != null && Number(p.price_cents) > 0) {
        priceCents = Number(p.price_cents);
      } else {
        priceCents = parsePriceToCents(p.price);
      }

      if (!priceCents || !isFinite(priceCents) || priceCents <= 0) {
        return json(400, { error: "Preço inválido para: " + (p.name || p.sku), sku: p.sku });
      }

      var title = p.name || it.sku;

      if (Array.isArray(p.variants) && it.variantId) {
        const v = p.variants.find(function (vv) {
          return String(vv.id) === String(it.variantId);
        });

        if (v) {
          if (v.price_cents != null) {
            priceCents = Number(v.price_cents) || priceCents;
          }
          title = title + " (" + (v.label || v.id) + ")";
        }
      }

      const stock =
        p.stock === null || p.stock === undefined
          ? Infinity
          : Number(p.stock);

      if (stock !== Infinity && it.quantity > stock) {
        return json(409, {
          error:
            "Sem estoque suficiente para: " +
            (p.name || it.sku) +
            ". Disponível: " +
            stock,
          sku: it.sku,
          available: stock,
        });
      }

      const pictureUrl =
        p.image && baseUrl
          ? baseUrl + "/" + String(p.image).replace(/^\/+/, "")
          : undefined;

      mpItems.push({
        id: it.variantId ? it.sku + "__" + it.variantId : it.sku,
        title: title,
        quantity: it.quantity,
        unit_price: priceCents / 100,
        currency_id: "BRL",
        ...(pictureUrl ? { picture_url: pictureUrl } : {}),
      });
    }

    const client = new MercadoPagoConfig({ accessToken: token });
    const preference = new Preference(client);

    const notificationUrl = baseUrl
      ? baseUrl + "/api/mp-webhook"
      : undefined;

    const externalRef = "CB-" + Date.now();

    const pref = await preference.create({
      body: {
        items: mpItems,
        external_reference: externalRef,
        ...(notificationUrl ? { notification_url: notificationUrl } : {}),
        back_urls: {
          success: baseUrl ? baseUrl + "/?status=success" : "",
          failure: baseUrl ? baseUrl + "/?status=failure" : "",
          pending: baseUrl ? baseUrl + "/?status=pending" : "",
        },
        auto_return: "approved",
      },
    });

    return json(200, {
      id: pref.id,
      checkout_url: pref.init_point,
      init_point: pref.init_point,
      external_reference: externalRef,
    });
  } catch (err) {
    console.error(err);
    return json(500, {
      error: "Internal error",
      details: safeJsonError(err),
    });
  }
}
