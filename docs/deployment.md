# Deploying LiveBoard

A checklist for a private staging deploy, then a pilot with 10–20 students. Setup steps (accounts, keys) are in the README; this covers what to check before students rely on it, what to watch, and how to roll back.

## Environments

| | Staging | Production (pilot) |
| --- | --- | --- |
| Vercel | a Preview deployment or a separate project | the main project |
| Supabase | its own project (never share a database with production) | its own project |
| Anthropic | its own key with a low monthly limit | its own key with a monthly limit you can afford |

Secrets go only in Vercel's environment variables. Anything starting with `VITE_` is sent to the browser, so only the Supabase URL and anon key may use that prefix. `ANTHROPIC_API_KEY` must never have it.

## Database

1. Run `supabase/schema.sql` in the SQL editor. It is safe to run again; upgrades add what's missing.
2. Check in **Database → Functions** that `push_rows`, `begin_ai_request` and `log_recall` exist.
3. Check in **Authentication → Policies** that `notes`, `markers` and `courses` have only a **read own rows** policy (writes go through `push_rows`), and that `recall_events` has no insert policy.
4. Turn on Point-in-Time Recovery or daily backups (Supabase **Database → Backups**) before the pilot.

## Release gates

Don't give the link to students until each of these is true.

- [ ] `npm test` passes locally or in CI (API, browser, sync, database checks).
- [ ] `npm audit --audit-level=high` reports nothing.
- [ ] On staging, signed out: AI says it needs sign-in, and the network tab shows `/api/marker` answering 401 with no delay (no model call).
- [ ] Temporarily remove `SUPABASE_ANON_KEY` from staging's server variables and redeploy: AI answers 503 and Settings says AI isn't connected. Put it back.
- [ ] Two real devices, one account: edit the same note on both with one offline; reconnect; both versions exist (one as “(from another device)”).
- [ ] One device, two accounts: sign in as A, write a note, sign out, sign in as B. B sees nothing of A's. Sign back in as A: A's note is there.
- [ ] Offline on a phone: write in a note, close the app fully, reopen offline, the writing is there; reconnect, it uploads (status line clears).
- [ ] Import a real lecture PDF from the pilot course and place a few markers.
- [ ] Download a backup, delete a note, restore the backup: the note returns.
- [ ] Set `AI_DISABLED=true` and redeploy: markers still write, calculate and recall; AI says it's off. Remove it.

## Limits to start with

- `AI_DAILY_LIMIT=40`, `AI_PER_MINUTE_LIMIT=6`, `AI_GLOBAL_DAILY_LIMIT` = students × 40.
- An Anthropic monthly spend limit at roughly twice what the global cap allows, so the database cap trips first.

## What to watch during the pilot

- **Vercel → Logs** for `/api/marker`: each request logs one line with a request id, status and duration (never note text or tokens). Watch for runs of 503 (sign-in or usage check failing) or 502/504 (Anthropic errors or slowness).
- **Supabase → Table editor → `ai_global`**: today's AI request count against the cap.
- **Supabase → Logs**: errors from `push_rows` (a failing upload shows to students as “Sync paused · N changes saved on this device”).
- Ask pilot students to report any “(from another device)” copies; they mean real conflicts happened, which is fine, but frequent ones suggest people are editing the same note on two devices at once.

## Rollback

- **App:** Vercel → Deployments → pick the last good one → **Promote to Production**. Students' notes are on their devices and in Supabase, so an app rollback doesn't lose data. Older app versions can't write past the revision check, so their uploads wait rather than overwrite.
- **AI costs or abuse:** set `AI_DISABLED=true` or lower `AI_GLOBAL_DAILY_LIMIT`, then Redeploy the current deployment (about a minute; no code change needed).
- **Database:** restore from Supabase backups. Notes still waiting on students' devices upload after the restore, through the same revision check.

## Known limits for the pilot

- PDF import keeps the text only (no page images, layout or handwriting). The original file is not uploaded.
- Signing out while offline forgets the sign-in on that device but can't revoke the session on the server until the next online sign-out.
- The leaderboard rewards answering recall, not getting it right; points are capped to one per marker per day.
