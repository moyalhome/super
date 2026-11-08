-- Who is online right now, and who added / took each item.
-- Names are self-declared display names (the household shares one code), used only for display.

alter table public.list_items add column if not exists added_by text;
alter table public.list_items add column if not exists checked_by text;

create table if not exists public.presence (
  client_id uuid primary key,
  name text not null,
  last_seen timestamptz not null default now()
);
alter table public.presence enable row level security;

create or replace function public.list_get(p_code text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s text := public._check_code(p_code);
begin
  if s <> 'ok' then return jsonb_build_object('error', s); end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', id, 'text', text, 'qty', qty, 'kind', kind, 'barcode', barcode,
      'keyword', keyword, 'exclude', exclude, 'checked', checked,
      'addedBy', added_by, 'checkedBy', checked_by, 'createdAt', created_at
    ) order by created_at, id)
    from public.list_items
  ), '[]'::jsonb);
end $$;

-- added_by is written only when the item is created; checked_by follows the checked flag.
create or replace function public.item_upsert(p_code text, p_item jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s text := public._check_code(p_code);
begin
  if s <> 'ok' then return jsonb_build_object('error', s); end if;
  insert into public.list_items (id, text, qty, kind, barcode, keyword, exclude, checked, added_by, checked_by)
  values (
    (p_item->>'id')::uuid, left(p_item->>'text', 200), coalesce((p_item->>'qty')::numeric, 1), p_item->>'kind',
    p_item->>'barcode', p_item->>'keyword', coalesce(left(p_item->>'exclude', 200), ''),
    coalesce((p_item->>'checked')::boolean, false),
    left(nullif(trim(p_item->>'addedBy'), ''), 40),
    case when coalesce((p_item->>'checked')::boolean, false) then left(nullif(trim(p_item->>'checkedBy'), ''), 40) else null end
  )
  on conflict (id) do update set
    text = excluded.text, qty = excluded.qty, kind = excluded.kind, barcode = excluded.barcode,
    keyword = excluded.keyword, exclude = excluded.exclude, checked = excluded.checked,
    checked_by = excluded.checked_by, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

-- Heartbeat: records this device and returns everyone seen in the last 45 seconds.
create or replace function public.presence_ping(p_code text, p_client uuid, p_name text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s text := public._check_code(p_code);
begin
  if s <> 'ok' then return jsonb_build_object('error', s); end if;
  if p_name is null or length(trim(p_name)) = 0 then return jsonb_build_object('error', 'empty_name'); end if;
  insert into public.presence (client_id, name, last_seen) values (p_client, left(trim(p_name), 40), now())
  on conflict (client_id) do update set name = excluded.name, last_seen = now();
  delete from public.presence where last_seen < now() - interval '1 day';
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', client_id, 'name', name) order by name, client_id)
    from public.presence where last_seen > now() - interval '45 seconds'
  ), '[]'::jsonb);
end $$;

create or replace function public.presence_leave(p_code text, p_client uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s text := public._check_code(p_code);
begin
  if s <> 'ok' then return jsonb_build_object('error', s); end if;
  delete from public.presence where client_id = p_client;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.presence_ping(text, uuid, text), public.presence_leave(text, uuid) from public;
grant execute on function public.presence_ping(text, uuid, text), public.presence_leave(text, uuid) to anon, authenticated;
