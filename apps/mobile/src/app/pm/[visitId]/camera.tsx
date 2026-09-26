import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { CameraCapture } from '@/components/camera-capture';
import { Banner } from '@/components/ui';
import { useVisit } from '@/pm/visit-context';

/** Evidence photo for one question: captured, compressed and kept on the phone, uploaded when there is a connection. */
export default function VisitCameraScreen() {
  const { itemId, caption } = useLocalSearchParams<{ itemId?: string; caption?: string }>();
  const pm = useVisit();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  return (
    <View style={{ flex: 1 }}>
      {error ? <Banner tone="danger" message={error} /> : null}
      <CameraCapture
        caption={caption ?? 'Evidence photo'}
        onCaptured={async (photo) => {
          const message = await pm.addPhoto({ id: photo.id, uri: photo.stored.uri, checklistItemId: itemId ?? null, caption, takenAt: photo.takenAt });
          if (message) {
            setError(`${message} The photo was not added; take it again.`);
            throw new Error(message); // lets the camera screen take another
          }
          router.back();
        }}
      />
    </View>
  );
}
