import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RunLogs } from './RunLogs.js';

const { apiMock } = vi.hoisted(() => ({ apiMock: { get: vi.fn() } }));
vi.mock('../api-client/client.js', () => ({ api: apiMock }));

const AGENT_ID = '01HZ1234567890ABCDEFGHJKMN';
const RUN_ID = '01HZN0PQRSTVWXYZ0123456789';

function renderPanel(running = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RunLogs agentId={AGENT_ID} runId={RUN_ID} running={running} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  apiMock.get.mockReset();
});

describe('RunLogs', () => {
  it('renders fetched log events with source and timestamp', async () => {
    apiMock.get.mockResolvedValue({
      runStatus: 'ok',
      events: [
        { at: '2026-05-16T12:00:00.000Z', source: 'app', message: 'sync down complete' },
        { at: '2026-05-16T12:00:01.000Z', source: 'egress-proxy', message: 'allowed api.example' },
      ],
      nextToken: null,
    });
    renderPanel();
    await waitFor(() => expect(screen.getByText(/sync down complete/)).toBeDefined());
    expect(screen.getByText(/allowed api.example/)).toBeDefined();
    expect(screen.getByText('[egress-proxy]')).toBeDefined();
    expect(apiMock.get).toHaveBeenCalledWith(
      expect.stringContaining(`/agents/${AGENT_ID}/runs/${RUN_ID}/logs?`),
    );
    expect(screen.queryByText('Load more')).toBeNull();
  });

  it('shows an empty state when the run has no log events', async () => {
    apiMock.get.mockResolvedValue({ runStatus: 'ok', events: [], nextToken: null });
    renderPanel();
    await waitFor(() => expect(screen.getByText('No log events.')).toBeDefined());
  });

  it('offers Load more when CloudWatch returned a pagination token', async () => {
    apiMock.get.mockResolvedValue({
      runStatus: 'ok',
      events: [{ at: '2026-05-16T12:00:00.000Z', source: 'app', message: 'first page' }],
      nextToken: 'tok1',
    });
    renderPanel();
    await waitFor(() => expect(screen.getByText('Load more')).toBeDefined());
  });

  it('shows an alert when the request fails', async () => {
    apiMock.get.mockRejectedValue(new Error('403'));
    renderPanel();
    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
  });
});
