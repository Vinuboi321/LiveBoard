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

1. Run `supabase/schema.sql` in the SQL editor. It is safe to run again; upgrades add what's missing. When upgrading a database that already has notes, it also gives older records sequence numbers so new devices download them (`tests/sql/upgrade.sh` checks this). Run it before deploying a new app version: the app needs the new functions.
2. Check in **Database → Functions** that `push_rows` (three arguments), `push_profile`, `sync_state`, `begin_ai_request`, `log_recall` and `delete_my_data` exist, and that the old two-argument `push_rows` is gone.
3. Check in **Authentication → Policies** that `notes`, `markers`, `courses` and `profiles` have only a read policy (writes go through `push_rows` and `push_profile`), and that `recall_events` has no insert policy.
4. Turn on Point-in-Time Recovery or daily backups (Supabase **Database → Backups**) before the pilot.

## Sign-in email (required before any student can sign in)

Supabase's built-in email only delivers to members of your Supabase team, and only 2 messages an hour. Students would never get a sign-in email.

1. Set up a sending service (Resend, Postmark, Brevo or Amazon SES all work) and verify a domain you own.
2. In Supabase **Authentication → Emails → SMTP Settings**, turn on custom SMTP with that service's details.
3. In **Authentication → Rate Limits**, raise the email limit to what the pilot needs (for 20 students, 30 an hour is plenty).
4. In **Authentication → Emails → Templates → Magic Link**, make sure the email shows the code as well as the link, for example:
   `<p><a href="{{ .ConfirmationURL }}">Sign in to LiveBoard</a></p><p>Or type this code in LiveBoard: <b>{{ .Token }}</b></p>`
   On iPad, a LiveBoard added to the home screen keeps its own storage, and links open in Safari instead, so students there need the code.

## Before real students use it

- **Privacy notice.** Students' notes are stored in Supabase, and the parts of a note near a marker are sent to Anthropic when they use AI. Say so in plain words, and say who to contact to delete data. Settings has "Delete my data from LiveBoard's servers"; you still need to delete the sign-in record yourself in **Authentication → Users**. If the pilot runs through a course, check with the instructor or the university about storing course material and student data.
- **Lecture files.** Imported PDFs aren't uploaded, but their text is saved in notes. Ask the instructor before students import their slides.
- **Custom domain.** If you put LiveBoard on your own domain, nothing changes in the app. If you point it at a self-hosted Supabase instead of `*.supabase.co`, add that address to `connect-src` in `vercel.json`.

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
- [ ] Sign in on an iPad from the home-screen app by typing the code from the email.
- [ ] Open the deployed site, then DevTools → Console: no "Content Security Policy" errors while importing, calculating and drawing a diagram.
- [ ] Delete account data with an unsynced edit on one device and a second device offline: the server stays empty after both reconnect, and the second device says its online copy was deleted.
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
