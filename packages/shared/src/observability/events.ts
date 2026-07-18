export const LOG_EVENTS = [
  'system.boot',
  'system.shutdown',
  'http.request.received',
  'http.request.handled',
  'http.request.error',
  'agent.created',
  'agent.updated',
  'agent.deleted',
  'agent.paused',
  'agent.resumed',
  // User-managed per-agent secrets (Phase 4 step 02) — names only, never values:
  'agent.secret.stored',
  'agent.secret.deleted',
  'agent.run.started',
  'agent.run.config_loaded',
  'agent.run.spend_reserved',
  'agent.run.spend_rejected',
  'agent.run.secret_fetched',
  'agent.run.anthropic_call',
  'agent.run.anthropic_response',
  'agent.run.spend_finalized',
  'agent.run.persisted',
  'agent.run.completed',
  'agent.run.failed',
  'schedule.upserted',
  'schedule.removed',
  'sandbox.run.sync_down',
  'sandbox.run.flush',
  'sandbox.run.app_exited',
  'sandbox.run.sync_up',
  // Launcher + lifecycle events (emitted by the runner/lifecycle Lambdas):
  'sandbox.run.launched',
  'sandbox.run.launch_failed',
  // The task launched, but persisting its bookkeeping taskArn failed. Logged
  // and swallowed — the live task must NOT be treated as a launch failure.
  'sandbox.run.taskarn_persist_failed',
  'sandbox.run.finalized',
  // Honest-cost reconciliation: the flat launch reservation is replaced by the
  // task's actual-duration Fargate cost when it stops (Phase 3 step 06):
  'sandbox.run.spend_reconciled',
  'sandbox.run.reconcile_failed',
  'sandbox.run.grants_injected',
  'sandbox.run.grant_denied',
  // Per-image task definitions for custom manifest.image tags (Phase 4 step 03):
  'sandbox.taskdef.registered',
  'sandbox.taskdef.cache_persist_failed',
  // Run-duration watchdog (one-shot StopTask schedule armed by the launcher,
  // disarmed by the lifecycle handler when the task stops):
  'sandbox.watchdog.armed',
  'sandbox.watchdog.arm_failed',
  'sandbox.watchdog.deleted',
  'sandbox.watchdog.delete_failed',
  // Egress-proxy sidecar events (emitted by the per-run proxy container):
  'sandbox.proxy.started',
  'sandbox.egress.allowed',
  'sandbox.egress.denied',
  // Anthropic metering gateway (ADR 0004; emitted by the gateway Lambda):
  'gateway.request.unauthorized',
  'gateway.request.rejected',
  'gateway.call.forwarded',
  'gateway.call.reconciled',
  'gateway.call.reconcile_failed',
  'gateway.call.usage_unparsed',
  'gateway.call.upstream_failed',
  'gateway.run.marked_exhausted',
  'gateway.run.mark_failed',
  'gateway.run.usage_record_failed',
] as const;

export type LogEvent = (typeof LOG_EVENTS)[number];
