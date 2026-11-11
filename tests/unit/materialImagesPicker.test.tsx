import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ItemImagePicker from '../../src/components/ItemImagePicker';
import { materialImageError } from '../../src/lib/materialImages';

describe('vendor material images', () => {
  it('offers camera capture and a multiple image chooser', () => {
    render(<ItemImagePicker itemNumber={2} files={[]} onChange={() => {}} />);
    const camera = screen.getByLabelText('Take photo of item 2');
    const chooser = screen.getByLabelText('Choose images for item 2');
    expect(camera).toHaveAttribute('capture', 'environment');
    expect(chooser).toHaveAttribute('multiple');
  });

  it('rejects unsupported and oversized files before upload', () => {
    expect(materialImageError({ type: 'application/pdf', size: 100 })).toMatch(/JPG/);
    expect(materialImageError({ type: 'image/jpeg', size: 5 * 1024 * 1024 + 1 })).toMatch(/5 MB/);
    const onChange = vi.fn();
    render(<ItemImagePicker itemNumber={1} files={[]} onChange={onChange} />);
    const chooser = screen.getByLabelText('Choose images for item 1');
    fireEvent.change(chooser, { target: { files: [new File(['bad'], 'material.pdf', { type: 'application/pdf' })] } });
    expect(screen.getByRole('alert')).toHaveTextContent(/JPG/);
    expect(onChange).not.toHaveBeenCalled();
  });
});
