import React, { useEffect, useState } from 'react';
import { MAX_MATERIAL_IMAGES, materialImageError } from '../lib/materialImages';

interface Props {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
  maxFiles?: number;
}

export default function MaterialImagesPicker({ files, onChange, disabled = false, maxFiles = MAX_MATERIAL_IMAGES }: Props): React.ReactElement {
  const [error, setError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<{ file: File; url: string }[]>([]);

  useEffect(() => {
    const next = files.map((file) => ({ file, url: URL.createObjectURL(file) }));
    setPreviews(next);
    return () => next.forEach(({ url }) => URL.revokeObjectURL(url));
  }, [files]);

  function add(selected: FileList | null) {
    if (!selected?.length) return;
    const incoming = Array.from(selected);
    const invalid = incoming.map(materialImageError).find(Boolean);
    if (invalid) { setError(invalid); return; }
    if (files.length + incoming.length > maxFiles) {
      setError(`Attach no more than ${MAX_MATERIAL_IMAGES} images per pass.`);
      return;
    }
    setError(null);
    onChange([...files, ...incoming]);
  }

  return (
    <section className="rp-section">
      <h2 className="rp-legend">Vendor material images</h2>
      <p className="text-sm text-navy-500 mb-3">Optional for RGP and NRGP. Add up to {MAX_MATERIAL_IMAGES} photos before approval starts.</p>
      <div className="flex flex-wrap gap-2">
        <label className="btn-secondary cursor-pointer">
          Take photo
          <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only"
            disabled={disabled} onChange={(event) => { add(event.target.files); event.target.value = ''; }} />
        </label>
        <label className="btn-secondary cursor-pointer">
          Choose images
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only"
            disabled={disabled} onChange={(event) => { add(event.target.files); event.target.value = ''; }} />
        </label>
      </div>
      {error && <p role="alert" className="field-error mt-2">{error}</p>}
      {previews.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-4">
          {previews.map(({ file, url }, index) => (
            <div key={`${file.name}-${index}`} className="min-w-0 rounded-lg border border-surface-200 p-2">
              <img src={url} alt={`Selected material ${index + 1}`} className="w-full h-24 object-cover rounded" />
              <p className="text-xs truncate mt-1" title={file.name}>{file.name}</p>
              <button type="button" className="text-xs text-flagged-700 underline" disabled={disabled}
                onClick={() => onChange(files.filter((_, i) => i !== index))}>Remove</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
