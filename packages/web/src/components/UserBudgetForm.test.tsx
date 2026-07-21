import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { UserBudgetForm } from './UserBudgetForm.js';

afterEach(() => cleanup());

describe('UserBudgetForm', () => {
  it('pre-fills the input from initialLimitUsd and shows a Clear button', () => {
    render(<UserBudgetForm initialLimitUsd={25} onSave={vi.fn()} onClear={vi.fn()} />);
    expect((screen.getByLabelText('Monthly budget USD') as HTMLInputElement).value).toBe('25');
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDefined();
  });

  it('hides Clear when no budget is currently set', () => {
    render(<UserBudgetForm initialLimitUsd={null} onSave={vi.fn()} onClear={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
  });

  it('calls onSave with the parsed positive amount', () => {
    const onSave = vi.fn();
    render(<UserBudgetForm initialLimitUsd={null} onSave={onSave} onClear={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Monthly budget USD'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(50);
  });

  it('rejects a non-positive amount without calling onSave', () => {
    const onSave = vi.fn();
    render(<UserBudgetForm initialLimitUsd={null} onSave={onSave} onClear={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Monthly budget USD'), { target: { value: '0' } });
    const form = screen.getByRole('button', { name: 'Save' }).closest('form');
    if (!form) throw new Error('form not found');
    fireEvent.submit(form);
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('Enter a positive dollar amount.');
  });

  it('calls onClear when Clear is clicked', () => {
    const onClear = vi.fn();
    render(<UserBudgetForm initialLimitUsd={25} onSave={vi.fn()} onClear={onClear} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onClear).toHaveBeenCalled();
  });

  it('disables Save and Clear while busy', () => {
    render(<UserBudgetForm initialLimitUsd={25} onSave={vi.fn()} onClear={vi.fn()} busy />);
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Clear' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
