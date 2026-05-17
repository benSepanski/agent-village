import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PromptScratchpad } from './PromptScratchpad.js';

afterEach(() => cleanup());

describe('PromptScratchpad', () => {
  it('invokes onRun with edited system + user prompts', async () => {
    const onRun = vi.fn().mockResolvedValue(undefined);
    render(<PromptScratchpad initialSystemPrompt="orig" onRun={onRun} />);
    fireEvent.change(screen.getByRole('textbox', { name: /^System prompt/ }), {
      target: { value: 'tweaked' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /^User prompt/ }), {
      target: { value: 'hi there' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run scratchpad' }));
    await Promise.resolve();
    expect(onRun).toHaveBeenCalledWith({ systemPrompt: 'tweaked', userPrompt: 'hi there' });
  });

  it('hides Save-to-agent until onSaveToAgent is provided', () => {
    render(<PromptScratchpad initialSystemPrompt="orig" onRun={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Save to agent' })).toBeNull();
  });

  it('disables Save-to-agent until the prompt is edited', () => {
    const onSave = vi.fn();
    render(<PromptScratchpad initialSystemPrompt="orig" onRun={vi.fn()} onSaveToAgent={onSave} />);
    const save = screen.getByRole('button', { name: 'Save to agent' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: /^System prompt/ }), {
      target: { value: 'tweaked' },
    });
    expect(
      (screen.getByRole('button', { name: 'Save to agent' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});
