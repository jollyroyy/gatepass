// SignatureCard — mirrors profilePhotoCard.test.tsx's register: click, pick a
// file, see the signature change, see errors surfaced. Unlike the photo card,
// this one fetches its own current signature on mount (fetchMySignature), so
// that call is mocked too.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import SignatureCard from '../../src/pages/Shared/SignatureCard';

const uploadSignature = vi.fn();
const removeSignature = vi.fn();
const fetchMySignature = vi.fn();

vi.mock('../../src/lib/signatureUpload', () => ({
  uploadSignature: (...a: unknown[]) => uploadSignature(...a),
  removeSignature: (...a: unknown[]) => removeSignature(...a),
  fetchMySignature: (...a: unknown[]) => fetchMySignature(...a),
}));

function pickFile(name = 'sig.png', type = 'image/png'): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

function setup() {
  const onChange = vi.fn();
  render(<SignatureCard userId="u1" onChange={onChange} />);
  return { onChange };
}

beforeEach(() => {
  uploadSignature.mockReset();
  removeSignature.mockReset();
  fetchMySignature.mockReset();
});

describe('SignatureCard', () => {
  it('renders the empty state and an upload control when there is no signature yet', async () => {
    fetchMySignature.mockResolvedValue(null);
    setup();

    await waitFor(() => expect(fetchMySignature).toHaveBeenCalledWith('u1'));
    expect(await screen.findByRole('button', { name: /Upload signature/i })).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Remove$/i })).not.toBeInTheDocument();
  });

  it('renders an image with the fetched signature url', async () => {
    fetchMySignature.mockResolvedValue('https://cdn/avatars/u1/signature?t=1');
    setup();

    const img = await screen.findByRole('img');
    expect(img).toHaveAttribute('src', 'https://cdn/avatars/u1/signature?t=1');
    expect(screen.getByRole('button', { name: /Replace/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Remove$/i })).toBeInTheDocument();
  });

  it('surfaces an upload failure (oversized/non-image) instead of silently doing nothing', async () => {
    fetchMySignature.mockResolvedValue(null);
    uploadSignature.mockResolvedValue({ error: 'That image is over 1 MB. Please choose a smaller one.' });
    const { onChange } = setup();

    const input = await screen.findByLabelText(/Choose a signature image/i);
    fireEvent.change(input, { target: { files: [pickFile()] } });

    expect(await screen.findByRole('alert')).toHaveTextContent(/over 1 MB/i);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('uploads the chosen file and reports the new url upward', async () => {
    fetchMySignature.mockResolvedValue(null);
    uploadSignature.mockResolvedValue({ url: 'https://cdn/avatars/u1/signature?t=2' });
    const { onChange } = setup();

    const input = await screen.findByLabelText(/Choose a signature image/i);
    fireEvent.change(input, { target: { files: [pickFile()] } });

    await waitFor(() => expect(uploadSignature).toHaveBeenCalledWith('u1', expect.any(File)));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('https://cdn/avatars/u1/signature?t=2'));
    expect(await screen.findByRole('img')).toHaveAttribute('src', 'https://cdn/avatars/u1/signature?t=2');
  });

  it('removes the signature and clears the image when Remove is pressed', async () => {
    fetchMySignature.mockResolvedValue('https://cdn/avatars/u1/signature?t=1');
    removeSignature.mockResolvedValue({ url: null });
    const { onChange } = setup();

    fireEvent.click(await screen.findByRole('button', { name: /^Remove$/i }));

    await waitFor(() => expect(removeSignature).toHaveBeenCalledWith('u1'));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(null));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
