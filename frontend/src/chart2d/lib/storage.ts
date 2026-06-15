export const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      console.warn(`[Storage] Failed to read key "${key}" from localStorage:`, e);
      return null;
    }
  },

  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      console.warn(`[Storage] Failed to write key "${key}" to localStorage:`, e);
    }
  },

  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      console.warn(`[Storage] Failed to remove key "${key}" from localStorage:`, e);
    }
  },

  getJson<T>(key: string, fallback: T): T {
    const raw = this.get(key);
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch (e) {
      console.warn(`[Storage] Failed to parse JSON for key "${key}":`, e);
      return fallback;
    }
  },

  setJson<T>(key: string, value: T): void {
    try {
      this.set(key, JSON.stringify(value));
    } catch (e) {
      console.warn(`[Storage] Failed to stringify JSON for key "${key}":`, e);
    }
  }
};
