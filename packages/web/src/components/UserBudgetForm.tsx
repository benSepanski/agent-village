import { useState, type FormEvent } from 'react';

export interface UserBudgetFormProps {
  /** `null` when no cap is currently set (pre-fills the input blank). */
  initialLimitUsd: number | null;
  /** Sets/updates the cap. Called with a positive USD amount. */
  onSave: (limitUsd: number) => void | Promise<void>;
  /** Clears the cap (maps to `{ userMonthlyBudgetUsd: null }` on the server). */
  onClear: () => void | Promise<void>;
  busy?: boolean;
}

/** Inline budget-edit control: set or clear the account's monthly cap. */
export function UserBudgetForm({
  initialLimitUsd,
  onSave,
  onClear,
  busy = false,
}: UserBudgetFormProps) {
  const [value, setValue] = useState(initialLimitUsd === null ? '' : String(initialLimitUsd));
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) {
      setError('Enter a positive dollar amount.');
      return;
    }
    setError(null);
    await onSave(n);
  };

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
    >
      <label>
        Monthly budget USD
        <input
          type="number"
          step="0.01"
          min="0.01"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      {error ? (
        <span role="alert" style={{ color: '#991b1b' }}>
          {error}
        </span>
      ) : null}
      <button type="submit" disabled={busy}>
        Save
      </button>
      {initialLimitUsd !== null ? (
        <button type="button" disabled={busy} onClick={() => void onClear()}>
          Clear
        </button>
      ) : null}
    </form>
  );
}
