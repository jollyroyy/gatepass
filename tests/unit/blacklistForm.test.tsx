// The blacklist form must NOT let a non-plate through as a 'vehicle' entry —
// the DB refuses those too (033), but the form is where the admin learns why.
// Also pins the payload: the vehicle value is normalized to WB09AB1234 before
// it reaches add_blacklist_entry, so the same plate can never be entered twice
// in two spellings.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BlacklistTab from '../../src/pages/Admin/BlacklistTab';

function thenable(result: { data: unknown; error: unknown }) {
  const obj: any = {
    then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return obj;
}

const rpc = vi.fn((name: string) => {
  if (name === 'list_blacklist_entries') {
    return thenable({ data: [], error: null });
  }
  if (name === 'add_blacklist_entry') {
    return thenable({ data: null, error: null });
  }
  return thenable({ data: null, error: null });
});

vi.mock('../../src/supabaseClient', () => ({
  gp: () => ({ rpc }),
  pub: () => ({ rpc }),
}));

function openForm() {
  render(<BlacklistTab />);
  fireEvent.click(screen.getByText('Add Entry'));
}

function fillReason() {
  fireEvent.change(screen.getByPlaceholderText('Reason for blacklisting'), { target: { value: 'not good' } });
}

describe('BlacklistTab vehicle entries', () => {
  beforeEach(() => rpc.mockClear());

  function selectVehicle() {
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'vehicle' } });
  }

  it('requires a vehicle number — the Add button refuses to submit without one', async () => {
    openForm();
    selectVehicle();
    fillReason();
    fireEvent.click(screen.getByText('Add to Blacklist'));
    await waitFor(() => {
      expect(screen.getByText('Vehicle number is required.')).toBeTruthy();
    });
    expect(rpc).not.toHaveBeenCalledWith('add_blacklist_entry');
  });

  it('refuses a plate that is not a real Indian registration number', async () => {
    openForm();
    selectVehicle();
    fillReason();
    fireEvent.change(screen.getByPlaceholderText('WB 09 AB 1234'), { target: { value: 'thar' } });
    fireEvent.click(screen.getByText('Add to Blacklist'));
    await waitFor(() => {
      expect(screen.getByText(/Not a valid Indian registration number/)).toBeTruthy();
    });
    expect(rpc).not.toHaveBeenCalledWith('add_blacklist_entry');

    fireEvent.change(screen.getByPlaceholderText('WB 09 AB 1234'), { target: { value: 'ABCDEF123' } });
    fireEvent.click(screen.getByText('Add to Blacklist'));
    await waitFor(() => {
      expect(screen.getByText(/Not a valid Indian registration number/)).toBeTruthy();
    });
    expect(rpc).not.toHaveBeenCalledWith('add_blacklist_entry');
  });

  it('submits a valid plate NORMALIZED (spaces/dashes stripped, upper-cased)', async () => {
    openForm();
    selectVehicle();
    fillReason();
    fireEvent.change(screen.getByPlaceholderText('WB 09 AB 1234'), { target: { value: 'wb-09-ab-1234' } });
    fireEvent.click(screen.getByText('Add to Blacklist'));
    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith('add_blacklist_entry', {
        p_list_type: 'vehicle',
        p_list_value: 'WB09AB1234',
        p_reason: 'not good',
      });
    });
  });

  it('accepts the Bharat-series plate too', async () => {
    openForm();
    selectVehicle();
    fillReason();
    fireEvent.change(screen.getByPlaceholderText('WB 09 AB 1234'), { target: { value: '22 BH 1234 XY' } });
    fireEvent.click(screen.getByText('Add to Blacklist'));
    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith('add_blacklist_entry', {
        p_list_type: 'vehicle',
        p_list_value: '22BH1234XY',
        p_reason: 'not good',
      });
    });
  });

  it('still adds a company by name (no plate involved)', async () => {
    render(<BlacklistTab />);
    fireEvent.click(screen.getByText('Add Entry'));
    fireEvent.change(screen.getByPlaceholderText('Vendor / company name'), { target: { value: 'BSC Cargo' } });
    fillReason();
    fireEvent.click(screen.getByText('Add to Blacklist'));
    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith('add_blacklist_entry', {
        p_list_type: 'company',
        p_list_value: 'BSC Cargo',
        p_reason: 'not good',
      });
    });
  });

  it('surfaces the RPC refusal as an error banner', async () => {
    rpc.mockImplementation((name: string) => {
      if (name === 'list_blacklist_entries') return thenable({ data: [], error: null });
      if (name === 'add_blacklist_entry') {
        return thenable({ data: null, error: { message: 'Only admins can manage the blacklist.' } });
      }
      return thenable({ data: null, error: null });
    });
    openForm();
    fillReason();
    fireEvent.change(screen.getByPlaceholderText('Vendor / company name'), { target: { value: 'BSC' } });
    fireEvent.click(screen.getByText('Add to Blacklist'));
    await waitFor(() => {
      expect(screen.getByText('Only admins can manage the blacklist.')).toBeTruthy();
    });
  });
});