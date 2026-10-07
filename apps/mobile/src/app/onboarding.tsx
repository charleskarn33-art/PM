import { Onboarding } from '@/components/onboarding';
import { onboarding } from '@/lib/onboarding-store';

/** First start on this phone: the introduction, then sign-in. */
export default function OnboardingScreen() {
  return <Onboarding finishLabel="Sign in" onDone={() => void onboarding.complete()} />;
}
