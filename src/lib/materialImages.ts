import { supabase } from '../supabaseClient';

export const MAX_MATERIAL_IMAGES = 10;
export const MAX_MATERIAL_IMAGE_BYTES = 5 * 1024 * 1024;

const EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export interface MaterialImage {
  name: string;
  url: string;
}

export function materialImageError(file: Pick<File, 'type' | 'size'>): string | null {
  if (!EXTENSION[file.type]) return 'Choose a JPG, PNG or WebP image.';
  if (file.size > MAX_MATERIAL_IMAGE_BYTES) return 'Each image must be 5 MB or smaller.';
  return null;
}

export async function uploadMaterialImages(passId: string, files: File[]): Promise<void> {
  if (files.length > MAX_MATERIAL_IMAGES) throw new Error('Attach no more than 10 images.');
  for (const file of files) {
    const invalid = materialImageError(file);
    if (invalid) throw new Error(invalid);
    const key = `${passId}/${crypto.randomUUID()}.${EXTENSION[file.type]}`;
    const { error } = await supabase.storage.from('pass-images').upload(key, file, {
      contentType: file.type,
      upsert: false,
    });
    if (error) throw error;
  }
}

export async function listMaterialImages(passId: string): Promise<MaterialImage[]> {
  const bucket = supabase.storage.from('pass-images');
  const { data, error } = await bucket.list(passId, { limit: 100, sortBy: { column: 'created_at', order: 'asc' } });
  if (error) throw error;
  const names = (data ?? []).filter((item) => item.name && item.id).map((item) => item.name);
  const signed = await Promise.all(names.map(async (name) => {
    const result = await bucket.createSignedUrl(`${passId}/${name}`, 3600);
    if (result.error || !result.data) throw result.error ?? new Error('Could not open an image.');
    return { name, url: result.data.signedUrl };
  }));
  return signed;
}
