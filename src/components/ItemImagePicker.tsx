import React, { useEffect, useState } from 'react';
import { MAX_MATERIAL_IMAGES, materialImageError } from '../lib/materialImages';

type Props = {
  itemNumber: number;
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
  maxFiles?: number;
};

export default function ItemImagePicker({
  itemNumber, files, onChange, disabled = false, maxFiles = MAX_MATERIAL_IMAGES,
}: Props): React.ReactElement {
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
      setError(`Attach no more than ${MAX_MATERIAL_IMAGES} images to this item.`);
      return;
    }
    setError(null);
    onChange([...files, ...incoming]);
  }

  return (
    <div className="flex flex-col gap-2 min-w-0">
      <div className="flex gap-1">
        <label className="rp-image-action" title={`Attach saved images to item ${itemNumber}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m20.5 11.5-8.2 8.2a5 5 0 0 1-7.1-7.1l9.2-9.2a3.5 3.5 0 0 1 5 5l-9.3 9.3a2 2 0 0 1-2.8-2.8l8.1-8.1" />
          </svg>
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only"
            aria-label={`Choose images for item ${itemNumber}`} disabled={disabled || maxFiles <= files.length}
            onChange={(event) => { add(event.target.files); event.target.value = ''; }} />
        </label>
      </div>
      {previews.map(({ file, url }, index) => (
        <div key={`${file.name}-${index}`} className="flex items-center gap-1 min-w-0">
          <img src={url} alt={`Selected item ${itemNumber} image ${index + 1}`} className="w-8 h-8 rounded object-cover" />
          <button type="button" className="text-xs text-flagged-700 underline" disabled={disabled}
            aria-label={`Remove image ${index + 1} from item ${itemNumber}`}
            onClick={() => onChange(files.filter((_, i) => i !== index))}>Remove</button>
        </div>
      ))}
      {error && <p role="alert" className="field-error">{error}</p>}
    </div>
  );
}
