/**
 * PR 8.3c-2b-i (docs/pr-8.3c-2b-plan.md §B.10): telt onbevestigd lokaal wedstrijdwerk
 * voor één organisatie op dit apparaat. Verlaten zou dat werk onsynchroniseerbaar
 * maken (Rules weigeren daarna elke write), dus een telling > 0 blokkeert het verlaten.
 *
 * Een implementatie LEEST alleen; ze wijzigt of verwijdert nooit een sleutel. Kan ze
 * niet vaststellen of er werk is (onleesbare data, sleutels niet op te sommen), dan
 * geeft ze minstens 1: onbekend blokkeert (fail closed).
 */
export interface LocalUnsyncedWorkProbe {
  countForOrganization(organizationId: string): number;
}
