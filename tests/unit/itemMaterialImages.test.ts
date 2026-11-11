import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  upload: vi.fn(), list: vi.fn(), signed: vi.fn(), order: vi.fn(),
}));

vi.mock('../../src/supabaseClient', () => ({
  supabase: { storage: { from: () => ({
    upload: mocks.upload, list: mocks.list, createSignedUrl: mocks.signed,
  }) } },
  gp: () => ({ from: () => ({ select: () => ({ eq: () => ({ order: mocks.order }) }) }) }),
}));

import { listItemImages, uploadRaisedItemImages } from '../../src/lib/materialImages';

const passId = '11111111-1111-4111-8111-111111111111';
const item1 = '22222222-2222-4222-8222-222222222222';
const item2 = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.upload.mockResolvedValue({ error: null });
  mocks.order.mockResolvedValue({ data: [{ id: item1, line_no: 1 }, { id: item2, line_no: 2 }], error: null });
});

describe('item-scoped material images', () => {
  it('uploads the second row photo under the second database item only', async () => {
    const file = new File(['sample'], 'item-two.png', { type: 'image/png' });
    await uploadRaisedItemImages(passId, [[], [file]]);
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(mocks.upload.mock.calls[0][0]).toMatch(new RegExp(`^${passId}/${item2}/[0-9a-f-]+\\.png$`));
    expect(mocks.upload.mock.calls[0][1]).toBe(file);
  });

  it('refuses a missing item before uploading anything', async () => {
    mocks.order.mockResolvedValue({ data: [{ id: item1, line_no: 1 }], error: null });
    const file = new File(['sample'], 'item-two.png', { type: 'image/png' });
    await expect(uploadRaisedItemImages(passId, [[], [file]])).rejects.toThrow('material item 2');
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('lists and signs only the requested item folder', async () => {
    mocks.list.mockResolvedValue({ data: [{ id: 'object-id', name: 'photo.png' }], error: null });
    mocks.signed.mockResolvedValue({ data: { signedUrl: 'https://example.test/photo' }, error: null });
    expect(await listItemImages(passId, item1)).toEqual([{ name: 'photo.png', url: 'https://example.test/photo' }]);
    expect(mocks.list).toHaveBeenCalledWith(`${passId}/${item1}`, expect.any(Object));
    expect(mocks.signed).toHaveBeenCalledWith(`${passId}/${item1}/photo.png`, 3600);
  });
});
