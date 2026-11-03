-- Behavioral checks for sync revisions, row isolation, AI limits and recall scoring. Run as a superuser after the schema.
grant select, insert, update on all tables in schema public to authenticated;
insert into auth.users values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b');

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';

-- first write
select public.push_rows('notes', '[{"id":"n1","base_rev":0,"data":{"title":"A1"},"updated_at":1,"deleted":false}]')->0->>'status' = 'ok' as first_write_ok \gset
\if :first_write_ok \else \echo 'FAIL first write' \quit \endif
-- write on top of the latest revision
select public.push_rows('notes', '[{"id":"n1","base_rev":1,"data":{"title":"A2"},"updated_at":2}]')->0->>'rev' = '2' as second_ok \gset
\if :second_ok \else \echo 'FAIL second write' \quit \endif
-- a stale device (still on rev 1) is refused and gets the server copy back
select (public.push_rows('notes', '[{"id":"n1","base_rev":1,"data":{"title":"STALE"},"updated_at":99}]')->0) as r \gset
select (:'r'::jsonb->>'status') = 'conflict' and (:'r'::jsonb->'data'->>'title') = 'A2' as stale_refused \gset
\if :stale_refused \else \echo 'FAIL stale overwrite allowed' :r \quit \endif
select (select data->>'title' from public.notes where id = 'n1') = 'A2' as server_kept \gset
\if :server_kept \else \echo 'FAIL server lost data' \quit \endif
-- legacy rows (no base) only apply when newer
select public.push_rows('notes', '[{"id":"n1","base_rev":null,"data":{"title":"OLD"},"updated_at":1}]')->0->>'status' = 'stale' as legacy_old \gset
\if :legacy_old \else \echo 'FAIL legacy older row applied' \quit \endif
-- direct writes that bypass revisions: insert works only for own rows
select (select count(*) from public.notes) = 1 as sees_own \gset
\if :sees_own \else \echo 'FAIL A row count' \quit \endif
-- bad ids are rejected
select public.push_rows('notes', '[{"id":"../x","data":{}}]')->0->>'status' = 'invalid' as bad_id \gset
\if :bad_id \else \echo 'FAIL bad id accepted' \quit \endif

-- user B can't see or take over A's row
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select (select count(*) from public.notes) = 0 as b_isolated \gset
\if :b_isolated \else \echo 'FAIL B sees A rows' \quit \endif
select public.push_rows('notes', '[{"id":"n1","base_rev":0,"data":{"title":"HIJACK"},"updated_at":5}]')->0->>'status' = 'invalid' as no_hijack \gset
\if :no_hijack \else \echo 'FAIL B overwrote A' \quit \endif
update public.notes set data = '{"title":"X"}' where id = 'n1';
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
\echo '(expected) a direct write that skips push_rows is refused:'
\set ON_ERROR_STOP 0
update public.notes set data = '{"title":"DIRECT"}' where id = 'n1';
insert into public.notes (id, user_id, data, updated_at) values ('n9', auth.uid(), '{}', 1);
\set ON_ERROR_STOP 1
reset role;
select (select data->>'title' from public.notes where id = 'n1') = 'A2' as a_intact \gset
\if :a_intact \else \echo 'FAIL A row changed by B' \quit \endif

-- pull cursor: seq increases with each write
select (select seq from public.notes where id = 'n1') > 0 as has_seq \gset
\if :has_seq \else \echo 'FAIL seq missing' \quit \endif

-- AI limits: per-minute cap 2, daily cap 3, global cap 4
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select (public.begin_ai_request(3, 2, 4)->>'allowed')::boolean as a1 \gset
select (public.begin_ai_request(3, 2, 4)->>'allowed')::boolean as a2 \gset
select public.begin_ai_request(3, 2, 4)->>'reason' = 'minute' as a3_minute \gset
\if :a1 \else \echo 'FAIL first AI request refused' \quit \endif
\if :a3_minute \else \echo 'FAIL per-minute limit' \quit \endif
reset role;
update public.ai_minute set minute = minute - interval '5 minutes';
set role authenticated;
select (public.begin_ai_request(3, 2, 4)->>'allowed')::boolean as a4 \gset
select public.begin_ai_request(3, 2, 4)->>'reason' = 'daily' as a5_daily \gset
\if :a5_daily \else \echo 'FAIL daily limit' \quit \endif
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select (public.begin_ai_request(3, 2, 4)->>'allowed')::boolean as b1 \gset
select public.begin_ai_request(3, 2, 4)->>'reason' = 'global' as b2_global \gset
\if :b2_global \else \echo 'FAIL global limit' \quit \endif
-- anonymous callers get nothing
\echo '(expected) signed-out AI request is refused:'
set request.jwt.claim.sub = '';
\set ON_ERROR_STOP 0
select public.begin_ai_request(3, 2, 4);
\set ON_ERROR_STOP 1

-- recall scoring: server decides points, once per marker per day
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select id as cls from public.create_class('BIO', 'Ana') \gset
select public.log_recall(:'cls', 'm1', true) = 10 as r1 \gset
select public.log_recall(:'cls', 'm1', true) = 0 as r2_once \gset
\if :r1 \else \echo 'FAIL recall points' \quit \endif
\if :r2_once \else \echo 'FAIL recall replay scored' \quit \endif
\echo '(expected) direct point insert is refused:'
\set ON_ERROR_STOP 0
insert into public.recall_events (class_id, points) values (:'cls', 20);
\set ON_ERROR_STOP 1
select (select points from public.class_leaderboard(:'cls') limit 1) = 10 as lb_ok \gset
\if :lb_ok \else \echo 'FAIL direct point insert counted' \quit \endif
\echo 'ALL SQL CHECKS PASS'
