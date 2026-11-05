-- Superseded by 20261105_deletion_barrier.sql, which must run after this.
-- Lets a student delete everything their account stored (added 2026-11-04).
-- The sign-in record itself (auth.users) can only be removed by an admin: Supabase → Authentication → Users → Delete.
drop function if exists public.delete_my_data();
create or replace function public.delete_my_data()
returns void language plpgsql security definer set search_path = public as $$
declare v uuid := auth.uid();
begin
  if v is null then raise exception 'sign in required'; end if;
  delete from public.notes where user_id = v;
  delete from public.markers where user_id = v;
  delete from public.courses where user_id = v;
  delete from public.profiles where user_id = v;
  delete from public.recall_events where user_id = v;
  delete from public.class_members where user_id = v;
  delete from public.ai_usage where user_id = v;
  delete from public.ai_minute where user_id = v;
  delete from public.classes c where c.owner = v and not exists (select 1 from public.class_members m where m.class_id = c.id);
end $$;
revoke all on function public.delete_my_data() from public;
grant execute on function public.delete_my_data() to authenticated;
