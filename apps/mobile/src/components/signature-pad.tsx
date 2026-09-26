import { useState } from 'react';
import { StyleSheet, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import { addPoint, type Stroke } from '@/lib/signature';
import { colors, radius } from '@/theme';

export type { Stroke };

/**
 * Finger signature: records strokes as points (through the touch responder
 * system) and draws them as short line segments (no drawing library needed). The strokes are what is sent; the
 * server draws the stored image from them.
 */
export function SignaturePad({ strokes, onChange, height = 220 }: { strokes: Stroke[]; onChange: (s: Stroke[]) => void; height?: number }) {
  const [width, setWidth] = useState(0);
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));
  const at = (e: GestureResponderEvent): [number, number] => [clamp(e.nativeEvent.locationX, width), clamp(e.nativeEvent.locationY, height)];

  return (
    <View
      style={[styles.pad, { height }]}
      onLayout={(e: LayoutChangeEvent) => setWidth(Math.floor(e.nativeEvent.layout.width))}
      accessibilityLabel="Signature area. Sign with your finger."
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      // Keep the gesture while signing (the screen must not scroll instead).
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => onChange([...strokes, addPoint([], ...at(e))])}
      onResponderMove={(e) => onChange([...strokes.slice(0, -1), addPoint(strokes[strokes.length - 1] ?? [], ...at(e))])}
    >
      {strokes.flatMap((s, si) =>
        s.length === 1
          ? [<View key={`${si}-dot`} pointerEvents="none" style={[styles.dot, { left: s[0]![0] - 1.5, top: s[0]![1] - 1.5 }]} />]
          : s.slice(1).map(([x2, y2], i) => {
              const [x1, y1] = s[i]!;
              const len = Math.hypot(x2 - x1, y2 - y1);
              const angle = Math.atan2(y2 - y1, x2 - x1);
              return (
                <View
                  key={`${si}-${i}`}
                  pointerEvents="none"
                  style={[styles.segment, { width: len + 1.5, left: (x1 + x2) / 2 - (len + 1.5) / 2, top: (y1 + y2) / 2 - 1.5, transform: [{ rotate: `${angle}rad` }] }]}
                />
              );
            }),
      )}
    </View>
  );
}


const styles = StyleSheet.create({
  pad: { borderWidth: 2, borderColor: colors.border, borderStyle: 'dashed', borderRadius: radius.md, backgroundColor: colors.white, overflow: 'hidden' },
  segment: { position: 'absolute', height: 3, borderRadius: 1.5, backgroundColor: '#000' },
  dot: { position: 'absolute', width: 3, height: 3, borderRadius: 1.5, backgroundColor: '#000' },
});
