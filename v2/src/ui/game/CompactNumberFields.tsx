import { MAX_CLOCK_MINUTES, MAX_CLOCK_SECONDS } from '../../domain/game/types';
import { maxSecondsForMinutes } from '../../domain/game/liveCommands';

/**
 * Numeriek veld met typen én een dropdown rechts met scrollbare waarden
 * (compact-bouwplan, Wisselen punt 3/4). De waarde is een tekstconcept: de
 * aanroeper valideert bij bevestigen (geen stille klem op ongeldige invoer).
 */
export function NumberDropdownField({
  value,
  min,
  max,
  pad,
  maxLength,
  testId,
  label,
  pickLabel,
  disabled,
  onChange,
}: {
  value: string;
  min: number;
  max: number;
  pad: boolean;
  maxLength: number;
  testId: string;
  label: string;
  pickLabel: string;
  disabled: boolean;
  onChange: (next: string) => void;
}) {
  const fmt = (n: number) => (pad ? String(n).padStart(2, '0') : String(n));
  const parsed = /^\d+$/.test(value) ? Number(value) : null;
  const selected = parsed != null && parsed >= min && parsed <= max ? parsed : null;
  const options = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  return (
    <div className="numfield">
      <input
        className="numfield__input"
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        maxLength={maxLength}
        value={value}
        disabled={disabled}
        data-testid={testId}
        aria-label={label}
        onInput={(e) =>
          onChange((e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, maxLength))
        }
        onBlur={() => {
          if (pad && /^\d+$/.test(value)) onChange(String(Number(value)).padStart(2, '0'));
        }}
      />
      <span className="numfield__pick">
        <span aria-hidden="true" className="numfield__chevron">
          ▾
        </span>
        <select
          className="numfield__select"
          value={selected == null ? '' : String(selected)}
          disabled={disabled}
          data-testid={`${testId}-pick`}
          aria-label={pickLabel}
          onChange={(e) => {
            const v = (e.target as HTMLSelectElement).value;
            if (v !== '') onChange(fmt(Number(v)));
          }}
        >
          {selected == null ? <option value="" /> : null}
          {options.map((n) => (
            <option key={n} value={String(n)}>
              {fmt(n)}
            </option>
          ))}
        </select>
      </span>
    </div>
  );
}

export interface ClockDraft {
  min: string;
  sec: string;
}

export function clockDraftFromSeconds(totalSec: number): ClockDraft {
  const safe = Number.isInteger(totalSec) && totalSec >= 0 ? totalSec : 0;
  return { min: String(Math.floor(safe / 60)), sec: String(safe % 60).padStart(2, '0') };
}

/** Hele seconden uit een klokconcept, of `null` bij ongeldige invoer (geen cijfers, seconden 60+, > 10:00). */
export function parseClockDraft(draft: ClockDraft): number | null {
  if (!/^\d{1,2}$/.test(draft.min) || !/^\d{1,2}$/.test(draft.sec)) return null;
  const min = Number(draft.min);
  const sec = Number(draft.sec);
  if (min > MAX_CLOCK_MINUTES || sec > 59) return null;
  const total = min * 60 + sec;
  return total <= MAX_CLOCK_SECONDS ? total : null;
}

/** Hele score uit tekst (0..max), of `null` bij ongeldige invoer. */
export function parseScoreDraft(raw: string, max: number): number | null {
  if (!/^\d{1,3}$/.test(raw)) return null;
  const n = Number(raw);
  return n <= max ? n : null;
}

export function ClockFields({
  draft,
  idPrefix,
  label,
  minutesLabel,
  secondsLabel,
  pickLabel,
  disabled,
  onChange,
}: {
  draft: ClockDraft;
  idPrefix: string;
  label: string;
  minutesLabel: string;
  secondsLabel: string;
  pickLabel: (what: string) => string;
  disabled: boolean;
  onChange: (next: ClockDraft) => void;
}) {
  const minNow = /^\d{1,2}$/.test(draft.min) ? Number(draft.min) : 0;
  return (
    <div className="clockfields" role="group" aria-label={label}>
      <NumberDropdownField
        value={draft.min}
        min={0}
        max={MAX_CLOCK_MINUTES}
        pad={false}
        maxLength={2}
        testId={`${idPrefix}-min`}
        label={`${label} ${minutesLabel}`}
        pickLabel={pickLabel(`${label} ${minutesLabel}`)}
        disabled={disabled}
        onChange={(min) =>
          // Kiezen van het maximum (10 min) zet de seconden terug op 00, zodat
          // de klok nooit boven 10:00 uitkomt.
          onChange({ min, sec: Number(min) >= MAX_CLOCK_MINUTES ? '00' : draft.sec })
        }
      />
      <span aria-hidden="true" className="clockfields__colon">
        :
      </span>
      <NumberDropdownField
        value={draft.sec}
        min={0}
        max={maxSecondsForMinutes(minNow)}
        pad
        maxLength={2}
        testId={`${idPrefix}-sec`}
        label={`${label} ${secondsLabel}`}
        pickLabel={pickLabel(`${label} ${secondsLabel}`)}
        disabled={disabled}
        onChange={(sec) => onChange({ min: draft.min, sec })}
      />
    </div>
  );
}
