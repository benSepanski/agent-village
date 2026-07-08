/**
 * Sandbox task sizing, read from the environment the infra stack injects into
 * both the launcher and the lifecycle Lambda. The launcher prices the flat
 * reservation with it; the lifecycle handler prices the actual-duration
 * reconciliation with it — same source, so the two sides of the ledger agree.
 */
const DEFAULT_CPU = 256;
const DEFAULT_MEMORY_MB = 512;

export interface SandboxTaskSize {
  /** Fargate CPU units (1024 = 1 vCPU). */
  cpu: number;
  /** Task memory in MiB. */
  memMb: number;
}

export function sandboxTaskSize(): SandboxTaskSize {
  return {
    cpu: Number(process.env['AV_SANDBOX_CPU'] ?? DEFAULT_CPU),
    memMb: Number(process.env['AV_SANDBOX_MEMORY'] ?? DEFAULT_MEMORY_MB),
  };
}
