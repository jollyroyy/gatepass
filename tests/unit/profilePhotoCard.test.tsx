// ProfilePhotoCard — the add / replace / remove interaction itself.
//
// profilePage.test.tsx only asserts which buttons render. Nothing covered the
// path a user actually takes: click the button, pick a file, see the photo
// change. That gap is why a broken upload could ship green.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ProfilePhotoCard from '../../src/pages/Shared/ProfilePhotoCard';

const uploadAvatar = vi.fn();
const removeAvatar = vi.fn();

vi.mock('../../src/lib/avatarUpload', () => ({
  uploadAvatar: (...a: unknown[]) => uploadAvatar(...a),
  removeAvatar: (...a: unknown[]) => removeAvatar(...a),
}));

function pickFile(name = 'me.png', type = 'image/png'): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

function setup(avatarUrl: string | null) {
  const onAvatarChange = vi.fn();
  render(
    <ProfilePhotoCard
      userId="u1"
      fullName="Riya Sen"
      email="hod.it@demo.vms"
      avatarUrl={avatarUrl}
      onAvatarChange={onAvatarChange}
    />
  );
  const input = screen.getByLabelText(/Choose a profile photo/i) as HTMLInputElement;
  return { onAvatarChange, input };
}

beforeEach(() => {
  uploadAvatar.mockReset();
  removeAvatar.mockReset();
});

describe('ProfilePhotoCard', () => {
  it('uploads the chosen file and reports the new url upward', async () => {
    uploadAvatar.mockResolvedValue({ url: 'https://cdn/avatars/u1/avatar?t=1' });
    const { onAvatarChange, input } = setup(null);

    fireEvent.change(input, { target: { files: [pickFile()] } });

    await waitFor(() => expect(uploadAvatar).toHaveBeenCalledTimes(1));
    expect(uploadAvatar.mock.calls[0][0]).toBe('u1');
    expect((uploadAvatar.mock.calls[0][1] as File).name).toBe('me.png');
    await waitFor(() =>
      expect(onAvatarChange).toHaveBeenCalledWith('https://cdn/avatars/u1/avatar?t=1')
    );
    expect(await screen.findByText('Photo updated.')).toBeInTheDocument();
  });

  it('replaces an existing photo through the same input', async () => {
    uploadAvatar.mockResolvedValue({ url: 'https://cdn/avatars/u1/avatar?t=2' });
    const { onAvatarChange, input } = setup('https://cdn/avatars/u1/avatar?t=1');

    expect(screen.getByRole('button', { name: /Change photo/i })).toBeInTheDocument();
    fireEvent.change(input, { target: { files: [pickFile('new.jpg', 'image/jpeg')] } });

    await waitFor(() =>
      expect(onAvatarChange).toHaveBeenCalledWith('https://cdn/avatars/u1/avatar?t=2')
    );
  });

  it('removes the photo and clears it upward', async () => {
    removeAvatar.mockResolvedValue({ url: null });
    const { onAvatarChange } = setup('https://cdn/avatars/u1/avatar?t=1');

    fireEvent.click(screen.getByRole('button', { name: /^Remove$/i }));

    await waitFor(() => expect(removeAvatar).toHaveBeenCalledWith('u1'));
    await waitFor(() => expect(onAvatarChange).toHaveBeenCalledWith(null));
    expect(await screen.findByText('Photo removed.')).toBeInTheDocument();
  });

  it('surfaces an upload failure instead of silently doing nothing', async () => {
    uploadAvatar.mockResolvedValue({ error: 'That image is over 2 MB. Please choose a smaller one.' });
    const { onAvatarChange, input } = setup(null);

    fireEvent.change(input, { target: { files: [pickFile()] } });

    expect(await screen.findByRole('alert')).toHaveTextContent(/over 2 MB/i);
    expect(onAvatarChange).not.toHaveBeenCalled();
  });

  it('re-picking the same file still triggers an upload', async () => {
    uploadAvatar.mockResolvedValue({ url: 'https://cdn/avatars/u1/avatar?t=3' });
    const { input } = setup(null);

    fireEvent.change(input, { target: { files: [pickFile()] } });
    await waitFor(() => expect(uploadAvatar).toHaveBeenCalledTimes(1));

    fireEvent.change(input, { target: { files: [pickFile()] } });
    await waitFor(() => expect(uploadAvatar).toHaveBeenCalledTimes(2));
  });
});
