/**
 * The synthetic demo traveller ("John Doe"). This is both the Cosmos seed
 * document and the deterministic fallback the MCP server returns when Cosmos is
 * not configured or unreachable. Fictional data — no real PII.
 */

export type SeatPreference = 'Aisle' | 'Window' | 'Middle' | 'Any';
export type DietaryRequirement = 'Vegetarian' | 'Vegan' | 'Halal' | 'Kosher' | 'Gluten-free' | 'None';
export interface PastDestination {
  city: string;
  country: string;
}

export interface TravellerProfile {
  traveller: string;
  programme: string;
  membershipNumber: string;
  tier: string;
  rewardPoints: number;
  preferredAirlines: string[];
  preferredCabin: 'Economy' | 'Premium' | 'Business';
  seat: SeatPreference;
  dietary: DietaryRequirement;
  pastDestinations: PastDestination[];
}

/** Stable Cosmos document id + partition-key value for the single demo traveller. */
export const TRAVELLER_ID = 'john-doe';
export const TRAVELLER_NAME = 'John Doe';

export const PROFILE: TravellerProfile = {
  traveller: TRAVELLER_NAME,
  programme: 'Waypoint Skyward',
  membershipNumber: '39302492',
  tier: 'Gold',
  rewardPoints: 7463,
  preferredAirlines: ['Vueling', 'British Airways'],
  preferredCabin: 'Economy',
  seat: 'Aisle',
  dietary: 'Vegetarian',
  pastDestinations: [
    { city: 'Lisbon', country: 'Portugal' },
    { city: 'Barcelona', country: 'Spain' },
    { city: 'Chania', country: 'Greece' },
  ],
};
