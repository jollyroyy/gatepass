// Avatar upload/removal: file validation, the stable object path, and the
// storage → profile-write ordering. The storage call goes to the shared
// `avatars` bucket and the profile write goes through gatepass.set_my_avatar()
// — never public.profiles directly.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  MAX_AVATAR_BYTES,
  validateAvatarFile,
  avatarPath,
  uploadAvatar,
  removeAvatar,
} from '../../src/lib/avatarUpload';

const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
  remove: vi.fn(),
  getPublicUrl: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('../../src/supabaseClient', () => ({
  supabase: {
    storage: {
      from: () => ({
        upload: mocks.upload,
        remove: mocks.remove,
        getPublicUrl: mocks.getPublicUrl,
      }),
    },
  },
  gp: () => ({ rpc: mocks.rpc }),
}));

const goodFile = { type: 'image/png', size: 1024 };

beforeEach(() => {
  mocks.upload.mockReset();
  mocks.remove.mockReset();
  mocks.getPublicUrl.mockReset();
  mocks.rpc.mockReset();
});

describe('validateAvatarFile', () => {
  it('accepts an image under the size cap', () => {
    expect(validateAvatarFile(goodFile)).toBeNull();
  });

  it('rejects a non-image file', () => {
    expect(validateAvatarFile({ type: 'text/plain', size: 100 })).toMatch(/image file/);
  });

  it('rejects a file over 2 MB', () => {
    expect(validateAvatarFile({ type: 'image/jpeg', size: MAX_AVATAR_BYTES + 1 })).toMatch(/2 MB/);
  });
});

describe('avatarPath', () => {
  it('is a fixed <uid>/avatar path with no extension, so upsert replaces and removal is exact', () => {
    expect(avatarPath('user-123')).toBe('user-123/avatar');
  });
});

describe('uploadAvatar', () => {
  it('returns the validation error without touching storage when the file is bad', async () => {
    const result = await uploadAvatar('u1', { type: 'application/pdf', size: 10 } as File);
    expect('error' in result && result.error).toMatch(/image file/);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('maps a missing-bucket upload error to a setup message, not a raw storage error', async () => {
    mocks.upload.mockResolvedValue({ error: { message: 'The resource was not found' } });
    const result = await uploadAvatar('u1', goodFile as File);
    expect('error' in result && result.error).toMatch(/not configured/);
  });

  it('uploads, builds a cache-busted public URL, and persists it via set_my_avatar', async () => {
    mocks.upload.mockResolvedValue({ error: null });
    mocks.getPublicUrl.mockReturnValue({ data: { publicUrl: 'https://x/avatars/u1/avatar' } });
    mocks.rpc.mockResolvedValue({ error: null });

    const result = await uploadAvatar('u1', goodFile as File);
    expect(mocks.upload).toHaveBeenCalledWith('u1/avatar', goodFile, { upsert: true, contentType: 'image/png' });
    expect(mocks.rpc).toHaveBeenCalledWith('set_my_avatar', { p_avatar_url: expect.stringContaining('https://x/avatars/u1/avatar?t=') });
    expect('url' in result && result.url).toMatch(/^https:\/\/x\/avatars\/u1\/avatar\?t=/);
  });

  it('reports a profile-save failure as a retryable message even though the photo uploaded', async () => {
    mocks.upload.mockResolvedValue({ error: null });
    mocks.getPublicUrl.mockReturnValue({ data: { publicUrl: 'https://x/u1/avatar' } });
    mocks.rpc.mockResolvedValue({ error: { message: 'boom' } });

    const result = await uploadAvatar('u1', goodFile as File);
    expect('error' in result && result.error).toMatch(/saving it to your profile failed/);
  });
});

describe('removeAvatar', () => {
  it('clears the profile URL first, then deletes the storage object', async () => {
    mocks.rpc.mockResolvedValue({ error: null });
    mocks.remove.mockResolvedValue({ error: null });

    const result = await removeAvatar('u1');
    expect(mocks.rpc).toHaveBeenCalledWith('set_my_avatar', { p_avatar_url: null });
    expect(mocks.remove).toHaveBeenCalledWith(['u1/avatar']);
    expect(result).toEqual({ url: null });
  });

  it('returns the RPC error without deleting storage when the profile clear fails', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'denied' } });
    const result = await removeAvatar('u1');
    expect('error' in result && result.error).toBe('denied');
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
