-- ===================================================================================
-- Deletion barrier (added 2026-11-05). Each account has a data generation. Deleting the
-- account's data bumps it; uploads made under an older generation are refused, so a
-- device that was offline during the deletion can't put the deleted notes back.
-- ===================================================================================
create table if not exists public.sync_generation (
  user_id uuid primary key references auth.users on delete cascade,
  gen bigint not null default 0
);
alter table public.sync_generation enable row level security;
drop policy if exists "read own generation" on public.sync_generation;
create policy "read own generation" on public.sync_generation for select using (user_id = auth.uid());

create or replace function public.sync_state()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('gen', coalesce((select gen from public.sync_generation where user_id = auth.uid()), 0));
$$;
revoke all on function public.sync_state() from public;
grant execute on function public.sync_state() to authenticated;

-- Uploads now carry the generation. The two-argument version is removed so nothing can skip the check.
drop function if exists public.push_rows(text, jsonb);
create or replace function public.push_rows(p_kind text, p_rows jsonb, p_gen bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; out jsonb := '[]'::jsonb; v_rev bigint; v_base bigint; v_gen bigint;
  c_rev bigint; c_data jsonb; c_deleted boolean; c_updated bigint;
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  if p_kind not in ('notes', 'markers', 'courses') then raise exception 'unknown kind'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 200 then raise exception 'rows must be an array of at most 200'; end if;
  -- One writer per account at a time (deletion takes the same lock), and seq order equals commit order.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  v_gen := coalesce((select gen from public.sync_generation where user_id = auth.uid()), 0);
  if p_gen is distinct from v_gen then
    return (select coalesce(jsonb_agg(jsonb_build_object('id', e->>'id', 'status', 'erased')), '[]'::jsonb) from jsonb_array_elements(p_rows) e);
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    if coalesce(r->>'id', '') !~ '^[A-Za-z0-9_-]{1,64}$' or jsonb_typeof(r->'data') <> 'object' or pg_column_size(r->'data') > 2000000 then
      out := out || jsonb_build_object('id', r->>'id', 'status', 'invalid'); continue;
    end if;
    c_rev := null; c_data := null; c_deleted := null; c_updated := null;
    execute format('select rev, data, deleted, updated_at from public.%I where id = $1 and user_id = $2 for update', p_kind) into c_rev, c_data, c_deleted, c_updated using r->>'id', auth.uid();
    v_base := case when r ? 'base_rev' and jsonb_typeof(r->'base_rev') = 'number' then (r->>'base_rev')::bigint else null end;
    if c_rev is null then
      begin
        execute format('insert into public.%I (id, user_id, data, updated_at, deleted, rev, seq) values ($1, auth.uid(), $2, $3, $4, 1, nextval(''public.liveboard_seq''))', p_kind)
          using r->>'id', r->'data', coalesce((r->>'updated_at')::bigint, 0), coalesce((r->>'deleted')::boolean, false);
        out := out || jsonb_build_object('id', r->>'id', 'status', 'ok', 'rev', 1);
      exception when unique_violation then
        out := out || jsonb_build_object('id', r->>'id', 'status', 'invalid'); -- the id belongs to someone else
      end;
    elsif (v_base is not null and c_rev = v_base) or (v_base is null and coalesce((r->>'updated_at')::bigint, 0) > c_updated) then
      v_rev := c_rev + 1;
      execute format('update public.%I set data = $2, updated_at = $3, deleted = $4, rev = $5, seq = nextval(''public.liveboard_seq'') where id = $1 and user_id = $6', p_kind)
        using r->>'id', r->'data', coalesce((r->>'updated_at')::bigint, 0), coalesce((r->>'deleted')::boolean, false), v_rev, auth.uid();
      out := out || jsonb_build_object('id', r->>'id', 'status', 'ok', 'rev', v_rev);
    else
      out := out || jsonb_build_object('id', r->>'id', 'status', case when v_base is null then 'stale' else 'conflict' end,
                                       'rev', c_rev, 'data', c_data, 'deleted', c_deleted);
    end if;
  end loop;
  return out;
end $$;
revoke all on function public.push_rows(text, jsonb, bigint) from public;
grant execute on function public.push_rows(text, jsonb, bigint) to authenticated;

-- Profile (streak, points, name) is written through the same barrier; clients can only read it directly.
create or replace function public.push_profile(p_data jsonb, p_gen bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  if jsonb_typeof(p_data) <> 'object' or pg_column_size(p_data) > 100000 then return jsonb_build_object('status', 'invalid'); end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  if p_gen is distinct from coalesce((select gen from public.sync_generation where user_id = auth.uid()), 0) then
    return jsonb_build_object('status', 'erased');
  end if;
  insert into public.profiles (user_id, data, updated_at) values (auth.uid(), p_data, (extract(epoch from now()) * 1000)::bigint)
    on conflict (user_id) do update set data = excluded.data, updated_at = excluded.updated_at;
  return jsonb_build_object('status', 'ok');
end $$;
revoke all on function public.push_profile(jsonb, bigint) from public;
grant execute on function public.push_profile(jsonb, bigint) to authenticated;
drop policy if exists "own rows" on public.profiles;
drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles for select using (user_id = auth.uid());

-- Deleting takes the account's write lock, removes everything, and bumps the generation in one transaction.
drop function if exists public.delete_my_data();
create or replace function public.delete_my_data()
returns bigint language plpgsql security definer set search_path = public as $$
declare v uuid := auth.uid(); v_gen bigint;
begin
  if v is null then raise exception 'sign in required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v::text, 0));
  delete from public.notes where user_id = v;
  delete from public.markers where user_id = v;
  delete from public.courses where user_id = v;
  delete from public.profiles where user_id = v;
  delete from public.recall_events where user_id = v;
  delete from public.class_members where user_id = v;
  delete from public.ai_usage where user_id = v;
  delete from public.ai_minute where user_id = v;
  delete from public.classes c where c.owner = v and not exists (select 1 from public.class_members m where m.class_id = c.id);
  insert into public.sync_generation (user_id, gen) values (v, 1)
    on conflict (user_id) do update set gen = sync_generation.gen + 1
    returning gen into v_gen;
  return v_gen;
end $$;
revoke all on function public.delete_my_data() from public;
grant execute on function public.delete_my_data() to authenticated;
