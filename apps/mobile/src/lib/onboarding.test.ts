import { describe, expect, it } from 'vitest';
import { createOnboardingStore, ONBOARDING_KEY, ONBOARDING_VERSION, SLIDES } from './onboarding';

function memory(initial: Record<string, string> = {}, failing = false) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: async (k: string) => {
      if (failing) throw new Error('storage unavailable');
      return data.get(k) ?? null;
    },
    setItem: async (k: string, v: string) => {
      if (failing) throw new Error('storage unavailable');
      data.set(k, v);
    },
  };
}

describe('onboarding store', () => {
  it('is pending on a new install and done once completed', async () => {
    const storage = memory();
    const store = createOnboardingStore(storage);
    expect(store.get()).toBe('loading');
    await store.load();
    expect(store.get()).toBe('pending');
    const seen: string[] = [];
    store.subscribe(() => seen.push(store.get()));
    await store.complete();
    expect(store.get()).toBe('done');
    expect(seen).toEqual(['done']);
    expect(storage.data.get(ONBOARDING_KEY)).toBe(ONBOARDING_VERSION);
    // The next start remembers it.
    const again = createOnboardingStore(storage);
    await again.load();
    expect(again.get()).toBe('done');
  });

  it('shows the introduction again after a new version of it', async () => {
    const store = createOnboardingStore(memory({ [ONBOARDING_KEY]: '0' }));
    await store.load();
    expect(store.get()).toBe('pending');
  });

  it('never blocks the app when storage fails', async () => {
    const store = createOnboardingStore(memory({}, true));
    await store.load();
    expect(store.get()).toBe('pending');
    await store.complete();
    expect(store.get()).toBe('done');
  });

  it('has short, distinct slides', () => {
    expect(new Set(SLIDES.map((s) => s.key)).size).toBe(SLIDES.length);
    for (const s of SLIDES) {
      expect(s.title.length).toBeLessThanOrEqual(40);
      expect(s.body.length).toBeLessThanOrEqual(220);
    }
  });
});
