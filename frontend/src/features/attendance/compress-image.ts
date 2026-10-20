const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.82;

function jpegName(file: File): string {
  const base = file.name.replace(/\.[^.]+$/, '') || 'foto';
  return `${base}.jpg`;
}

/**
 * Resizes/re-encodes a camera photo before upload. If the browser cannot decode
 * the image (e.g. some HEIC variants), the original file is returned so the
 * backend can validate it with sharp.
 */
export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) {
    return file;
  }

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));

    if (scale === 1 && file.size <= 2 * 1024 * 1024) {
      bitmap.close();
      return file;
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));

    const context = canvas.getContext('2d');
    if (!context) {
      bitmap.close();
      return file;
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    );
    if (!blob) {
      return file;
    }

    return new File([blob], jpegName(file), {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
  } catch {
    return file;
  }
}
