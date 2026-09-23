import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { fitWithin } from './photo-size';

/** Evidence photo: long side at most 1600 px, JPEG quality 0.7; thumbnail 320 px. */
const MAX_SIDE = 1600;
const THUMB_SIDE = 320;

export interface StoredPhoto {
  uri: string;
  thumbUri: string;
  width: number;
  height: number;
  sizeBytes: number | null;
}

async function render(uri: string, width: number, height: number, max: number, compress: number) {
  const size = fitWithin(width, height, max);
  const ref = await ImageManipulator.manipulate(uri).resize(size).renderAsync();
  return ref.saveAsync({ compress, format: SaveFormat.JPEG });
}

/**
 * Compresses a camera capture and keeps it (with a thumbnail) in the app's
 * document folder, which the OS does not clear, until it has been uploaded.
 */
export async function storeCapturedPhoto(captureUri: string, width: number, height: number, photoId: string): Promise<StoredPhoto> {
  const dir = new Directory(Paths.document, 'pm-photos');
  if (!dir.exists) dir.create({ intermediates: true });
  const main = await render(captureUri, width, height, MAX_SIDE, 0.7);
  const thumb = await render(captureUri, width, height, THUMB_SIDE, 0.6);
  const mainFile = new File(dir, `${photoId}.jpg`);
  const thumbFile = new File(dir, `${photoId}_thumb.jpg`);
  new File(main.uri).moveSync(mainFile);
  new File(thumb.uri).moveSync(thumbFile);
  try {
    new File(captureUri).delete();
  } catch {
    // The camera's temporary file is in the cache folder; the OS clears it anyway.
  }
  return { uri: mainFile.uri, thumbUri: thumbFile.uri, width: main.width, height: main.height, sizeBytes: mainFile.size ?? null };
}
