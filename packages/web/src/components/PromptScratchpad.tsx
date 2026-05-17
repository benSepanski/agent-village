import { useState } from 'react';

export interface PromptScratchpadProps {
  initialSystemPrompt: string;
  initialUserPrompt?: string;
  onRun: (input: { systemPrompt: string; userPrompt: string }) => void | Promise<void>;
  onSaveToAgent?: (systemPrompt: string) => void | Promise<void>;
}

export function PromptScratchpad({
  initialSystemPrompt,
  initialUserPrompt = 'Run.',
  onRun,
  onSaveToAgent,
}: PromptScratchpadProps) {
  const [systemPrompt, setSystemPrompt] = useState(initialSystemPrompt);
  const [userPrompt, setUserPrompt] = useState(initialUserPrompt);
  const [busy, setBusy] = useState(false);

  const trigger = async (fn: () => void | Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="prompt scratchpad" style={{ display: 'grid', gap: 8, maxWidth: 720 }}>
      <PromptFields
        systemPrompt={systemPrompt}
        setSystemPrompt={setSystemPrompt}
        userPrompt={userPrompt}
        setUserPrompt={setUserPrompt}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          disabled={busy}
          onClick={() => void trigger(() => onRun({ systemPrompt, userPrompt }))}
        >
          Run scratchpad
        </button>
        {onSaveToAgent ? (
          <button
            type="button"
            disabled={busy || systemPrompt === initialSystemPrompt}
            onClick={() => void trigger(() => onSaveToAgent(systemPrompt))}
          >
            Save to agent
          </button>
        ) : null}
      </div>
    </section>
  );
}

interface PromptFieldsProps {
  systemPrompt: string;
  setSystemPrompt: (v: string) => void;
  userPrompt: string;
  setUserPrompt: (v: string) => void;
}

function PromptFields(p: PromptFieldsProps) {
  return (
    <>
      <label>
        System prompt
        <textarea
          value={p.systemPrompt}
          onChange={(e) => p.setSystemPrompt(e.target.value)}
          rows={6}
        />
      </label>
      <label>
        User prompt
        <textarea value={p.userPrompt} onChange={(e) => p.setUserPrompt(e.target.value)} rows={3} />
      </label>
    </>
  );
}
