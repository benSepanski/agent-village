import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as ReactRouter from '@tanstack/react-router';
import { RunNowSection, UserBudgetSection } from './agents.$agentId.js';

const { apiMock } = vi.hoisted(() => ({
  apiMock: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() },
}));
vi.mock('../api-client/client.js', () => ({ api: apiMock }));

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));
vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual<typeof ReactRouter>('@tanstack/react-router');
  return { ...actual, useNavigate: () => navigateMock };
});

const AGENT_ID = '01HZ1234567890ABCDEFGHJKMN';

function withClient(children: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <>{children}</>
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  apiMock.patch.mockReset();
  navigateMock.mockReset();
});

describe('RunNowSection', () => {
  it('surfaces a 402 spend-limit rejection from run-now inline', async () => {
    apiMock.post.mockRejectedValue(
      new Error('POST /agents/x/run-now → 402: {"message":"Monthly budget exceeded"}'),
    );
    render(withClient(<RunNowSection agentId={AGENT_ID} />));
    fireEvent.click(screen.getByRole('button', { name: 'Run now' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Monthly budget exceeded'),
    );
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('navigates to the new run on success without showing an error', async () => {
    apiMock.post.mockResolvedValue({ runId: 'run1', status: 'running' });
    render(withClient(<RunNowSection agentId={AGENT_ID} />));
    fireEvent.click(screen.getByRole('button', { name: 'Run now' }));
    await waitFor(() => expect(navigateMock).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('UserBudgetSection', () => {
  it('surfaces a validation failure from the budget-edit mutation inline', async () => {
    apiMock.get.mockResolvedValue({
      month: '2026-07',
      limitUsd: 25,
      usedUsd: 3,
      remainingUsd: 22,
      agents: [],
    });
    apiMock.patch.mockRejectedValue(
      new Error('PATCH /me/budget → 400: {"message":"userMonthlyBudgetUsd must be finite"}'),
    );
    render(withClient(<UserBudgetSection />));
    await waitFor(() =>
      expect((screen.getByLabelText('Monthly budget USD') as HTMLInputElement).value).toBe('25'),
    );
    fireEvent.change(screen.getByLabelText('Monthly budget USD'), { target: { value: '999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'userMonthlyBudgetUsd must be finite',
      ),
    );
  });

  it('surfaces a 402 rejection from the budget-edit mutation inline', async () => {
    apiMock.get.mockResolvedValue({
      month: '2026-07',
      limitUsd: null,
      usedUsd: 0,
      remainingUsd: null,
      agents: [],
    });
    apiMock.patch.mockRejectedValue(
      new Error('PATCH /me/budget → 402: {"message":"cannot set budget below current spend"}'),
    );
    render(withClient(<UserBudgetSection />));
    await waitFor(() => expect(screen.getByLabelText('Monthly budget USD')).toBeDefined());
    fireEvent.change(screen.getByLabelText('Monthly budget USD'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'cannot set budget below current spend',
      ),
    );
  });
});
