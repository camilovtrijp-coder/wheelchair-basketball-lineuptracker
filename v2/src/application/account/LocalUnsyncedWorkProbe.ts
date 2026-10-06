/**
 * PR 8.3c-2b-i (docs/pr-8.3c-2b-plan.md §B.10): telt onbevestigd lokaal wedstrijdwerk
 * voor één organisatie op dit apparaat. Verlaten zou dat werk onsynchroniseerbaar
 * maken (Rules weigeren daarna elke write), dus een telling > 0 blokkeert het verlaten.
 *
 * Een implementatie LEEST alleen; ze wijzigt of verwijdert nooit een sleutel.
 */
export interface LocalUnsyncedWorkProbe {
  countForOrganization(organizationId: string): number;
}
