/**
 * Shared contract for FRD-006 personalisation via Cosmos DB (INC-6).
 *
 * The agent enriches its answers with a synthetic traveller profile stored in
 * Azure Cosmos DB (serverless) and retrieved through the self-hosted
 * `waypoint-data` MCP: a reward-programme membership (Gold Tier + reward
 * points), past destinations (city + country), and travel preferences (seat +
 * dietary). All data is fictional for one demo traveller, "John Doe".
 * Personalisation is explained, audited (`cosmos.getTravellerProfile` mcp
 * entry), echoed at the simulated booking, and degrades gracefully when the
 * store is unavailable.
 *
 * In production the agent reads these shapes from Cosmos via the MCP; offline
 * (tests/demo) the trusted cosmos tool returns the deterministic synthetic
 * profile. No real PII — credentials are redacted at the SSE boundary.
 */

export type SeatPreference = 'Aisle' | 'Window' | 'Middle' | 'Any';

export type DietaryRequirement = 'Vegetarian' | 'Vegan' | 'Halal' | 'Kosher' | 'Gluten-free' | 'None';

/** A place the traveller has visited — city + country only (drives "you've been to X"). */
export interface PastDestination {
  city: string;
  country: string;
}

/** The synthetic loyalty + preferences profile stored in Cosmos DB. */
export interface PersonalisationProfile {
  traveller: string;
  /** Reward programme name, e.g. "Waypoint Skyward". */
  programme: string;
  /** Frequent-flyer / reward membership number, e.g. "39302492". */
  membershipNumber: string;
  tier: string;
  /** Reward points balance shown in the header and summary. */
  rewardPoints: number;
  preferredAirlines: string[];
  preferredCabin: 'Economy' | 'Premium' | 'Business';
  seat: SeatPreference;
  dietary: DietaryRequirement;
  /** Places already visited (city + country); absent when history is unavailable (partial data). */
  pastDestinations?: PastDestination[];
}

/** The personalisation note the agent surfaces (present or degraded/unavailable). */
export interface PersonalisationResult {
  available: boolean;
  /** One-line explanation of the personalisation ("Because you're Gold Tier…"). */
  rationale?: string;
  tier?: string;
  rewardPoints?: number;
  /** The seat that will be pre-selected (respects a live override of the saved seat). */
  appliedSeat?: SeatPreference;
  /** The in-flight meal that will be requested, from the dietary requirement. */
  appliedMeal?: DietaryRequirement;
  /** Present when available is false — why personalisation is unavailable. */
  reason?: string;
}

/**
 * Simulated at booking time (FRD-005) — display only, never written back to
 * Cosmos. Seat letter follows the preference: Aisle→C/D, Window→A/F, Middle→B/E.
 */
export interface BookingPersonalisation {
  /** Assigned seat, e.g. "23C". */
  seatAssignment: string;
  /** In-flight meal requested, e.g. "Vegetarian". */
  mealRequested: DietaryRequirement;
  /** Simulated reward points earned on this trip. */
  pointsEarned: number;
  /** The saved membership the points are credited to. */
  membershipNumber: string;
  /** rewardPoints + pointsEarned (display only). */
  newBalance: number;
}
