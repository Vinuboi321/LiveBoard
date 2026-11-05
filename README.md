# LiveBoard

A study notes app where **markers are the only tool**. Import a lecture or start a blank page, select any text (or tap **+** on an empty line), and type what you want in plain words. The marker explains, expands, calculates, reformats, draws, links or drafts, and anything that belongs in your notes is written into the page. Every marker tracks how well you know it, and each morning the home dial quizzes you on what you marked.

LiveBoard installs as an app on iPad, iPhone, Windows and Mac from the browser, and it works offline. Notes live on the device first. When accounts are set up, they also sync to Supabase.

## What's in it

**Home: the time dial.** Notes sit around a ring by when you last opened them. The 3 most recent float as large cards, older notes stack in colored folders (This week, This month, Last month, This year, Last year, Older), and folders fan open on hover or when spun under the pointer. Import lecture and Blank page live in the center.

**Morning strip.** Shows your streak with the last 7 days, a recall scope (last night, this week, this course), **Start recall**, and your class rank.

**Recall in the hub.** Questions play inside the dial's center while the ring turns to each question's note. *Got it* pushes a marker out on a growing interval and *Again* brings it back in 10 minutes. Finishing a session counts the day toward your streak.

**Markers (the one tool).**

| Type in the marker box | What happens | Needs AI |
| --- | --- | --- |
| `explain this simpler`, `give me an example`, `expand on this` | Explanation written into the note, tinted until you **Keep** or **Remove** it | yes |
| `why does this work?`, any question | Answer in the marker; **Add to note** if you want it | yes |
| `outline this topic`, `summarize this note`, `draft notes on …` (on a blank-line marker) | Generated notes written at that spot | yes |
| `draw a diagram`, `show the cycle` | A diagram rendered in the note | yes |
| `turn this into a list` (multi-sentence passage) | The passage rewritten as a list | yes |
| `e^0.5 * 0.5^4 / 4!`, `calc 3*(2+5)` | Result from a math engine with 64-digit precision, never from the model | no |
| `make this a heading`, `bold`, `highlight`, `quote` | Formats the passage | no |
| `link to elasticity` | Two-way link to the best-matching note (shows on that note too) | no |
| `related notes` | Your other notes that mention the same ideas | no |
| `remind me friday`, `review in 3 days`, `remind me before the exam` | The marker comes back in recall then | no |

Shortcut chips adapt to what you marked. Math gets "Show the steps," a definition gets "Make a flashcard," a process gets "Turn into numbered steps," and code gets "Explain this code line by line."

**Traceable writing.** Everything a marker writes into a note has a "marker ↗" chip that reopens it. Its Write tab keeps up to 12 versions of each block, and you can restore any of them.

**Search.** Press ⌘K / Ctrl+K (or /) to search every marker's passage, drafts, questions, answers, recall cards and connections.

**Study guides.** From a marker's Related tab, **Build a study guide** combines every point connected to it into one new note. Each section links back to its original point. With the AI connected, it also writes a short overview.

**Free markers.** Drop a marker anywhere on a page (+ Marker, double-click a margin, or press and hold) and drag it around. Linked markers are joined by a faint thread behind the text.

Markers are color-coded by type: writing, question, explanation, math, visual, link and reminder. Their dot fills in as you go from **Unsure** to **Getting it** to **Mastered**. A rail in the page margin shows every marker on the page. The classic formatting toolbar is hidden behind **Aa**.

**Import:** PDF (text is extracted page by page), .txt and .md.
**Classes:** share a course as a class with a 6-character code, and classmates who join appear on a weekly leaderboard built from recall points.
**Backup:** download and restore a JSON backup from Settings.

## Set up and deploy

You need three free accounts: **Supabase** (accounts and sync), an **Anthropic API key** (AI markers), and **Vercel** (hosting). The app also runs without any of them. It then saves on the device only, and math, formatting, links and reminders still work.

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor**, then **New query**. Paste all of `supabase/schema.sql` and click **Run**. It's safe to run again after an update; each upgrade is also in `supabase/migrations/`.
3. Go to **Authentication → Providers**. Email is on by default, and LiveBoard signs people in with an emailed link or code. Supabase's built-in email only reaches your own team (2 an hour), so set up custom SMTP and add the code to the email template before inviting students; see [docs/deployment.md](docs/deployment.md#sign-in-email-required-before-any-student-can-sign-in).
4. Go to **Authentication → URL Configuration**. Set **Site URL** to your Vercel URL once you have it (for example `https://liveboard-yourname.vercel.app`), and add it under **Redirect URLs**.
5. From **Project Settings → API**, copy the **Project URL** and the **anon public** key.

### 2. Anthropic

Create an API key at [console.anthropic.com](https://console.anthropic.com), add billing, and set a monthly spend limit there.

### 3. Vercel

1. Import this GitHub repo at [vercel.com/new](https://vercel.com/new). The framework is detected as Vite, and the build settings come from `vercel.json`.
2. Add these environment variables (see `.env.example`):
   - `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
   - `SUPABASE_URL` and `SUPABASE_ANON_KEY` (the same values, used by the server to check sign-in)
   - `ANTHROPIC_API_KEY`
   - optionally `ANTHROPIC_MODEL`, and the limits `AI_DAILY_LIMIT` (per student per day, default 60), `AI_PER_MINUTE_LIMIT` (default 8) and `AI_GLOBAL_DAILY_LIMIT` (whole app per day, default 5000)
   - `AI_DISABLED=true` turns AI off at once if costs spike; writing, math and recall keep working

   AI fails closed: if the sign-in check or the usage check isn't configured or can't be reached, no model call is made. See [docs/deployment.md](docs/deployment.md) for the release checklist, monitoring and rollback.
3. Deploy, then put the URL back into Supabase's Site URL (step 1.4).

### 4. Install it

- **iPad / iPhone:** open the site in Safari, tap **Share**, then **Add to Home Screen**.
- **Windows / Mac:** open it in Edge or Chrome, then choose **Install LiveBoard** from the address bar.

## Develop

```bash
npm install
npm run dev            # app only; AI shows "not connected"
npx vercel dev         # app + /api/marker with your .env.local
npm run build          # typecheck + production build
npm test               # builds, then runs every check below (CI runs the same on each push)
```

| Suite | What it proves |
| --- | --- |
| `tests/api.cjs` | `/api/marker` makes no model call without verified sign-in and a working usage check; bad input gets 400/413, slow AI 504 |
| `tests/e2e.cjs`, `tests/regressions.cjs` | the marker flows, dial, recall and earlier bug fixes in a real browser (AI mocked) |
| `tests/safety.cjs` | strict backup restore, markers that survive deleting their passage, exam reminders, the sandboxed calculator |
| `tests/sync.cjs` | against a fake Supabase: offline edits survive restarts and sign-out, accounts stay separate, two devices editing one note keep both versions |
| `tests/sql/run.sh` | `supabase/schema.sql` on real Postgres: revision checks, row isolation, AI limits, once-a-day recall points (needs local Postgres) |

## How it's built

| Layer | Choice |
| --- | --- |
| App | Vite + TypeScript, no framework. Installable PWA (vite-plugin-pwa) |
| Editor | TipTap (ProseMirror) with custom `marker` mark, `pin` node, `markerOutput` node and `diagram` node (`src/editor/extensions.ts`) |
| Marker box | `src/editor/markerBox.ts`. Local intents run first (`src/ai.ts`), everything else goes to `/api/marker` |
| AI | `api/marker.ts`, a Vercel function calling the Claude Messages API with a forced tool call, so results come back structured (`insert` vs `answer`, type, markdown, calc, mermaid, recall Q/A) |
| Math | mathjs with 64-digit BigNumber precision, in a worker that is stopped after 4 seconds (`src/mathCore.ts`) |
| Storage | IndexedDB via Dexie (`src/store.ts`), local-first. One database per account on the device, and every change is written with an upload-queue entry in the same transaction |
| Sync | Supabase (`src/sync.ts`). Uploads go through `push_rows`, which only applies a change made on top of the latest server revision; downloads follow a server sequence number. Row-level security keeps every row private to its owner |
| Backup | `src/backup.ts` validates every field and node type, then `restoreBackup` writes it in one transaction |
| Home | `src/home/home.ts`: dial, morning strip, recall |

The backend contract (`/api/marker`) and the Supabase tables are plain JSON, so a native Flutter app can reuse both as they are.

## Known gaps and next steps

- **Handwriting:** Apple Pencil ink isn't in the web app. It's the main reason for the planned Flutter version.
- **Scanned PDFs** need OCR, and markers on imported PDFs anchor to the extracted text, not to the original page layout.
- **Tables** from the AI become lists, because the editor doesn't have tables yet.
- **Sync conflicts:** when two devices change one note, the device that uploads second keeps its version in place and the other version is saved as a copy named “… (from another device)”. Its markers stay with the original, so the copy is plain text. Marker conflicts merge (every message, answer and written version is kept).
- **Accounts on shared devices:** each account has its own database on the device. Signing out keeps a copy for next time (unsynced changes upload on the next sign-in); “Sign out and remove from this device” deletes it, and is refused while changes are still waiting. Notes made while signed out are only added to an account when the student says so. Signing out while offline forgets the sign-in on the device, but can't revoke it on the server until the next online sign-out.
- **Several tabs:** a note open in two tabs updates live in both. If both are typing in the same second, the other tab's version is kept as a copy.
- **Markers whose passage is deleted** keep everything and show “Source removed”, with a button to put them back.
- **Math** uses 64-digit precision. A few functions only exist for ordinary numbers, and those results are marked ≈.
- **Leaderboard** points are decided by the server: 10 for “Got it”, 3 for “Again”, once per marker per day. It's still a friendly measure of effort, not proof of knowledge.
- **Dependencies:** `npm audit` reports 10 low/moderate findings, all in the service-worker build tooling (workbox-build and its glob/minimatch/ejs chain via vite-plugin-pwa). They run only at build time on trusted input and aren't shipped to students. CI fails on any high or critical finding.
- AI answers arrive all at once. Streaming would make long drafts feel faster.
