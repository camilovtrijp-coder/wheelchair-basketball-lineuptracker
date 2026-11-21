import { useEffect, useState } from 'preact/hooks';
import { translate, type Lang, type StringKey } from '../../i18n/strings';
import { fmtSec } from './liveFormat';
import { nudgeClock, parseClockText } from './calmClock';

/**
 * Tijdveld van het Rustig-scherm: −10s, `mm:ss` typen en +10s. Bestuurd door de
 * aanroeper (`value`; `null` = de getypte tekst is ongeldig of valt buiten de
 * grenzen). Het veld kent geen domeinregels; de grenzen komen van de aanroeper
 * (`swapTimeBounds`). "−10s" is eerder in de wedstrijd, "+10s" later.
 */
export interface CalmClockFieldProps {
  lang: Lang;
  value: number | null;
  clockDown: boolean;
  bounds: { min: number; max: number } | null;
  disabled?: boolean;
  testId: string;
  onChange: (value: number | null) => void;
}

function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.split(`{${key}}`).join(String(value)),
    template,
  );
}

export function CalmClockField({
  lang,
  value,
  clockDown,
  bounds,
  disabled = false,
  testId,
  onChange,
}: CalmClockFieldProps) {
  const t = (key: StringKey) => translate(lang, key);
  const [text, setText] = useState(value != null ? fmtSec(value) : '');
  const [lastValid, setLastValid] = useState(value ?? 0);
  const [error, setError] = useState<'invalid' | 'range' | null>(null);

  // Wijzigt de aanroeper de waarde (bijv. na een nudge), dan volgt de tekst.
  useEffect(() => {
    if (value != null) {
      setLastValid(value);
      setText(fmtSec(value));
      setError(null);
    }
  }, [value]);

  function handleInput(raw: string) {
    setText(raw);
    const parsed = parseClockText(raw);
    if (parsed == null) {
      setError('invalid');
      onChange(null);
    } else if (bounds != null && (parsed < bounds.min || parsed > bounds.max)) {
      setError('range');
      onChange(null);
    } else {
      setError(null);
      onChange(parsed);
    }
  }

  function nudge(earlier: boolean) {
    onChange(nudgeClock(value ?? lastValid, clockDown, earlier, bounds));
  }

  return (
    <div className="calm-clock" data-testid={testId}>
      <div className="calm-clock__row">
        <button
          type="button"
          className="btn-outline calm-clock__btn"
          disabled={disabled}
          aria-label={t('calmTimeEarlierAria')}
          data-testid={`${testId}-earlier`}
          onClick={() => nudge(true)}
        >
          −10s
        </button>
        <input
          type="text"
          inputMode="numeric"
          className="calm-clock__input"
          value={text}
          disabled={disabled}
          aria-label={t('calmTimeInputAria')}
          aria-invalid={error != null}
          data-testid={`${testId}-input`}
          onInput={(e) => handleInput((e.target as HTMLInputElement).value)}
        />
        <button
          type="button"
          className="btn-outline calm-clock__btn"
          disabled={disabled}
          aria-label={t('calmTimeLaterAria')}
          data-testid={`${testId}-later`}
          onClick={() => nudge(false)}
        >
          +10s
        </button>
      </div>
      {error != null ? (
        <p className="calm-clock__error" role="alert" data-testid={`${testId}-error`}>
          {error === 'invalid' || bounds == null
            ? t('calmTimeInvalid')
            : fill(t('calmTimeOutOfRange'), { min: fmtSec(bounds.min), max: fmtSec(bounds.max) })}
        </p>
      ) : null}
    </div>
  );
}
