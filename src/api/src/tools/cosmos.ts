import type {
  BookingPersonalisation,
  DietaryRequirement,
  PersonalisationProfile,
  PersonalisationResult,
  SeatPreference,
} from '../../../shared/types/personalisation.js';

/**
 * FRD-006 Cosmos profile tool — the synthetic traveller profile and the pure
 * personalisation logic shared by the real Copilot driver and the local test
 * driver. In production this data is read from Azure Cosmos DB via the
 * `waypoint-data` MCP; here it is a deterministic, fictional profile for one
 * demo traveller ("John Doe") that also backs tests/offline. No real PII.
 */

/** The single synthetic demo traveller stored in Cosmos. */
const PROFILE: PersonalisationProfile = {
  traveller: 'John Doe',
  programme: 'Waypoint Skyward',
  membershipNumber: '39302492',
  tier: 'Gold',
  rewardPoints: 7463,
  preferredAirlines: ['TAP Air Portugal', 'British Airways'],
  preferredCabin: 'Economy',
  seat: 'Aisle',
  dietary: 'Vegetarian',
  pastDestinations: [
    { city: 'Lisbon', country: 'Portugal' },
    { city: 'Barcelona', country: 'Spain' },
    { city: 'Chania', country: 'Greece' },
  ],
};

/**
 * Fetch the traveller profile. `includeHistory: false` models the partial-data
 * edge case (preferences present, history missing) — the agent must then use
 * only what is available and never fabricate a past destination.
 */
export function getTravellerProfile(options?: { includeHistory?: boolean }): PersonalisationProfile {
  const profile: PersonalisationProfile = { ...PROFILE };
  if (options?.includeHistory === false) delete profile.pastDestinations;
  return profile;
}

/** A redacted result summary for the `cosmos.getTravellerProfile` audit entry — never a credential. */
export function profileAuditSummary(profile: PersonalisationProfile): Record<string, unknown> {
  return {
    dataset: 'loyalty + preferences + past destinations',
    tier: profile.tier,
    rewardPoints: profile.rewardPoints,
    membershipNumber: profile.membershipNumber,
    seat: profile.seat,
    dietary: profile.dietary,
    pastDestinations: profile.pastDestinations?.map((d) => `${d.city}, ${d.country}`),
  };
}

const SEAT_WORDS: Record<string, SeatPreference> = {
  aisle: 'Aisle',
  window: 'Window',
  middle: 'Middle',
};

/** Detect a live seat preference the traveller states in this turn (overrides the saved one). */
export function detectSeatOverride(message: string): SeatPreference | undefined {
  const match = message.toLowerCase().match(/\b(aisle|window|middle)\b\s*(seat)?/);
  return match ? SEAT_WORDS[match[1]] : undefined;
}

const gbpPoints = new Intl.NumberFormat('en-GB');
const article = (word: string): string => (/^[aeiou]/i.test(word) ? 'an' : 'a');
const seatWord = (seat: SeatPreference): string => (seat === 'Any' ? 'preferred' : seat.toLowerCase());

/**
 * Fold the profile into a personalisation note. Explains *why* (FR-006-3),
 * applies a live seat override over the saved preference and notes the
 * difference, and never invents a past destination when history is absent.
 */
export function personalise(profile: PersonalisationProfile, message = ''): PersonalisationResult {
  const override = detectSeatOverride(message);
  const appliedSeat = override ?? profile.seat;
  const appliedMeal = profile.dietary;
  const lastVisited = profile.pastDestinations?.[0];
  const tripNote = lastVisited ? ` and enjoyed ${lastVisited.city}, ${lastVisited.country} before` : '';
  const status = `you're ${profile.tier} Tier (${gbpPoints.format(profile.rewardPoints)} reward points)${tripNote}`;

  const rationale =
    override && override !== profile.seat
      ? `You usually prefer ${article(seatWord(profile.seat))} ${seatWord(profile.seat)} seat, but because ${status}, ` +
        `I'll apply ${article(seatWord(appliedSeat))} ${seatWord(appliedSeat)} seat this time as you asked and keep your ${appliedMeal.toLowerCase()} meal.`
      : `Because ${status}, I'll pre-select ${article(seatWord(appliedSeat))} ${seatWord(appliedSeat)} seat and a ${appliedMeal.toLowerCase()} meal.`;

  return {
    available: true,
    tier: profile.tier,
    rewardPoints: profile.rewardPoints,
    appliedSeat,
    appliedMeal,
    rationale,
  };
}

const SEAT_LETTER: Record<SeatPreference, string> = { Aisle: 'C', Window: 'A', Middle: 'B', Any: 'C' };

function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = (h * 31 + value.charCodeAt(i)) | 0;
  return h;
}

/**
 * Compute the simulated booking personalisation: a seat assignment consistent
 * with the preference, the in-flight meal, and reward points earned on this
 * trip credited to the saved membership. Display only — never written back.
 */
export function bookingPersonalisation(
  profile: PersonalisationProfile,
  opts: { ref: string; flightGBP: number; party: number; seat?: SeatPreference },
): BookingPersonalisation {
  const seat = opts.seat ?? profile.seat;
  const row = 10 + (Math.abs(hash(opts.ref)) % 21); // rows 10–30
  const seatAssignment = `${row}${SEAT_LETTER[seat]}`;
  const pointsEarned = Math.max(1, Math.round((opts.flightGBP * opts.party) / 2));
  return {
    seatAssignment,
    mealRequested: profile.dietary as DietaryRequirement,
    pointsEarned,
    membershipNumber: profile.membershipNumber,
    newBalance: profile.rewardPoints + pointsEarned,
  };
}

/** Format a reward-points balance for display, e.g. 7584 → "7,584". */
export function formatPoints(value: number): string {
  return gbpPoints.format(value);
}
