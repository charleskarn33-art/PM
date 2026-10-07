import Ionicons from '@expo/vector-icons/Ionicons';
import { useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PrimaryButton } from '@/components/ui';
import { SLIDES, type Slide } from '@/lib/onboarding';
import { colors, radius, spacing, touchTarget } from '@/theme';

/**
 * The introduction: what the field app does, in four swipeable pages. Shown
 * once before the first sign-in (`finishLabel` "Sign in") and from Profile.
 */
export function Onboarding({ onDone, finishLabel }: { onDone: () => void; finishLabel: string }) {
  const { width } = useWindowDimensions();
  const list = useRef<FlatList<Slide>>(null);
  const [index, setIndex] = useState(0);
  const last = index === SLIDES.length - 1;

  const go = (i: number) => {
    list.current?.scrollToIndex({ index: i, animated: true });
    setIndex(i);
  };
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width));
    if (i !== index && i >= 0 && i < SLIDES.length) setIndex(i);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.top}>
        <Text style={styles.step} accessibilityLabel={`Page ${index + 1} of ${SLIDES.length}`}>
          {index + 1} / {SLIDES.length}
        </Text>
        {!last ? (
          <Pressable onPress={onDone} accessibilityRole="button" accessibilityLabel="Skip the introduction" hitSlop={12} style={styles.skip}>
            <Text style={styles.skipText}>Skip</Text>
          </Pressable>
        ) : (
          <View style={styles.skip} />
        )}
      </View>

      <FlatList
        ref={list}
        data={SLIDES}
        keyExtractor={(s) => s.key}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        renderItem={({ item }) => (
          <View style={[styles.slide, { width }]} accessible accessibilityLabel={`${item.title}. ${item.body}`}>
            <View style={styles.badge}>
              <Ionicons name={item.icon} size={64} color={colors.white} />
            </View>
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.body}>{item.body}</Text>
          </View>
        )}
      />

      <View style={styles.bottom}>
        <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {SLIDES.map((s, i) => (
            <Pressable key={s.key} onPress={() => go(i)} hitSlop={8}>
              <View style={[styles.dot, i === index && styles.dotActive]} />
            </Pressable>
          ))}
        </View>
        <PrimaryButton title={last ? finishLabel : 'Next'} onPress={last ? onDone : () => go(index + 1)} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, minHeight: touchTarget },
  step: { color: colors.textMuted, fontSize: 15, fontWeight: '600' },
  skip: { minWidth: 64, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' },
  skipText: { color: colors.navy, fontSize: 17, fontWeight: '700' },
  slide: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl * 1.5 },
  badge: {
    width: 136,
    height: 136,
    borderRadius: 68,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl * 1.5,
    borderWidth: 6,
    borderColor: colors.red,
  },
  title: { color: colors.text, fontSize: 24, fontWeight: '800', textAlign: 'center' },
  body: { color: colors.textMuted, fontSize: 17, lineHeight: 25, textAlign: 'center', marginTop: spacing.md, maxWidth: 480 },
  bottom: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl, gap: spacing.lg },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm },
  dot: { width: 10, height: 10, borderRadius: radius.sm, backgroundColor: colors.border },
  dotActive: { width: 28, backgroundColor: colors.red },
});
