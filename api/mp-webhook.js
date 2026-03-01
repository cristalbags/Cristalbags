import crypto from "crypto";
import { Payment, MercadoPagoConfig } from "mercadopago";
import { hasSupabaseEnv, sbRequest, safeJsonError } from "../lib/supabase.js";

function json(status, data, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

function verifySignature({ payload, xSignature, xRequestId, secret }) {
  try {
    if (!xSignature || !xRequestId || !secret) return false;

    const parts = xSignature.split(",");
    let ts = null;
    let v1 = null;
    for (const p of parts) {
      const [k, v] = p.split("=");
      if (k && String(k).trim() === "ts") ts = v;
      if (k && String(k).trim() === "v1") v1 = v;
    }
    if (!ts || !v1) return false;

    const manifest = `id:${payload.id};request-id:${xRequestId};ts:${ts};`;
    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(manifest);
    const hex = hmac.digest("hex");

    return crypto.timingSafeEqual(Buffer.from(hex), Buffer.from(v1));
  } catch {
    return false;
  }
}

function normalizeItems(info){
  const raw = (info && info.additional_info && info.additional_info.items) ? info.additional_info.items : null;
  if(!Array.isArray(raw)) return [];
  return raw.map((it)=>({
    id: it.id,
    title: it.title,
    quantity: it.quantity,
    unit_price: it.unit_price,
  }));
}

async function upsertOrder(order){
  if(!hasSupabaseEnv()) return;
  // Upsert by payment_id
  await sbRequest("orders?on_conflict=payment_id", {
    method: "POST",
    headers: {
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: [order],
  });
}

async function tryReduceStockOnce(paymentId, items){
  if(!hasSupabaseEnv()) return { ok: false, reason: "supabase_disabled" };

  // Acquire a one-time lock by flipping stock_reduced from false -> true.
  // If another webhook already processed it, this PATCH returns [].
  const lockRows = await sbRequest(
    `orders?payment_id=eq.${encodeURIComponent(paymentId)}&stock_reduced=is.false`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: { stock_reduced: true },
    }
  );

  const acquired = Array.isArray(lockRows) && lockRows.length > 0;
  if(!acquired){
    return { ok: true, already: true };
  }

  try{
    // Aggregate qty per SKU
    const bySku = new Map();
    for(const it of (items || [])){
      const rawId = String((it && it.id) ? it.id : "");
      const sku = rawId.split("__")[0] || rawId;
      if(!sku) continue;
      const q = Math.max(1, parseInt((it && it.quantity) ? it.quantity : "", 10) || 1);
      bySku.set(sku, (bySku.get(sku) || 0) + q);
    }

    for(const [sku, q] of bySku.entries()){
      const rows = await sbRequest(
        `products?select=sku,stock&sku=eq.${encodeURIComponent(sku)}&limit=1`
      );
      const row = Array.isArray(rows) ? rows[0] : null;
      if(!row) continue;
      const current = Number(row.stock);
      if(!Number.isFinite(current)) continue;
      const next = Math.max(0, current - q);

      await sbRequest(`products?sku=eq.${encodeURIComponent(sku)}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: { stock: next },
      });
    }

    return { ok: true, reduced: true };
  }catch(err){
    // Roll back the lock so it can retry later
    try{
      await sbRequest(`orders?payment_id=eq.${encodeURIComponent(paymentId)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: { stock_reduced: false },
      });
    }catch{}
    throw err;
  }
}

export async function POST(request) {
  try {
    const body = await request.json();

    // Optional: validate signature if you configured MP_WEBHOOK_SECRET
    const xSignature = request.headers.get("x-signature");
    const xRequestId = request.headers.get("x-request-id");
    const secret = process.env.MP_WEBHOOK_SECRET;

    if (secret) {
      const ok = verifySignature({
        payload: body,
        xSignature,
        xRequestId,
        secret,
      });

      if (!ok) {
        return json(401, { error: "Invalid signature" });
      }
    }

    // Mercado Pago sends different event shapes. We handle payment notifications.
    const isPayment = (body && body.type === "payment") || (body && body.data && body.data.id);
    if (!isPayment) {
      return json(200, { ok: true, ignored: true });
    }

    const dataId = body && body.data ? body.data.id : null;
    if (!dataId) {
      return json(200, { ok: true, ignored: true });
    }

    const token = process.env.MP_ACCESS_TOKEN;
    if (!token) {
      return json(500, { error: "Missing MP_ACCESS_TOKEN" });
    }

    const client = new MercadoPagoConfig({ accessToken: token });
    const payment = new Payment(client);

    const info = await payment.get({ id: dataId });

    const paymentId = String((info && info.id) ? info.id : (dataId || ""));
    const status = (info && info.status) ? info.status : "unknown";
    const items = normalizeItems(info);

    const payerName = [(info && info.payer && info.payer.first_name) ? info.payer.first_name : "", (info && info.payer && info.payer.last_name) ? info.payer.last_name : ""]
      .filter(Boolean)
      .join(" ")
      .trim();

    const orderRow = {
      payment_id: paymentId,
      external_reference: (info && info.external_reference) ? info.external_reference : null,
      status,
      items,
      total: (info && info.transaction_amount != null) ? info.transaction_amount : null,
      total_cents:
        (info && info.transaction_amount != null)
          ? Math.round(Number(info.transaction_amount) * 100)
          : null,
      payer_name: payerName || null,
      payer_email: (info && info.payer && info.payer.email) ? info.payer.email : null,
      method: (info && info.payment_method_id) ? info.payment_method_id : ((info && info.payment_type_id) ? info.payment_type_id : null),
      card_last4: (info && info.card && info.card.last_four_digits) ? info.card.last_four_digits : null,
      created_at: (info && info.date_created) ? info.date_created : new Date().toISOString(),
    };

    // Store/update order
    await upsertOrder(orderRow);

    // Reduce stock only once, when approved
    if (status === "approved") {
      await tryReduceStockOnce(paymentId, items);
    }

    return json(200, { ok: true });
  } catch (err) {
    console.error(err);
    return json(500, { error: "Webhook error", details: safeJsonError(err) });
  }
}
