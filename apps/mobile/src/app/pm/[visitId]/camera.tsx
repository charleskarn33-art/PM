import { CameraView, useCameraPermissions } from 'expo-camera';
import { randomUUID } from 'expo-crypto';
import * as Location from 'expo-location';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { Banner, LoadingView, PrimaryButton } from '@/components/ui';
import { storeCapturedPhoto } from '@/lib/photo-files';
import { photoPaths } from '@/offline/types';
import { usePmVisitContext } from '@/pm/context';
import { useOffline } from '@/providers/offline-provider';
import { colors, spacing } from '@/theme';

/** Location for the photo record, only if permission was already given (never prompts here). */
async function lastKnownPosition() {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted) return null;
    const pos = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 });
    return pos ? { latitude: pos.coords.latitude, longitude: pos.coords.longitude } : null;
  } catch {
    return null;
  }
}

export default function CameraScreen() {
  const { itemId, sectionId } = useLocalSearchParams<{ itemId?: string; sectionId?: string }>();
  const pm = usePmVisitContext();
  const { store, changed } = useOffline();
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const item = pm.items.find((i) => i.id === itemId);
  const title = item ? item.prompt : 'Photo';

  if (!permission) return <LoadingView label="Opening camera…" />;
  if (!permission.granted) {
    return (
      <View style={styles.permission}>
        <Stack.Screen options={{ title: 'Camera' }} />
        <Text style={styles.permissionText}>The camera is needed to take PM evidence photos.</Text>
        {permission.canAskAgain ? (
          <PrimaryButton title="Allow camera" onPress={() => void requestPermission()} />
        ) : (
          <PrimaryButton title="Open settings" onPress={() => void Linking.openSettings()} />
        )}
      </View>
    );
  }
  if (!pm.visit || !store) return <LoadingView />;
  const visit = pm.visit;

  async function capture() {
    if (!camera.current || !store) return;
    setBusy(true);
    setError(null);
    try {
      const shot = await camera.current.takePictureAsync({ quality: 0.9, exif: false });
      const id = randomUUID();
      const [stored, position] = await Promise.all([storeCapturedPhoto(shot.uri, shot.width, shot.height, id), lastKnownPosition()]);
      const paths = photoPaths(visit.site_id, visit.id, id);
      await store.addPhoto({
        row: {
          id,
          site_id: visit.site_id,
          visit_id: visit.id,
          section_id: sectionId ?? item?.section_id ?? null,
          checklist_item_id: itemId ?? null,
          bucket: 'pm-photos',
          file_path: paths.file,
          thumbnail_path: paths.thumb,
          mime_type: 'image/jpeg',
          size_bytes: stored.sizeBytes,
          width: stored.width,
          height: stored.height,
          latitude: position?.latitude ?? null,
          longitude: position?.longitude ?? null,
          taken_at: new Date().toISOString(),
        },
        local_uri: stored.uri,
        thumb_uri: stored.thumbUri,
      });
      changed();
      router.back();
    } catch (e) {
      setError(`Photo not saved: ${e instanceof Error ? e.message : String(e)}`);
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Take photo' }} />
      <CameraView ref={camera} style={styles.camera} facing="back" onCameraReady={() => setReady(true)} />
      <View style={styles.controls}>
        <Text style={styles.caption} numberOfLines={2}>
          {title}
          {item?.photo_instructions ? ` — ${item.photo_instructions}` : ''}
        </Text>
        {error ? <Banner tone="danger" message={error} /> : null}
        <PrimaryButton title={busy ? 'Saving…' : 'Capture'} loading={busy} disabled={!ready || busy} onPress={() => void capture()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  controls: { padding: spacing.lg, gap: spacing.md, backgroundColor: colors.navy },
  caption: { color: colors.white, fontSize: 16, fontWeight: '600' },
  permission: { flex: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.lg },
  permissionText: { fontSize: 18, color: colors.text },
});
