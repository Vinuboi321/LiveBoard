import "./styles.css";
import { destroyHome, installHomeListeners, renderHome, setFocusNote, homeAlive, inRecall } from "./home/home";
import { destroyNote, renderNote } from "./editor/noteView";
import { fileToHtml } from "./importers";
import { openSettings } from "./settings";
import { ensureStarterCourse, liveCourses, liveNotes, loadAll, newNote, note, onChange, putMarker, putMeta, putNote, state, deleteNote } from "./store";
import { initSync } from "./sync";
import { $, debounce, toast } from "./util";
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
  // A blank note left empty and untitled isn't worth keeping.
  if (n && !n.deleted && n.title === "Untitled note" && !n.plain.trim() && !(n.html || "").trim()) await deleteNote(n.id);
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
    toast("Lecture imported. Select any text to place a marker.");
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
  await putMeta({ seeded: true });
}

async function boot() {
  $("#today")!.textContent = new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  await loadAll();
  await seedWelcome();
  installHomeListeners();
  $("#settingsBtn")!.onclick = () => openSettings(undefined, refresh);
  addEventListener("hashchange", route);
  route();
  onChange(k => { if (k !== "meta") refresh(); });
  initSync(() => { toast("Signed in. Your notes are syncing."); refresh(); }).catch(e => console.warn(e));
}

boot().catch(err => {
  console.error(err);
  stage().innerHTML = `<div class="fatal"><h2>LiveBoard couldn't start</h2><p>${String(err?.message || err)}</p><p>If you're in a private window, storage may be blocked. Try a normal window.</p></div>`;
});
