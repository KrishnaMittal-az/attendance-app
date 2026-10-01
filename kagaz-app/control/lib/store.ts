// In-memory app state (no database). Lives on globalThis so it survives Next.js dev HMR and is shared
// by every route handler bundle. Changes are broadcast to SSE subscribers, coalesced to ~50 ms.
import { emptyStats, type FeedItem, type KagazConfig, type KagazState } from "./types";

const FEED_CAP = 300;
const BROADCAST_MS = 50;

type Subscriber = (json: string) => void;

interface StoreGlobal {
  state: KagazState;
  subs: Set<Subscriber>;
  timer: ReturnType<typeof setTimeout> | null;
  nextFeedId: number;
}

const g = globalThis as typeof globalThis & { __kagazStore?: StoreGlobal };

function envOrDefault(name: string, fallback: string): string | null {
  const raw = (process.env[name] ?? "").trim();
  const value = raw || fallback;
  return value.toLowerCase() === "default" ? null : value;
}

/** --model / --effort as passed to the CLI ("default" means: don't pass the flag). */
export function configuredModel(): string | null {
  return envOrDefault("KAGAZ_MODEL", "sonnet");
}

export function configuredEffort(): string | null {
  return envOrDefault("KAGAZ_EFFORT", "medium");
}

function initialConfig(): KagazConfig {
  return {
    model: configuredModel(),
    effort: configuredEffort(),
    mock: process.env.KAGAZ_MOCK === "1",
    previewUrl: process.env.KAGAZ_PREVIEW_URL || "http://localhost:5173",
    cliVersion: null,
  };
}

function initialState(): KagazState {
  return {
    status: "idle",
    mode: null,
    runId: 0,
    startedAt: null,
    finishedAt: null,
    buildStartedAt: null,
    sketch: null,
    sessionId: null,
    canTweak: false,
    feed: [],
    stats: emptyStats(),
    summary: null,
    error: null,
    previewVersion: 0,
    config: initialConfig(),
  };
}

function store(): StoreGlobal {
  if (!g.__kagazStore) {
    g.__kagazStore = { state: initialState(), subs: new Set(), timer: null, nextFeedId: 1 };
  }
  return g.__kagazStore;
}

export function getState(): KagazState {
  return store().state;
}

function broadcastNow(): void {
  const s = store();
  s.timer = null;
  if (s.subs.size === 0) return;
  const json = JSON.stringify(s.state);
  for (const fn of [...s.subs]) {
    try {
      fn(json);
    } catch {
      s.subs.delete(fn);
    }
  }
}

function scheduleBroadcast(): void {
  const s = store();
  if (s.timer) return;
  s.timer = setTimeout(broadcastNow, BROADCAST_MS);
}

/** Mutate the state in place, then broadcast (coalesced). */
export function update(mutator: (state: KagazState) => void): void {
  mutator(store().state);
  scheduleBroadcast();
}

/** Subscribe to state changes; the callback receives the serialized KagazState. */
export function subscribe(fn: Subscriber): () => void {
  const s = store();
  s.subs.add(fn);
  return () => {
    s.subs.delete(fn);
  };
}

function makeItem(partial: Omit<FeedItem, "id" | "at">): FeedItem {
  const s = store();
  const item: FeedItem = { id: s.nextFeedId++, at: Date.now(), kind: partial.kind, text: partial.text };
  if (partial.detail !== undefined) item.detail = partial.detail;
  if (partial.live !== undefined) item.live = partial.live;
  return item;
}

/** Append a feed item; returns its id. */
export function addFeed(partial: Omit<FeedItem, "id" | "at">): number {
  const item = makeItem(partial);
  update((state) => {
    state.feed.push(item);
    if (state.feed.length > FEED_CAP) state.feed.splice(0, state.feed.length - FEED_CAP);
  });
  return item.id;
}

/** Replace the whole feed (new build, reset, restore). */
export function resetFeed(items: Omit<FeedItem, "id" | "at">[]): void {
  const fresh = items.map(makeItem);
  update((state) => {
    state.feed = fresh;
  });
}

export function updateFeed(id: number, patch: Partial<Omit<FeedItem, "id" | "at">>): void {
  const item = store().state.feed.find((f) => f.id === id);
  if (!item) return;
  let changed = false;
  for (const [key, value] of Object.entries(patch) as [keyof typeof patch, unknown][]) {
    if (value === undefined) {
      if (key in item) {
        delete (item as unknown as Record<string, unknown>)[key];
        changed = true;
      }
    } else if ((item as unknown as Record<string, unknown>)[key] !== value) {
      (item as unknown as Record<string, unknown>)[key] = value;
      changed = true;
    }
  }
  if (changed) scheduleBroadcast();
}

export function removeFeed(id: number): void {
  const feed = store().state.feed;
  const index = feed.findIndex((f) => f.id === id);
  if (index === -1) return;
  update((state) => {
    state.feed.splice(index, 1);
  });
}

/** Mark every streaming item as finished (used when a run ends). */
export function settleLiveFeed(): void {
  update((state) => {
    for (const item of state.feed) if (item.live) item.live = false;
  });
}

export function setCliVersion(version: string | null, effortSupported: boolean): void {
  update((state) => {
    state.config.cliVersion = version;
    state.config.effort = effortSupported ? configuredEffort() : null;
  });
}
