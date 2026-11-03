import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { applyRemote, applyRemoteMeta, putMeta, setDirtyHook, state } from "./store";
import type { Course, Marker, Note } from "./types";
import { $ } from "./util";

/* Mirrors the local store to Supabase. Every row is { id, user_id, data (jsonb), updated_at, deleted }; newest updated_at wins. */
const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const sb: SupabaseClient | null = URL_ && KEY ? createClient(URL_, KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;
export const syncConfigured = () => !!sb;

let session: Session | null = null;
export const currentUser = () => session?.user ?? null;
export const authToken = () => session?.access_token ?? null;

const dirty = { notes: new Set<string>(), markers: new Set<string>(), courses: new Set<string>(), meta: false };
let pushTimer: number | undefined;
let busy = false;

function setStatus(text: string | null) {
  const el = $("#syncState");
  if (!el) return;
  el.hidden = !text;
  el.textContent = text || "";
}

setDirtyHook((kind, id) => {
  if (!sb || !session) return;
  if (kind === "meta") dirty.meta = true;
  else dirty[kind].add(id);
  clearTimeout(pushTimer);
  pushTimer = window.setTimeout(push, 1500);
});

async function push() {
  if (!sb || !session || busy) return;
  if (!navigator.onLine) { setStatus("Offline · saved on this device"); return; }
  busy = true;
  const uidv = session.user.id;
  try {
    for (const kind of ["courses", "notes", "markers"] as const) {
      const ids = [...dirty[kind]];
      if (!ids.length) continue;
      const map = state[kind] as Map<string, Note | Marker | Course>;
      const rows = ids.map(id => map.get(id)).filter(Boolean).map(r => ({ id: r!.id, user_id: uidv, data: r, updated_at: r!.updatedAt, deleted: !!r!.deleted }));
      for (let i = 0; i < rows.length; i += 200) {
        const { error } = await sb.from(kind).upsert(rows.slice(i, i + 200));
        if (error) throw error;
      }
      ids.forEach(id => dirty[kind].delete(id));
    }
    if (dirty.meta) {
      const m = state.meta;
      const { error } = await sb.from("profiles").upsert({ user_id: uidv, data: { studyDays: m.studyDays, points: m.points, displayName: m.displayName }, updated_at: m.updatedAt });
      if (error) throw error;
      dirty.meta = false;
    }
    setStatus(null);
  } catch (e) {
    console.warn("sync push failed", e);
    setStatus("Sync paused · retrying");
    clearTimeout(pushTimer);
    pushTimer = window.setTimeout(push, 15000);
  } finally {
    busy = false;
  }
}

export async function pull() {
  if (!sb || !session) return;
  const since = state.meta.lastPull || 0;
  const started = Date.now();
  try {
    for (const kind of ["courses", "notes", "markers"] as const) {
      let from = 0;
      for (;;) {
        const { data, error } = await sb.from(kind).select("data, updated_at").gt("updated_at", since).order("updated_at").range(from, from + 499);
        if (error) throw error;
        if (!data?.length) break;
        await applyRemote(kind, data.map(r => r.data as Note | Marker | Course));
        if (data.length < 500) break;
        from += 500;
      }
    }
    const { data: prof } = await sb.from("profiles").select("data").maybeSingle();
    if (prof?.data) {
      const d = prof.data as { studyDays?: string[]; points?: number; displayName?: string };
      await applyRemoteMeta({
        studyDays: [...new Set([...state.meta.studyDays, ...(d.studyDays || [])])],
        points: Math.max(state.meta.points, d.points || 0),
        displayName: state.meta.displayName || d.displayName || ""
      });
    }
    await putMeta({ lastPull: started - 60_000 });
  } catch (e) {
    console.warn("sync pull failed", e);
    setStatus("Sync paused · retrying");
  }
}

function markEverythingDirty() {
  state.notes.forEach((_, id) => dirty.notes.add(id));
  state.markers.forEach((_, id) => dirty.markers.add(id));
  state.courses.forEach((_, id) => dirty.courses.add(id));
  dirty.meta = true;
}

export async function initSync(onSignedIn: () => void) {
  if (!sb) return;
  const { data } = await sb.auth.getSession();
  session = data.session;
  if (session) { await pull(); markEverythingDirty(); push(); }
  sb.auth.onAuthStateChange(async (event, s) => {
    const wasSignedIn = !!session;
    session = s;
    if (event === "SIGNED_IN" && !wasSignedIn) { await pull(); markEverythingDirty(); push(); onSignedIn(); }
  });
  addEventListener("online", () => { pull(); push(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") pull(); else push(); });
}

export async function signIn(email: string) {
  if (!sb) throw new Error("Accounts aren't set up on this server yet.");
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin } });
  if (error) throw error;
}
export async function signOut() {
  if (!sb) return;
  await push();
  await sb.auth.signOut();
  session = null;
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
export async function logRecallPoints(classId: string | null | undefined, points: number) {
  if (!sb || !session || !classId) return;
  const { error } = await sb.from("recall_events").insert({ class_id: classId, points });
  if (error) console.warn(error);
}
