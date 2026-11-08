-- Named lists the household can save and re-load (for example "monthly shopping", "top-ups").
-- Same pattern as the main list: closed table, access only through functions that check the household code.

create table if not exists public.saved_lists (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  items jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.saved_lists enable row level security;

create or replace function public.saved_lists_get(p_code text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s text := public._check_code(p_code);
begin
  if s <> 'ok' then return jsonb_build_object('error', s); end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'items', items) order by name)
    from public.saved_lists
  ), '[]'::jsonb);
end $$;

create or replace function public.saved_list_save(p_code text, p_name text, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s text := public._check_code(p_code);
begin
  if s <> 'ok' then return jsonb_build_object('error', s); end if;
  if p_name is null or length(trim(p_name)) = 0 then return jsonb_build_object('error', 'empty_name'); end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 300 then
    return jsonb_build_object('error', 'bad_items');
  end if;
  insert into public.saved_lists (name, items) values (left(trim(p_name), 60), p_items)
  on conflict (name) do update set items = excluded.items, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.saved_list_delete(p_code text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s text := public._check_code(p_code);
begin
  if s <> 'ok' then return jsonb_build_object('error', s); end if;
  delete from public.saved_lists where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.saved_lists_get(text), public.saved_list_save(text, text, jsonb), public.saved_list_delete(text, uuid) from public;
grant execute on function public.saved_lists_get(text), public.saved_list_save(text, text, jsonb), public.saved_list_delete(text, uuid) to anon, authenticated;
