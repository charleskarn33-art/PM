import { router } from 'expo-router';
import { Onboarding } from '@/components/onboarding';

/** The introduction again, from Profile. */
export default function IntroductionScreen() {
  return <Onboarding finishLabel="Done" onDone={() => (router.canGoBack() ? router.back() : router.replace('/'))} />;
}
