export interface CostTier {
  label: string;
  /** Price in cents. 0 = free. */
  amount: number;
}

interface CostTierEditorProps {
  tiers: CostTier[];
  onChange: (tiers: CostTier[]) => void;
}

function formatDollars(cents: number): string {
  if (cents === 0) return "";
  return (cents / 100).toFixed(2);
}

function parseDollars(value: string): number {
  const dollars = parseFloat(value);
  if (isNaN(dollars) || dollars < 0) return 0;
  return Math.round(dollars * 100);
}

export function CostTierEditor({ tiers, onChange }: CostTierEditorProps) {
  const isFree = tiers.length === 0;

  function setFree() {
    onChange([]);
  }

  function setPaid() {
    onChange([{ label: "", amount: 0 }]);
  }

  function addTier() {
    onChange([...tiers, { label: "", amount: 0 }]);
  }

  function removeTier(i: number) {
    const next = tiers.filter((_, idx) => idx !== i);
    onChange(next.length === 0 ? [] : next);
  }

  function updateLabel(i: number, label: string) {
    onChange(tiers.map((t, idx) => (idx === i ? { ...t, label } : t)));
  }

  function updateAmount(i: number, value: string) {
    onChange(tiers.map((t, idx) => (idx === i ? { ...t, amount: parseDollars(value) } : t)));
  }

  return (
    <div>
      <div className="radio-group">
        <label className="radio-option">
          <input
            type="radio"
            name="pricing-mode"
            value="free"
            checked={isFree}
            onChange={setFree}
          />
          Free — no cost to attend
        </label>
        <label className="radio-option">
          <input
            type="radio"
            name="pricing-mode"
            value="paid"
            checked={!isFree}
            onChange={setPaid}
          />
          Paid — define price tiers
        </label>
      </div>

      {!isFree && (
        <div className="tier-list">
          {tiers.map((tier, i) => (
            <div key={i} className="tier-row">
              <input
                type="text"
                className="field__input"
                placeholder="e.g. General Admission"
                value={tier.label}
                maxLength={80}
                onChange={(e) => updateLabel(i, e.target.value)}
              />
              <div className="tier-row__amount-wrap">
                <span className="tier-row__currency">$</span>
                <input
                  type="number"
                  className="field__input tier-row__amount-input"
                  min={0}
                  step="0.01"
                  placeholder="0.00"
                  value={formatDollars(tier.amount)}
                  onChange={(e) => updateAmount(i, e.target.value)}
                />
              </div>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => removeTier(i)}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={addTier}
          >
            + Add tier
          </button>
        </div>
      )}
    </div>
  );
}
