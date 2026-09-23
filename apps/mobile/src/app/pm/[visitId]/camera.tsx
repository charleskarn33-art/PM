import { useLocalSearchParams, useRouter } from 'expo-router';
import { CameraCapture } from '@/components/camera-capture';
import { LoadingView } from '@/components/ui';
import { photoPaths } from '@/offline/types';
import { usePmVisitContext } from '@/pm/context';
import { useOffline } from '@/providers/offline-provider';

export default function PmCameraScreen() {
  const { itemId, sectionId } = useLocalSearchParams<{ itemId?: string; sectionId?: string }>();
  const pm = usePmVisitContext();
  const { store, changed } = useOffline();
  const router = useRouter();
  const item = pm.items.find((i) => i.id === itemId);
  if (!pm.visit || !store) return <LoadingView />;
  const visit = pm.visit;

  return (
    <CameraCapture
      caption={`${item ? item.prompt : 'Photo'}${item?.photo_instructions ? ` — ${item.photo_instructions}` : ''}`}
      onCaptured={async ({ id, stored, position, takenAt }) => {
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
