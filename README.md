# LiveBoard

A study notes app where **markers are the only tool**. Import a lecture or start a blank page, select any text (or tap **+** on an empty line), and type what you want in plain words. The marker explains, expands, calculates, reformats, draws, links or drafts, and anything that belongs in your notes is written into the page. Every marker tracks how well you know it, and each morning the home dial quizzes you on what you marked.

LiveBoard installs as an app on iPad, iPhone, Windows and Mac from the browser, and it works offline. Notes live on the device first. When accounts are set up, they also sync to Supabase.

## Standalone classroom app

Download `standalone/LiveBoard.html` and open it in your browser. Choose Education, then Teacher, to use presentation search, class filters and marker conversations. The file runs locally without Node.js or a ChatGPT account. Cross-device live lessons require a configured classroom backend.

## What's in it

**Home: the time dial.** Notes sit around a ring by when you last opened them. The 3 most recent float as large cards, older notes stack in colored folders (This week, This month, Last month, then one folder for everything older), and folders fan open on hover or when spun under the pointer. Import and Blank page live in the center hub. The hub itself is calm, neutral glass, so the color stays with the folders and files. The ring around it is the time scale, drawn in quiet ink with only the selected item's stretch lit in its color. A bezel of fine ticks turns with the dial and swells under the pointer, small study sprites (bits of maths and science, tiny graphs, an atom, a grade) drift along the track and are dragged when you spin, a ring runs outward each time something new lands under the pointer, and the hub leans toward the cursor (all drawn on one canvas, `src/home/bezel.ts`, and still under reduced motion). Each note card carries a memory fingerprint, one dot per marker, filled by how well you know it. Opening a note grows its card into the page.

**Morning strip.** Shows your streak (tap it for a 7-day forecast of what comes due), a recall scope (all due, last night, this week, this course), and your class rank.

**Recall** starts from a slip tucked into the left edge of the home screen (`renderSlip` in `src/home/home.ts`). While something is due it shows how many and bobs out from the edge every few seconds; the first time LiveBoard is opened each day it slides further out and says so. Tapping it pulls a sheet out from the left over most of the screen (the slip grows into it), the notes stay faintly visible behind, and recall runs there one card at a time: type what you remember, show the answer, then Again or Got it (1 / 2 on a keyboard), with the run of questions down the side. Escape, the ×, or a tap on the notes behind puts it away. Exit tickets and the exam countdown's cram use the same sheet.

**Voice** (`src/voice.ts`, the browser's own speech recognition and speech; nothing to install). Where the browser can't listen (Firefox), no mic is shown. Chrome sends the audio to Google's speech service to transcribe it and Safari to Apple's; LiveBoard keeps only the words.
- *Say it back* (recall): the mic beside the answer box listens while you explain the answer in your own words. A row of beads, one per key idea in the hidden answer, fills as you say them, so you know you've only covered two of five without seeing it. A pause turns the card over with what you said marked against the answer.
- *Out loud* (the headphones in the recall sheet's corner): hands-free recall for a walk to class. Each question is read to you, you answer aloud, the answer is read back with how many key ideas you said, and "got it" or "again" grades it ("stop" ends it).
- *Tell the calendar*: hold the calendar chip on the home screen and say it ("bio lab report due next Thursday", "chem midterm December 3rd at 2", "study group every Wednesday at 7"), then let go; or tap **Say it** at the top of the open calendar. It's read by plain rules (`src/voiceDate.ts`, tested in `tests/voice.cjs`), not AI, so the day is exact and it works offline once the words are in. What's understood shows as you speak (title, day, course), the entry lands on its day with an Undo, and if no day was said it fills in the title and asks for the day instead of guessing. A course with an exam date in Settings gets a countdown chip with how ready you are (the share of its markers you've mastered) and a **Cram** button that opens a cram sitting for that course (below).

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
**Classes** (`src/home/classes.ts`, the **Classes** button in a student's header) is a binder: each class is a divider with a coloured tab down the right edge, and its page holds the live lesson if one is running, your notes in the course linked to it (open one, or start a new one there), how you're doing on its markers, and the class's week on the leaderboard. The last tab is for joining, and its one code box takes both kinds of code: 6 characters joins a class, 8 joins a live lesson (no account needed). There are two kinds of class. A **study group** is a course a student shares from Settings; classmates share only leaderboard points. A **teacher's class** is made by a teacher under Classes in the classroom; joining one links one of the student's courses and, after the student ticks a box saying so, shares that course's notes and markers with the teacher, read-only. Nothing else is shared, and leaving stops it at once.

**Pop quizzes.** A teacher opens a class under Classes, then **Pop quizzes → New pop quiz** (`marker-slides/app/QuizPanel.tsx`): a title and up to 20 questions, each **short answer** (with the answer to compare against), **multiple choice** (2 to 6 options, one marked right) or **true or false**, with an optional picture (shrunk on the teacher's device to about 200 KB and kept inline with the quiz, 1.5 MB at most in all) and, for the marked kinds, an optional explanation shown after answering. Questions can be moved, copied and removed. The quiz is required or optional, has a due time, and can shuffle its questions and options for each student. Multiple choice and true or false are marked by the server from what was picked (`submit_quiz`); short answers are marked by the student. **Release** sends it to every student in the class at once (a `class_quizzes` row, pushed by Supabase Realtime to the class's members only). Each student gets a card saying it arrived, and the recall slip leads with it (required ones until they're done). It runs in the recall sheet: a short answer from memory, typed or out loud, then the teacher's answer and Got it or Again; a multiple choice or true or false one by tapping an option (or a letter, or T/F, on a keyboard; or saying it in Out loud mode), which shows at once whether it was right, the right option and the explanation. At the end the marks and what they wrote go to the teacher once (`submit_quiz`; the first result stands). The teacher sees who has finished, the average, and each student's score and words, and can close or delete a quiz. Quizzes are self-graded like all recall, and the answers reach the student's device so it can show them: it's a check-in on what stuck, not a secure exam. The class's page in a student's binder lists its quizzes, to take or with the score.

**Quiz questions in live lessons** (`marker-slides/app/QuizCard.tsx`, `slideQuiz.ts`). In a presentation, **Quiz +** drafts a question from the current slide or an open marker (a starting prompt and the slide's picture), which the teacher edits, with a symbol picker for maths and science and an optional model answer. A picture can be uploaded or found on Wikimedia Commons, and its source link travels with it. Drafts stay with the presentation on this device; **Share question with class** sends one to the live room, where each student answers once beneath the slide and the teacher reads every answer. **Complete draft** turns it into a question slide right after its source. On the server this is `room_quiz` (host-only sharing by the room secret, 60 questions and 3000 answers per room, pictures left out of the poll once a device has them); the D1 fallback in `marker-slides/app/api/rooms/quiz.ts` follows the same rules. The presentation shelf also gained subject filters and two more example lessons.

**Live lesson notices** (`src/home/liveNotice.ts`). When a teacher starts a live lesson and tells one of their classes (from the invite dialog, beside the code), every signed-in student in that class gets a card at the side of the screen with a **Join** button. It's pushed, not polled: telling the class writes a row to `class_pings`, which Supabase Realtime sends to the class's members only (row level security), and ending the lesson deletes it. The app asks for the class list once when a student signs in, and once more only after coming back from more than five minutes away, in case the connection slept through a ping. The class's tab and page show it too. Students who aren't in the class still join with the 8-character code.
**Backup:** download and restore a JSON backup from Settings.

**Cram.** Cramming is a longer sitting than daily recall, so it has its own screen (`src/home/cram.ts`) instead of the dial's hub. You choose weak spots or everything, which notes to include and how long. **Generate questions** adds practice questions written from those notes: with the AI connected you can type what you want (a topic, harder questions, common mistakes) and get a mix of short-answer and multiple-choice questions; without it, fill-in-the-blanks are built on the device from the notes' own sentences. During the sitting you type from memory, see which key ideas you included, and grade yourself Again, Almost or Got it; multiple-choice marks itself; a hint is one tap away; anything not known comes round again (at most twice). The end screen shows the first-try score, time, the change in exam readiness, results by topic and what's still shaky. Only the first answer to a marker's question moves its schedule (Almost changes nothing), and generated questions never touch it.

**Mouse and touch.** Every `:hover` style sits inside `@media (hover: hover)`, so on an iPad or phone a tap never leaves a button stuck in its lifted state (a regression test fails if a bare `:hover` rule is added). What a mouse gets by resting has another way in on touch: press and hold a marker card for its peek, tap a star in the learning map or a suggestion dot in a note once to see it and again to act, and tap a folder to bring it up. Keyboard hints, the hub's lean and tooltips that only repeat a label are left out on touch. Small always-running animations (the old flowing Return-to-dial tab, pulsing dots on buttons, the spinning menu ring) are gone; the dial, the dive into a note, the marker card and the learning map keep theirs.

**Who it's for.** The first time LiveBoard opens on a device it shows a welcome dial (`src/role.ts`). **Just me** and **Education** sit side by side at the top of the ring, like notes and folders on the home dial: one click lights a choice up and says what it is, a second click goes in. Education turns the dial over to **Student** or **Teacher**. The choice is remembered on that device until accounts carry it; Settings has a three-way switch, and a link with `?as=individual`, `?as=student` or `?as=teacher` sets it and is then removed from the address.

- **Just me (individual)** is the notes app for anyone: the dial, markers, recall and search, with notebooks where a student has courses, everyday marker suggestions (summarize, action items, remind me), and none of the class features (no Classes, class codes, leaderboard, exam dates or cram).
- **Student** adds those class features: **Classes** (classes, their leaderboard and live lessons), exam countdowns and cram.
- **Teacher** lands on **Presentations** in the classroom, whose top bar also has **Worksheets** (the worksheet studio, `#teacher`, see `docs/teacher-studio.md`) and **Student notes**.

**Dial first.** On the notes home the dial is the screen: it is sized to nearly all the height. The top line (greeting, recall, streak, calendar, exams, classes) and what sits under the dial are drawn small and faint, and come up to full size when you go to them: point at them, tab into them, open one of their panels, or scroll toward them (`wake-top` / `wake-bottom` in `src/home/home.ts`, styles under "dial-first home"). The top line keeps the same room either way and grows over the empty space above the dial, so the dial never jumps.

**Your own folders.** The empty dashed folder at the very end of the ring, just past the oldest folder ("In the past"), makes a folder of your own: tap it, or spin to it and press Enter (`src/home/folders.ts`): a name, a colour (ten swatches or any colour), a background (plain, dots, stripes, grid, waves, glow) and a mark on its tab, with a live preview. It is a course or notebook with a look (`Course.folder`), so it syncs like any course and holds every note in it; move a note in from the course menu at the top of the note, or use **New note here** in the hub. Your folders sit on the dial just left of the pointer, outside the run of time (spin back from "now" to reach them), and their notes leave the time folders, though the three most recent still show as loose cards. **Customize** in the hub changes one; taking a folder off the dial turns it back into a plain course, and an empty one is deleted.

**Folders by subject.** The dial stays about time, so every course or notebook also has a door that isn't. A small wheel of folder tabs peeks from the right edge of the home screen (`src/home/rotunda.ts`), one tab per folder in its colour and mark, swaying slowly; it slides out a little on hover, and a scroll or a drag over it turns it. Tapping it opens a sheet that widens out of the wheel with every folder you have, plain courses too, newest first, each drawn as its folder with its latest notes peeking out and how many markers are due. A folder opens in place to all its notes, with **New note here** and **Customize** (or **Put on the dial** for a plain course). Search at the top finds folders by name and notes by title across all of them. Esc goes back a step: from a folder to all folders, then closed. Under reduced motion it opens and closes without the circle and the stagger. `tests/folders.cjs` covers it at desktop and phone sizes.

**The calendar.** Individuals and students have a calendar chip on the home screen's top line (`src/home/calendar.ts`) saying what's next; tapping it opens the calendar over most of the screen. It is the one place for everything with a date: deadlines, exams, events (a class, an appointment; with a time, and weekly if it repeats), study sessions, notes written for a day, reminders set from a marker ("remind me Friday"), and a student's course exams. Across the top, **the week**: the next seven days at a glance, with what's on each and how many markers come up for recall. Below, **the month**, each day showing its first entries, and **the day** you tapped: what's on it, what you wrote that day, and a form to add to that day (deadline, exam, event or study session; time and weekly repeat optional; or **Write a note for this day**, which opens a new note kept on that day). An exam or deadline a couple of days or more away can **Plan reviews**: study sessions a week, three days and a day before. A student's exam for a course becomes that course's exam date, so the exam countdown and cram pick it up. Entries are stored with the profile (`deadlines` in `push_profile`, merged per entry) with optional `kind`, `time`, `repeat` and `noteId` fields, so older copies still read as plain deadlines.

**The preview is the whole app.** The single-file preview build (`ARTIFACT=1`, `scripts-artifact.mjs`) can't have a second page, so there the classroom is mounted inside the notes page and the two sides swap in place (`src/classroom/open.ts`, `marker-slides/embed.jsx`, `marker-slides/app/nav.ts`). `tests/preview.cjs` builds that file and crosses both sides in it.

**Developer switch (temporary).** A pink **DEV** dot in the bottom-left corner of every screen flips the device between Just me, Student and Teacher and can bring the welcome dial back. It is for looking at each side while building. Remove it before launch by deleting `src/devSwitch.ts` and its two imports (`src/main.ts`, `marker-slides/client.tsx`), or build with `VITE_DEV_SWITCH=0`.

**The classroom** (`marker-slides/`, React) is bundled into the app as a second page, `/classroom.html`, on the same origin: presentations, the object-based slide editor, the student join screen and live classes. Its home puts one presentation in front, the one opened most recently, with its own slides on a turning tray (`marker-slides/app/Reel.tsx`): left and right arrows, a drag, a sideways swipe or the strip of ticks turn through them, and Open starts at the slide in front. Underneath is the shelf: every presentation in a grid, like a Drive folder, its top row peeking up from the bottom of the screen. Scrolling down is ordinary scrolling; picking a card brings that presentation up front, and double-clicking opens it. Inside a presentation, **All presentations** beside the wordmark is the way back. It shares the notes side's look and its one light/dark choice (`src/theme.ts`, same colour tokens, same top bar; `tests/classroom.cjs` compares the colours on both sides in both modes). Presentations stay on the device.

**A teacher's classes** (`marker-slides/app/Classes.tsx`, **Classes** in the classroom's top bar): make a class and get its 6-character code; see each class's students with their notes, markers, how many they've mastered, what's due and when they were last active; choose a student to read their notes and markers for that class. A student who joined without sharing shows as "not sharing". It needs a signed-in LiveBoard account (`teacher_*` functions in `supabase/schema.sql`, called from `src/classroom/classes.ts`; every one checks on the server that the caller owns the class). The single-file preview uses sample classes instead (`marker-slides/app/classesDemo.ts`, `src/classSource.ts`).

**Live classes** run on LiveBoard's own Supabase project (the `room_*` functions in `supabase/schema.sql`, called from `src/classroom/rooms.ts`), so the deployed app needs no second server. Starting a live lesson copies the deck to the server; students join with the 8-character code without signing in, and the teacher's control is the room's secret, kept in their browser. Students see their own markers and the teacher's; the projector shows only the teacher's; speaker notes never reach students; the **Student markers** switch is enforced by the server. **End class** deletes the room, its slides and every marker from the server (what was asked stays with the deck on the teacher's device), and any room older than 12 hours is deleted the next time a room is made. A student's **Add to my notes** turns their questions and the teacher's answers into a note. Without Supabase configured, the classroom falls back to the stand-alone `/api/rooms` runtime in `marker-slides/` (Cloudflare D1), which is only for local development; see `docs/classroom-local.md`.

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

**Focus.** **Focus** in the header opens a large sheet (`src/session.ts`). Set the length by dragging round the dial (one lap is two hours, in 5-minute steps), with the arrow keys or the scroll wheel, by typing any length up to 4 hours, or with the 15/25/45/60/90 presets. Run it as **one block** or as **cycles with breaks** (5, 10 or 15 minute breaks, 2 to 8 rounds); the sheet shows the whole plan and when it ends. You can name what you're working on and pick a note to open when it starts. Options, remembered between sessions: **Quiet screen** (everything but your note and the timer fades out; the header comes back when you hover it), **Hold alerts** (students: live-lesson and pop-quiz notices wait until the session is over), **Chime** at the end of a block or break, and **Exit ticket**. Background sound (brown noise, rain, white noise, with volume) is generated on the device with Web Audio (`src/focusSound.ts`), so nothing is downloaded or streamed; it pauses during breaks.

While it runs, the header chip counts down (teal on a break), and the sheet shows a ring running down, Pause/Resume (Space), +5 min, Skip break, End, the markers placed so far and the rounds. The session survives a reload and catches up on phases that ended while the app was closed. When it ends you get a summary (time focused, rounds, markers), a yes/not-yet on your goal, and the exit ticket: a recall of exactly the markers placed during the session. Finished sessions are kept on this device only (`Meta.focusLog`, never uploaded) for today's minutes, the last seven days and a run of days on the setup screen. `tests/focus.cjs` runs whole sessions on a fake clock.

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
- **Dependencies:** the code that ships has no known vulnerabilities (`npm audit --omit=dev`). As of November 17, 2026, `npm audit` reports 12 findings (10 high, 2 moderate), all in build tooling: a picomatch ReDoS advisory (GHSA-fc5q-39xc-vjpf) that covers every published version with no fix yet, reached through vite and the service-worker build (vite-plugin-pwa, workbox-build), plus glob and minimatch there. They run only at build time on this repository's own files and patterns, and none of it ships to students. CI fails on any high or critical finding in shipped code and any critical finding anywhere. When picomatch ships a fix, update vite and vite-plugin-pwa and put the gate back to `--audit-level=high` for everything.
- AI answers arrive all at once. Streaming would make long drafts feel faster.
