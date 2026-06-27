import type { Run } from '../api-client/types.js';
import { buildEvents } from './RunTimeline.events.js';

export function RunTimeline({ run }: { run: Run }) {
  const events = buildEvents(run);
  return (
    <ol style={{ paddingLeft: 0, listStyle: 'none' }}>
      {events.map((e, i) => (
        <li
          key={i}
          style={{
            display: 'grid',
            gridTemplateColumns: '220px 1fr',
            gap: 12,
            padding: '4px 0',
            color: e.tone === 'error' ? '#991b1b' : '#1f2937',
          }}
        >
          <time style={{ fontFamily: 'monospace' }}>{e.timestamp}</time>
          <code>{e.event}</code>
        </li>
      ))}
    </ol>
  );
}
