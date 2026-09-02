/**
 * The platform boundary.
 *
 * Nothing in sim/, render/ or ui/ touches localStorage, window.location,
 * document.title, or the File API directly. It all comes through here.
 *
 * This is the entire cost of keeping the Steam port a thin wrapper. Scatter
 * storage calls through game logic instead and the port becomes a week of
 * archaeology.
 */

export interface Platform {
  save(slot: string, data: string): Promise<void>;
  load(slot: string): Promise<string | null>;
  listSlots(): Promise<string[]>;
  deleteSlot(slot: string): Promise<void>;

  /**
   * No-op on web. Named events are fired from the sim anyway, because Steam
   * wants stable string IDs and you only learn which ones matter by playing.
   */
  unlockAchievement(id: string): void;

  isFullscreen(): boolean;
  requestFullscreen(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Browser
// ---------------------------------------------------------------------------

const DB_NAME = 'wontfix';
const STORE = 'saves';

/**
 * IndexedDB rather than localStorage: a mid-battle snapshot of a full
 * MissionState will exceed the ~5MB localStorage ceiling on a busy map, and
 * IndexedDB is async so a save never blocks a frame.
 */
export class BrowserPlatform implements Platform {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private db(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return this.dbPromise;
  }

  private async tx<T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async save(slot: string, data: string): Promise<void> {
    await this.tx('readwrite', (s) => s.put(data, slot));
  }

  async load(slot: string): Promise<string | null> {
    const v = await this.tx<string | undefined>('readonly', (s) => s.get(slot));
    return v ?? null;
  }

  async listSlots(): Promise<string[]> {
    const keys = await this.tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys());
    return keys.map(String);
  }

  async deleteSlot(slot: string): Promise<void> {
    await this.tx('readwrite', (s) => s.delete(slot));
  }

  unlockAchievement(id: string): void {
    // No-op on web. SteamPlatform forwards this to steamworks.js.
    void id;
  }

  isFullscreen(): boolean {
    return document.fullscreenElement !== null;
  }

  async requestFullscreen(): Promise<void> {
    await document.documentElement.requestFullscreen();
  }
}

// ---------------------------------------------------------------------------
// Node — for headless tests and balance sweeps
// ---------------------------------------------------------------------------

export class MemoryPlatform implements Platform {
  private store = new Map<string, string>();

  async save(slot: string, data: string): Promise<void> {
    this.store.set(slot, data);
  }
  async load(slot: string): Promise<string | null> {
    return this.store.get(slot) ?? null;
  }
  async listSlots(): Promise<string[]> {
    return [...this.store.keys()];
  }
  async deleteSlot(slot: string): Promise<void> {
    this.store.delete(slot);
  }
  unlockAchievement(): void {}
  isFullscreen(): boolean {
    return false;
  }
  async requestFullscreen(): Promise<void> {}
}

// SteamPlatform lands here later: filesystem for saves, steamworks.js for
// achievements and Cloud. Roughly 200 lines. Nothing else in the codebase
// needs to know which implementation it is holding.
