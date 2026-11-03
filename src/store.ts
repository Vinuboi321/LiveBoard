import Dexie, { type Table } from "dexie";
import type { Course, Marker, Meta, Note } from "./types";
import { COURSE_COLORS, DAY, uid } from "./util";

/* Local-first storage. Everything lives in IndexedDB and works offline; sync.ts mirrors it to Supabase when configured. */
class LiveBoardDB extends Dexie {
  notes!: Table<Note, string>;
  markers!: Table<Marker, string>;
  courses!: Table<Course, string>;
  meta!: Table<Meta, string>;
  constructor() {
    super("liveboard");
    this.version(1).stores({ notes: "id, courseId, openedAt, updatedAt", markers: "id, noteId, due, updatedAt", courses: "id, updatedAt", meta: "key" });
  }
}
export const db = new LiveBoardDB();

type Kind = "notes" | "markers" | "courses" | "meta";
type Listener = (kind: Kind) => void;
const listeners = new Set<Listener>();
export const onChange = (fn: Listener) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = (k: Kind) => listeners.forEach(fn => fn(k));

/** Called after every local write so sync.ts can push it. Set by sync.ts. */
export let markDirty: (kind: Exclude<Kind, "meta"> | "meta", id: string) => void = () => {};
export const setDirtyHook = (fn: typeof markDirty) => { markDirty = fn; };

export const state = {
  notes: new Map<string, Note>(),
  markers: new Map<string, Marker>(),
  courses: new Map<string, Course>(),
  meta: null as unknown as Meta
};

const defaultMeta = (): Meta => ({ key: "meta", studyDays: [], points: 0, scope: "night", showTools: false, lastPull: 0, displayName: "", updatedAt: Date.now(), seeded: false });

export async function loadAll() {
  const [notes, markers, courses, meta] = await Promise.all([db.notes.toArray(), db.markers.toArray(), db.courses.toArray(), db.meta.get("meta")]);
  notes.forEach(n => state.notes.set(n.id, n));
  markers.forEach(m => state.markers.set(m.id, m));
  courses.forEach(c => state.courses.set(c.id, c));
  state.meta = { ...defaultMeta(), ...(meta || {}) };
}

/* ---------- reads ---------- */
export const liveNotes = () => [...state.notes.values()].filter(n => !n.deleted);
export const liveCourses = () => [...state.courses.values()].filter(c => !c.deleted).sort((a, b) => a.name.localeCompare(b.name));
export const note = (id?: string | null) => (id ? state.notes.get(id) : undefined);
export const course = (id?: string | null) => (id ? state.courses.get(id) : undefined);
export const courseColor = (id?: string | null) => course(id)?.color || "#8892A0";
export const courseName = (id?: string | null) => course(id)?.name || "No course";
export const markersOf = (noteId: string) => [...state.markers.values()].filter(m => m.noteId === noteId && !m.deleted);
export const liveMarkers = () => [...state.markers.values()].filter(m => !m.deleted && state.notes.get(m.noteId) && !state.notes.get(m.noteId)!.deleted);

/* ---------- writes ---------- */
export async function putNote(n: Note, touch = true) {
  if (touch) n.updatedAt = Date.now();
  state.notes.set(n.id, n);
  await db.notes.put(n);
  markDirty("notes", n.id);
  emit("notes");
}
export async function putMarker(m: Marker) {
  m.updatedAt = Date.now();
  state.markers.set(m.id, m);
  await db.markers.put(m);
  markDirty("markers", m.id);
  emit("markers");
}
export async function putCourse(c: Course) {
  c.updatedAt = Date.now();
  state.courses.set(c.id, c);
  await db.courses.put(c);
  markDirty("courses", c.id);
  emit("courses");
}
export async function putMeta(patch: Partial<Meta>) {
  state.meta = { ...state.meta, ...patch, updatedAt: Date.now() };
  await db.meta.put(state.meta);
  markDirty("meta", "meta");
  emit("meta");
}

/** Used by sync when pulling: writes without marking dirty. */
export async function applyRemote(kind: "notes" | "markers" | "courses", rows: (Note | Marker | Course)[]) {
  const map = state[kind] as Map<string, Note | Marker | Course>;
  const table = db[kind] as Table<Note | Marker | Course, string>;
  const winners = rows.filter(r => { const cur = map.get(r.id); return !cur || cur.updatedAt <= r.updatedAt; });
  winners.forEach(r => map.set(r.id, r));
  if (winners.length) { await table.bulkPut(winners); emit(kind); }
}
export async function applyRemoteMeta(patch: Partial<Meta>) {
  state.meta = { ...state.meta, ...patch };
  await db.meta.put(state.meta);
  emit("meta");
}

export async function newCourse(name: string) {
  const used = liveCourses().map(c => c.color);
  const color = COURSE_COLORS.find(c => !used.includes(c)) || COURSE_COLORS[liveCourses().length % COURSE_COLORS.length];
  const c: Course = { id: uid(), name: name.trim().slice(0, 32).toUpperCase(), color, updatedAt: Date.now() };
  await putCourse(c);
  return c;
}

export async function newNote(courseId: string, title: string, kind: Note["kind"], html: string | null = null) {
  const t = Date.now();
  const n: Note = { id: uid(), courseId, title: title.slice(0, 140) || "Untitled note", kind, doc: null, html, plain: html ? html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "", createdAt: t, updatedAt: t, openedAt: t };
  await putNote(n);
  return n;
}

export async function deleteNote(id: string) {
  const n = note(id);
  if (!n) return;
  await putNote({ ...n, deleted: true });
  for (const m of markersOf(id)) await putMarker({ ...m, deleted: true });
}

export function newMarker(noteId: string, text: string, type: Marker["type"]): Marker {
  const t = Date.now();
  return { id: uid(), noteId, type, text, thread: [], mastery: 0, due: t + 8 * 36e5, ivl: 1, createdAt: t, updatedAt: t };
}

/** Keep marker records in step with the pins that exist in a note's document (handles deletes and undo). */
export async function reconcilePins(noteId: string, pinIds: Set<string>) {
  for (const m of state.markers.values()) {
    if (m.noteId !== noteId) continue;
    const present = pinIds.has(m.id);
    if (present && m.deleted) await putMarker({ ...m, deleted: false });
    else if (!present && !m.deleted) await putMarker({ ...m, deleted: true });
  }
}

/* ---------- streak and recall ---------- */
export function streak() {
  const set = new Set(state.meta.studyDays);
  let d = Date.now(), n = 0;
  const key = (t: number) => { const x = new Date(t); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
  if (!set.has(key(d))) d -= DAY;
  while (set.has(key(d))) { n++; d -= DAY; }
  return n;
}

export async function ensureStarterCourse() {
  if (liveCourses().length) return;
  await newCourse("My first course");
}

export async function exportAll() {
  return JSON.stringify({ app: "liveboard", version: 1, exportedAt: new Date().toISOString(), notes: [...state.notes.values()], markers: [...state.markers.values()], courses: [...state.courses.values()], meta: state.meta }, null, 2);
}
export async function importAll(json: string) {
  const data = JSON.parse(json);
  if (data.app !== "liveboard") throw new Error("That file isn't a LiveBoard backup.");
  for (const c of data.courses || []) await putCourse({ ...c });
  for (const n of data.notes || []) await putNote({ ...n }, false);
  for (const m of data.markers || []) await putMarker({ ...m });
  if (data.meta) await putMeta({ studyDays: [...new Set([...(state.meta.studyDays || []), ...(data.meta.studyDays || [])])], points: Math.max(state.meta.points, data.meta.points || 0) });
}
/** Empty the local copy (used when an account signs out or a different account signs in on this device). */
export async function resetLocal(ownerId: string | null) {
  await Promise.all([db.notes.clear(), db.markers.clear(), db.courses.clear()]);
  state.notes.clear();
  state.markers.clear();
  state.courses.clear();
  state.meta = { ...defaultMeta(), ownerId, seeded: true, demoSeeded: true, demoVersion: 99 };
  await db.meta.put(state.meta);
  emit("notes"); emit("markers"); emit("courses"); emit("meta");
}
export async function wipeLocal() {
  await db.delete();
  location.hash = "";
  location.reload();
}
