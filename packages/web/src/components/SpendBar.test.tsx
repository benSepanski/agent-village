import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { SpendBar } from './SpendBar.js';

afterEach(() => cleanup());

describe('SpendBar', () => {
  it('shows the used / limit text', () => {
    render(<SpendBar spendUsedUsd={0.12} spendLimitUsd={1} />);
    expect(screen.getByText('$0.1200 / $1.00')).toBeDefined();
  });

  it('exposes ARIA progressbar values', () => {
    render(<SpendBar spendUsedUsd={0.5} spendLimitUsd={1} />);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('0.5');
    expect(bar.getAttribute('aria-valuemax')).toBe('1');
  });

  it('caps the bar at 100% even when used exceeds limit', () => {
    render(<SpendBar spendUsedUsd={2} spendLimitUsd={1} />);
    expect(screen.getByText('$2.0000 / $1.00')).toBeDefined();
  });

  it('handles a zero limit without dividing by zero', () => {
    render(<SpendBar spendUsedUsd={0} spendLimitUsd={0} />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuemax')).toBe('0');
  });
});
