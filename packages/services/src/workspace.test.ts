import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { agentRepoMock, workspaceS3Mock } = vi.hoisted(() => ({
  agentRepoMock: {
    getAgent: vi.fn(),
  },
  workspaceS3Mock: {
    listWorkspaceObjects: vi.fn(),
    presignWorkspaceUrl: vi.fn(),
  },
}));

vi.mock('@agent-village/data', () => ({
  agentRepo: agentRepoMock,
  userRepo: {},
  runRepo: {},
  secrets: {},
  grantSecrets: {},
  workspaceS3: workspaceS3Mock,
}));

import { AgentNotFoundError } from '@agent-village/domain';
import { listWorkspace, presignWorkspace } from './workspace.js';

const SUB = 'cog-sub-abc';
const AGENT_ID = '01HZ1234567890ABCDEFGHJKMN';
const PREFIX = `${SUB}/${AGENT_ID}/`;
const BUCKET = 'agent-village-dev-workspace';

beforeEach(() => {
  process.env['AV_WORKSPACE_BUCKET'] = BUCKET;
  agentRepoMock.getAgent.mockReset().mockResolvedValue({ id: AGENT_ID, ownerSub: SUB });
  workspaceS3Mock.listWorkspaceObjects.mockReset().mockResolvedValue({
    entries: [],
    truncated: false,
  });
  workspaceS3Mock.presignWorkspaceUrl.mockReset().mockResolvedValue('https://example/signed');
});

afterEach(() => {
  delete process.env['AV_WORKSPACE_BUCKET'];
});

describe('listWorkspace', () => {
  it('lists the agent prefix and strips it from each entry path', async () => {
    workspaceS3Mock.listWorkspaceObjects.mockResolvedValue({
      entries: [
        { key: `${PREFIX}notes.md`, size: 12, lastModified: '2026-07-18T00:00:00.000Z' },
        { key: `${PREFIX}sub/a.txt`, size: 0, lastModified: '2026-07-18T00:00:00.000Z' },
      ],
      truncated: true,
    });
    const res = await listWorkspace(SUB, AGENT_ID);
    expect(res).toEqual({
      entries: [
        { path: 'notes.md', size: 12, lastModified: '2026-07-18T00:00:00.000Z' },
        { path: 'sub/a.txt', size: 0, lastModified: '2026-07-18T00:00:00.000Z' },
      ],
      truncated: true,
    });
    expect(workspaceS3Mock.listWorkspaceObjects).toHaveBeenCalledWith(BUCKET, PREFIX);
  });

  it('proves ownership before touching S3', async () => {
    agentRepoMock.getAgent.mockResolvedValue(null);
    await expect(listWorkspace(SUB, AGENT_ID)).rejects.toBeInstanceOf(AgentNotFoundError);
    expect(agentRepoMock.getAgent).toHaveBeenCalledWith(SUB, AGENT_ID);
    expect(workspaceS3Mock.listWorkspaceObjects).not.toHaveBeenCalled();
  });

  it('throws when AV_WORKSPACE_BUCKET is unset', async () => {
    delete process.env['AV_WORKSPACE_BUCKET'];
    await expect(listWorkspace(SUB, AGENT_ID)).rejects.toThrow(/AV_WORKSPACE_BUCKET/);
  });
});

describe('presignWorkspace', () => {
  it('presigns each file under the agent prefix and returns a shared expiresAt', async () => {
    workspaceS3Mock.presignWorkspaceUrl.mockImplementation((_b: string, key: string) =>
      Promise.resolve(`https://example/${key}`),
    );
    const res = await presignWorkspace(SUB, AGENT_ID, {
      files: [
        { path: 'notes.md', op: 'get' },
        { path: 'notes.md', op: 'put' },
      ],
    });
    expect(res.urls).toHaveLength(2);
    expect(res.urls[0]).toMatchObject({
      path: 'notes.md',
      op: 'get',
      url: `https://example/${PREFIX}notes.md`,
    });
    expect(res.urls[0]!.expiresAt).toBe(res.urls[1]!.expiresAt);
    expect(workspaceS3Mock.presignWorkspaceUrl).toHaveBeenCalledWith(
      BUCKET,
      `${PREFIX}notes.md`,
      'get',
      900,
    );
  });

  it('proves ownership before presigning anything', async () => {
    agentRepoMock.getAgent.mockResolvedValue(null);
    await expect(
      presignWorkspace(SUB, AGENT_ID, { files: [{ path: 'a.txt', op: 'get' }] }),
    ).rejects.toBeInstanceOf(AgentNotFoundError);
    expect(workspaceS3Mock.presignWorkspaceUrl).not.toHaveBeenCalled();
  });
});
