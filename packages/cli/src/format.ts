import kleur from 'kleur';

function columnWidths(headers: string[], rows: string[][]): number[] {
  return headers.map((h, i) => {
    const max = Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length));
    return Math.min(max, 60);
  });
}

function pad(value: string, width: number): string {
  if (value.length >= width) return value.slice(0, width);
  return value + ' '.repeat(width - value.length);
}

export function table(headers: string[], rows: string[][]): string {
  const widths = columnWidths(headers, rows);
  const header = headers.map((h, i) => kleur.bold(pad(h, widths[i]!))).join('  ');
  const sep = widths.map((w) => '-'.repeat(w)).join('  ');
  const body = rows.map((r) => r.map((c, i) => pad(c ?? '', widths[i]!)).join('  '));
  return [header, sep, ...body].join('\n');
}

export function kv(rows: Array<[string, string]>): string {
  const w = Math.max(...rows.map(([k]) => k.length));
  return rows.map(([k, v]) => `${kleur.bold(pad(k, w))}  ${v}`).join('\n');
}

export function statusColor(status: string): string {
  if (status === 'ok' || status === 'active') return kleur.green(status);
  if (status === 'error' || status === 'spend_limit_exceeded') return kleur.red(status);
  if (status === 'paused') return kleur.yellow(status);
  return status;
}
