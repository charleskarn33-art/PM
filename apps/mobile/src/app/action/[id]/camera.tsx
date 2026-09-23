import { useLocalSearchParams, useRouter } from 'expo-router';
import { CameraCapture } from '@/components/camera-capture';
import { LoadingView } from '@/components/ui';
import { actionPhotoPaths } from '@/offline/types';
import { useLocalQuery, useOffline } from '@/providers/offline-provider';

export default function ActionCameraScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { store, changed } = useOffline();
  const router = useRouter();
  const query = useLocalQuery((s) => s.action(id), `action:${id}`);
  const action = query.data;
  if (!store || !action) return <LoadingView />;

  return (
    <CameraCapture
      caption={`${action.action_number}: ${action.description}`}
      onCaptured={async ({ id: photoId, stored, position, takenAt }) => {
        const paths = actionPhotoPaths(action.site_id, action.id, photoId);
        await store.addPhoto({
          row: {
            id: photoId,
            site_id: action.site_id,
            visit_id: null,
            corrective_action_id: action.id,
            section_id: null,
            checklist_item_id: null,
            bucket: 'pm-photos',
            file_path: paths.file,
            thumbnail_path: paths.thumb,
            mime_type: 'image/jpeg',
            size_bytes: stored.sizeBytes,
            width: stored.width,
            height: stored.height,
            latitude: position?.latitude ?? null,
            longitude: position?.longitude ?? null,
            taken_at: takenAt,
          },
          local_uri: stored.uri,
          thumb_uri: stored.thumbUri,
        });
        changed();
        router.back();
      }}
    />
  );
}
