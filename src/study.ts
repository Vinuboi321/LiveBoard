import { course, liveCourses, liveMarkers, note, putMarker, putMeta, state } from "./store";
import { logRecall } from "./sync";
import type { Marker } from "./types";
import { DAY, dayKey, esc } from "./util";

/* What LiveBoard knows about how well you know things. Shared by the dial (recall, fingerprints, exam readiness)
   and the note page (Test me), so a marker is graded the same way wherever you answer it. */

export const isDue = (m: Marker) => m.due <= Date.now();
export function recallable(m: Marker) {
  if (m.recallOff || m.closedAt) return false; // a closed-out marker is finished: it stays in the map, not in recall
  if (m.type === "link" && !m.text) return false;
  return !!(m.text || m.recallQ || m.thread.some(t => t.role === "marker" && t.text && !t.text.startsWith("⚠")));
}

/** Record one recall answer: move the marker's mastery, schedule its next review, and score the point. */
export async function gradeMarker(m0: Marker, good: boolean) {
  const m = state.markers.get(m0.id) || m0; // latest copy, in case it was edited since the question was shown
  const ivl = good ? Math.max(1, (m.ivl || 1) * 2.5) : 1;
  const mastery = (good ? Math.min(2, m.mastery + 1) : Math.max(0, m.mastery - 1)) as Marker["mastery"];
  await putMarker({ ...m, ivl, mastery, due: Date.now() + (good ? ivl * DAY : 10 * 60 * 1000), type: m.type === "reminder" ? "question" : m.type, remindAt: m.type === "reminder" ? null : m.remindAt });
  await putMeta({ points: state.meta.points + (good ? 10 : 3) });
  logRecall(course(note(m.noteId)?.courseId)?.classId, m.id, good);
}

/** The question and answer a marker is quizzed with. */
export function recallText(m: Marker) {
  const lastReply = [...m.thread].reverse().find(t => t.role === "marker" && t.text && !t.text.startsWith("⚠") && !/^(Formatted|This marker will|Linked to)/.test(t.text));
  const q = m.recallQ || (m.text ? `What does this mean, in your own words? “${m.text.length > 140 ? m.text.slice(0, 140) + "…" : m.text}”` : `What did you write here about ${note(m.noteId)?.title || "this note"}?`);
  const a = m.recallA || lastReply?.text.replace(/[#*_`>-]/g, "").slice(0, 400) || m.text || "Check the note.";
  return { q, a };
}

/* ---------- a note's memory fingerprint: one dot per marker, filled by how well you know it ---------- */
export function fingerprint(noteId: string, max = 12) {
  const ms = liveMarkers().filter(m => m.noteId === noteId && !m.detachedAt).sort((a, b) => a.createdAt - b.createdAt);
  if (!ms.length) return "";
  const shown = ms.slice(0, max);
  const known = ms.filter(m => m.mastery === 2).length;
  return `<span class="fp" role="img" aria-label="${ms.length} marker${ms.length === 1 ? "" : "s"}, ${known} mastered">${shown.map(m => `<i data-type="${m.type}" data-mastery="${m.mastery}"${isDue(m) && recallable(m) ? ' class="due"' : ""}></i>`).join("")}${ms.length > max ? `<em>+${ms.length - max}</em>` : ""}</span>`;
}

/* ---------- exam readiness ---------- */
export interface Readiness { courseId: string; name: string; color: string; days: number; pct: number; counts: [number, number, number]; markers: Marker[] }
/** Courses with an exam date coming up, soonest first, with how much of what you marked you've mastered. */
export function upcomingExams(): Readiness[] {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return liveCourses().flatMap(c => {
    if (!c.examDate || !/^\d{4}-\d\d-\d\d$/.test(c.examDate)) return [];
    const days = Math.round((new Date(`${c.examDate}T00:00:00`).getTime() - today.getTime()) / DAY);
    if (days < 0 || days > 60) return [];
    const markers = liveMarkers().filter(m => recallable(m) && note(m.noteId)?.courseId === c.id);
    const counts: [number, number, number] = [0, 0, 0];
    markers.forEach(m => counts[m.mastery]++);
    const pct = markers.length ? Math.round(100 * (counts[1] * 0.5 + counts[2]) / markers.length) : 0;
    return [{ courseId: c.id, name: c.name, color: c.color, days, pct, counts, markers }];
  }).sort((a, b) => a.days - b.days);
}

/** How many markers come due on each of the next 7 days (today first; overdue ones count as today). */
export function forecast() {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const out = [...Array(7)].map((_, i) => ({ day: new Date(start.getTime() + i * DAY), n: 0 }));
  for (const m of liveMarkers()) {
    if (!recallable(m)) continue;
    const i = Math.max(0, Math.floor((m.due - start.getTime()) / DAY));
    if (i < 7) out[i].n++;
  }
  return out;
}
export const studiedOn = (t: number) => state.meta.studyDays.includes(dayKey(t));

/* ---------- checking a typed answer against the stored one, without AI ---------- */
const STOP = new Set("about above after again against along already always among another around because become becomes before being below between called comes could doing during either every example first found given gives going having inside instead itself known later least makes means might never often other others rather really result results second should since something still their there these thing things think those though three through together under until using usually where whether which while whose within without would yours".split(" "));
const stem = (w: string) => w.replace(/(ing|ed|es|s|ly)$/, "").slice(0, 7);
/** The words in an answer that carry its meaning (longer words, numbers, symbols), in order, without repeats. */
export function keyIdeas(answer: string) {
  const seen = new Set<string>(), out: string[] = [];
  for (const raw of answer.match(/[\p{L}\p{N}][\p{L}\p{N}'’.+\-/%^=]*[\p{L}\p{N}%]|[\p{L}\p{N}]/gu) || []) {
    const w = raw.toLowerCase();
    const isNum = /\d/.test(w), acronym = /^[A-Z]{2,6}$/.test(raw);
    if (!isNum && !acronym && (w.length < 5 || STOP.has(w))) continue;
    const k = isNum ? w : stem(w);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(raw);
  }
  return out.slice(0, 10);
}
/** Marks up the stored answer to show which key ideas the typed answer included and which it left out. */
export function compareAnswer(typed: string, answer: string) {
  const ideas = keyIdeas(answer);
  const said = new Set((typed.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’.+\-/%^=]*[\p{L}\p{N}%]|[\p{L}\p{N}]/gu) || []).map(w => (/\d/.test(w) ? w : stem(w))));
  const hit = new Set(ideas.filter(w => said.has(/\d/.test(w) ? w.toLowerCase() : stem(w.toLowerCase()))));
  let html = "", rest = answer;
  for (const w of ideas) {
    const i = rest.indexOf(w);
    if (i < 0) continue;
    html += esc(rest.slice(0, i)) + (hit.has(w) ? `<mark class="hit">${esc(w)}</mark>` : `<u class="miss">${esc(w)}</u>`);
    rest = rest.slice(i + w.length);
  }
  return { html: html + esc(rest), hit: hit.size, total: ideas.length };
}
