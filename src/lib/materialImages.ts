import { gp, supabase } from '../supabaseClient';

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

export async function uploadItemImages(passId: string, itemId: string, files: File[]): Promise<void> {
  if (files.length > MAX_MATERIAL_IMAGES) throw new Error('Attach no more than 10 images to an item.');
  for (const file of files) {
    const invalid = materialImageError(file);
    if (invalid) throw new Error(invalid);
    const key = `${passId}/${itemId}/${crypto.randomUUID()}.${EXTENSION[file.type]}`;
    const { error } = await supabase.storage.from('pass-images').upload(key, file, {
      contentType: file.type,
      upsert: false,
    });
    if (error) throw error;
  }
}

/** The raise RPC numbers material rows in the same order as the form items. */
export async function uploadRaisedItemImages(passId: string, itemImages: File[][]): Promise<void> {
  if (!itemImages.some((files) => files.length > 0)) return;
  const result = await gp().from('v_gate_pass_items').select('id,line_no')
    .eq('gate_pass_id', passId).order('line_no');
  if (result.error) throw result.error;
  const rows = result.data ?? [];
  const pending = itemImages.flatMap((files, idx) => files.length ? [{ files, lineNo: idx + 1 }] : []);
  const mapped = pending.map(({ files, lineNo }) => {
    const itemId = rows.find((row) => row.line_no === lineNo)?.id;
    if (!itemId) throw new Error(`Could not find material item ${lineNo} after raising the pass.`);
    return { itemId, files };
  });
  for (const { itemId, files } of mapped) await uploadItemImages(passId, itemId, files);
}

async function listImages(folder: string): Promise<MaterialImage[]> {
  const bucket = supabase.storage.from('pass-images');
  const { data, error } = await bucket.list(folder, { limit: 100, sortBy: { column: 'created_at', order: 'asc' } });
  if (error) throw error;
  const names = (data ?? []).filter((item) => item.name && item.id).map((item) => item.name);
  const signed = await Promise.all(names.map(async (name) => {
    const result = await bucket.createSignedUrl(`${folder}/${name}`, 3600);
    if (result.error || !result.data) throw result.error ?? new Error('Could not open an image.');
    return { name, url: result.data.signedUrl };
  }));
  return signed;
}

export function listItemImages(passId: string, itemId: string): Promise<MaterialImage[]> {
  return listImages(`${passId}/${itemId}`);
}

/** Photos uploaded before item-level attachments had no item identity. */
export function listLegacyMaterialImages(passId: string): Promise<MaterialImage[]> {
  return listImages(passId);
}
