/**
 * Whether this install has shown the introduction (onboarding). Kept on the
 * phone, not per account: it is about the app, shown once before the first
 * sign-in, and again from Profile on request. Bump the version when the
 * introduction changes enough to show it again.
 */

export const ONBOARDING_KEY = 'ipt-pm.onboarding';
export const ONBOARDING_VERSION = '1';

export type OnboardingStatus = 'loading' | 'pending' | 'done';

interface KeyValue {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export function createOnboardingStore(storage: KeyValue) {
  let status: OnboardingStatus = 'loading';
  const listeners = new Set<() => void>();
  const set = (s: OnboardingStatus) => {
    status = s;
    listeners.forEach((l) => l());
  };
  return {
    get: () => status,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    /** Reads the saved state; if storage cannot be read, the introduction is shown (harmless). */
    async load() {
      const saved = await storage.getItem(ONBOARDING_KEY).catch(() => null);
      set(saved === ONBOARDING_VERSION ? 'done' : 'pending');
    },
    /** The introduction was finished or skipped. Moves on even if saving fails (it would only show again). */
    async complete() {
      set('done');
      await storage.setItem(ONBOARDING_KEY, ONBOARDING_VERSION).catch(() => undefined);
    },
  };
}

export type OnboardingStore = ReturnType<typeof createOnboardingStore>;

export interface Slide {
  key: string;
  icon: 'clipboard' | 'cloud-offline' | 'camera' | 'construct';
  title: string;
  body: string;
}

/** What a field technician needs to know before the first PM. */
export const SLIDES: Slide[] = [
  {
    key: 'pm',
    icon: 'clipboard',
    title: 'Preventive maintenance at your sites',
    body: 'See the PMs scheduled for you and complete each checklist on site: readings, answers, photos and your signature. Your supervisor reviews it from the office.',
  },
  {
    key: 'offline',
    icon: 'cloud-offline',
    title: 'Works without signal',
    body: 'Everything you record is saved on this phone first and sent automatically when a connection comes back. Sync before you uninstall the app or change phones.',
  },
  {
    key: 'permissions',
    icon: 'camera',
    title: 'Camera and location',
    body: 'The camera takes evidence photos. Your location is recorded only when you start a PM, to confirm you are at the site. Allow both when the app asks.',
  },
  {
    key: 'actions',
    icon: 'construct',
    title: 'Failures and corrective actions',
    body: 'Failed checks become failures for your supervisor. Corrective actions assigned to you appear under Actions, and the bell tells you when something needs you.',
  },
];
