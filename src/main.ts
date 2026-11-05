import "./styles.css";
import { destroyHome, installHomeListeners, renderHome, setFocusNote, homeAlive, inRecall } from "./home/home";
import { destroyNote, flushNote, renderNote } from "./editor/noteView";
import { fileToHtml } from "./importers";
import { openSettings } from "./settings";
import { openSearch } from "./search";
import { ensureStarterCourse, liveCourses, liveNotes, markersOf, newNote, note, onChange, openStore, putMarker, putMeta, putNote, state, deleteNote } from "./store";
import { bootOwner, claimSignedOutNotes, initSync, migrateLegacyShared, push, signedOutNotes } from "./sync";
import { $, debounce, esc, toast } from "./util";
import { newMarker } from "./store";

const stage = () => $("#stage")!;
let currentNote: string | null = null;

function route() {
  const m = location.hash.match(/^#note-([\w-]+)/);
  if (m) showNote(m[1]);
  else showHome();
}

async function showHome() {
  await leaveNote();
  if (location.hash.startsWith("#note-")) history.replaceState(null, "", location.pathname + location.search);
  renderHome(stage(), { openNote, newBlank, importFile: () => ($("#fileIn") as HTMLInputElement).click(), openSettings: s => openSettings(s, refresh) });
}

async function leaveNote() {
  if (!currentNote) return;
  destroyNote();
  const n = note(currentNote);
  // A blank note left empty and untitled isn't worth keeping, unless it holds markers (their writing lives in the marker, not the page text).
  const empty = n && !n.deleted && n.title === "Untitled note" && !n.plain.trim() && !(n.html || "").trim() && markersOf(n.id).length === 0 && ![...state.markers.values()].some(m => m.noteId === n.id && !m.deleted);
  if (empty) await deleteNote(n!.id);
  setFocusNote(n && !n.deleted ? n.id : null);
  currentNote = null;
}

function showNote(id: string) {
  if (!note(id) || note(id)!.deleted) { goHome(); return; }
  destroyHome();
  if (currentNote && currentNote !== id) { destroyNote(); }
  currentNote = id;
  setFocusNote(id);
  stage().scrollTop = 0;
  renderNote(stage(), id, goHome, openNote);
}

function openNote(id: string) { location.hash = `note-${id}`; }
function goHome() { if (location.hash) location.hash = ""; else route(); }

function currentCourseId() {
  const recent = [...liveNotes()].sort((a, b) => b.openedAt - a.openedAt)[0];
  return (recent && liveCourses().some(c => c.id === recent.courseId) ? recent.courseId : liveCourses()[0]?.id) as string;
}

async function newBlank() {
  await ensureStarterCourse();
  const n = await newNote(currentCourseId(), "Untitled note", "blank");
  openNote(n.id);
}

($("#fileIn") as HTMLInputElement).onchange = async e => {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0];
  input.value = "";
  if (!f) return;
  try {
    const r = await fileToHtml(f);
    if (!r) return;
    await ensureStarterCourse();
    const n = await newNote(currentCourseId(), r.title, "lecture", r.html);
    openNote(n.id);
    toast(/\.pdf$/i.test(f.name) ? "Imported the PDF's text. Pictures, layout and handwriting aren't kept, and the PDF itself isn't uploaded. Select any text to place a marker." : "Lecture imported. Select any text to place a marker.", 7000);
  } catch (err) {
    toast((err as Error).message || "Couldn't read that file.", 5000);
  }
};

/* Re-render the home screen when data changes underneath it (sync pulls, settings edits). */
const refresh = debounce(() => { if (homeAlive() && !inRecall()) renderHome(stage(), { openNote, newBlank, importFile: () => ($("#fileIn") as HTMLInputElement).click(), openSettings: s => openSettings(s, refresh) }, true); }, 400);

async function seedWelcome() {
  if (state.meta.seeded) return;
  await ensureStarterCourse();
  const cid = liveCourses()[0].id;
  const n = await newNote(cid, "Start here: how markers work", "blank", null);
  const m = newMarker(n.id, "Markers are the only tool in LiveBoard", "explain");
  m.thread = [
    { role: "user", text: "What can a marker do?", at: Date.now() },
    { role: "marker", text: "Anything you'd reach for a toolbar for. Type what you want in plain words: **explain**, **give an example**, **turn this into a list**, **draw a diagram**, **e^0.5 * 2**, **link to** another note, or **remind me Friday**. Results that belong in your notes are written in, tinted until you keep them.", at: Date.now(), inserted: true }
  ];
  m.recallQ = "What is the one tool you use for everything in LiveBoard?";
  m.recallA = "Markers. Select text (or tap + on an empty line), then type what you want.";
  state.markers.set(m.id, m);
  await putMarker(m);
  const html = `<h2>Welcome to LiveBoard</h2>
<p><span data-marker="${m.id}">Markers are the only tool in LiveBoard</span><span data-pin="${m.id}"></span>. Tap the dot to open this one.</p>
<p>To place your own, select any words in this note and press <strong>Place marker</strong>. Then type what you want: explain it, expand it, calculate something, turn it into a list, draw it, or link it to another note.</p>
<p>On an empty line, tap the <strong>+</strong> in the margin to write or generate from a marker, like "outline what I know about this topic".</p>
<p></p>
<p>Every marker remembers how well you know it. Each morning, the dial's <strong>Start recall</strong> button quizzes you on what you marked, and your answers move markers from unsure to mastered.</p>
<p>Need bold, headings or lists by hand? Tap <strong>Aa</strong> at the top of a note to show the classic tools.</p>`;
  await putNote({ ...n, html, plain: html.replace(/<[^>]+>/g, " ") });
  await putMeta({ seeded: true, welcomeId: n.id });
}

async function boot() {
  $("#today")!.textContent = new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  // Whose notes these are is settled before anything is shown, so one account's notes never flash up for another.
  await migrateLegacyShared().catch(e => console.warn("legacy move", e));
  const owner = await bootOwner();
  await openStore(owner);
  // A signed-in account gets its starter note only once it's known to be empty, so each new device doesn't add another.
  if (!owner) await seedWelcome();
  if (import.meta.env.VITE_ARTIFACT) await (await import("./demo")).seedDemo();
  installHomeListeners();
  $("#settingsBtn")!.onclick = () => openSettings(undefined, refresh);
  const ss = $("#syncState")!; // the sync line opens Settings, where waiting or refused items are explained
  ss.setAttribute("role", "button"); ss.tabIndex = 0;
  ss.onclick = () => openSettings(undefined, refresh);
  ss.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openSettings(undefined, refresh); } };
  $("#searchBtn")!.onclick = () => openSearch(openNote);
  document.addEventListener("keydown", e => {
    const typing = (e.target as HTMLElement)?.closest?.("input, textarea, [contenteditable='true']");
    if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) { e.preventDefault(); openSearch(openNote); }
  });
  addEventListener("hashchange", route);
  route();
  installUpdates();
  onChange(k => { if (k !== "meta") refresh(); });
  initSync({
    beforeSwitch: async () => { flushNote(); await new Promise(r => setTimeout(r, 50)); },
    notice: msg => toast(msg, 6000)
  }).then(async pulled => {
    if (!owner) return;
    if (pulled && !state.meta.seeded) {
      if (!liveNotes().length) { await seedWelcome(); refresh(); }
      else await putMeta({ seeded: true });
    }
    await offerClaim();
  }).catch(e => console.warn(e));
}

/** First sign-in on a device with signed-out notes: ask before moving them into the account (the device may be shared). */
async function offerClaim() {
  const count = await signedOutNotes();
  if (!count) return;
  const bar = document.createElement("div");
  bar.className = "claimbar";
  bar.setAttribute("role", "dialog");
  bar.setAttribute("aria-label", "Notes made while signed out");
  bar.innerHTML = `<p><b>${count} note${count === 1 ? " was" : "s were"} made on this device while signed out.</b> Add ${count === 1 ? "it" : "them"} to this account?</p><div class="row"><button class="btn primary" id="clYes">Add to my account</button><button class="btn" id="clNo">Keep separate</button></div>`;
  document.body.appendChild(bar);
  const done = async (move: boolean) => {
    bar.remove();
    await claimSignedOutNotes(move);
    if (move) { await openStore(state.owner); void push(); refresh(); route(); toast(`Added ${count} note${count === 1 ? "" : "s"} to your account.`); }
  };
  ($("#clYes", bar) as HTMLButtonElement).onclick = () => done(true);
  ($("#clNo", bar) as HTMLButtonElement).onclick = () => done(false);
}

/* App updates: offer a reload once a new version is downloaded, and save first. */
function installUpdates() {
  import("virtual:pwa-register").then(({ registerSW }) => {
    const update = registerSW({
      onNeedRefresh() {
        if (document.querySelector(".updatebar")) return;
        const bar = document.createElement("div");
        bar.className = "updatebar";
        bar.innerHTML = `<span>A new version of LiveBoard is ready.</span><button class="btn primary" id="upGo">Reload</button><button class="btn" id="upLater">Later</button>`;
        document.body.appendChild(bar);
        ($("#upLater", bar) as HTMLButtonElement).onclick = () => bar.remove();
        ($("#upGo", bar) as HTMLButtonElement).onclick = async () => { flushNote(); await new Promise(r => setTimeout(r, 150)); await update(true); };
      }
    });
  }).catch(() => { /* no service worker here */ });
  // A lazily loaded part of the app (PDF import, diagrams) was replaced by a newer deploy.
  addEventListener("vite:preloadError", e => {
    e.preventDefault();
    toast("LiveBoard was updated. Your notes are saved; reload the page to use this feature.", 8000);
  });
}

/* Saving on the device failed (storage full, or blocked by the browser): say so, instead of failing silently. */
addEventListener("unhandledrejection", e => {
  const r = e.reason as { name?: string; inner?: { name?: string }; message?: string } | undefined;
  const name = `${r?.name || ""} ${r?.inner?.name || ""}`;
  if (/QuotaExceeded/.test(name)) toast("This device is out of storage space, so your latest change couldn't be saved. Free up space, then keep going.", 10000);
  else if (/DatabaseClosed|InvalidState|UnknownError|Abort/.test(name)) toast("Couldn't save on this device just now. Reload the page; anything already saved is safe.", 8000);
});

boot().catch(err => {
  console.error(err);
  const storage = /IndexedDB|MissingAPI|SecurityError|InvalidState|DatabaseClosed|Open|Quota/i.test(`${err?.name} ${err?.message}`);
  stage().innerHTML = storage
    ? `<div class="fatal"><h2>LiveBoard can't save on this browser</h2><p>LiveBoard keeps your notes on this device, and this browser is blocking that. This usually happens in a private window, or when a school or work policy turns off site storage.</p><p>Open LiveBoard in a normal window, or allow site data for this site in the browser's settings.</p></div>`
    : `<div class="fatal"><h2>LiveBoard couldn't start</h2><p>Reload the page. If it keeps happening, your notes are still saved on this device; contact support with this message:</p><p class="muted small">${esc(String(err?.message || err)).slice(0, 300)}</p></div>`;
});
