import DOMPurify from "dompurify";
import { course, note, state } from "./store";
import type { Course, Marker, Note, ThreadMsg } from "./types";

/*
  Backup files are untrusted input: they may be old, hand-edited, truncated or crafted.
  validateBackup checks everything before anything is written; restoreBackup (store.ts) then writes it all in one transaction.
*/
export const MAX_BACKUP_BYTES = 40 * 1024 * 1024;
const LIMITS = { notes: 5000, markers: 50000, courses: 300, thread: 500, nodes: 300000, depth: 80 };
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const NODES = new Set(["doc", "paragraph", "text", "heading", "bulletList", "orderedList", "listItem", "blockquote", "codeBlock", "horizontalRule", "hardBreak", "taskList", "taskItem", "pin", "markerOutput", "diagram"]);
const MARKS = new Set(["bold", "italic", "underline", "strike", "code", "highlight", "marker", "link"]);
const TYPES = new Set(["note", "question", "explain", "math", "visual", "link", "reminder"]);

class BackupError extends Error {}
const fail = (msg: string): never => { throw new BackupError(msg); };
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max: number, what: string, optional = false) => {
  if (v === undefined || v === null) return optional ? null : fail(`${what} is missing.`);
  if (typeof v !== "string") fail(`${what} must be text.`);
  return (v as string).slice(0, max);
};
const num = (v: unknown, what: string, dflt?: number) => {
  if ((v === undefined || v === null) && dflt !== undefined) return dflt;
  if (typeof v !== "number" || !Number.isFinite(v)) fail(`${what} must be a number.`);
  return v as number;
};
const id = (v: unknown, what: string) => (typeof v === "string" && ID.test(v) ? v : fail(`${what} has an invalid id.`));

/** Check a ProseMirror document: known node and mark types only, plain attributes, bounded size and depth. */
function checkDoc(doc: unknown, where: string) {
  if (doc === null || doc === undefined) return null;
  let count = 0;
  const walk = (n: unknown, depth: number): void => {
    if (!isObj(n)) fail(`${where}: the note content is damaged.`);
    const node = n as Record<string, unknown>;
    if (++count > LIMITS.nodes) fail(`${where} is too large to restore.`);
    if (depth > LIMITS.depth) fail(`${where} is nested too deeply.`);
    if (typeof node.type !== "string" || !NODES.has(node.type)) fail(`${where} contains content LiveBoard doesn't recognise (${String(node.type).slice(0, 30)}).`);
    if (node.type === "text" && typeof node.text !== "string") fail(`${where}: text is damaged.`);
    if (node.attrs !== undefined) {
      if (!isObj(node.attrs)) fail(`${where}: formatting is damaged.`);
      for (const v of Object.values(node.attrs as object)) if (v !== null && !["string", "number", "boolean"].includes(typeof v)) fail(`${where}: formatting is damaged.`);
    }
    if (node.marks !== undefined) {
      if (!Array.isArray(node.marks)) fail(`${where}: formatting is damaged.`);
      for (const m of node.marks as unknown[]) if (!isObj(m) || !MARKS.has(String(m.type))) fail(`${where} contains formatting LiveBoard doesn't recognise.`);
    }
    if (node.content !== undefined) {
      if (!Array.isArray(node.content)) fail(`${where}: the note content is damaged.`);
      for (const c of node.content as unknown[]) walk(c, depth + 1);
    }
  };
  walk(doc, 0);
  if ((doc as { type?: string }).type !== "doc") fail(`${where}: the note content is damaged.`);
  return doc;
}

export interface ValidBackup {
  courses: Course[]; notes: Note[]; markers: Marker[];
  meta?: { studyDays: string[]; points: number };
  summary: { notes: number; markers: number; courses: number; replaces: number; exportedAt: string | null };
}

export function validateBackup(text: string): ValidBackup {
  if (text.length > MAX_BACKUP_BYTES) fail("That backup is too large to restore here.");
  let data: unknown;
  try { data = JSON.parse(text); } catch { fail("That file isn't a LiveBoard backup (it isn't valid JSON)."); }
  if (!isObj(data) || data.app !== "liveboard") fail("That file isn't a LiveBoard backup.");
  const b = data as Record<string, unknown>;
  if (![1, 2].includes(b.version as number)) fail("This backup is from a newer version of LiveBoard. Update the app and try again.");
  for (const k of ["notes", "markers", "courses"] as const) if (b[k] !== undefined && !Array.isArray(b[k])) fail(`The backup's ${k} list is damaged.`);
  const rawC = (b.courses as unknown[]) || [], rawN = (b.notes as unknown[]) || [], rawM = (b.markers as unknown[]) || [];
  if (rawN.length > LIMITS.notes || rawM.length > LIMITS.markers || rawC.length > LIMITS.courses) fail("That backup has more notes than LiveBoard can restore at once.");

  const seen = new Set<string>();
  const unique = (v: string, what: string) => { if (seen.has(v)) fail(`${what} appears twice in the backup.`); seen.add(v); return v; };

  const courses: Course[] = rawC.map((c, i) => {
    if (!isObj(c)) return fail(`Course ${i + 1} is damaged.`);
    const color = typeof c.color === "string" && /^#[0-9a-fA-F]{6}$/.test(c.color) ? c.color : "#8892A0";
    const code = typeof c.classCode === "string" && /^[A-Z0-9]{4,8}$/.test(c.classCode) ? c.classCode : null;
    const classId = typeof c.classId === "string" && /^[0-9a-f-]{36}$/i.test(c.classId) ? c.classId : null;
    const exam = typeof c.examDate === "string" && /^\d{4}-\d\d-\d\d$/.test(c.examDate) ? c.examDate : null;
    return { id: unique(id(c.id, `Course ${i + 1}`), "A course"), name: str(c.name, 32, `Course ${i + 1}'s name`)!.toUpperCase() || "COURSE", color, classId, classCode: code, examDate: exam, updatedAt: num(c.updatedAt, "A course date", Date.now()), deleted: !!c.deleted };
  });
  const courseIds = new Set(courses.map(c => c.id));
  const fallbackCourse = courses[0]?.id || [...state.courses.keys()][0] || null;

  const notes: Note[] = rawN.map((n, i) => {
    const where = `Note ${i + 1}`;
    if (!isObj(n)) return fail(`${where} is damaged.`);
    const nid = unique(id(n.id, where), "A note");
    let courseId = typeof n.courseId === "string" ? n.courseId : "";
    if (!courseIds.has(courseId) && !course(courseId)) courseId = fallbackCourse || "";
    const doc = checkDoc(n.doc, `“${String(n.title ?? where).slice(0, 40)}”`);
    const html = !doc && typeof n.html === "string" ? DOMPurify.sanitize(n.html.slice(0, 2_000_000)) : null;
    return {
      id: nid, courseId, title: str(n.title, 140, `${where}'s title`, true) || "Untitled note", kind: n.kind === "lecture" ? "lecture" : "blank",
      doc, html, plain: str(n.plain, 200000, `${where}'s text`, true) || "",
      createdAt: num(n.createdAt, `${where}'s date`, Date.now()), updatedAt: num(n.updatedAt, `${where}'s date`, Date.now()), openedAt: num(n.openedAt, `${where}'s date`, Date.now()),
      deleted: !!n.deleted
    };
  });
  if (notes.some(n => !n.courseId)) fail("Some notes in the backup don't belong to a course.");
  const noteIds = new Set(notes.map(n => n.id));

  const markers: Marker[] = rawM.map((m, i) => {
    const where = `Marker ${i + 1}`;
    if (!isObj(m)) return fail(`${where} is damaged.`);
    const mid = unique(id(m.id, where), "A marker");
    const noteId = typeof m.noteId === "string" ? m.noteId : "";
    if (!noteIds.has(noteId) && !note(noteId)) fail(`${where} belongs to a note that isn't in the backup.`);
    if (m.thread !== undefined && (!Array.isArray(m.thread) || m.thread.length > LIMITS.thread)) fail(`${where}'s conversation is damaged.`);
    const thread: ThreadMsg[] = ((m.thread as unknown[]) || []).map(t => {
      if (!isObj(t) || !["user", "marker", "self"].includes(String(t.role))) return fail(`${where}'s conversation is damaged.`);
      return { role: t.role as ThreadMsg["role"], text: str(t.text, 20000, "A message", true) || "", at: num(t.at, "A message date", 0), inserted: !!t.inserted, calc: str(t.calc, 500, "A calculation", true), result: str(t.result, 500, "A result", true) };
    });
    let outputs: Marker["outputs"] | undefined;
    if (isObj(m.outputs)) {
      outputs = {};
      for (const [oid, list] of Object.entries(m.outputs).slice(0, 200)) {
        if (!ID.test(oid) || !Array.isArray(list)) continue;
        outputs[oid] = list.slice(-12).filter(isObj).map(v => ({ at: num(v.at, "A version date", 0), text: str(v.text, 50000, "A version", true) || "", html: DOMPurify.sanitize(str(v.html, 200000, "A version", true) || "") }));
      }
    }
    const mastery = [0, 1, 2].includes(m.mastery as number) ? m.mastery as 0 | 1 | 2 : 0;
    return {
      id: mid, noteId, type: (TYPES.has(String(m.type)) ? m.type : "note") as Marker["type"], text: str(m.text, 4000, `${where}'s passage`, true) || "", thread,
      recallQ: str(m.recallQ, 1000, `${where}'s question`, true), recallA: str(m.recallA, 4000, `${where}'s answer`, true),
      mastery, due: num(m.due, `${where}'s due date`, Date.now()), ivl: Math.min(3650, Math.max(0, num(m.ivl, `${where}'s interval`, 1))),
      linkNoteId: typeof m.linkNoteId === "string" && ID.test(m.linkNoteId) ? m.linkNoteId : null,
      links: Array.isArray(m.links) ? m.links.filter((x): x is string => typeof x === "string" && ID.test(x)).slice(0, 100) : undefined,
      draft: str(m.draft, 50000, `${where}'s draft`, true) || undefined, recallOff: !!m.recallOff,
      passageEditedAt: typeof m.passageEditedAt === "number" ? m.passageEditedAt : null, remindAt: typeof m.remindAt === "number" ? m.remindAt : null,
      detachedAt: typeof m.detachedAt === "number" ? m.detachedAt : null, outputs,
      createdAt: num(m.createdAt, `${where}'s date`, Date.now()), updatedAt: num(m.updatedAt, `${where}'s date`, Date.now()), deleted: !!m.deleted
    };
  });

  let meta: ValidBackup["meta"];
  if (isObj(b.meta)) {
    const days = Array.isArray(b.meta.studyDays) ? b.meta.studyDays.filter((d): d is string => typeof d === "string" && /^\d{4}-\d\d-\d\d$/.test(d)).slice(-3650) : [];
    meta = { studyDays: days, points: Math.min(1e7, Math.max(0, Number(b.meta.points) || 0)) };
  }
  const replaces = [...notes, ...markers, ...courses].filter(r => state.notes.has(r.id) || state.markers.has(r.id) || state.courses.has(r.id)).length;
  return { courses, notes, markers, meta, summary: { notes: notes.filter(n => !n.deleted).length, markers: markers.filter(m => !m.deleted).length, courses: courses.filter(c => !c.deleted).length, replaces, exportedAt: typeof b.exportedAt === "string" ? b.exportedAt.slice(0, 40) : null } };
}
