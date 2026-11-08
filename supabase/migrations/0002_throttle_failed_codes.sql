-- Throttle wrong household codes, so that a short code (for example 4 digits) cannot be brute-forced.
-- The check now returns a status instead of raising: an exception would roll back the log of the failed attempt.

alter table public.household add column if not exists max_failures int not null default 30;

create table if not exists public.failed_attempts (
  at timestamptz not null default now()
);
create index if not exists failed_attempts_at on public.failed_attempts (at);
alter table public.failed_attempts enable row level security;

drop function if exists public._check_code(text);
create function public._check_code(p_code text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  recent int;
  limit_n int;
begin
  select max_failures into limit_n from public.household where id = 1;
  select count(*) into recent from public.failed_attempts where at > now() - interval '1 hour';
  if recent >= coalesce(limit_n, 30) then
    perform pg_sleep(1);
    return 'locked';
  end if;
  if p_code is null or not exists (select 1 from public.household h where h.code_hash = crypt(p_code, h.code_hash)) then
    insert into public.failed_attempts default values;
    delete from public.failed_attempts where at < now() - interval '1 day';
    perform pg_sleep(1);
    return 'bad_code';
  end if;
  return 'ok';
end $$;

create or replace function public.list_get(p_code text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s text := public._check_code(p_code);
begin
  if s <> 'ok' then return jsonb_build_object('error', s); end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', id, 'text', text, 'qty', qty, 'kind', kind, 'barcode', barcode,
      'keyword', keyword, 'exclude', exclude, 'checked', checked
    ) order by created_at, id)
    from public.list_items
  ), '[]'::jsonb);
end $$;

drop function if exists public.item_upsert(text, jsonb);
create function public.item_upsert(p_code text, p_item jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s text := public._check_code(p_code);
begin
  if s <> 'ok' then return jsonb_build_object('error', s); end if;
  insert into public.list_items (id, text, qty, kind, barcode, keyword, exclude, checked)
  values (
    (p_item->>'id')::uuid, left(p_item->>'text', 200), coalesce((p_item->>'qty')::numeric, 1), p_item->>'kind',
    p_item->>'barcode', p_item->>'keyword', coalesce(left(p_item->>'exclude', 200), ''),
    coalesce((p_item->>'checked')::boolean, false)
  )
  on conflict (id) do update set
    text = excluded.text, qty = excluded.qty, kind = excluded.kind, barcode = excluded.barcode,
    keyword = excluded.keyword, exclude = excluded.exclude, checked = excluded.checked, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

drop function if exists public.item_delete(text, uuid);
create function public.item_delete(p_code text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s text := public._check_code(p_code);
begin
  if s <> 'ok' then return jsonb_build_object('error', s); end if;
  delete from public.list_items where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public._check_code(text) from public, anon, authenticated;
revoke all on function public.list_get(text), public.item_upsert(text, jsonb), public.item_delete(text, uuid) from public;
grant execute on function public.list_get(text), public.item_upsert(text, jsonb), public.item_delete(text, uuid) to anon, authenticated;
