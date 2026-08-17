// The legend sits BELOW the ring, at every width.
//
// It used to be `flex-col sm:flex-row`, i.e. beside the ring on anything wider
// than a phone. Each of these donuts lives in a one-third-width card, so the
// legend got whatever was left of ~380px after a 150px ring and a gap — long
// labels truncated and the client could not read which colour was which.
// Stacking it under the ring gives the legend the card's full width.
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DonutChart from '../../src/components/charts/DonutChart';
import type { Slice } from '../../src/lib/adminAnalytics';
import type { GatePassView } from '../../src/types';

function slice(key: string, label: string, value: number): Slice {
  return { key, label, value, rows: Array.from({ length: value }, () => ({}) as GatePassView) };
}

const SLICES = [slice('a', 'RGP Out', 3), slice('b', 'NRGP Out', 1)];

describe('DonutChart legend placement', () => {
  it('stacks the legend under the ring rather than beside it', () => {
    const { container } = render(
      <DonutChart slices={SLICES} colors={{ a: '#111111', b: '#222222' }} centerLabel="Total Passes" />,
    );

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('flex-col');
    // No horizontal variant at ANY breakpoint — `sm:flex-row` was the bug.
    expect(wrapper.className).not.toMatch(/flex-row/);
  });

  it('the ring comes first in the DOM, so the legend reads after it', () => {
    const { container } = render(
      <DonutChart slices={SLICES} colors={{ a: '#111111', b: '#222222' }} centerLabel="Total Passes" />,
    );

    const wrapper = container.firstElementChild as HTMLElement;
    const svg = container.querySelector('svg');
    const list = container.querySelector('ul');
    expect(svg).toBeTruthy();
    expect(list).toBeTruthy();
    expect(wrapper.contains(svg!)).toBe(true);
    expect(svg!.compareDocumentPosition(list!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('still lists every slice with its label, count and share', () => {
    render(<DonutChart slices={SLICES} colors={{ a: '#111111', b: '#222222' }} centerLabel="Total Passes" />);

    expect(screen.getByText('RGP Out')).toBeTruthy();
    expect(screen.getByText('NRGP Out')).toBeTruthy();
    expect(screen.getByText('(75%)')).toBeTruthy();
    expect(screen.getByText('(25%)')).toBeTruthy();
  });
});
