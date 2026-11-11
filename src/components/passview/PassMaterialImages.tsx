import React, { useEffect, useState } from 'react';
import { listLegacyMaterialImages, type MaterialImage } from '../../lib/materialImages';

/** Existing pass-level photos cannot be assigned to an item retroactively. */
export default function PassMaterialImages({ passId }: { passId: string }): React.ReactElement | null {
  const [images, setImages] = useState<MaterialImage[]>([]);

  useEffect(() => {
    let cancelled = false;
    void listLegacyMaterialImages(passId)
      .then((found) => { if (!cancelled) setImages(found); })
      .catch(() => { if (!cancelled) setImages([]); });
    return () => { cancelled = true; };
  }, [passId]);

  if (!images.length) return null;
  return (
    <section className="card p-5">
      <h2 className="card-title">Earlier pass photos</h2>
      <p className="text-sm text-navy-500 mb-3">These photos were attached before item-level images were available.</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {images.map((image, index) => (
          <a key={image.name} href={image.url} target="_blank" rel="noopener noreferrer"
            aria-label={`Open earlier pass photo ${index + 1}`}>
            <img src={image.url} alt={`Earlier pass photo ${index + 1}`}
              className="w-full h-32 object-cover rounded-lg border border-surface-200" />
          </a>
        ))}
      </div>
    </section>
  );
}
