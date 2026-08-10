// ModalShell is the shared popup wrapper: every modal in the app should use it
// so a close control (button, Escape, backdrop) is implemented exactly once.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ModalShell from '../../src/components/ModalShell';

describe('ModalShell', () => {
  it('renders a real, keyboard-reachable close button in the top-right corner', () => {
    render(
      <ModalShell onClose={vi.fn()}>
        <p>content</p>
      </ModalShell>,
    );
    const btn = screen.getByRole('button', { name: 'Close' });
    expect(btn.tagName).toBe('BUTTON');
    expect(btn).toHaveAttribute('type', 'button');
    expect(btn).toHaveAttribute('aria-label', 'Close');
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <ModalShell onClose={onClose}>
        <p>content</p>
      </ModalShell>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose on Escape', () => {
    const onClose = vi.fn();
    render(
      <ModalShell onClose={onClose}>
        <p>content</p>
      </ModalShell>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the backdrop is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(
      <ModalShell onClose={onClose}>
        <p>content</p>
      </ModalShell>,
    );
    const overlay = container.querySelector('.modal-overlay') as HTMLElement;
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onClose when clicking inside the modal content', () => {
    const onClose = vi.fn();
    render(
      <ModalShell onClose={onClose}>
        <p data-testid="inner">content</p>
      </ModalShell>,
    );
    fireEvent.click(screen.getByTestId('inner'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('removes its Escape listener on unmount', () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <ModalShell onClose={onClose}>
        <p>content</p>
      </ModalShell>,
    );
    unmount();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});
