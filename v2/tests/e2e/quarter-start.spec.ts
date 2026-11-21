// Kwartstart-keuze bij Einde kwart (bouwplan R3, scenario's S10/S11): browsertests tegen de
// Firebase-emulator (lokale modus via `./fixtures`). Fictieve spelers: #4 Alex, #7 Sam, #9 Robin,
// #11 Kim, #13 Dani; bank #6 Bo, #12 Noa, #15 Jules. De CI draait deze spec; lokaal is de emulator nodig.
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';

const ACTIVE_GAME_KEY = 'lineup-tracker-v2-active-game:org-rotterdam:team-u23';
const GAME_SCREEN_KEY = 'lineup-tracker-v2-game-screen';
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const ROSTER: Array<[string, string]> = [
  ['4', 'Alex'],
  ['7', 'Sam'],
  ['9', 'Robin'],
  ['11', 'Kim'],
  ['13', 'Dani'],
  ['6', 'Bo'],
  ['12', 'Noa'],
  ['15', 'Jules'],
];
const STARTERS = ['4', '7', '9', '11', '13'];

type Lang = 'nl' | 'en';

interface StoredSegment {
  id: string;
  lineup: string[];
  beginSec: number;
  endSec: number;
  durSec: number;
  pf: number;
  pa: number;
}
interface StoredAction {
  type: string;
  segment?: StoredSegment;
  segmentId?: string;
}
interface StoredGame {
  actions: StoredAction[];
  onCourt: string[];
  curQuarter: number;
  beginSec: number;
  pendingSwapLineup: string[] | null;
  players: Array<{ id: string; nr: string; naam: string }>;
}

async function readActiveGame(page: Page): Promise<StoredGame> {
  const raw = await page.evaluate((key) => window.localStorage.getItem(key), ACTIVE_GAME_KEY);
  return JSON.parse(raw ?? 'null') as StoredGame;
}

/** Vastgelegde segmenten van de actielog, zonder de verwijderde (zoals de afleiding in de app). */
function liveSegments(game: StoredGame): StoredSegment[] {
  const deleted = new Set(
    game.actions.filter((a) => a.type === 'segment-deleted').map((a) => a.segmentId),
  );
  const saved: StoredSegment[] = [];
  for (const a of game.actions) {
    if (a.type === 'segment-saved' && a.segment != null && !deleted.has(a.segment.id)) {
      saved.push(a.segment);
    }
  }
  // Bijgestelde tijden (segment-edited) vervangen het opgeslagen segment.
  return saved.map((s) => {
    const edits = game.actions.filter((a) => a.type === 'segment-edited' && a.segment?.id === s.id);
    return edits.length > 0 ? edits[edits.length - 1]!.segment! : s;
  });
}

function nrsOf(game: StoredGame, ids: string[]): string[] {
  return ids.map((id) => game.players.find((p) => p.id === id)?.nr ?? '?');
}

/** Zet het roster op, kiest #4/#7/#9/#11/#13 als starters en start de wedstrijd (scherm: Rustig). */
async function startGame(page: Page, lang: Lang = 'nl'): Promise<void> {
  await page.addInitScript(
    ({ l, s, key }) => {
      window.localStorage.setItem('lineup-tracker-lang', l);
      window.localStorage.setItem(key, s);
    },
    { l: lang, s: 'calm', key: GAME_SCREEN_KEY },
  );
  await page.goto('/');
  await page.getByTestId('nav-roster').click();
  for (let i = 0; i < ROSTER.length; i += 1) {
    await page.getByTestId('roster-add').click();
  }
  const nameInputs = page.locator('[data-testid^="roster-naam-"]');
  await expect(nameInputs).toHaveCount(ROSTER.length);
  // Eerst alle namen (de volgorde blijft stabiel), daarna per speler-id het nummer:
  // het roster sorteert op nummer, dus op index vullen zou rijen door elkaar halen.
  const ids: string[] = [];
  for (let i = 0; i < ROSTER.length; i += 1) {
    const testId = await nameInputs.nth(i).getAttribute('data-testid');
    ids.push(testId!.replace('roster-naam-', ''));
    await nameInputs.nth(i).fill(ROSTER[i]![1]);
  }
  for (let i = 0; i < ROSTER.length; i += 1) {
    await page.getByTestId(`roster-nr-${ids[i]}`).fill(ROSTER[i]![0]);
  }
  // Opslaan is idempotent: bij een gemiste klik (smal scherm) opnieuw proberen.
  await expect(async () => {
    await page.getByTestId('roster-save').click();
    await expect(page.getByTestId('roster-save-success')).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  await page.reload();

  await page.getByTestId('nav-game').click();
  for (const nr of STARTERS) {
    const card = page.locator('.game-setup-card', { hasText: new RegExp(`#${nr} `) });
    await card.locator('[data-testid^="game-start-"]').click();
  }
  await expect(page.getByTestId('game-starters-info')).toContainText('5/5');
  await page.getByTestId('game-start-btn').click();
}

async function startCalmGame(page: Page, lang: Lang = 'nl'): Promise<void> {
  await startGame(page, lang);
  // Zonder segment opent Rustig op het wisselschema (besluit 8): naar Wedstrijd.
  await expect(page.getByTestId('calm-view-plan')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('calm-view-game').click();
  await expect(page.getByTestId('calm-court')).toBeVisible();
}

/** Tik een vloerspeler (op naam) en een bankspeler (op naam) aan. */
async function pickSwap(page: Page, out: string, inn: string): Promise<void> {
  await page.getByTestId('calm-court').locator('.calm-chip', { hasText: out }).click();
  await page.getByTestId('calm-bench').locator('.calm-chip', { hasText: inn }).click();
}

test.describe('Kwartstart-keuze', () => {
  test('Einde kwart: opties tonen en zelf samenstellen legt kwart 2 vast', async ({ page }) => {
    await startCalmGame(page);
    await pickSwap(page, 'Sam', 'Noa');
    await page.getByTestId('calm-swap-run').click();
    await page.getByTestId('calm-end-quarter').click();
    // S10: eerst de open tijden, daarna het keuzescherm.
    await expect(page.getByTestId('calm-confirm-sheet')).toBeVisible();
    await page.getByTestId('calm-confirm-all').click();
    await expect(page.getByTestId('quarter-start')).toBeVisible();
    // Zonder schema: zoals het veld nu staat (standaard) en zelf samenstellen.
    await expect(page.getByTestId('quarter-start-option-field')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.getByTestId('quarter-start-option-plan')).toHaveCount(0);
    const axe = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(axe.violations, JSON.stringify(axe.violations, null, 2)).toEqual([]);
    // S11: zelf samenstellen, Bo voor Dani.
    await page.getByTestId('quarter-start-option-custom').click();
    const custom = page.getByTestId('quarter-start-custom');
    await custom.locator('.chip', { hasText: 'Dani' }).click();
    await expect(page.getByTestId('quick-time-confirm')).toBeDisabled();
    await custom.locator('.chip', { hasText: 'Bo' }).click();
    await expect(page.getByTestId('quarter-start-diff-custom')).toContainText('Bo');
    await page.getByTestId('quick-time-confirm').click();
    await expect(page.getByTestId('calm-strip-title')).toContainText('10:00');
    const game = await readActiveGame(page);
    expect(game.curQuarter).toBe(2);
    expect(nrsOf(game, game.onCourt).sort()).toEqual(['11', '12', '4', '6', '9']);
    // Het afgesloten kwart is met de oude opstelling vastgelegd.
    const segs = liveSegments(game);
    expect(nrsOf(game, segs[segs.length - 1]!.lineup).sort()).toEqual(
      ['11', '12', '4', '9', '13'].sort(),
    );
  });

  test('Engelse teksten in het keuzescherm', async ({ page }) => {
    await startCalmGame(page, 'en');
    await page.getByTestId('calm-end-quarter').click();
    await expect(page.getByTestId('quarter-start-option-field')).toContainText(
      'As the court is now',
    );
    await expect(page.getByTestId('quarter-start-option-custom')).toContainText('Build my own');
  });
});
