import { describe, expect, it } from 'vitest';
import {
  ListWorkspaceResponse,
  PresignWorkspaceInput,
  PresignWorkspaceResponse,
  WorkspacePath,
} from './workspace.js';

describe('WorkspacePath', () => {
  it('accepts simple and nested relative paths', () => {
    expect(WorkspacePath.parse('notes.md')).toBe('notes.md');
    expect(WorkspacePath.parse('sub/dir/file_1.txt')).toBe('sub/dir/file_1.txt');
  });

  it('accepts segments with dots, underscores, and hyphens', () => {
    expect(WorkspacePath.parse('a.b-c_d/e.f')).toBe('a.b-c_d/e.f');
  });

  it('rejects traversal segments', () => {
    expect(() => WorkspacePath.parse('..')).toThrow();
    expect(() => WorkspacePath.parse('../secret')).toThrow();
    expect(() => WorkspacePath.parse('a/../b')).toThrow();
    expect(() => WorkspacePath.parse('.')).toThrow();
    expect(() => WorkspacePath.parse('a/.')).toThrow();
  });

  it('rejects empty segments (leading/trailing/double slash)', () => {
    expect(() => WorkspacePath.parse('')).toThrow();
    expect(() => WorkspacePath.parse('/a')).toThrow();
    expect(() => WorkspacePath.parse('a/')).toThrow();
    expect(() => WorkspacePath.parse('a//b')).toThrow();
  });

  it('rejects segments with characters outside [A-Za-z0-9._-]', () => {
    expect(() => WorkspacePath.parse('a b')).toThrow();
    expect(() => WorkspacePath.parse('a\\b')).toThrow();
    expect(() => WorkspacePath.parse('a$b')).toThrow();
  });

  it('accepts a path at the 512-char boundary and rejects one over it', () => {
    const atMax = 'a'.repeat(512);
    expect(WorkspacePath.parse(atMax)).toBe(atMax);
    expect(() => WorkspacePath.parse('a'.repeat(513))).toThrow();
  });
});

describe('ListWorkspaceResponse', () => {
  it('accepts a well-formed page', () => {
    const parsed = ListWorkspaceResponse.parse({
      entries: [{ path: 'notes.md', size: 0, lastModified: '2026-07-18T00:00:00.000Z' }],
      truncated: false,
    });
    expect(parsed.entries).toHaveLength(1);
  });

  it('rejects a negative or non-integer size', () => {
    const base = { path: 'notes.md', lastModified: '2026-07-18T00:00:00.000Z' };
    expect(() =>
      ListWorkspaceResponse.parse({ entries: [{ ...base, size: -1 }], truncated: false }),
    ).toThrow();
    expect(() =>
      ListWorkspaceResponse.parse({ entries: [{ ...base, size: 1.5 }], truncated: false }),
    ).toThrow();
  });

  it('rejects a non-ISO lastModified', () => {
    expect(() =>
      ListWorkspaceResponse.parse({
        entries: [{ path: 'notes.md', size: 0, lastModified: 'not-a-date' }],
        truncated: false,
      }),
    ).toThrow();
  });
});

describe('PresignWorkspaceInput', () => {
  it('accepts 1..100 files with distinct (path, op) pairs', () => {
    const parsed = PresignWorkspaceInput.parse({
      files: [
        { path: 'a.txt', op: 'get' },
        { path: 'a.txt', op: 'put' },
        { path: 'b.txt', op: 'delete' },
      ],
    });
    expect(parsed.files).toHaveLength(3);
  });

  it('rejects an empty files array', () => {
    expect(() => PresignWorkspaceInput.parse({ files: [] })).toThrow();
  });

  it('accepts exactly 100 files and rejects 101', () => {
    const files = Array.from({ length: 100 }, (_, i) => ({ path: `f${i}.txt`, op: 'get' }));
    expect(PresignWorkspaceInput.parse({ files }).files).toHaveLength(100);
    files.push({ path: 'f100.txt', op: 'get' });
    expect(() => PresignWorkspaceInput.parse({ files })).toThrow();
  });

  it('rejects a duplicate (path, op) pair', () => {
    expect(() =>
      PresignWorkspaceInput.parse({
        files: [
          { path: 'a.txt', op: 'get' },
          { path: 'a.txt', op: 'get' },
        ],
      }),
    ).toThrow();
  });

  it('rejects an invalid op', () => {
    expect(() => PresignWorkspaceInput.parse({ files: [{ path: 'a.txt', op: 'move' }] })).toThrow();
  });

  it('rejects a traversal path even inside a batch', () => {
    expect(() =>
      PresignWorkspaceInput.parse({ files: [{ path: '../escape', op: 'get' }] }),
    ).toThrow();
  });
});

describe('PresignWorkspaceResponse', () => {
  it('accepts a well-formed response', () => {
    const parsed = PresignWorkspaceResponse.parse({
      urls: [
        {
          path: 'a.txt',
          op: 'get',
          url: 'https://example-bucket.s3.amazonaws.com/x?sig=1',
          expiresAt: '2026-07-18T00:15:00.000Z',
        },
      ],
    });
    expect(parsed.urls).toHaveLength(1);
  });

  it('rejects a non-ISO expiresAt', () => {
    expect(() =>
      PresignWorkspaceResponse.parse({
        urls: [{ path: 'a.txt', op: 'get', url: 'https://x', expiresAt: 'soon' }],
      }),
    ).toThrow();
  });
});
