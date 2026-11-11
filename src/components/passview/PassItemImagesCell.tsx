import React, { useEffect, useState } from 'react';
import { gp } from '../../supabaseClient';
import { listItemImages, uploadItemImages, type MaterialImage } from '../../lib/materialImages';
import { safeErrorMessage } from '../../lib/errors';
import ItemImagePicker from '../ItemImagePicker';

export default function PassItemImagesCell({
  passId, itemId, itemNumber,
}: { passId: string; itemId: string; itemNumber: number }): React.ReactElement {
  const [images, setImages] = useState<MaterialImage[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [canAttach, setCanAttach] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [found, permission] = await Promise.all([
          listItemImages(passId, itemId),
          gp().rpc('can_attach_item_image', { p_pass_id: passId, p_item_id: itemId }),
        ]);
        if (cancelled) return;
        setImages(found);
        setCanAttach(!permission.error && permission.data === true);
      } catch (cause) {
        if (!cancelled) setError(safeErrorMessage(cause));
      }
    })();
    return () => { cancelled = true; };
  }, [passId, itemId]);

  async function attach(selected: File[]) {
    setFiles(selected);
    if (!selected.length || saving) return;
    setSaving(true);
    setError(null);
    try {
      await uploadItemImages(passId, itemId, selected);
      setImages(await listItemImages(passId, itemId));
    } catch (cause) {
      setError(safeErrorMessage(cause));
      try { setImages(await listItemImages(passId, itemId)); } catch { /* retain prior images */ }
      const permission = await gp().rpc('can_attach_item_image', { p_pass_id: passId, p_item_id: itemId });
      setCanAttach(!permission.error && permission.data === true);
    } finally {
      setFiles([]);
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 min-w-[96px]">
      <div className="flex flex-wrap gap-1">
        {images.map((image, index) => (
          <a key={image.name} href={image.url} target="_blank" rel="noopener noreferrer"
            aria-label={`Open image ${index + 1} of item ${itemNumber}`}>
            <img src={image.url} alt={`Item ${itemNumber} image ${index + 1}`}
              className="w-12 h-12 rounded object-cover border border-surface-200" />
          </a>
        ))}
      </div>
      {canAttach && images.length < 10 && (
        <ItemImagePicker itemNumber={itemNumber} files={files} onChange={(next) => void attach(next)}
          disabled={saving} maxFiles={10 - images.length} />
      )}
      {saving && <span className="text-xs text-navy-500">Uploading…</span>}
      {error && <span role="alert" className="field-error">{error}</span>}
      {!canAttach && images.length === 0 && !error && <span className="text-sm text-navy-500">—</span>}
    </div>
  );
}
