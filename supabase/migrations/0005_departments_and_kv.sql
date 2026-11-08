-- Departments: each list item carries its department, and the household remembers fixes
-- ("this product belongs in dairy") plus the order of the departments, in a tiny key-value table.

alter table public.list_items add column if not exists dept text;

create table if not exists public.kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.kv enable row level security;

create or replace function public.list_get(p_code text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s text := public._check_code(p_code);
begin
  if s <> 'ok' then return jsonb_build_object('error', s); end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', id, 'text', text, 'qty', qty, 'kind', kind, 'barcode', barcode,
      'keyword', keyword, 'exclude', exclude, 'checked', checked,
      'addedBy', added_by, 'checkedBy', checked_by, 'createdAt', created_at, 'dept', dept
    ) order by created_at, id)
    from public.list_items
  ), '[]'::jsonb);
end $$;

create or replace function public.item_upsert(p_code text, p_item jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s text := public._check_code(p_code);
begin
  if s <> 'ok' then return jsonb_build_object('error', s); end if;
  insert into public.list_items (id, text, qty, kind, barcode, keyword, exclude, checked, added_by, checked_by, dept)
  values (
    (p_item->>'id')::uuid, left(p_item->>'text', 200), coalesce((p_item->>'qty')::numeric, 1), p_item->>'kind',
    p_item->>'barcode', p_item->>'keyword', coalesce(left(p_item->>'exclude', 200), ''),
    coalesce((p_item->>'checked')::boolean, false),
    left(nullif(trim(p_item->>'addedBy'), ''), 40),
    case when coalesce((p_item->>'checked')::boolean, false) then left(nullif(trim(p_item->>'checkedBy'), ''), 40) else null end,
    left(nullif(trim(p_item->>'dept'), ''), 40)
  )
  on conflict (id) do update set
    text = excluded.text, qty = excluded.qty, kind = excluded.kind, barcode = excluded.barcode,
    keyword = excluded.keyword, exclude = excluded.exclude, checked = excluded.checked,
    checked_by = excluded.checked_by, dept = excluded.dept, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.kv_get_all(p_code text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s text := public._check_code(p_code);
begin
  if s <> 'ok' then return jsonb_build_object('error', s); end if;
  return coalesce((select jsonb_object_agg(key, value) from public.kv), '{}'::jsonb);
end $$;

create or replace function public.kv_set(p_code text, p_key text, p_value jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s text := public._check_code(p_code);
begin
  if s <> 'ok' then return jsonb_build_object('error', s); end if;
  if p_key is null or length(p_key) = 0 or length(p_key) > 160 then return jsonb_build_object('error', 'bad_key'); end if;
  if p_value is null or pg_column_size(p_value) > 8000 then return jsonb_build_object('error', 'bad_value'); end if;
  insert into public.kv (key, value) values (p_key, p_value)
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.kv_get_all(text), public.kv_set(text, text, jsonb) from public;
grant execute on function public.kv_get_all(text), public.kv_set(text, text, jsonb) to anon, authenticated;
