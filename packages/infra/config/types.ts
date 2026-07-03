export interface EnvConfig {
  /** Environment name; appears in resource names and tags. */
  readonly env: 'dev' | 'prod';
  /** Resource name prefix; e.g. `agent-village-dev` */
  readonly prefix: string;
  /** AWS region */
  readonly region: string;
  /** AWS account id; from CDK_DEFAULT_ACCOUNT if unset. */
  readonly account?: string;
  /** Removal policy controls whether destructive `cdk destroy` actually deletes data. */
  readonly retainOnDelete: boolean;
  /** Lambda memory in MB for the runner. Bigger = faster cold starts, more cost. */
  readonly runnerMemoryMb: number;
  /** Lambda memory in MB for API handlers. */
  readonly apiMemoryMb: number;
  /** CloudWatch Logs retention in days. */
  readonly logRetentionDays: number;
  /** Fargate task CPU units for sandboxed application runs (256 = 0.25 vCPU). */
  readonly sandboxTaskCpu: number;
  /** Fargate task memory in MiB for sandboxed application runs. */
  readonly sandboxTaskMemoryMb: number;
  /** Monthly budget cap in USD; >= 1. Triggers email alarms at 50/80/100%. */
  readonly monthlyBudgetUsd: number;
  /** Email address that receives Budget + alarm SNS notifications. */
  readonly alarmEmail: string;
  /** Optional custom domain for the SPA. */
  readonly webDomain?: string;
  /**
   * Verified SES sending domain/identity for agent `ses` grants. When set, the
   * SandboxStack creates an SES EmailIdentity and grants the task role
   * ses:SendEmail scoped to it (each run is then narrowed by an STS session
   * policy). Leave unset to synth/deploy with NO SES resources — `ses` grants
   * are inert in that env (send fails at runtime).
   */
  readonly sesSenderDomain?: string;
}
