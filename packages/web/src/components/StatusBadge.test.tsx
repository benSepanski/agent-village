import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { StatusBadge } from './StatusBadge.js';

afterEach(() => cleanup());

describe('StatusBadge', () => {
  it('renders the active label in green', () => {
    render(<StatusBadge status="active" />);
    const node = screen.getByText('active');
    expect(node.style.backgroundColor).toBeTruthy();
  });

  it('renders the spend-limit label', () => {
    render(<StatusBadge status="spend_limit_exceeded" />);
    expect(screen.getByText('spend-limit')).toBeDefined();
  });

  it('renders all four other statuses', () => {
    render(<StatusBadge status="paused" />);
    render(<StatusBadge status="ok" />);
    render(<StatusBadge status="error" />);
    expect(screen.getByText('paused')).toBeDefined();
    expect(screen.getByText('ok')).toBeDefined();
    expect(screen.getByText('error')).toBeDefined();
  });
});
