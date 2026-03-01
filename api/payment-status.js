import { MercadoPagoConfig, Payment } from "mercadopago";

function json(status, body){
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function formatBRL(n){
  try{
    return new Intl.NumberFormat("pt-BR", { style:"currency", currency:"BRL" }).format(Number(n||0));
  }catch(e){
    return String(n||"");
  }
}

export async function GET(request){
  try{
    if(!process.env.MP_ACCESS_TOKEN){
      return json(500, { error: "Missing MP_ACCESS_TOKEN env var" });
    }

    const url = new URL(request.url);
    const payment_id = url.searchParams.get("payment_id");
    const external_reference = url.searchParams.get("external_reference");

    if(!payment_id) return json(400, { error: "Missing payment_id" });

    const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
    const payment = new Payment(client);

    const info = await payment.get({ id: payment_id });

    // If external_reference was provided, ensure it matches (basic anti-snooping).
    if(external_reference && info && info.external_reference && String(info.external_reference) !== String(external_reference)){
      return json(403, { error: "external_reference mismatch" });
    }

    // Sanitize output (NEVER return full card data)
    const card_last4 = (info && info.card && (info.card.last_four_digits || info.card.last_four)) ? (info.card.last_four_digits || info.card.last_four) : null;
    const method = (info && info.payment_method_id) ? info.payment_method_id : ((info && info.payment_method && info.payment_method.id) ? info.payment_method.id : ((info && info.payment_method) ? info.payment_method : null));
    const amount = (info && info.transaction_amount != null) ? formatBRL(info.transaction_amount) : null;

    return json(200, {
      status: (info && info.status) ? info.status : null,
      amount,
      method,
      card_last4,
    });
  }catch(err){
    console.error(err);
    return json(500, { error: "Internal error", details: String((err && err.message) ? err.message : err) });
  }
}
