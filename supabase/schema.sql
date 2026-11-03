-- LiveBoard database schema for Supabase.
-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query → paste → Run).

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
