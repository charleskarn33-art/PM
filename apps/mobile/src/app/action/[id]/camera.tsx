import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { CameraCapture } from '@/components/camera-capture';
import { Banner } from '@/components/ui';
import { errorMessage } from '@/lib/api/errors';
import { sessionClient } from '@/lib/api/session';
import { deletePhotoFile } from '@/offline/runtime';

/** A photo of the work on a corrective action, uploaded straight away (needs a connection). */
export default function ActionCameraScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  return (
    <View style={{ flex: 1 }}>
      {error ? <Banner tone="danger" message={error} /> : null}
      <CameraCapture
        caption="Corrective action photo"
        onCaptured={async (photo) => {
          if (!sessionClient) return;
          const form = new FormData();
          form.append('id', photo.id);
          // React Native's FormData takes a file as { uri, name, type }.
          form.append('file', { uri: photo.stored.uri, name: `${photo.id}.jpg`, type: 'image/jpeg' } as unknown as Blob);
          try {
            await sessionClient.upload(`/corrective-actions/${id}/attachments`, form);
          } catch (e) {
            const message = errorMessage(e, 'upload the photo');
            setError(`${message} The photo was not added.`);
            deletePhotoFile(photo.stored.uri);
            throw new Error(message); // lets the camera take another
          }
          deletePhotoFile(photo.stored.uri);
          router.back();
        }}
      />
    </View>
  );
}
