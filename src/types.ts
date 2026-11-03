export type MarkerType = "note" | "question" | "explain" | "math" | "visual" | "link" | "reminder";
export type Mastery = 0 | 1 | 2; // unsure, getting it, mastered

export interface Course {
  id: string;
  name: string;
  color: string;
  classId?: string | null;
  classCode?: string | null;
  updatedAt: number;
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
  remindAt?: number | null;
  createdAt: number;
  updatedAt: number;
  deleted?: boolean;
}

export interface Meta {
  key: "meta";
  studyDays: string[];
  points: number;
  scope: "night" | "week" | "unit";
  showTools: boolean;
  lastPull: number;
  displayName: string;
  updatedAt: number;
  seeded: boolean;
}

export interface AIResult {
  kind: "insert" | "answer";
  type: MarkerType;
  markdown: string;
  calc?: string | null;
  mermaid?: string | null;
  recall?: { q: string; a: string } | null;
}
