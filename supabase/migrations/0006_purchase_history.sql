-- What the household bought before, so the app can offer it again with one tap.
-- A purchase is counted when an item is put in the cart.

create table if not exists public.history (
  key text primary key,            -- b:<barcode>, w:<keyword> or t:<text>
  text text not null,
  kind text not null check (kind in ('barcode', 'weighted', 'free')),
  barcode text,
  keyword text,
  dept text,
  qty numeric not null default 1,  -- the quantity used last time
  times int not null default 0,
  last_at timestamptz not null default now()
);
alter table public.history enable row level security;

create or replace function public.history_bump(p_code text, p_item jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  s text := public._check_code(p_code);
  k text;
begin
  if s <> 'ok' then return jsonb_build_object('error', s); end if;
  k := case p_item->>'kind'
         when 'barcode' then 'b:' || (p_item->>'barcode')
         when 'weighted' then 'w:' || lower(trim(p_item->>'keyword'))
         else 't:' || lower(trim(p_item->>'text')) end;
  if k is null or length(k) < 3 or length(k) > 160 then return jsonb_build_object('error', 'bad_key'); end if;
  insert into public.history (key, text, kind, barcode, keyword, dept, qty, times, last_at)
  values (k, left(p_item->>'text', 200), p_item->>'kind', p_item->>'barcode', p_item->>'keyword',
          left(nullif(trim(p_item->>'dept'), ''), 40), coalesce((p_item->>'qty')::numeric, 1), 1, now())
  on conflict (key) do update set
    times = public.history.times + 1, last_at = now(), qty = excluded.qty,
    text = excluded.text, dept = coalesce(excluded.dept, public.history.dept);
  delete from public.history where times <= 1 and last_at < now() - interval '1 year';
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.history_get(p_code text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s text := public._check_code(p_code);
begin
  if s <> 'ok' then return jsonb_build_object('error', s); end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'key', key, 'text', text, 'kind', kind, 'barcode', barcode, 'keyword', keyword,
      'dept', dept, 'qty', qty, 'times', times, 'lastAt', last_at
    ) order by times desc, last_at desc)
    from (select * from public.history order by times desc, last_at desc limit 80) h
  ), '[]'::jsonb);
end $$;

revoke all on function public.history_bump(text, jsonb), public.history_get(text) from public;
grant execute on function public.history_bump(text, jsonb), public.history_get(text) to anon, authenticated;
