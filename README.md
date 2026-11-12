# LiveBoard

A study notes app where **markers are the only tool**. Import a lecture or start a blank page, select any text (or tap **+** on an empty line), and type what you want in plain words. The marker explains, expands, calculates, reformats, draws, links or drafts, and anything that belongs in your notes is written into the page. Every marker tracks how well you know it, and each morning the home dial quizzes you on what you marked.

LiveBoard installs as an app on iPad, iPhone, Windows and Mac from the browser, and it works offline. Notes live on the device first. When accounts are set up, they also sync to Supabase.

## What's in it

**Home: the time dial.** Notes sit around a ring by when you last opened them. The 3 most recent float as large cards, older notes stack in colored folders (This week, This month, Last month, then one folder for everything older), and folders fan open on hover or when spun under the pointer. Import and Blank page live in the center hub. The hub itself is calm, neutral glass, so the color stays with the folders and files. The ring around it is the time scale, drawn in quiet ink with only the selected item's stretch lit in its color. A bezel of fine ticks turns with the dial and swells under the pointer, small study sprites (bits of maths and science, tiny graphs, an atom, a grade) drift along the track and are dragged when you spin, a ring runs outward each time something new lands under the pointer, and the hub leans toward the cursor (all drawn on one canvas, `src/home/bezel.ts`, and still under reduced motion). Each note card carries a memory fingerprint, one dot per marker, filled by how well you know it. Opening a note grows its card into the page.

**Morning strip.** Shows your streak (tap it for a 7-day forecast of what comes due), a recall scope (all due, last night, this week, this course), **Start recall**, and your class rank. A course with an exam date in Settings gets a countdown chip with how ready you are (the share of its markers you've mastered) and a **Cram** button that opens a cram sitting for that course (below).

**Recall in the hub.** Questions play inside the dial's center while the ring turns to each question's note. You can type what you remember before revealing; the answer then shows which of its key ideas you included and which you missed (worked out on the device), and with the AI connected, **Check with AI** adds a two-sentence verdict. *Got it* pushes a marker out on a growing interval and *Again* brings it back in 10 minutes. Space shows the answer, then 1 and 2 grade it. The end screen lists what's still shaky. Finishing a session counts the day toward your streak.

**Test me.** On any note with marked passages, **Test me** covers every one. Tap a passage to reveal it and say whether you knew it; the answer moves that marker's mastery and next review exactly as recall does. The note can't be edited while it's on.

**One-tap marking.** Selecting text shows **Place marker** plus actions that mark and run in one tap. With the AI they fit the selection (Simplify, Example, Quiz, Show the steps); without it they're Highlight, Remind me tomorrow and Calculate.

**Lost me here.** Capture confusion at the current selection or cursor without opening a panel or interrupting the lecture. It creates a marker (or uses the marked passage), records the moment in Journey, and makes the point due for recall. It works offline.

**Journey.** Inside a marker, save “I originally thought” alongside “Now I understand.” Each breakthrough stays on a dated timeline; earlier thinking is preserved. Unfinished drafts autosave on the device and travel with marker sync and backups. Save a breakthrough to add it to the dated timeline and clear the draft. Each marker tracks Unresolved, Working through, or Understood independently of recall mastery. Search can show only unresolved and working-through markers. Older Journey entries remain readable; no database migration is needed. Saving a correction does not automatically award mastery.

**Source-linked answers.** New AI responses can include exact quotes from the marked passage or nearby text. The server drops quotes that do not match the supplied source. Open “Quoted from your note” to inspect them, or return to the marker in the note. When that source changes, the answer is flagged for review. A response without citations says so. Matching a quote establishes its origin, not the correctness of the explanation.

**Compare.** The marker's Compare button opens two facing panels: the current marker and any other marker you choose, including one from another note. Read their sources, drafts and saved responses together, then close to return to the same workspace. On small screens the panels stack.

**Resizable workspaces.** Drag any marker-window edge or corner, or focus a resize handle and use arrow keys (Shift for larger steps). Double-click a handle to reset. Sizes are remembered during the session. Capture pulses, unfolding breakthroughs, comparison transitions and elastic resizing respect reduced-motion preferences.

**Suggested markers.** Dashed dots in a note's margin point at sentences that look worth marking: definitions, formulas, rules and causes. They're found on the device with pattern matching, nothing is sent anywhere, and nothing is marked until you tap one. **Hide** turns them off for that note.

**The sky.** Under the dial, every marker is a star: grouped by course, joined into a constellation per note, hollow when unsure and bright when mastered, twinkling when due. Links you made between markers cross it as threads. Tap a star to open its marker.

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

**Cram.** Cramming is a longer sitting than daily recall, so it has its own screen (`src/home/cram.ts`) instead of the dial's hub. You choose weak spots or everything, which notes to include and how long. **Generate questions** adds practice questions written from those notes: with the AI connected you can type what you want (a topic, harder questions, common mistakes) and get a mix of short-answer and multiple-choice questions; without it, fill-in-the-blanks are built on the device from the notes' own sentences. During the sitting you type from memory, see which key ideas you included, and grade yourself Again, Almost or Got it; multiple-choice marks itself; a hint is one tap away; anything not known comes round again (at most twice). The end screen shows the first-try score, time, the change in exam readiness, results by topic and what's still shaky. Only the first answer to a marker's question moves its schedule (Almost changes nothing), and generated questions never touch it.

**The morning line.** Above the dial, the greeting and how many markers are waiting are the heading. Where you recall from is a word in that sentence (tap it to change). The streak sits to the left and exams and your class to the right, each opening its own detail.

**Depth and motion.** On launch the dial lies edge-on in a faint grid with its notes hovering over it, then swings up to face you (once per launch). Opening a note from the dial drops its card into the hub and the view follows it in, landing on the page. An open folder fans its files back with depth, loose cards lean toward the pointer, marker cards and recall answers turn into place. All of it is skipped when the device asks for reduced motion.

**The learning map.** The sky under the dial opens into a full-screen map: every marker as a star in its note's constellation, beside one column that shows how much is learned overall and by course, plus the streak and what's due this week. Tap a course to see only its part of the sky, a star to open its marker, Esc to fold the map away.

**Hundreds of notes.** The dial never shows more than eight things, however many notes there are: three recent cards, a "more" folder, and one folder per time band. A fuller folder is drawn a little larger and thicker (on a log scale), shows only its newest five files, and offers **See all**: a searchable shelf of everything in it, filterable by course, with cards that get smaller as the count grows and only the first 120 drawn until you ask for more. Checked with 600 notes on the dial and 240 in one week.

**Peek and swipe.** Resting on a marker card under the dial shows a peek inside the marker (the passage, the last thing saved, mastery, next recall). Clicking the card or the peek swings the whole screen away to the right and the note is behind it, with the marker open.

**The marker card.** Larger (500 × 680 where there's room). The Write box is a ruled writing desk that grows as you type, with a word count and a line of encouragement under it and prompts that rotate while it's empty; Ctrl/⌘ + Enter inserts into the note. The selected tab's highlight slides between tabs and each tab's contents step in from the side you moved toward. Keeping, inserting and reaching Mastered get a small burst of sparks.

**The note header.** **Return to dial** is a book tab at the note's top-left corner: it starts outside the page's edge and wraps round it, and the words ride a current running through the tab. Resting on it pulls the tab out a little. Under it is **Menu**, a ring of the app's colours around three bars that fold into a cross when it's open, with an amber dot when recall is due in this note. On the right are **Marker** and **Format** (Aa). The menu opens with the note's numbers (words, reading time, markers, due), then Lost me here, Test me and Picture as tiles, the outline with "you're here", print and export, and Delete note at the bottom. It is placed so it is always fully on screen, at any window size. While a test is running, the way out ("Done · 2 of 5") shows in the header. A delete button that has asked "tap again" goes back to normal when you tap anywhere else or press Escape.

**Status and closing out.** The status chip at the top of an open marker (Unsure, Getting it, Mastered) is a button: tap it, pick one. When you're finished with a marker, **Close out** (in its footer) keeps it without the clutter: it leaves recall and the home page, goes quiet on the page (a small grey ring, no highlight), and stays in the learning map as a milestone, drawn with a tick and listed under "Closed out". Open it from the map or the page and **Reopen** puts it back. Remove marker still deletes.

**Resizable marker card.** Pull any side or corner of an open marker and it behaves like something elastic. It chases your hand on a loose spring (lags, overshoots once, settles), thins along the other axis while it moves fast, and leans into a diagonal pull. The corner you hold pinches tighter while the far ones round out, the edge you hold glows and bows, and a small readout shows the size. Pulled past its smallest or largest size it keeps giving a little, then snaps back; letting go sends a ripple off that side. The size is remembered on this device, arrow keys on a focused handle adjust it, a double-click springs it back to standard, and the Write box grows to fill whatever room you give it. With reduced motion on, the card simply follows the pointer.

**Pictures.** Paste a screenshot, drop image files on the page, or use ••• → Picture (on a phone this offers the camera). Each picture is shrunk on the device to roughly 100–160 KB and stored inside the note, so it works offline and syncs with the note; nothing is ever loaded from a web address, and images in pasted web pages are dropped. Tap a picture to make it Small, Medium or Full, caption it, or remove it. A note syncs as one record of about 2 MB, so a note holds roughly a dozen pictures; past that LiveBoard says the note is full rather than failing to sync.

**Study sessions.** **Focus** in the header starts a 15, 25, 45 or 60 minute timer that follows you between notes and survives a reload. When it ends (or you end it), LiveBoard offers an **exit ticket**: a quiz on exactly the markers you placed during the session. No sound, no blocking dialog.

**Outline, print and export.** The ••• menu on a note lists its headings to jump to, shows a word count and reading time, and takes the note out of the app: print or save as PDF (the note alone, no app chrome), copy as Markdown, or download a .md file.

**Light and dark.** The sun/moon button in the header switches themes, and Settings → Appearance offers Match device, Light or Dark. Dark is the original deep-violet look; light is near-white and quiet, with color kept for courses, folders and markers. The choice is saved per device, not synced.

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
| `tests/api.cjs` | `/api/marker` (markers and the cram `quiz` action) makes no model call without verified sign-in and a working usage check; bad input gets 400/413, slow AI 504 |
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
| AI | `api/marker.ts`, a Vercel function calling the Claude Messages API with a forced tool call, so results come back structured. `action: "quiz"` returns practice questions for cramming (`{ questions: [{ kind, q, a, choices?, why }] }`) through the same sign-in and usage checks, counted as one request. Marker results: (`insert` vs `answer`, type, markdown, calc, mermaid, recall Q/A) |
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
- **Opening notes:** recency updates locally without uploading the whole note. Content edits still sync; opening an older copy cannot compete with newer edits on another device.
- **Sync conflicts:** when two devices change one note, the device that uploads second keeps its version in place and the other version is saved as a copy named “… (from another device)”. Its markers stay with the original, so the copy is plain text. Marker conflicts merge (every message, answer and written version is kept).
- **Accounts on shared devices:** each account has its own database on the device. Signing out keeps a copy for next time (unsynced changes upload on the next sign-in); “Sign out and remove from this device” deletes it, and is refused while changes are still waiting. Notes made while signed out are only added to an account when the student says so. Signing out while offline forgets the sign-in on the device, but can't revoke it on the server until the next online sign-out.
- **Refused uploads** (a note too large for the server, or records restored from another account's backup) stay queued and are never counted as saved. The sync line and Settings say so, the device copy can't be removed while they're waiting, and Settings offers a backup and "Upload them as new copies".
- **Deleting account data** stops all uploads, deletes the online copy, signs out and removes this device's copy, in that order. The server then refuses uploads from any other device still holding the old data; that device keeps its copy locally and can re-upload it only if the student chooses to.
- **Several tabs:** a note open in two tabs updates live in both. If both are typing in the same second, the other tab's version is kept as a copy.
- **Markers whose passage is deleted** keep everything and show “Source removed”, with a button to put them back.
- **Math** uses 64-digit precision. A few functions only exist for ordinary numbers, and those results are marked ≈.
- **Typed recall answers** are compared by key words, so a correct answer in different words can show as missing ideas. It's a prompt for your own judgment (you still choose Got it or Again), and the AI check is optional because it counts toward the daily AI limit.
- **Suggested markers** use simple patterns and will miss things or point at unimportant sentences. They only read English well.
- **Motion:** the 3D entrance, the dive into a note and the map's unfolding use CSS 3D transforms and the Web Animations API. Going back to the dial uses the View Transitions API (Chrome, Edge, Safari 18+). With reduced motion on, screens switch instantly. The 3D pieces are checked in desktop Chromium only so far; they still need a look on a real iPad.
- **Leaderboard** points are decided by the server: 10 for “Got it”, 3 for “Again”, once per marker per day. It's still a friendly measure of effort, not proof of knowledge.
- **Dependencies:** `npm audit` reports 6 findings (2 low, 4 moderate) as of November 11, 2026, all in the service-worker build tooling (workbox-build and its deepmerge/glob/minimatch dependencies via vite-plugin-pwa). They run only at build time on trusted input and aren't shipped to students. CI fails on any high or critical finding.
- AI answers arrive all at once. Streaming would make long drafts feel faster.
