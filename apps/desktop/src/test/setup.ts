import "@testing-library/jest-dom/vitest";

/**
 * Web Storage fix for Node >= 25.
 *
 * Node ships an experimental global `localStorage`/`sessionStorage` (on by
 * default since v25). Vitest's jsdom environment does not override globals that
 * already exist in Node, so tests see Node's object, which without
 * `--localstorage-file` has no working methods (`localStorage.clear` is
 * undefined). Point both globals at jsdom's real Storage when it is available,
 * and fall back to an in-memory Storage otherwise. On older Node versions this
 * is a no-op in practice: jsdom's Storage is what the globals already were.
 */
type StorageName = "localStorage" | "sessionStorage";

class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length() {
    return this.store.size;
  }

  clear() {
    this.store.clear();
  }

  getItem(key: string) {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }

  key(index: number) {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.store.delete(key);
  }

  setItem(key: string, value: string) {
    this.store.set(key, String(value));
  }
}

function isUsableStorage(storage: unknown): storage is Storage {
  const candidate = storage as Partial<Storage> | null | undefined;
  return (
    typeof candidate?.clear === "function" &&
    typeof candidate.getItem === "function" &&
    typeof candidate.setItem === "function" &&
    typeof candidate.removeItem === "function"
  );
}

function readStorage(target: object, name: StorageName): unknown {
  try {
    return (target as Record<StorageName, unknown>)[name];
  } catch {
    return undefined;
  }
}

function resolveStorage(name: StorageName): Storage | undefined {
  // Vitest exposes the JSDOM instance as `globalThis.jsdom` in the jsdom environment.
  const jsdomWindow = (globalThis as { jsdom?: { window?: object } }).jsdom?.window;
  if (jsdomWindow) {
    const storage = readStorage(jsdomWindow, name);
    return isUsableStorage(storage) ? storage : new MemoryStorage();
  }
  // Other environments: keep a working native Storage, replace a broken one.
  return isUsableStorage(readStorage(globalThis, name)) ? undefined : new MemoryStorage();
}

function installStorage(name: StorageName) {
  const storage = resolveStorage(name);
  if (!storage) return;
  Object.defineProperty(globalThis, name, {
    configurable: true,
    enumerable: true,
    get: () => storage
  });
}

installStorage("localStorage");
installStorage("sessionStorage");
