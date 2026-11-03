import Dexie, { type Table } from "dexie";
import type { Course, Marker, Meta, Note } from "./types";
import { COURSE_COLORS, DAY, uid } from "./util";

/*
  Local-first storage. Everything lives in IndexedDB and works offline; sync.ts mirrors it to Supabase.

  Each account gets its own database on the device ("liveboard-u-<id>"); notes made while signed out live in "liveboard".
  Switching accounts opens a different database, so one person's notes are never shown to, mixed with or deleted for another.

  Every change is written together with an outbox entry in one transaction. The outbox survives restarts and is only
  cleared when the server confirms that exact version, so an edit made offline can't be lost by closing the app.
*/
export type Kind = "notes" | "markers" | "courses";
export interface OutboxRow { key: string; kind: Kind | "meta"; id: string; ver: number; at: number; legacy?: boolean }

class LiveBoardDB extends Dexie {
  notes!: Table<Note, string>;
  markers!: Table<Marker, string>;
  courses!: Table<Course, string>;
  meta!: Table<Meta, string>;
  outbox!: Table<OutboxRow, string>;
  constructor(name: string) {
    super(name);
    const v1 = { notes: "id, courseId, openedAt, updatedAt", markers: "id, noteId, due, updatedAt", courses: "id, updatedAt", meta: "key" };
    this.version(1).stores(v1);
    this.version(2).stores({ ...v1, outbox: "key, kind, at" });
  }
}

export const ANON_DB = "liveboard";
export const dbNameFor = (owner: string | null) => (owner ? `liveboard-u-${owner.replace(/[^\w-]/g, "")}` : ANON_DB);
export let db: LiveBoardDB = new LiveBoardDB(ANON_DB);
export const openDb = (name: string) => new LiveBoardDB(name);

type ChangeKind = Kind | "meta";
type Listener = (kind: ChangeKind) => void;
const listeners = new Set<Listener>();
export const onChange = (fn: Listener) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = (k: ChangeKind) => listeners.forEach(fn => fn(k));
/** Fired when sync replaces records with another device's version (so an open editor can reload). */
type RemoteListener = (kind: Kind, ids: string[]) => void;
const remoteListeners = new Set<RemoteListener>();
export const onRemote = (fn: RemoteListener) => { remoteListeners.add(fn); return () => remoteListeners.delete(fn); };

/** Called after every local write so sync.ts can schedule an upload. */
let wrote: () => void = () => {};
export const setWriteHook = (fn: () => void) => { wrote = fn; };

export const state = {
  owner: null as string | null,
  notes: new Map<string, Note>(),
  markers: new Map<string, Marker>(),
  courses: new Map<string, Course>(),
  meta: null as unknown as Meta,
  /** keys of records with changes the server hasn't confirmed yet ("notes:<id>") */
  pending: new Set<string>()
};

const defaultMeta = (): Meta => ({ key: "meta", studyDays: [], points: 0, scope: "due", showTools: false, lastPull: 0, displayName: "", updatedAt: Date.now(), seeded: false });
const SYNCED_META: (keyof Meta)[] = ["studyDays", "points", "displayName"];

/** Open the database for this owner (null = signed out) and load it. Nothing renders before this resolves. */
export async function openStore(owner: string | null) {
  if (db.name !== dbNameFor(owner)) { db.close(); db = new LiveBoardDB(dbNameFor(owner)); }
  state.owner = owner;
  await loadAll();
}

export async function loadAll() {
  const [notes, markers, courses, meta, outbox] = await Promise.all([db.notes.toArray(), db.markers.toArray(), db.courses.toArray(), db.meta.get("meta"), db.outbox.toArray()]);
  state.notes.clear(); state.markers.clear(); state.courses.clear(); state.pending.clear();
  notes.forEach(n => state.notes.set(n.id, n));
  markers.forEach(m => state.markers.set(m.id, m));
  courses.forEach(c => state.courses.set(c.id, { ...c, color: safeColor(c.color) }));
  outbox.forEach(o => state.pending.add(o.key));
  state.meta = { ...defaultMeta(), ...(meta || {}) };
  if ((state.meta.scope as string) !== "due" && !["night", "week", "unit"].includes(state.meta.scope)) state.meta.scope = "due";
}

/* ---------- reads ---------- */
export const liveNotes = () => [...state.notes.values()].filter(n => !n.deleted);
export const liveCourses = () => [...state.courses.values()].filter(c => !c.deleted).sort((a, b) => a.name.localeCompare(b.name));
export const note = (id?: string | null) => (id ? state.notes.get(id) : undefined);
export const course = (id?: string | null) => (id ? state.courses.get(id) : undefined);
export const safeColor = (c: unknown) => (typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c) ? c : "#8892A0");
export const courseColor = (id?: string | null) => safeColor(course(id)?.color);
export const courseName = (id?: string | null) => course(id)?.name || "No course";
export const markersOf = (noteId: string) => [...state.markers.values()].filter(m => m.noteId === noteId && !m.deleted);
export const liveMarkers = () => [...state.markers.values()].filter(m => !m.deleted && state.notes.get(m.noteId) && !state.notes.get(m.noteId)!.deleted);
export const pendingCount = () => state.pending.size;

/* ---------- writes ---------- */
const maxRev = (a?: number, b?: number) => (a === undefined && b === undefined ? undefined : Math.max(a || 0, b || 0));
const table = (kind: Kind) => db[kind] as unknown as Table<Note | Marker | Course, string>;

async function write(kind: Kind, rec: Note | Marker | Course) {
  const key = `${kind}:${rec.id}`;
  state.pending.add(key);
  await db.transaction("rw", table(kind), db.outbox, async () => {
    await table(kind).put(rec);
    await db.outbox.put({ key, kind, id: rec.id, ver: rec.updatedAt, at: Date.now() });
  });
  wrote();
}

/** Writes always build on the latest stored copy, so a stale object can't undo a newer change or drop the server revision. */
export async function putNote(n: Note, touch = true) {
  const cur = state.notes.get(n.id);
  const rec: Note = { ...n, rev: maxRev(cur?.rev, n.rev), updatedAt: touch ? Math.max(Date.now(), (cur?.updatedAt || 0) + 1) : n.updatedAt };
  state.notes.set(rec.id, rec);
  await write("notes", rec);
  emit("notes");
}
/** Update fields of a note in place, on top of whatever is stored now. */
export async function patchNote(id: string, patch: Partial<Note>, touch = true) {
  const cur = state.notes.get(id);
  if (!cur) return;
  await putNote({ ...cur, ...patch }, touch);
}
export async function putMarker(m: Marker) {
  const cur = state.markers.get(m.id);
  const rec: Marker = { ...m, rev: maxRev(cur?.rev, m.rev), updatedAt: Math.max(Date.now(), (cur?.updatedAt || 0) + 1) };
  state.markers.set(rec.id, rec);
  await write("markers", rec);
  emit("markers");
}
export async function putCourse(c: Course) {
  const cur = state.courses.get(c.id);
  const rec: Course = { ...c, color: safeColor(c.color), rev: maxRev(cur?.rev, c.rev), updatedAt: Math.max(Date.now(), (cur?.updatedAt || 0) + 1) };
  state.courses.set(rec.id, rec);
  await write("courses", rec);
  emit("courses");
}
export async function putMeta(patch: Partial<Meta>) {
  state.meta = { ...state.meta, ...patch, updatedAt: Date.now() };
  const synced = SYNCED_META.some(k => k in patch);
  if (synced) state.pending.add("meta:meta");
  await db.transaction("rw", db.meta, db.outbox, async () => {
    await db.meta.put(state.meta);
    if (synced) await db.outbox.put({ key: "meta:meta", kind: "meta", id: "meta", ver: state.meta.updatedAt, at: Date.now() });
  });
  if (synced) wrote();
  emit("meta");
}
/** Local-only settings (cursors, view choices): never queued for upload. */
export async function putLocalMeta(patch: Partial<Meta>) {
  state.meta = { ...state.meta, ...patch };
  await db.meta.put(state.meta);
}

/* ---------- used by sync ---------- */
export const outboxRows = () => db.outbox.orderBy("at").toArray();

/** The server confirmed version `ver` as revision `rev`. Clear the outbox entry only if nothing changed since. */
export async function ack(kind: Kind | "meta", id: string, ver: number, rev?: number) {
  const key = `${kind}:${id}`;
  await db.transaction("rw", kind === "meta" ? db.meta : table(kind as Kind), db.outbox, async () => {
    const o = await db.outbox.get(key);
    if (o && o.ver === ver) { await db.outbox.delete(key); state.pending.delete(key); }
    if (kind !== "meta" && rev !== undefined) {
      const cur = await table(kind).get(id);
      if (cur && (cur.rev ?? 0) < rev) {
        const next = { ...cur, rev };
        await table(kind).put(next);
        (state[kind] as Map<string, Note | Marker | Course>).set(id, next);
      }
    }
  });
}

/** Take the server's version of records. Records with unconfirmed local changes are skipped; their upload resolves the conflict. */
export async function applyRemote(kind: Kind, rows: (Note | Marker | Course)[], force = false) {
  const map = state[kind] as Map<string, Note | Marker | Course>;
  const winners = rows.filter(r => force || !state.pending.has(`${kind}:${r.id}`)).map(r => kind === "courses" ? { ...r, color: safeColor((r as Course).color) } : r);
  if (!winners.length) return;
  await db.transaction("rw", table(kind), db.outbox, async () => {
    await table(kind).bulkPut(winners);
    if (force) for (const r of winners) { await db.outbox.delete(`${kind}:${r.id}`); state.pending.delete(`${kind}:${r.id}`); }
  });
  winners.forEach(r => map.set(r.id, r));
  emit(kind);
  remoteListeners.forEach(fn => fn(kind, winners.map(r => r.id)));
}
export async function applyRemoteMeta(patch: Partial<Meta>) {
  state.meta = { ...state.meta, ...patch };
  await db.meta.put(state.meta);
  emit("meta");
}

/* ---------- creation ---------- */
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
  await patchNote(id, { deleted: true });
  for (const m of markersOf(id)) await putMarker({ ...m, deleted: true });
}

export function newMarker(noteId: string, text: string, type: Marker["type"]): Marker {
  const t = Date.now();
  return { id: uid(), noteId, type, text, thread: [], mastery: 0, due: t + 8 * 36e5, ivl: 1, createdAt: t, updatedAt: t };
}

/**
  Keep marker records in step with the pins in a note's document.
  A marker whose pin disappears isn't deleted: its thinking (thread, writing, recall) is kept and it shows as "source removed"
  until it is reattached or deleted on purpose. Undo brings the pin back and reattaches it.
*/
export async function reconcilePins(noteId: string, pinIds: Set<string>) {
  for (const m of state.markers.values()) {
    if (m.noteId !== noteId) continue;
    const present = pinIds.has(m.id);
    if (present && (m.deleted || m.detachedAt)) await putMarker({ ...m, deleted: false, detachedAt: null }); // undo brought it back
    else if (m.deleted) continue;
    else if (!present && !m.detachedAt) await putMarker({ ...m, detachedAt: Date.now() });
  }
}

/* ---------- streak ---------- */
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

/* ---------- backup ---------- */
export async function exportAll() {
  return JSON.stringify({ app: "liveboard", version: 2, exportedAt: new Date().toISOString(), notes: [...state.notes.values()], markers: [...state.markers.values()], courses: [...state.courses.values()], meta: { studyDays: state.meta.studyDays, points: state.meta.points, displayName: state.meta.displayName } }, null, 2);
}

/** Add a validated backup in one transaction: either everything is restored or nothing changes. */
export async function restoreBackup(b: { notes: Note[]; markers: Marker[]; courses: Course[]; meta?: { studyDays: string[]; points: number } }) {
  const now = Date.now();
  const stamp = <T extends { updatedAt: number; rev?: number }>(r: T, i: number): T => ({ ...r, rev: undefined, updatedAt: now + i });
  const courses = b.courses.map(stamp), notes = b.notes.map(stamp), markers = b.markers.map(stamp);
  await db.transaction("rw", [db.courses, db.notes, db.markers, db.outbox, db.meta], async () => {
    for (const [kind, rows] of [["courses", courses], ["notes", notes], ["markers", markers]] as const) {
      // keep the server revision of records that already exist here, so the upload replaces them cleanly
      for (const r of rows) { const cur = await table(kind).get(r.id); if (cur?.rev) r.rev = cur.rev; }
      await table(kind).bulkPut(rows);
      await db.outbox.bulkPut(rows.map(r => ({ key: `${kind}:${r.id}`, kind, id: r.id, ver: r.updatedAt, at: now })));
    }
    if (b.meta) {
      state.meta = { ...state.meta, studyDays: [...new Set([...state.meta.studyDays, ...b.meta.studyDays])].sort(), points: Math.max(state.meta.points, b.meta.points), updatedAt: now };
      await db.meta.put(state.meta);
      await db.outbox.put({ key: "meta:meta", kind: "meta", id: "meta", ver: state.meta.updatedAt, at: now });
    }
  });
  await loadAll();
  wrote();
  (["courses", "notes", "markers", "meta"] as const).forEach(emit);
}

/** Delete this device's copy of the current database (only after everything has uploaded, or on purpose). */
export async function deleteLocalDb(name: string) {
  if (db.name === name) db.close();
  await Dexie.delete(name);
}
export async function wipeLocal() {
  const name = db.name;
  db.close();
  await Dexie.delete(name);
  location.hash = "";
  location.reload();
}
