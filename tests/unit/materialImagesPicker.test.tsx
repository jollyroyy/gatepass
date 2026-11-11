import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import MaterialImagesPicker from '../../src/components/MaterialImagesPicker';
import { materialImageError } from '../../src/lib/materialImages';

describe('vendor material images', () => {
  it('offers camera capture and a multiple image chooser', () => {
    render(<MaterialImagesPicker files={[]} onChange={() => {}} />);
    const camera = screen.getByText('Take photo').querySelector('input');
    const chooser = screen.getByText('Choose images').querySelector('input');
    expect(camera).toHaveAttribute('capture', 'environment');
    expect(chooser).toHaveAttribute('multiple');
  });

  it('rejects unsupported and oversized files before upload', () => {
    expect(materialImageError({ type: 'application/pdf', size: 100 })).toMatch(/JPG/);
    expect(materialImageError({ type: 'image/jpeg', size: 5 * 1024 * 1024 + 1 })).toMatch(/5 MB/);
    const onChange = vi.fn();
    render(<MaterialImagesPicker files={[]} onChange={onChange} />);
    const chooser = screen.getByText('Choose images').querySelector('input')!;
    fireEvent.change(chooser, { target: { files: [new File(['bad'], 'material.pdf', { type: 'application/pdf' })] } });
    expect(screen.getByRole('alert')).toHaveTextContent(/JPG/);
    expect(onChange).not.toHaveBeenCalled();
  });
});
