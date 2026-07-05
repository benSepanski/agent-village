import { useState, type FormEvent } from 'react';
import {
  ANTHROPIC_MODELS,
  CreateAgentInput,
  type CreateAgentInputType,
} from '../api-client/types.js';

type Mode = 'create' | 'edit';

export interface AgentFormProps {
  mode: Mode;
  initial?: Partial<CreateAgentInputType>;
  submitLabel?: string;
  onSubmit: (input: CreateAgentInputType) => void | Promise<void>;
}

interface FormState {
  name: string;
  model: (typeof ANTHROPIC_MODELS)[number];
  systemPrompt: string;
  schedule: string;
  spendLimitUsd: string;
  anthropicApiKey: string;
}

function toFormState(initial: Partial<CreateAgentInputType> | undefined): FormState {
  return {
    name: initial?.name ?? '',
    model: initial?.model ?? 'claude-opus-4-8',
    systemPrompt: initial?.systemPrompt ?? '',
    schedule: initial?.schedule ?? '',
    spendLimitUsd: initial?.spendLimitUsd === undefined ? '1' : String(initial.spendLimitUsd),
    anthropicApiKey: '',
  };
}

function parse(state: FormState):
  | {
      ok: true;
      value: CreateAgentInputType;
    }
  | {
      ok: false;
      error: string;
    } {
  const candidate = {
    name: state.name,
    model: state.model,
    systemPrompt: state.systemPrompt,
    schedule: state.schedule.trim() === '' ? null : state.schedule.trim(),
    spendLimitUsd: Number(state.spendLimitUsd),
    anthropicApiKey: state.anthropicApiKey,
  };
  const result = CreateAgentInput.safeParse(candidate);
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    error: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
  };
}

interface FieldsProps {
  state: FormState;
  set: (next: FormState) => void;
  mode: Mode;
}

function TextFields({ state, set }: { state: FormState; set: FieldsProps['set'] }) {
  return (
    <>
      <label>
        Name
        <input
          value={state.name}
          onChange={(e) => set({ ...state, name: e.target.value })}
          required
        />
      </label>
      <label>
        Model
        <select
          value={state.model}
          onChange={(e) => set({ ...state, model: e.target.value as FormState['model'] })}
        >
          {ANTHROPIC_MODELS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <label>
        System prompt
        <textarea
          value={state.systemPrompt}
          onChange={(e) => set({ ...state, systemPrompt: e.target.value })}
          rows={6}
          required
        />
      </label>
    </>
  );
}

function ScheduleAndSecretFields({ state, set, mode }: FieldsProps) {
  return (
    <>
      <label>
        Schedule (5-field cron, or empty for manual-only)
        <input
          value={state.schedule}
          onChange={(e) => set({ ...state, schedule: e.target.value })}
          placeholder="*/5 * * * *"
        />
      </label>
      <label>
        Spend limit USD
        <input
          type="number"
          step="0.01"
          min="0.01"
          value={state.spendLimitUsd}
          onChange={(e) => set({ ...state, spendLimitUsd: e.target.value })}
          required
        />
      </label>
      <label>
        Anthropic API key {mode === 'edit' ? '(leave blank to keep current)' : ''}
        <input
          type="password"
          value={state.anthropicApiKey}
          onChange={(e) => set({ ...state, anthropicApiKey: e.target.value })}
          required={mode === 'create'}
        />
      </label>
    </>
  );
}

function Fields(props: FieldsProps) {
  return (
    <>
      <TextFields state={props.state} set={props.set} />
      <ScheduleAndSecretFields {...props} />
    </>
  );
}

export function AgentForm({ mode, initial, submitLabel, onSubmit }: AgentFormProps) {
  const [state, setState] = useState<FormState>(() => toFormState(initial));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    const result = parse(state);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(result.value);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      style={{ display: 'grid', gap: '12px', maxWidth: 600 }}
    >
      <Fields state={state} set={setState} mode={mode} />
      {error ? (
        <p role="alert" style={{ color: '#991b1b' }}>
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={submitting}>
        {submitLabel ?? (mode === 'create' ? 'Create agent' : 'Save changes')}
      </button>
    </form>
  );
}
