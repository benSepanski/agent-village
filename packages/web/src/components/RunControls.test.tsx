import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RunControls } from './RunControls.js';

afterEach(() => cleanup());

describe('RunControls', () => {
  it('calls onRun with dryRun=false by default', () => {
    const onRun = vi.fn();
    render(<RunControls onRun={onRun} />);
    fireEvent.click(screen.getByRole('button', { name: 'Run now' }));
    expect(onRun).toHaveBeenCalledWith({ dryRun: false });
  });

  it('toggles dryRun', () => {
    const onRun = vi.fn();
    render(<RunControls onRun={onRun} />);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Run now' }));
    expect(onRun).toHaveBeenCalledWith({ dryRun: true });
  });

  it('renders Replay with the replayOfRunId in the payload', () => {
    const onRun = vi.fn();
    render(<RunControls onRun={onRun} replayOfRunId="01RUN" />);
    fireEvent.click(screen.getByRole('button', { name: 'Replay' }));
    expect(onRun).toHaveBeenCalledWith({ dryRun: false, replayOfRunId: '01RUN' });
  });

  it('disables the button while busy', () => {
    const onRun = vi.fn();
    render(<RunControls onRun={onRun} busy />);
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  });
});
