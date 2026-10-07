import Storage from 'expo-sqlite/kv-store';
import { createOnboardingStore } from './onboarding';

/** The app's onboarding state, saved in the phone's local key-value store. */
export const onboarding = createOnboardingStore(Storage);
