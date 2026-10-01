import * as ImageManipulator from 'expo-image-manipulator';

export interface PreparedImage {
  uri: string;
  contentType: 'image/png' | 'image/jpeg';
}

const MAX_BYTES = 900_000; // the API accepts up to 1 MB
const MAX_WIDTH = 800;

/**
 * Resizes a picked image and encodes it as PNG (keeps transparency for logos). If that is still too
 * large (e.g. a photo), falls back to JPEG. Always returns a PNG/JPEG the API accepts, which also
 * converts formats like HEIC.
 */
export async function prepareImage(
  uri: string,
  measure: (uri: string) => Promise<number>,
): Promise<PreparedImage> {
  const png = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: MAX_WIDTH } }], {
    format: ImageManipulator.SaveFormat.PNG,
  });
  if ((await measure(png.uri)) <= MAX_BYTES) return { uri: png.uri, contentType: 'image/png' };
  const jpg = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: MAX_WIDTH } }], {
    format: ImageManipulator.SaveFormat.JPEG,
    compress: 0.7,
  });
  return { uri: jpg.uri, contentType: 'image/jpeg' };
}
