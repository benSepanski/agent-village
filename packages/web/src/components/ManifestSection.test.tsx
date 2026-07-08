import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ManifestSection } from './ManifestSection.js';
import type { Agent } from '../api-client/types.js';

afterEach(() => cleanup());

const baseAgent = {
  id: '01HZ1234567890ABCDEFGHJKMN',
  ownerSub: 'cog-sub-abc',
  name: 'Daily',
  model: 'claude-opus-4-7',
  systemPrompt: 'hi',
  schedule: '*/5 * * * *',
  spendLimitUsd: 1,
  spendUsedUsd: 0,
  anthropicSecretArn: 'arn:aws:secretsmanager:us-east-1:0:secret:foo',
  status: 'active',
  activeRunId: null,
  createdAt: '2026-05-16T12:00:00.000Z',
  updatedAt: '2026-05-16T12:00:00.000Z',
} as const;

describe('ManifestSection', () => {
  it('renders a note when the agent has no manifest', () => {
    const agent = { ...baseAgent, manifest: null } as unknown as Agent;
    render(<ManifestSection agent={agent} />);
    expect(screen.getByText(/No application manifest/)).toBeDefined();
  });

  it('renders manifest fields and one grant of each kind', () => {
    const agent = {
      ...baseAgent,
      manifest: {
        name: 'summarizer',
        image: 'summarizer-v3',
        schedule: '0 * * * *',
        timeoutMinutes: 15,
        egressAllow: ['api.notion.com', '*.github.com'],
        env: { GMAIL_ADDRESS: 'agent@example.com', GMAIL_MAX_REPLIES: '3' },
        flushIntervalSeconds: 60,
        grants: [
          {
            kind: 'ses',
            fromAddress: 'agent@example.com',
            allowedRecipients: ['owner@example.com'],
          },
          { kind: 'notion', secretName: 'agent-village/dev/agents/x/notion' },
          {
            kind: 'github',
            repos: ['acme/repo'],
            secretName: 'agent-village/dev/agents/x/github',
          },
          { kind: 'secret', name: 'gmail-app-password', env: 'GMAIL_APP_PASSWORD' },
        ],
      },
    } as unknown as Agent;
    render(<ManifestSection agent={agent} />);
    expect(screen.getByText('summarizer')).toBeDefined();
    expect(screen.getByText('summarizer-v3')).toBeDefined();
    expect(screen.getByText('0 * * * *')).toBeDefined();
    expect(screen.getByText('15')).toBeDefined();
    expect(screen.getByText('60')).toBeDefined();
    expect(screen.getByText('GMAIL_ADDRESS=agent@example.com')).toBeDefined();
    expect(screen.getByText('GMAIL_MAX_REPLIES=3')).toBeDefined();
    expect(screen.getByText('api.notion.com')).toBeDefined();
    expect(screen.getByText('*.github.com')).toBeDefined();
    expect(screen.getByText(/from agent@example.com/)).toBeDefined();
    expect(screen.getByText(/secret agent-village\/dev\/agents\/x\/notion/)).toBeDefined();
    expect(screen.getByText(/repos acme\/repo/)).toBeDefined();
    expect(screen.getByText(/gmail-app-password as GMAIL_APP_PASSWORD/)).toBeDefined();
  });
});
