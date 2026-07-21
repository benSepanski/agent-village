import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { UserBudget } from './UserBudget.js';

afterEach(() => cleanup());

describe('UserBudget', () => {
  it('shows a no-budget message when no limit is set', () => {
    render(<UserBudget limitUsd={null} usedUsd={0} />);
    expect(screen.getByText('No monthly budget set for your account.')).toBeDefined();
  });

  it('shows the used/limit bar and remaining amount when a limit is set', () => {
    render(<UserBudget limitUsd={10} usedUsd={4} />);
    expect(screen.getByText('$4.0000 / $10.00')).toBeDefined();
    expect(screen.getByText('$6.00 remaining this month')).toBeDefined();
  });

  it('clamps a negative used amount (drift) to 0 for display', () => {
    render(<UserBudget limitUsd={10} usedUsd={-0.5} />);
    expect(screen.getByText('$0.0000 / $10.00')).toBeDefined();
    expect(screen.getByText('$10.00 remaining this month')).toBeDefined();
  });

  it('clamps remaining at 0 when used exceeds the limit', () => {
    render(<UserBudget limitUsd={10} usedUsd={15} />);
    expect(screen.getByText('$0.00 remaining this month')).toBeDefined();
  });
});
