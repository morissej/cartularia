export interface ObjectUrlLease {
  url: string;
  release: () => void;
}

interface ObjectUrlCacheEntry {
  promise: Promise<string>;
  url?: string;
  leases: number;
  lastAccess: number;
}

export class ObjectUrlLeaseCache {
  private readonly entries = new Map<string, ObjectUrlCacheEntry>();
  private readonly keyByUrl = new Map<string, string>();
  private readonly maximumIdleEntries: number;
  private readonly revoke: (url: string) => void;
  private accessClock = 0;

  constructor(
    maximumIdleEntries: number,
    revoke: (url: string) => void,
  ) {
    this.maximumIdleEntries = maximumIdleEntries;
    this.revoke = revoke;
  }

  async acquire(key: string, create: () => Promise<string>): Promise<ObjectUrlLease> {
    let entry = this.entries.get(key);
    if (!entry) {
      const created: ObjectUrlCacheEntry = {
        promise: Promise.resolve(''),
        leases: 0,
        lastAccess: ++this.accessClock,
      };
      created.promise = create().then((url) => {
        created.url = url;
        this.keyByUrl.set(url, key);
        this.evictIdleEntries();
        return url;
      }).catch((error) => {
        if (this.entries.get(key) === created) this.entries.delete(key);
        throw error;
      });
      this.entries.set(key, created);
      entry = created;
    }

    entry.leases += 1;
    entry.lastAccess = ++this.accessClock;
    let url: string;
    try {
      url = await entry.promise;
    } catch (error) {
      entry.leases = Math.max(0, entry.leases - 1);
      throw error;
    }

    let released = false;
    return {
      url,
      release: () => {
        if (released) return;
        released = true;
        this.releaseEntry(key);
      },
    };
  }

  releaseByUrl(url: string) {
    const key = this.keyByUrl.get(url);
    if (!key) return false;
    this.releaseEntry(key);
    return true;
  }

  clear() {
    this.entries.forEach((entry) => {
      if (entry.url) this.revoke(entry.url);
    });
    this.entries.clear();
    this.keyByUrl.clear();
  }

  snapshot() {
    return {
      entries: this.entries.size,
      activeLeases: [...this.entries.values()].reduce((total, entry) => total + entry.leases, 0),
      idleEntries: [...this.entries.values()].filter((entry) => entry.leases === 0).length,
    };
  }

  private releaseEntry(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.leases = Math.max(0, entry.leases - 1);
    entry.lastAccess = ++this.accessClock;
    this.evictIdleEntries();
  }

  private evictIdleEntries() {
    while (this.entries.size > this.maximumIdleEntries) {
      const candidate = [...this.entries.entries()]
        .filter(([, entry]) => entry.leases === 0 && Boolean(entry.url))
        .sort(([, left], [, right]) => left.lastAccess - right.lastAccess)[0];
      if (!candidate) return;
      const [key, entry] = candidate;
      this.entries.delete(key);
      if (entry.url) {
        this.keyByUrl.delete(entry.url);
        this.revoke(entry.url);
      }
    }
  }
}
