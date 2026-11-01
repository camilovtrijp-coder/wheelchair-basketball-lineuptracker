import { type LiveCommandError } from '../../domain/game/liveCommands';
import { type StringKey } from '../../i18n/strings';

/** v1: `fmt()` — "-1:05"/"1:05" (min:ss, met minteken bij negatieve duur). */
export function fmtSec(sec: number): string {
  const neg = sec < 0;
  const abs = Math.abs(sec);
  return `${neg ? '-' : ''}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`;
}

/** Bestaande tekstsleutel voor een geweigerd livecommando; `null` = geen melding. */
export function liveErrorKey(error: LiveCommandError): StringKey | null {
  switch (error) {
    case 'invalid-clock':
      return 'correctErrorInvalidTime';
    case 'invalid-duration':
      return 'endAfterBegin';
    case 'invalid-lineup':
      return 'needFiveOnCourt';
    case 'invalid-score':
      return 'correctErrorInvalidScore';
    case 'score-below-segment-start':
      return 'liveErrorScoreBelowSegmentStart';
    case 'invalid-quarter':
      return 'correctErrorInvalidQuarter';
    case 'score-changed':
      return 'liveErrorScoreChangedAtZero';
    case 'unknown-segment':
      return 'correctErrorUnknownSegment';
    case 'no-pending-swap':
      return null;
  }
}
