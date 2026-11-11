import React, { useEffect, useState } from 'react';
import { gp } from '../../supabaseClient';
import { listMaterialImages, uploadMaterialImages, type MaterialImage } from '../../lib/materialImages';
import { safeErrorMessage } from '../../lib/errors';
import MaterialImagesPicker from '../MaterialImagesPicker';

export default function PassMaterialImages({ passId }: { passId: string }): React.ReactElement {
  const [images, setImages] = useState<MaterialImage[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [canAttach, setCanAttach] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setCanAttach(false);
    void (async () => {
      try {
        const found = await listMaterialImages(passId);
        if (cancelled) return;
        setImages(found);
        try {
          const permission = await gp().rpc('can_attach_pass_image', { p_pass_id: passId });
          if (!cancelled) setCanAttach(!permission.error && permission.data === true);
        } catch {
          if (!cancelled) setCanAttach(false);
        }
        if (!cancelled) setError(null);
      } catch (cause) {
        if (!cancelled) setError(safeErrorMessage(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [passId]);

  async function attach() {
    if (!files.length || saving) return;
    setSaving(true);
    setError(null);
    try {
      await uploadMaterialImages(passId, files);
      setFiles([]);
      setImages(await listMaterialImages(passId));
    } catch (cause) {
      setError(safeErrorMessage(cause));
      // A partial upload remains on the pass. Refresh so the reader can see it.
      setFiles([]);
      try { setImages(await listMaterialImages(passId)); } catch { /* keep the last gallery */ }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card p-5">
      <h2 className="card-title">Vendor material images</h2>
      {loading ? <p className="text-sm text-navy-500">Loading images…</p> : (
        images.length ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {images.map((image, index) => (
              <a key={image.name} href={image.url} target="_blank" rel="noopener noreferrer"
                aria-label={`Open material image ${index + 1}`}>
                <img src={image.url} alt={`Vendor material ${index + 1}`} className="w-full h-32 object-cover rounded-lg border border-surface-200" />
              </a>
            ))}
          </div>
        ) : <p className="text-sm text-navy-500">No images attached.</p>
      )}
      {canAttach && images.length < 10 && (
        <div className="mt-4">
          <MaterialImagesPicker files={files} onChange={setFiles} disabled={saving} maxFiles={10 - images.length} />
          {files.length > 0 && <button type="button" className="btn-primary mt-3" disabled={saving} onClick={attach}>
            {saving ? 'Uploading…' : 'Attach images'}
          </button>}
        </div>
      )}
      {error && <p role="alert" className="field-error mt-3">{error}</p>}
    </section>
  );
}
