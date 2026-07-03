import type { Agent, ToolGrant } from '../api-client/types.js';

function grantKey(grant: ToolGrant): string {
  if (grant.kind === 'ses') return `ses-${grant.fromAddress}`;
  if (grant.kind === 'notion') return `notion-${grant.secretName}`;
  return `github-${grant.secretName}`;
}

function GrantRow({ grant }: { grant: ToolGrant }) {
  if (grant.kind === 'ses') {
    return (
      <li>
        <strong>ses</strong> — from {grant.fromAddress}, to {grant.allowedRecipients.join(', ')}
      </li>
    );
  }
  if (grant.kind === 'notion') {
    return (
      <li>
        <strong>notion</strong> — secret {grant.secretName}
      </li>
    );
  }
  return (
    <li>
      <strong>github</strong> — repos {grant.repos.join(', ')}, secret {grant.secretName}
    </li>
  );
}

export function ManifestSection({ agent }: { agent: Agent }) {
  const { manifest } = agent;
  if (!manifest) {
    return (
      <p style={{ color: '#6b7280', fontStyle: 'italic' }}>
        No application manifest (inline agent).
      </p>
    );
  }
  return (
    <div>
      <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px' }}>
        <dt>name</dt>
        <dd>{manifest.name}</dd>
        <dt>image</dt>
        <dd>{manifest.image}</dd>
        <dt>schedule (informational)</dt>
        <dd>{manifest.schedule ?? '—'}</dd>
        <dt>timeoutMinutes</dt>
        <dd>{manifest.timeoutMinutes}</dd>
        <dt>flushIntervalSeconds</dt>
        <dd>{manifest.flushIntervalSeconds}</dd>
      </dl>
      <h4>Egress allow-list</h4>
      {manifest.egressAllow.length === 0 ? (
        <p>No egress allowed.</p>
      ) : (
        <ul>
          {manifest.egressAllow.map((domain) => (
            <li key={domain}>{domain}</li>
          ))}
        </ul>
      )}
      <h4>Tool grants</h4>
      {manifest.grants.length === 0 ? (
        <p>No tool grants.</p>
      ) : (
        <ul>
          {manifest.grants.map((grant) => (
            <GrantRow key={grantKey(grant)} grant={grant} />
          ))}
        </ul>
      )}
    </div>
  );
}
