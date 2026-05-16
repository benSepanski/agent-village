import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AgentForm } from './AgentForm.js';

afterEach(() => cleanup());

describe('AgentForm (create)', () => {
  it('rejects submission when required fields are missing', async () => {
    const onSubmit = vi.fn();
    render(<AgentForm mode="create" onSubmit={onSubmit} />);
    const form = screen.getByRole('button', { name: 'Create agent' }).closest('form');
    if (!form) throw new Error('form not found');
    fireEvent.submit(form);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeDefined();
  });

  it('submits parsed input when fields are valid', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<AgentForm mode="create" onSubmit={onSubmit} />);
    fillValidForm({ schedule: '*/5 * * * *' });
    fireEvent.submit(screen.getByRole('button', { name: 'Create agent' }).closest('form')!);
    await Promise.resolve();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0].schedule).toBe('*/5 * * * *');
  });

  it('treats an empty schedule as null (manual-only)', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<AgentForm mode="create" onSubmit={onSubmit} />);
    fillValidForm({ schedule: '' });
    fireEvent.submit(screen.getByRole('button', { name: 'Create agent' }).closest('form')!);
    await Promise.resolve();
    expect(onSubmit.mock.calls[0]![0].schedule).toBeNull();
  });
});

function fillValidForm({ schedule }: { schedule: string }) {
  fireEvent.change(screen.getByRole('textbox', { name: /^Name/ }), {
    target: { value: 'Daily' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: /^System prompt/ }), {
    target: { value: 'You are helpful.' },
  });
  if (schedule !== '') {
    fireEvent.change(screen.getByRole('textbox', { name: /^Schedule/ }), {
      target: { value: schedule },
    });
  }
  fireEvent.change(screen.getByRole('spinbutton', { name: /^Spend limit/ }), {
    target: { value: '1' },
  });
  fireEvent.change(screen.getByLabelText(/Anthropic API key/), {
    target: { value: 'sk-ant-x' },
  });
}
