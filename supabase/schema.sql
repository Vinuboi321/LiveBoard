-- LiveBoard database schema for Supabase.
-- Run this whole file in the Supabase SQL editor (Project → SQL Editor → New query → paste → Run).
-- It is safe to run again: upgrades add what is missing. supabase/migrations/ holds each upgrade on its own.

-- Each synced record is stored whole as JSON; the newest updated_at wins.
create table if not exists public.notes (
  id text primary key,
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  data jsonb not null,
  updated_at bigint not null,
  deleted boolean not null default false
);
create table if not exists public.markers (
  id text primary key,
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  data jsonb not null,
  updated_at bigint not null,
  deleted boolean not null default false
);
create table if not exists public.courses (
  id text primary key,
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  data jsonb not null,
  updated_at bigint not null,
  deleted boolean not null default false
);

create index if not exists notes_user_updated on public.notes (user_id, updated_at);
create index if not exists markers_user_updated on public.markers (user_id, updated_at);
create index if not exists courses_user_updated on public.courses (user_id, updated_at);

create table if not exists public.profiles (
  user_id uuid primary key references auth.users on delete cascade default auth.uid(),
  data jsonb not null default '{}',
  updated_at bigint not null default 0
);

alter table public.notes enable row level security;
alter table public.markers enable row level security;
alter table public.courses enable row level security;
alter table public.profiles enable row level security;

do $$
declare t text;
begin
  foreach t in array array['notes','markers','courses','profiles'] loop
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('create policy "own rows" on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

-- Classes: a course a teacher or student shares with a join code. Powers the class leaderboard.
create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  owner uuid not null references auth.users on delete cascade default auth.uid(),
  created_at timestamptz not null default now()
);
create table if not exists public.class_members (
  class_id uuid references public.classes on delete cascade,
  user_id uuid references auth.users on delete cascade default auth.uid(),
  display_name text not null,
  joined_at timestamptz not null default now(),
  primary key (class_id, user_id)
);
create table if not exists public.recall_events (
  id bigserial primary key,
  class_id uuid not null references public.classes on delete cascade,
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  points int not null check (points between 0 and 20),
  at timestamptz not null default now()
);
alter table public.classes enable row level security;
alter table public.class_members enable row level security;
alter table public.recall_events enable row level security;

drop policy if exists "members read class" on public.classes;
create policy "members read class" on public.classes for select
  using (exists (select 1 from public.class_members m where m.class_id = id and m.user_id = auth.uid()));
drop policy if exists "own membership" on public.class_members;
create policy "own membership" on public.class_members for select using (user_id = auth.uid());
drop policy if exists "log own points" on public.recall_events;
create policy "log own points" on public.recall_events for insert
  with check (user_id = auth.uid() and exists (select 1 from public.class_members m where m.class_id = recall_events.class_id and m.user_id = auth.uid()));

create or replace function public.create_class(p_name text, p_display text)
returns table (id uuid, code text) language plpgsql security definer set search_path = public as $$
declare v_code text; v_id uuid;
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  loop
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    exit when not exists (select 1 from public.classes c where c.code = v_code);
  end loop;
  insert into public.classes (code, name, owner) values (v_code, left(p_name, 60), auth.uid()) returning classes.id into v_id;
  insert into public.class_members (class_id, user_id, display_name) values (v_id, auth.uid(), left(coalesce(nullif(p_display, ''), 'Student'), 40));
  return query select v_id, v_code;
end $$;

create or replace function public.join_class(p_code text, p_display text)
returns table (id uuid, name text, code text) language plpgsql security definer set search_path = public as $$
declare v public.classes;
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  select * into v from public.classes c where c.code = upper(trim(p_code));
  if v.id is null then raise exception 'class not found'; end if;
  insert into public.class_members (class_id, user_id, display_name)
    values (v.id, auth.uid(), left(coalesce(nullif(p_display, ''), 'Student'), 40))
    on conflict (class_id, user_id) do update set display_name = excluded.display_name;
  return query select v.id, v.name, v.code;
end $$;

create or replace function public.class_leaderboard(p_class uuid)
returns table (display_name text, points bigint, is_me boolean) language sql security definer set search_path = public as $$
  select m.display_name,
         coalesce((select sum(e.points) from public.recall_events e where e.class_id = m.class_id and e.user_id = m.user_id and e.at > now() - interval '7 days'), 0) as points,
         m.user_id = auth.uid() as is_me
  from public.class_members m
  where m.class_id = p_class
    and exists (select 1 from public.class_members me where me.class_id = p_class and me.user_id = auth.uid())
  order by points desc, m.display_name
  limit 50;
$$;

-- Daily AI usage counter used by /api/marker to enforce the free-tier cap.
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users on delete cascade,
  day date not null default current_date,
  count int not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
drop policy if exists "read own usage" on public.ai_usage;
create policy "read own usage" on public.ai_usage for select using (user_id = auth.uid());

create or replace function public.bump_ai_usage()
returns int language plpgsql security definer set search_path = public as $$
declare v int;
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  insert into public.ai_usage (user_id, day, count) values (auth.uid(), current_date, 1)
    on conflict (user_id, day) do update set count = ai_usage.count + 1
    returning count into v;
  return v;
end $$;

grant execute on function public.create_class(text, text) to authenticated;
grant execute on function public.join_class(text, text) to authenticated;
grant execute on function public.class_leaderboard(uuid) to authenticated;
grant execute on function public.bump_ai_usage() to authenticated;

-- ===================================================================================
-- Sync revisions (added 2026-11-03). Every write goes through push_rows, which only
-- applies a change when the device saw the latest server revision. Pulls follow a
-- server-assigned sequence number, so device clocks never decide what is "new".
-- ===================================================================================
create sequence if not exists public.liveboard_seq;
grant usage on sequence public.liveboard_seq to authenticated;

do $$
declare t text;
begin
  foreach t in array array['notes','markers','courses'] loop
    execute format('alter table public.%I add column if not exists rev bigint not null default 0', t);
    execute format('alter table public.%I add column if not exists seq bigint not null default 0', t);
    execute format('create index if not exists %I on public.%I (user_id, seq)', t || '_user_seq', t);
  end loop;
end $$;

-- p_rows: [{ id, base_rev (number, or null = "apply only if newer"), data, updated_at, deleted }]
-- Returns one result per row: { id, status: ok | conflict | stale | invalid, rev, data?, deleted? }
create or replace function public.push_rows(p_kind text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; out jsonb := '[]'::jsonb; v_rev bigint; v_base bigint;
  c_rev bigint; c_data jsonb; c_deleted boolean; c_updated bigint;
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  if p_kind not in ('notes', 'markers', 'courses') then raise exception 'unknown kind'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 200 then raise exception 'rows must be an array of at most 200'; end if;
  -- One writer per account at a time keeps seq order equal to commit order, so pulls never skip a row.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
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
grant execute on function public.push_rows(text, jsonb) to authenticated;

-- Writes go only through push_rows (which checks the owner itself); clients can read their own rows and nothing else.
-- Direct upserts from older app versions are refused, so they can't skip the revision check.
do $$
declare t text;
begin
  foreach t in array array['notes','markers','courses'] loop
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('drop policy if exists "read own rows" on public.%I', t);
    execute format('create policy "read own rows" on public.%I for select using (user_id = auth.uid())', t);
  end loop;
end $$;
revoke execute on function public.push_rows(text, jsonb) from public;

-- ===================================================================================
-- AI limits (added 2026-11-03). One atomic call per AI request: per-user daily,
-- per-user per-minute, and an app-wide daily cap. /api/marker refuses to call the
-- model unless this returns allowed = true.
-- ===================================================================================
create table if not exists public.ai_minute (
  user_id uuid not null references auth.users on delete cascade,
  minute timestamptz not null,
  count int not null default 0,
  primary key (user_id, minute)
);
create table if not exists public.ai_global (
  day date primary key,
  count int not null default 0
);
alter table public.ai_minute enable row level security;
alter table public.ai_global enable row level security;

create or replace function public.begin_ai_request(p_daily int, p_per_minute int, p_global int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_day int; v_min int; v_glob int; v_now timestamptz := date_trunc('minute', now());
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  -- Server-side ceilings, so a misconfigured environment variable can't remove the limits.
  p_daily := least(greatest(coalesce(p_daily, 60), 1), 1000);
  p_per_minute := least(greatest(coalesce(p_per_minute, 8), 1), 60);
  p_global := least(greatest(coalesce(p_global, 5000), 1), 1000000);

  insert into public.ai_global (day, count) values (current_date, 0) on conflict (day) do nothing;
  select count into v_glob from public.ai_global where day = current_date for update;
  if v_glob >= p_global then return jsonb_build_object('allowed', false, 'reason', 'global'); end if;

  insert into public.ai_usage (user_id, day, count) values (auth.uid(), current_date, 0) on conflict (user_id, day) do nothing;
  select count into v_day from public.ai_usage where user_id = auth.uid() and day = current_date for update;
  if v_day >= p_daily then return jsonb_build_object('allowed', false, 'reason', 'daily', 'used', v_day); end if;

  insert into public.ai_minute (user_id, minute, count) values (auth.uid(), v_now, 0) on conflict (user_id, minute) do nothing;
  select count into v_min from public.ai_minute where user_id = auth.uid() and minute = v_now for update;
  if v_min >= p_per_minute then return jsonb_build_object('allowed', false, 'reason', 'minute'); end if;

  update public.ai_global set count = count + 1 where day = current_date;
  update public.ai_usage set count = count + 1 where user_id = auth.uid() and day = current_date;
  update public.ai_minute set count = count + 1 where user_id = auth.uid() and minute = v_now;
  delete from public.ai_minute where user_id = auth.uid() and minute < v_now - interval '1 hour';
  return jsonb_build_object('allowed', true, 'used', v_day + 1);
end $$;
revoke all on function public.begin_ai_request(int, int, int) from public;
grant execute on function public.begin_ai_request(int, int, int) to authenticated;
revoke execute on function public.bump_ai_usage() from authenticated;

-- ===================================================================================
-- Recall points (added 2026-11-03). The server decides the points, and each marker
-- scores at most once per day, so the leaderboard can't be inflated by replays.
-- ===================================================================================
alter table public.recall_events add column if not exists marker_id text;
alter table public.recall_events add column if not exists day date not null default current_date;
create unique index if not exists recall_events_once_a_day on public.recall_events (user_id, class_id, marker_id, day);
drop policy if exists "log own points" on public.recall_events;

create or replace function public.log_recall(p_class uuid, p_marker text, p_got boolean)
returns int language plpgsql security definer set search_path = public as $$
declare v_pts int := case when p_got then 10 else 3 end;
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  if coalesce(p_marker, '') !~ '^[A-Za-z0-9_-]{1,64}$' then raise exception 'bad marker id'; end if;
  if not exists (select 1 from public.class_members m where m.class_id = p_class and m.user_id = auth.uid()) then return 0; end if;
  insert into public.recall_events (class_id, user_id, points, marker_id, day) values (p_class, auth.uid(), v_pts, p_marker, current_date)
    on conflict (user_id, class_id, marker_id, day) do nothing;
  return case when found then v_pts else 0 end;
end $$;
grant execute on function public.log_recall(uuid, text, boolean) to authenticated;
