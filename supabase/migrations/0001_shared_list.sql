-- Shared household shopping list.
-- Tables are closed to the public API (RLS on, no policies). All access goes through the functions below,
-- which check the household code. The code itself is never stored in this repo: only its bcrypt hash lives in the database.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.household (
  id int primary key default 1 check (id = 1),
  code_hash text not null
);

create table if not exists public.list_items (
  id uuid primary key,
  text text not null,
  qty numeric not null default 1,
  kind text not null check (kind in ('barcode', 'weighted', 'free')),
  barcode text,
  keyword text,
  exclude text not null default '',
  checked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.household enable row level security;
alter table public.list_items enable row level security;

create or replace function public._check_code(p_code text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_code is null or not exists (select 1 from public.household h where h.code_hash = crypt(p_code, h.code_hash)) then
    perform pg_sleep(1); -- slow down guessing
    raise exception 'bad_code';
  end if;
end $$;

create or replace function public.list_get(p_code text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._check_code(p_code);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', id, 'text', text, 'qty', qty, 'kind', kind, 'barcode', barcode,
      'keyword', keyword, 'exclude', exclude, 'checked', checked
    ) order by created_at, id)
    from public.list_items
  ), '[]'::jsonb);
end $$;

create or replace function public.item_upsert(p_code text, p_item jsonb) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._check_code(p_code);
  insert into public.list_items (id, text, qty, kind, barcode, keyword, exclude, checked)
  values (
    (p_item->>'id')::uuid, left(p_item->>'text', 200), coalesce((p_item->>'qty')::numeric, 1), p_item->>'kind',
    p_item->>'barcode', p_item->>'keyword', coalesce(left(p_item->>'exclude', 200), ''),
    coalesce((p_item->>'checked')::boolean, false)
  )
  on conflict (id) do update set
    text = excluded.text, qty = excluded.qty, kind = excluded.kind, barcode = excluded.barcode,
    keyword = excluded.keyword, exclude = excluded.exclude, checked = excluded.checked, updated_at = now();
end $$;

create or replace function public.item_delete(p_code text, p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._check_code(p_code);
  delete from public.list_items where id = p_id;
end $$;

-- Harmless call used by the daily workflow so the free project is not paused for inactivity.
create or replace function public.ping() returns timestamptz
language sql security definer set search_path = public as $$ select now() $$;

revoke all on function public._check_code(text) from public, anon, authenticated;
revoke all on function public.list_get(text), public.item_upsert(text, jsonb), public.item_delete(text, uuid), public.ping() from public;
grant execute on function public.list_get(text), public.item_upsert(text, jsonb), public.item_delete(text, uuid), public.ping() to anon, authenticated;
