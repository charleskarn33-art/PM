import { Link } from 'expo-router';
import { useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { LocalPhoto } from '@/offline/types';
import { colors, radius, spacing, toneColors } from '@/theme';
import type { PmVisitModel } from './use-pm-visit';

/**
 * Photos for one checklist item (or a whole section) with an "Add photo"
 * button. Photos taken on this phone show from the local file; a photo only
 * on the server shows a placeholder (it is safely stored there).
 */
export function PhotoStrip({ pm, itemId, sectionId }: { pm: PmVisitModel; itemId?: string; sectionId: string }) {
  const [error, setError] = useState<string | null>(null);
  const photos = pm.photos.filter((p) => (itemId ? p.checklist_item_id === itemId : !p.checklist_item_id && p.section_id === sectionId));
  const visitId = pm.visit?.id;
  if (!visitId) return null;

  function confirmRemove(p: LocalPhoto) {
    Alert.alert('Remove photo?', 'This photo has not been uploaded yet and will be deleted from the phone.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => void pm.removePhoto(p.id).then(setError),
      },
    ]);
  }

  return (
    <View style={{ gap: spacing.xs }}>
      <ScrollView horizontal contentContainerStyle={styles.row}>
        {photos.map((p) => (
          <Pressable
            key={p.id}
            accessibilityRole="imagebutton"
            accessibilityLabel={p.pending ? 'Photo waiting to upload. Long press to remove.' : 'Uploaded photo'}
            onLongPress={p.pending && pm.editable ? () => confirmRemove(p) : undefined}
            style={styles.thumbBox}
          >
            {p.thumb_uri || p.local_uri ? (
              <Image source={{ uri: p.thumb_uri ?? p.local_uri! }} style={styles.thumb} />
            ) : (
              <View style={[styles.thumb, styles.placeholder]}>
                <Text style={styles.placeholderText}>On server</Text>
              </View>
            )}
            <Text style={[styles.badge, { color: p.pending ? toneColors.info.fg : toneColors.success.fg }]}>
              {p.pending ? 'Waiting' : 'Uploaded'}
            </Text>
          </Pressable>
        ))}
        {pm.editable ? (
          <Link href={{ pathname: '/pm/[visitId]/camera', params: { visitId, sectionId, ...(itemId ? { itemId } : {}) } }} asChild>
            <Pressable accessibilityRole="button" accessibilityLabel="Add photo" style={[styles.thumb, styles.add]}>
              <Text style={styles.addText}>+ Photo</Text>
            </Pressable>
          </Link>
        ) : null}
      </ScrollView>
      {error ? <Text style={{ color: toneColors.danger.fg }}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.sm, paddingVertical: spacing.xs },
  thumbBox: { alignItems: 'center', gap: 2 },
  thumb: { width: 88, height: 88, borderRadius: radius.sm, backgroundColor: '#e5e7eb' },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  placeholderText: { fontSize: 12, color: colors.textMuted },
  badge: { fontSize: 12, fontWeight: '600' },
  add: { alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderStyle: 'dashed', borderColor: colors.navy, backgroundColor: 'transparent' },
  addText: { color: colors.navy, fontWeight: '700', fontSize: 15 },
});
