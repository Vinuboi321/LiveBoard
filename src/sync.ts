import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import Dexie from "dexie";
import { ack, ANON_DB, applyRemote, applyRemoteMeta, block, blockAll, blockedCount, db, dbNameFor, type Kind, openDb, outboxRows, pendingCount, putCourse, putLocalMeta, putMarker, putNote, requeueAll, setWriteHook, state, deleteLocalDb } from "./store";
import type { Course, Marker, Meta, Note, ThreadMsg } from "./types";
import { $, uid } from "./util";

/*
  Mirrors the local store to Supabase.
  Rows are { id, user_id, data (jsonb), updated_at, deleted, rev, seq }. Uploads go through the push_rows function, which only
  applies a change made on top of the latest server revision; anything else comes back as a conflict and is merged here,
  so no device silently overwrites another. Downloads follow the server's sequence number, never a device clock.
*/
const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const sb: SupabaseClient | null = URL_ && KEY ? createClient(URL_, KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;
export const syncConfigured = () => !!sb;

let session: Session | null = null;
export const currentUser = () => session?.user ?? null;
export const authToken = () => session?.access_token ?? null;

let pushTimer: number | undefined;
let pushing: Promise<boolean> | null = null;
let notice: (msg: string) => void = () => {};

function setStatus(text: string | null) {
  const el = $("#syncState");
  if (!el) return;
  el.hidden = !text;
  el.textContent = text || "";
}
const canSync = () => !!(sb && session && state.owner && session.user.id === state.owner && !suspended);

setWriteHook(() => { if (canSync()) schedulePush(1200); });
function schedulePush(ms: number) { clearTimeout(pushTimer); pushTimer = window.setTimeout(() => { push(); }, ms); }
export const hasUnsynced = () => pendingCount() > 0;

/* ---------- which account's notes to open ---------- */
const authStorageKey = () => (sb?.auth as unknown as { storageKey?: string })?.storageKey || Object.keys(localStorage).find(k => /^sb-.+-auth-token$/.test(k)) || "";

/** Decide whose notes to open before anything renders. Reads the saved sign-in without waiting for the network. */
export async function bootOwner(): Promise<string | null> {
  if (!sb) return null;
  const authInUrl = /access_token=|refresh_token=|[?&]code=|error_description=/.test(location.hash + location.search);
  if (authInUrl) {
    const { data } = await sb.auth.getSession(); // finishes a magic-link sign-in
    return data.session?.user.id ?? null;
  }
  try {
    const key = authStorageKey();
    const raw = key ? localStorage.getItem(key) : null;
    const id = raw ? (JSON.parse(raw) as { user?: { id?: string } }).user?.id : null;
    return typeof id === "string" && /^[\w-]{8,64}$/.test(id) ? id : null;
  } catch { return null; }
}

/** Before LiveBoard kept one database per account, everything shared "liveboard". Move such a copy to its owner's database. */
export async function migrateLegacyShared() {
  const anon = openDb(ANON_DB);
  try {
    const meta = await anon.meta.get("meta");
    const owner = meta?.ownerId;
    if (!owner) return;
    await copyBetween(anon, dbNameFor(owner), { legacy: true });
    await anon.transaction("rw", [anon.notes, anon.markers, anon.courses, anon.outbox, anon.meta], async () => {
      await Promise.all([anon.notes.clear(), anon.markers.clear(), anon.courses.clear(), anon.outbox.clear()]);
      await anon.meta.put({ ...meta, ownerId: null, seeded: true, demoSeeded: true, demoVersion: 99, cursors: {}, lastPull: 0 } as Meta);
    });
  } finally { anon.close(); }
}

/** Copy records into another database and queue them for upload there. Copy first, delete after: a crash can duplicate, never lose. */
async function copyBetween(from: ReturnType<typeof openDb>, toName: string, opts: { legacy?: boolean; skipNotes?: Set<string> } = {}) {
  const to = openDb(toName);
  try {
    const skip = opts.skipNotes || new Set<string>();
    const notes = (await from.notes.toArray()).filter(n => !skip.has(n.id));
    const markers = (await from.markers.toArray()).filter(m => !skip.has(m.noteId));
    const courses = await from.courses.toArray();
    const now = Date.now();
    await to.transaction("rw", [to.notes, to.markers, to.courses, to.outbox], async () => {
      for (const [kind, rows] of [["courses", courses], ["notes", notes], ["markers", markers]] as const) {
        for (const r of rows as (Note | Marker | Course)[]) {
          const t = to[kind] as unknown as Dexie.Table<Note | Marker | Course, string>;
          const cur = await t.get(r.id);
          if (cur && cur.updatedAt >= r.updatedAt) continue;
          await t.put({ ...r, rev: opts.legacy ? undefined : cur?.rev });
          await to.outbox.put({ key: `${kind}:${r.id}`, kind, id: r.id, ver: r.updatedAt, at: now, legacy: opts.legacy });
        }
      }
    });
  } finally { to.close(); }
}

/** Notes made on this device while signed out, other than the untouched starter note. */
export async function signedOutNotes() {
  const anon = openDb(ANON_DB);
  try {
    const meta = await anon.meta.get("meta");
    if (state.owner && meta?.claimDeclined?.includes(state.owner)) return 0;
    const notes = await anon.notes.toArray();
    return notes.filter(n => !n.deleted && !(n.id === meta?.welcomeId && n.updatedAt - n.createdAt < 5000)).length;
  } finally { anon.close(); }
}
/** Move the signed-out notes into the signed-in account (or remember that they should stay separate). */
export async function claimSignedOutNotes(move: boolean) {
  if (!state.owner) return;
  const anon = openDb(ANON_DB);
  try {
    const meta = await anon.meta.get("meta");
    if (!move) { await anon.meta.put({ ...(meta as Meta), claimDeclined: [...new Set([...(meta?.claimDeclined || []), state.owner])] }); return; }
    const welcome = meta?.welcomeId ? await anon.notes.get(meta.welcomeId) : null;
    const skip = new Set<string>(welcome && welcome.updatedAt - welcome.createdAt < 5000 ? [welcome.id] : []);
    await copyBetween(anon, db.name, { skipNotes: skip });
    await anon.transaction("rw", [anon.notes, anon.markers, anon.courses, anon.outbox], async () => {
      await Promise.all([anon.notes.clear(), anon.markers.clear(), anon.courses.clear(), anon.outbox.clear()]);
    });
  } finally { anon.close(); }
}

/* ---------- upload ---------- */
let suspended = false; // set while deleting the account's data: nothing may upload
export function push(): Promise<boolean> {
  if (pushing) return pushing.then(() => push()); // one upload at a time; queue another pass after it
  pushing = doPush().finally(() => { pushing = null; });
  return pushing;
}
const MAX_RECORD_BYTES = 1_900_000; // the server refuses records over about 2 MB

function statusLine() {
  const blocked = blockedCount(), waiting = pendingCount() - blocked;
  if (state.meta.erasedAt) return "This account's online copy was deleted · notes here are on this device only";
  if (blocked) return `${blocked} item${blocked === 1 ? "" : "s"} couldn't upload · open Settings`;
  return waiting ? "Syncing…" : null;
}

async function doPush(): Promise<boolean> {
  if (!canSync() || suspended) return false;
  if (!navigator.onLine) { setStatus(`Offline · ${pendingCount()} change${pendingCount() === 1 ? "" : "s"} saved on this device`); return false; }
  try {
    if (state.meta.gen === undefined && !(await checkGeneration())) return false;
    if (state.meta.erasedAt) { setStatus(statusLine()); return false; }
    const rows = (await outboxRows()).filter(o => !o.blocked);
    for (const kind of ["courses", "notes", "markers"] as const) {
      const items = rows.filter(r => r.kind === kind);
      for (let i = 0; i < items.length; i += 100) {
        if (suspended) return false;
        const batch = items.slice(i, i + 100).map(o => ({ o, rec: (state[kind] as Map<string, Note | Marker | Course>).get(o.id) })).filter(x => x.rec && x.rec.updatedAt === x.o.ver);
        const send: typeof batch = [];
        for (const x of batch) {
          const { rev: _rev, ...data } = x.rec!;
          if (JSON.stringify(data).length > MAX_RECORD_BYTES) await block(kind, x.rec!.id, x.o.ver, "too-large");
          else send.push(x);
        }
        if (!send.length) continue;
        const payload = send.map(({ o, rec }) => {
          const { rev, ...data } = rec!;
          return { id: rec!.id, base_rev: o.legacy ? null : rev ?? 0, data, updated_at: rec!.updatedAt, deleted: !!rec!.deleted };
        });
        const { data, error } = await sb!.rpc("push_rows", { p_kind: kind, p_rows: payload, p_gen: state.meta.gen });
        if (error) throw error;
        const results = Array.isArray(data) ? data as PushResult[] : [];
        if (results.some(r => r.status === "erased")) { await accountErased(); return false; }
        for (const { o, rec } of send) {
          const r = results.find(x => x.id === rec!.id);
          if (!r) continue; // no answer for this one: it stays queued
          if (r.status === "ok") await ack(kind, rec!.id, o.ver, r.rev);
          else if (r.status === "conflict" || r.status === "stale") await resolve(kind, rec!.id, r);
          else await block(kind, rec!.id, o.ver, "refused"); // never counted as saved
        }
      }
    }
    const meta = rows.find(r => r.kind === "meta");
    if (meta && !suspended) {
      const m = state.meta;
      const { data, error } = await sb!.rpc("push_profile", { p_data: { studyDays: m.studyDays, points: m.points, displayName: m.displayName }, p_gen: m.gen });
      if (error) throw error;
      if ((data as { status?: string } | null)?.status === "erased") { await accountErased(); return false; }
      if ((data as { status?: string } | null)?.status === "ok") await ack("meta", "meta", meta.ver);
    }
    const left = pendingCount() - blockedCount();
    setStatus(statusLine());
    if (left > 0) schedulePush(800);
    return left === 0 && blockedCount() === 0;
  } catch (e) {
    console.warn("sync push failed", e);
    setStatus(`Sync paused · ${pendingCount()} change${pendingCount() === 1 ? "" : "s"} saved on this device`);
    schedulePush(15000);
    return false;
  }
}

interface PushResult { id: string; status: "ok" | "conflict" | "stale" | "invalid" | "erased"; rev: number; data?: unknown; deleted?: boolean }

/* ---------- the account's data generation ----------
   Deleting the account's online data bumps a server-side generation number. Uploads carry the generation they were
   made under, so a device that was offline during the deletion can't quietly put the deleted notes back. */
async function checkGeneration(): Promise<boolean> {
  const { data, error } = await sb!.rpc("sync_state");
  if (error || typeof (data as { gen?: unknown } | null)?.gen !== "number") { console.warn("sync_state", error); return false; }
  const gen = (data as { gen: number }).gen;
  if (state.meta.gen === undefined) { await putLocalMeta({ gen }); return true; }
  if (gen !== state.meta.gen) { await accountErased(); return false; }
  return true;
}
async function accountErased() {
  if (!state.meta.erasedAt) {
    await blockAll("erased");
    await putLocalMeta({ erasedAt: Date.now() });
    notice("This account's online notes were deleted from another device. The notes on this device are kept here only. Settings has options.");
  }
  setStatus(statusLine());
}
/** After a deletion elsewhere: upload everything on this device again, as the account's new online copy. */
export async function reuploadAfterErase() {
  const { data, error } = await sb!.rpc("sync_state");
  if (error) throw new Error("Couldn't reach the server. Try again when you're online.");
  await putLocalMeta({ gen: (data as { gen: number }).gen, erasedAt: null, cursors: {} });
  await requeueAll();
  await push();
}

/* ---------- conflicts: keep both sides, never drop either ----------
   Always resolved against the record as it is NOW (the student may have kept typing while the upload was in flight),
   never against the copy that was sent. Reading the latest copy and writing the result happen with no wait in between. */
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const latest = <T extends Note | Marker | Course>(kind: Kind, id: string) => (state[kind] as Map<string, T>).get(id);

async function resolve(kind: Kind, id: string, r: PushResult) {
  const server = { ...(r.data as object), id, rev: r.rev, deleted: !!r.deleted } as Note | Marker | Course;
  const now0 = latest(kind, id);
  if (!now0) { await applyRemote(kind, [server], true); return; }

  if (kind === "markers") {
    const cur = latest<Marker>(kind, id)!;
    await putMarker({ ...mergeMarkers(cur, server as Marker), rev: Math.max(cur.rev || 0, r.rev) });
    return;
  }
  if (kind === "courses") {
    const cur = latest<Course>(kind, id)!;
    if (cur.updatedAt >= server.updatedAt || r.status === "conflict") await putCourse({ ...cur, rev: Math.max(cur.rev || 0, r.rev) });
    else await applyRemote(kind, [server], true);
    return;
  }
  // notes: this device's latest version stays in place; a different server version is kept as a copy
  const s = server as Note;
  const l0 = now0 as Note;
  if (l0.deleted && !s.deleted) { await applyRemote("notes", [s], true); notice(`“${s.title}” was edited on another device, so it was kept.`); return; }
  if (!s.deleted && !l0.deleted && (!same(l0.doc, s.doc) || l0.title !== s.title) && !same(s.doc, null)) {
    await conflictCopy(s, "from another device");
    notice(`“${l0.title}” changed on two devices. This device's version stayed; the other was saved as a copy.`);
  }
  const cur = latest<Note>("notes", id)!; // re-read: the copy above took a moment, and typing may have continued
  await putNote({ ...cur, courseId: cur.courseId || s.courseId, rev: Math.max(cur.rev || 0, r.rev) }, true);
}

/** Save one side of a conflict as its own note. Its markers stay with the original, so the copy holds plain text. */
async function conflictCopy(src: Note, label: string) {
  const t = Date.now();
  await putNote({ ...src, id: uid(), title: `${src.title} (${label})`.slice(0, 140), doc: stripMarkers(src.doc), html: src.doc ? null : src.html, conflictOf: src.id, rev: undefined, createdAt: t, openedAt: t, updatedAt: t, deleted: false });
}
export function stripMarkers(doc: unknown): unknown {
  if (!doc || typeof doc !== "object") return doc;
  const walk = (n: { type?: string; content?: unknown[]; marks?: { type: string }[] }): unknown[] => {
    if (n.type === "pin") return [];
    const kids = Array.isArray(n.content) ? n.content.flatMap(c => walk(c as typeof n)) : undefined;
    if (n.type === "markerOutput") return kids || [];
    const out: Record<string, unknown> = { ...n };
    if (kids) out.content = kids;
    if (n.marks) out.marks = n.marks.filter(m => m.type !== "marker");
    return [out];
  };
  return walk(doc as never)[0] ?? null;
}

/** Two devices changed one marker: keep every message, answer and written version from both. */
export function mergeMarkers(a: Marker, b: Marker): Marker {
  const newer = a.updatedAt >= b.updatedAt ? a : b;
  const seen = new Set<string>();
  const thread: ThreadMsg[] = [...a.thread, ...b.thread].filter(t => { const k = `${t.role}|${t.at}|${t.text}`; if (seen.has(k)) return false; seen.add(k); return true; }).sort((x, y) => x.at - y.at);
  const outputs: Marker["outputs"] = {};
  for (const src of [a.outputs || {}, b.outputs || {}]) for (const [oid, list] of Object.entries(src)) {
    const all = [...(outputs[oid] || []), ...list];
    const uniq = new Map(all.map(v => [`${v.at}|${v.text}`, v]));
    outputs[oid] = [...uniq.values()].sort((x, y) => x.at - y.at).slice(-12);
  }
  const draft = a.draft && b.draft && a.draft !== b.draft ? `${newer.draft}\n\n${newer === a ? b.draft : a.draft}` : a.draft || b.draft;
  return { ...newer, thread, outputs, draft, links: [...new Set([...(a.links || []), ...(b.links || [])])], deleted: !!(a.deleted && b.deleted), mastery: newer.mastery, due: newer.due };
}

/* ---------- download ---------- */
export async function pull(): Promise<boolean> {
  if (!canSync()) return false;
  try {
    if (!(await checkGeneration())) { setStatus(statusLine()); return false; }
    const cursors = { ...(state.meta.cursors || {}) };
    for (const kind of ["courses", "notes", "markers"] as const) {
      for (;;) {
        const since = cursors[kind] || 0;
        const { data, error } = await sb!.from(kind).select("id, data, rev, seq, deleted").gt("seq", since).order("seq").limit(500);
        if (error) throw error;
        if (!data?.length) break;
        const rows = data.filter(r => r.data && typeof r.data === "object").map(r => ({ ...(r.data as object), id: r.id, rev: r.rev, deleted: !!r.deleted }) as Note | Marker | Course);
        await applyRemote(kind, rows);
        cursors[kind] = Math.max(since, ...data.map(r => Number(r.seq) || 0));
        await putLocalMeta({ cursors });
        if (data.length < 500) break;
      }
    }
    const { data: prof } = await sb!.from("profiles").select("data").maybeSingle();
    if (prof?.data) {
      const d = prof.data as { studyDays?: unknown; points?: unknown; displayName?: unknown };
      await applyRemoteMeta({
        studyDays: [...new Set([...state.meta.studyDays, ...(Array.isArray(d.studyDays) ? d.studyDays.filter(x => typeof x === "string" && /^\d{4}-\d\d-\d\d$/.test(x)) : [])])],
        points: Math.max(state.meta.points, Number(d.points) || 0),
        displayName: state.meta.displayName || (typeof d.displayName === "string" ? d.displayName.slice(0, 40) : "")
      });
    }
    setStatus(statusLine());
    return true;
  } catch (e) {
    console.warn("sync pull failed", e);
    setStatus("Sync paused · retrying");
    return false;
  }
}

/* ---------- sign-in state ---------- */
interface Hooks { beforeSwitch: () => Promise<void> | void; notice: (msg: string) => void }
let hooks: Hooks = { beforeSwitch: () => {}, notice: () => {} };
let switching = false;

/** Leave cleanly, then reopen as `owner`. Reloading guarantees the editor, in-flight AI and caches from the old account are gone. */
async function switchTo(owner: string | null) {
  if (switching || owner === state.owner) return;
  switching = true;
  try { await hooks.beforeSwitch(); } catch (e) { console.warn(e); }
  location.reload();
}

/** Resolves after the first download, with whether it worked (false when offline or signed out). */
export async function initSync(h: Hooks): Promise<boolean> {
  hooks = h;
  notice = h.notice;
  if (!sb) return false;
  const { data, error } = await sb.auth.getSession();
  session = data.session;
  // A sign-in or sign-out that happened elsewhere (another tab, or a session that expired while closed)
  if (!error && (session?.user.id ?? null) !== state.owner) {
    if (session || navigator.onLine) { await switchTo(session?.user.id ?? null); return false; }
  }
  sb.auth.onAuthStateChange((event, s) => {
    session = s;
    if (event === "SIGNED_OUT") { void switchTo(null); return; }
    if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && s && s.user.id !== state.owner) { void switchTo(s.user.id); return; }
  });
  addEventListener("online", () => { void pull().then(push); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void pull(); else void push(); });
  addEventListener("pagehide", () => { void push(); });
  if (!canSync()) return false;
  const ok = await pull();
  void push();
  return ok;
}

export async function signIn(email: string) {
  if (!sb) throw new Error("Accounts aren't set up on this server yet.");
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin } });
  if (error) throw new Error(/rate|seconds/i.test(error.message) ? "Too many sign-in emails just now. Wait a minute and try again." : error.message);
}
/** The email also carries a 6-digit code. Typing it signs in right here, which matters on iPad: links open in Safari,
    not in the app added to the home screen (which keeps its own storage). */
export async function verifyCode(email: string, code: string) {
  if (!sb) throw new Error("Accounts aren't set up on this server yet.");
  const { error } = await sb.auth.verifyOtp({ email, token: code.replace(/\s/g, ""), type: "email" });
  if (error) throw new Error(/expired|invalid/i.test(error.message) ? "That code is wrong or has expired. Ask for a new email." : error.message);
  // the SIGNED_IN event reopens LiveBoard as this account
}

/**
  Delete everything this account stored online, and this device's copy of it.
  Order matters: stop all uploads and wait for any in flight, then delete on the server (which also bumps the account's
  generation, so other devices can't re-upload the deleted notes), then sign out WITHOUT uploading, then remove the local copy.
*/
export async function deleteAccountData() {
  if (!sb || !session || !state.owner) throw new Error("Sign in first.");
  suspended = true;
  clearTimeout(pushTimer);
  try {
    await hooks.beforeSwitch(); // saves the open note locally; nothing uploads while suspended
    if (pushing) await pushing.catch(() => undefined);
    const { error } = await sb.rpc("delete_my_data");
    if (error) throw new Error("Couldn't delete your data: " + error.message);
  } catch (e) { suspended = false; schedulePush(1000); throw e; }
  const name = db.name;
  const { error } = await sb.auth.signOut({ scope: "local" });
  if (error) { try { localStorage.removeItem(authStorageKey()); } catch { /* storage blocked */ } }
  session = null;
  switching = true;
  await deleteLocalDb(name);
}


/**
  Sign out of this device. Unsynced changes are never discarded: they stay in this account's database on the device and
  upload the next time this account signs in. Removing the device copy is only allowed once everything has uploaded.
*/
export async function signOut(opts: { removeDeviceCopy?: boolean } = {}) {
  if (!sb) return { unsynced: 0 };
  await hooks.beforeSwitch();
  clearTimeout(pushTimer);
  for (let i = 0; i < 3 && pendingCount() > blockedCount() && navigator.onLine; i++) await push();
  const unsynced = pendingCount();
  if (opts.removeDeviceCopy && unsynced) throw new Error(`${unsynced} change${unsynced === 1 ? " hasn't" : "s haven't"} uploaded yet, so this device's copy can't be removed. Connect to the internet and try again, or sign out without removing it.`);
  const name = db.name;
  const { error } = await sb.auth.signOut({ scope: "local" });
  if (error) {
    // supabase-js keeps the session when it can't reach the server. Offline, forget it on this device anyway;
    // the student asked to sign out, and their changes are already safe in this account's local database.
    const offline = !navigator.onLine || /fetch|network|load failed/i.test(error.message);
    if (!offline) throw new Error("Couldn't sign out: " + error.message);
    try { localStorage.removeItem(authStorageKey()); } catch { /* storage blocked */ }
  }
  session = null;
  if (opts.removeDeviceCopy) await deleteLocalDb(name);
  switching = true;
  return { unsynced };
}


/* ---------- Classes and leaderboard ---------- */
export async function createClass(name: string, displayName: string) {
  if (!sb || !session) throw new Error("Sign in to create a class.");
  const { data, error } = await sb.rpc("create_class", { p_name: name, p_display: displayName });
  if (error) throw error;
  return (Array.isArray(data) ? data[0] : data) as { id: string; code: string };
}
export async function joinClass(code: string, displayName: string) {
  if (!sb || !session) throw new Error("Sign in to join a class.");
  const { data, error } = await sb.rpc("join_class", { p_code: code.trim().toUpperCase(), p_display: displayName });
  if (error) throw new Error(error.message.includes("not found") ? "No class has that code." : error.message);
  return (Array.isArray(data) ? data[0] : data) as { id: string; name: string; code: string };
}
export async function leaderboard(classId: string) {
  if (!sb || !session) return null;
  const { data, error } = await sb.rpc("class_leaderboard", { p_class: classId });
  if (error) { console.warn(error); return null; }
  return data as { display_name: string; points: number; is_me: boolean }[];
}
/** The server decides the points and counts each marker once a day. */
export async function logRecall(classId: string | null | undefined, markerId: string, got: boolean) {
  if (!sb || !session || !classId) return;
  const { error } = await sb.rpc("log_recall", { p_class: classId, p_marker: markerId, p_got: got });
  if (error) console.warn(error);
}
