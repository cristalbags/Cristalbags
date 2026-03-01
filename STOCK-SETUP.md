# Estoque + Admin (Supabase)

Este update adiciona:

- Catálogo vindo do **Supabase** (com fallback para `/data/products.json`).
- Controle de **estoque** (quando `stock = 0` o produto fica **esgotado**).
- **Painel admin** em `/admin` para editar estoque e ver pedidos.
- Webhook do Mercado Pago salvando pedidos em `orders` e baixando estoque automaticamente quando `approved`.

---

## 1) Criar as tabelas no Supabase

1) Abra **Supabase → SQL Editor**.
2) Cole e rode o arquivo `supabase.sql` (na raiz do projeto).

Tabelas criadas/usadas:

- `products`
- `orders`

---

## 2) Variáveis de ambiente (Vercel)

No Vercel, em **Project → Settings → Environment Variables**:

### Obrigatórias

- `MP_ACCESS_TOKEN` — token do Mercado Pago
- `SUPABASE_URL` — URL do seu projeto Supabase
- `SUPABASE_SERVICE_ROLE_KEY` — service role key (server-only)
- `ADMIN_PASSWORD` — senha do painel `/admin`

### Opcional

- `MP_WEBHOOK_SECRET` — se você ativar assinatura no webhook do MP
- `PUBLIC_URL` — URL pública do site (se não setar, tentamos inferir pelo request)

---

## 3) Importar produtos do `products.json` para o Supabase

Depois de configurar as variáveis, abra:

- `/admin`

Faça login com `ADMIN_PASSWORD` e clique:

- **Importar do products.json**

Isso cria/atualiza os produtos no Supabase.

**Obs:** produtos novos recebem `stock = 999` por padrão (você pode ajustar depois).

---

## 4) Webhook do Mercado Pago

O endpoint do webhook é:

- `/api/mp-webhook`

O `create-preference` já envia `notification_url` automaticamente.

Quando o pagamento ficar `approved`, o webhook:

1) grava/atualiza o pedido em `orders`
2) baixa o estoque em `products` (uma vez só por `payment_id`)

---

## 5) Catálogo no site

O front-end tenta carregar nesta ordem:

1) `/api/products` (Supabase)
2) `/data/products.json` (fallback)

Então você pode:

- trabalhar localmente usando o JSON
- e em produção usar Supabase (com estoque)
