-- Cristal Bags (Supabase) — schema + safe migrations
-- You can paste this into Supabase SQL Editor and run.

-- 1) Extensions
create extension if not exists "uuid-ossp";

-- 2) PRODUCTS
create table if not exists public.products (
  id uuid primary key default uuid_generate_v4(),
  sku text unique,
  name text,
  category text,
  price_cents integer,
  price numeric,
  dimensions text,
  description text,
  image text,
  premium boolean not null default false,
  stock integer not null default 0,
  variants jsonb,
  default_variant text,
  active boolean not null default true,
  created_at timestamp with time zone default now()
);

-- Add missing columns safely (for existing tables)
alter table public.products add column if not exists sku text;
alter table public.products add column if not exists name text;
alter table public.products add column if not exists category text;
alter table public.products add column if not exists price_cents integer;
alter table public.products add column if not exists price numeric;
alter table public.products add column if not exists dimensions text;
alter table public.products add column if not exists description text;
alter table public.products add column if not exists image text;
alter table public.products add column if not exists premium boolean not null default false;
alter table public.products add column if not exists stock integer not null default 0;
alter table public.products add column if not exists variants jsonb;
alter table public.products add column if not exists default_variant text;
alter table public.products add column if not exists active boolean not null default true;
alter table public.products add column if not exists created_at timestamp with time zone default now();

create unique index if not exists products_sku_unique on public.products(sku);

-- 3) ORDERS
create table if not exists public.orders (
  id uuid primary key default uuid_generate_v4(),
  payment_id text unique,
  external_reference text,
  status text,
  items jsonb,
  total_cents integer,
  total numeric,
  payer_name text,
  payer_email text,
  method text,
  card_last4 text,
  stock_reduced boolean not null default false,
  created_at timestamp with time zone default now()
);

alter table public.orders add column if not exists payment_id text;
alter table public.orders add column if not exists external_reference text;
alter table public.orders add column if not exists status text;
alter table public.orders add column if not exists items jsonb;
alter table public.orders add column if not exists total_cents integer;
alter table public.orders add column if not exists total numeric;
alter table public.orders add column if not exists payer_name text;
alter table public.orders add column if not exists payer_email text;
alter table public.orders add column if not exists method text;
alter table public.orders add column if not exists card_last4 text;
alter table public.orders add column if not exists stock_reduced boolean not null default false;
alter table public.orders add column if not exists created_at timestamp with time zone default now();

create unique index if not exists orders_payment_id_unique on public.orders(payment_id);

-- Optional: speed up admin order list
create index if not exists orders_created_at_idx on public.orders(created_at desc);
