import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MonthSpend } from './MonthSpend.js';

afterEach(() => cleanup());

describe('MonthSpend', () => {
  it('shows the month, summed cost, and run count', () => {
    render(<MonthSpend month="2026-07" costUsd={0.1234} runCount={5} />);
    expect(screen.getByText('This month (2026-07): $0.1234 across 5 runs')).toBeDefined();
  });

  it('uses the singular for exactly one run', () => {
    render(<MonthSpend month="2026-07" costUsd={0.01} runCount={1} />);
    expect(screen.getByText('This month (2026-07): $0.0100 across 1 run')).toBeDefined();
  });

  it('renders a zero month without runs', () => {
    render(<MonthSpend month="2026-01" costUsd={0} runCount={0} />);
    expect(screen.getByText('This month (2026-01): $0.0000 across 0 runs')).toBeDefined();
  });
});
