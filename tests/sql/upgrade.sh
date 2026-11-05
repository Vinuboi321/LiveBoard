#!/usr/bin/env bash
# Upgrade check: start from the schema as it was before sync revisions (git 2a850a2), add data the old way,
# run today's schema twice, then confirm a fresh device's pull (seq > 0) sees every old record.
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=${DB:-lbupgrade}
dropdb --if-exists "$DB" && createdb "$DB"
OLD=$(mktemp); git show 2a850a2:supabase/schema.sql > "$OLD"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f tests/sql/supabase-shim.sql -f "$OLD" >/dev/null 2>&1
psql -q -v ON_ERROR_STOP=1 -d "$DB" >/dev/null 2>&1 <<'SQL'
insert into auth.users values ('00000000-0000-0000-0000-00000000000a');
insert into public.notes (id, user_id, data, updated_at) values ('legacy1', '00000000-0000-0000-0000-00000000000a', '{"title":"old note"}', 5), ('legacy2', '00000000-0000-0000-0000-00000000000a', '{"title":"old note 2"}', 6);
insert into public.markers (id, user_id, data, updated_at) values ('lm1', '00000000-0000-0000-0000-00000000000a', '{"text":"old marker"}', 5);
insert into public.courses (id, user_id, data, updated_at) values ('lc1', '00000000-0000-0000-0000-00000000000a', '{"name":"OLD"}', 5);
SQL
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/schema.sql -f supabase/schema.sql >/dev/null 2>&1
R=$(psql -tA -d "$DB" -c "select (select count(*) from public.notes where seq > 0) || ',' || (select count(*) from public.markers where seq > 0) || ',' || (select count(*) from public.courses where seq > 0) || ',' || (select count(distinct seq) from (select seq from notes union all select seq from markers union all select seq from courses) s)")
echo "rows visible to a fresh device (notes,markers,courses,distinct seq): $R"
rm -f "$OLD"
[ "$R" = "2,1,1,4" ] && echo "UPGRADE CHECK PASSES" || { echo "UPGRADE CHECK FAILED"; exit 1; }
