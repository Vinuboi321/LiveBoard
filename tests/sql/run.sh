#!/usr/bin/env bash
# Runs supabase/schema.sql twice (fresh install, then upgrade) on a throwaway local Postgres database, then the behavior checks.
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=${DB:-lbtest}
PSQL=${PSQL:-psql}
dropdb --if-exists "$DB" && createdb "$DB"
$PSQL -q -v ON_ERROR_STOP=1 -d "$DB" -f tests/sql/supabase-shim.sql -f supabase/schema.sql -f supabase/schema.sql -f tests/sql/check.sql 2>&1 | grep -v "NOTICE" > /tmp/lb-sql.log || true; cat /tmp/lb-sql.log; grep -q "ALL SQL CHECKS PASS" /tmp/lb-sql.log
bash tests/sql/upgrade.sh
