export type MarkerType = "note" | "question" | "explain" | "math" | "visual" | "link" | "reminder";
export type Mastery = 0 | 1 | 2; // unsure, getting it, mastered

export interface Course {
  id: string;
  name: string;
  color: string;
  classId?: string | null;
  classCode?: string | null;
  examDate?: string | null; // YYYY-MM-DD, used by "remind me before the exam"
  updatedAt: number;
  rev?: number; // server revision this copy is based on
  deleted?: boolean;
}

export interface Note {
  id: string;
  courseId: string;
  title: string;
  kind: "lecture" | "blank";
  doc: unknown | null; // ProseMirror JSON
  html?: string | null; // initial HTML from an import, converted to doc on first open
  plain: string; // plain text, used for search, related notes and AI context
  createdAt: number;
  updatedAt: number;
  openedAt: number;
  rev?: number; // server revision this copy is based on
  conflictOf?: string | null; // set on a copy made when two devices edited this note at once
  deleted?: boolean;
}

export interface ThreadMsg {
  role: "user" | "marker" | "self"; // self = the student's own answer or kept writing
  text: string; // markdown for marker replies
  at: number;
  inserted?: boolean; // this reply was written into the note
  calc?: string | null;
  result?: string | null;
}

export interface Marker {
  id: string;
  noteId: string;
  type: MarkerType;
  text: string; // the passage it is anchored to ("" for a blank-space marker)
  thread: ThreadMsg[];
  recallQ?: string | null;
  recallA?: string | null;
  mastery: Mastery;
  due: number; // next recall time
  ivl: number; // spaced-repetition interval in days
  linkNoteId?: string | null;
  links?: string[]; // other markers this one is connected to (two-way)
  draft?: string; // unfinished writing in the Write tab
  recallOff?: boolean; // left out of daily recall
  passageEditedAt?: number | null; // the marked words changed after the recall question was written
  outputs?: Record<string, { at: number; text: string; html: string }[]>; // revision history of what this marker wrote into the note, by output id
  remindAt?: number | null;
  detachedAt?: number | null; // its passage or point was removed from the note; the marker's thinking is kept
  createdAt: number;
  updatedAt: number;
  rev?: number; // server revision this copy is based on
  deleted?: boolean;
}

export interface Meta {
  key: "meta";
  studyDays: string[];
  points: number;
  scope: "due" | "night" | "week" | "unit"; // recall filter; "due" = everything due
  showTools: boolean;
  lastPull: number;
  displayName: string;
  updatedAt: number;
  seeded: boolean;
  demoSeeded?: boolean;
  demoVersion?: number;
  ownerId?: string | null; // legacy (single shared database); kept so old copies can be moved to their account
  welcomeId?: string | null; // the starter note, not offered when moving signed-out notes into an account
  cursors?: Partial<Record<"notes" | "markers" | "courses", number>>; // last server sequence pulled
  claimDeclined?: string[]; // accounts that chose to keep this device's signed-out notes separate
  gen?: number; // the account's server data generation this device last synced with (it changes when the online data is deleted)
  erasedAt?: number | null; // when this device found the account's online data had been deleted elsewhere
}

export interface AIResult {
  kind: "insert" | "answer";
  type: MarkerType;
  markdown: string;
  calc?: string | null;
  mermaid?: string | null;
  recall?: { q: string; a: string } | null;
}
