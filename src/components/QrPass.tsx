// QR code renderer for a gate pass. Renders nothing if generation fails —
// a missing QR code should never crash the page it lives on.
import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface QrPassProps {
  value: string;
  size?: number;
}

export default function QrPass({ value, size = 160 }: QrPassProps): React.ReactElement {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDataUrl(null);
    QRCode.toDataURL(value, { width: size, margin: 1, errorCorrectionLevel: 'M' })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (!dataUrl) return <></>;

  return <img src={dataUrl} alt={`QR code for ${value}`} width={size} height={size} />;
}
