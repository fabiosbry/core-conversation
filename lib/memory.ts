import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";

export type PsychoLayer = "leaves" | "branches" | "trunk" | "roots";

export type TranscriptRole = "user" | "assistant";

export interface TranscriptEntry {
  role: TranscriptRole;
  content: string;
  timestamp: string;
}

export interface PsychoTreeEntry {
  id: string;
  layer: PsychoLayer;
  question: string | null;
  answer: string;
  evidence: string | null;
  tags: string[];
  confidence: number | null;
  timestamp: string;
}

export interface SocialPost {
  id: string;
  text: string;
  date: string | null;
  url: string | null;
}

export interface SocialActivity {
  id: string;
  text: string;
  date: string | null;
  url: string | null;
}

export interface UserMemory {
  user: {
    id: string;
    name: string | null;
    email: string | null;
  };
  social: {
    instagram: {
      handle: string | null;
      url: string | null;
      posts: SocialPost[];
    };
    linkedin: {
      profileUrl: string | null;
      activities: SocialActivity[];
    };
  };
  psychoTree: Record<PsychoLayer, PsychoTreeEntry[]>;
  transcript: TranscriptEntry[];
  lastFollowup: FollowupSignal | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryUpdate {
  user?: {
    name?: string | null;
    email?: string | null;
  };
  social?: {
    instagram?: {
      handle?: string | null;
      url?: string | null;
      posts?: Array<{
        text?: string | null;
        date?: string | null;
        url?: string | null;
      }>;
    };
    linkedin?: {
      profileUrl?: string | null;
      activities?: Array<{
        text?: string | null;
        date?: string | null;
        url?: string | null;
      }>;
    };
  };
  psychoTree?: Partial<
    Record<
      PsychoLayer,
      Array<{
        question?: string | null;
        answer?: string | null;
        evidence?: string | null;
        tags?: string[] | null;
        confidence?: number | null;
      }>
    >
  >;
  hasPsychoTreeAnswer?: boolean;
}

export type FollowupAction =
  | "double_down"
  | "rephrase"
  | "continue_story"
  | "move_on";

export interface FollowupSignal {
  action: FollowupAction;
  targetLayer: PsychoLayer | "none";
  rationale: string | null;
  suggestedPrompt: string | null;
}

const MEMORY_DIR = path.join(process.cwd(), "data", "memory");

const memoryLocks = new Map<string, Promise<void>>();

function sanitizeSessionId(sessionId: string) {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, "");
  return safe.length > 0 ? safe : "anonymous";
}

async function ensureMemoryDir() {
  await fs.mkdir(MEMORY_DIR, { recursive: true });
}

function createEmptyMemory(sessionId: string): UserMemory {
  const now = new Date().toISOString();
  return {
    user: {
      id: sessionId,
      name: null,
      email: null,
    },
    social: {
      instagram: {
        handle: null,
        url: null,
        posts: [],
      },
      linkedin: {
        profileUrl: null,
        activities: [],
      },
    },
    psychoTree: {
      leaves: [],
      branches: [],
      trunk: [],
      roots: [],
    },
    transcript: [],
    lastFollowup: null,
    createdAt: now,
    updatedAt: now,
  };
}

async function readMemoryFile(sessionId: string): Promise<UserMemory> {
  await ensureMemoryDir();
  const safeId = sanitizeSessionId(sessionId);
  const filePath = path.join(MEMORY_DIR, `${safeId}.json`);

  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as UserMemory;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    const memory = createEmptyMemory(safeId);
    await fs.writeFile(filePath, JSON.stringify(memory, null, 2), "utf8");
    return memory;
  }
}

async function writeMemoryFile(sessionId: string, memory: UserMemory) {
  await ensureMemoryDir();
  const safeId = sanitizeSessionId(sessionId);
  const filePath = path.join(MEMORY_DIR, `${safeId}.json`);
  await fs.writeFile(filePath, JSON.stringify(memory, null, 2), "utf8");
}

async function withMemoryLock<T>(
  sessionId: string,
  fn: () => Promise<T>
): Promise<T> {
  const safeId = sanitizeSessionId(sessionId);
  const current = memoryLocks.get(safeId) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  memoryLocks.set(safeId, current.then(() => next));

  try {
    await current;
    return await fn();
  } finally {
    release();
    if (memoryLocks.get(safeId) === next) {
      memoryLocks.delete(safeId);
    }
  }
}

export async function getMemory(sessionId: string): Promise<UserMemory> {
  return readMemoryFile(sessionId);
}

export async function updateMemory(
  sessionId: string,
  updater: (memory: UserMemory) => UserMemory | Promise<UserMemory>
): Promise<UserMemory> {
  return withMemoryLock(sessionId, async () => {
    const memory = await readMemoryFile(sessionId);
    const updated = await updater(memory);
    updated.updatedAt = new Date().toISOString();
    await writeMemoryFile(sessionId, updated);
    return updated;
  });
}

export function appendTranscriptEntry(
  memory: UserMemory,
  entry: TranscriptEntry
): UserMemory {
  memory.transcript.push(entry);
  return memory;
}

export function applyMemoryUpdate(
  memory: UserMemory,
  update: MemoryUpdate
): UserMemory {
  if (update.user?.name) {
    memory.user.name = update.user.name;
  }
  if (update.user?.email) {
    memory.user.email = update.user.email;
  }

  if (update.social?.instagram) {
    const instagram = update.social.instagram;
    if (instagram.handle) {
      memory.social.instagram.handle = instagram.handle;
    }
    if (instagram.url) {
      memory.social.instagram.url = instagram.url;
    }
    if (Array.isArray(instagram.posts)) {
      const existing = new Set(
        memory.social.instagram.posts.map((post) => post.text.toLowerCase())
      );
      instagram.posts.forEach((post) => {
        if (!post?.text) return;
        const key = post.text.toLowerCase();
        if (existing.has(key)) return;
        existing.add(key);
        memory.social.instagram.posts.push({
          id: randomUUID(),
          text: post.text,
          date: post.date ?? null,
          url: post.url ?? null,
        });
      });
    }
  }

  if (update.social?.linkedin) {
    const linkedin = update.social.linkedin;
    if (linkedin.profileUrl) {
      memory.social.linkedin.profileUrl = linkedin.profileUrl;
    }
    if (Array.isArray(linkedin.activities)) {
      const existing = new Set(
        memory.social.linkedin.activities.map((activity) =>
          activity.text.toLowerCase()
        )
      );
      linkedin.activities.forEach((activity) => {
        if (!activity?.text) return;
        const key = activity.text.toLowerCase();
        if (existing.has(key)) return;
        existing.add(key);
        memory.social.linkedin.activities.push({
          id: randomUUID(),
          text: activity.text,
          date: activity.date ?? null,
          url: activity.url ?? null,
        });
      });
    }
  }

  if (update.psychoTree) {
    const layers: PsychoLayer[] = ["leaves", "branches", "trunk", "roots"];
    layers.forEach((layer) => {
      const entries = update.psychoTree?.[layer];
      if (!Array.isArray(entries) || entries.length === 0) return;
      const existingKeys = new Set(
        memory.psychoTree[layer].map(
          (entry) => `${entry.question ?? ""}:${entry.answer}`.toLowerCase()
        )
      );
      entries.forEach((entry) => {
        if (!entry?.answer) return;
        const key = `${entry.question ?? ""}:${entry.answer}`.toLowerCase();
        if (existingKeys.has(key)) return;
        existingKeys.add(key);
        memory.psychoTree[layer].push({
          id: randomUUID(),
          layer,
          question: entry.question ?? null,
          answer: entry.answer,
          evidence: entry.evidence ?? null,
          tags: Array.isArray(entry.tags) ? entry.tags.filter(Boolean) : [],
          confidence:
            typeof entry.confidence === "number" ? entry.confidence : null,
          timestamp: new Date().toISOString(),
        });
      });
    });
  }

  return memory;
}
