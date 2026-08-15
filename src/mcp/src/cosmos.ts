import { CosmosClient, type Container } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';
import { PROFILE, TRAVELLER_ID, TRAVELLER_NAME, type TravellerProfile } from './profile.js';

/**
 * Cosmos DB data layer for the traveller profile (ADR-007). Reads the single
 * synthetic document with the Container App's managed identity (keyless —
 * `aadCredentials`). If Cosmos is not configured (`COSMOS_ENDPOINT` absent) or a
 * read fails, it returns the deterministic offline profile so the demo always
 * works. On first run against an empty container it seeds the document.
 */

const DATABASE = process.env.COSMOS_DATABASE ?? 'waypoint';
const CONTAINER = process.env.COSMOS_CONTAINER ?? 'profiles';
const endpoint = process.env.COSMOS_ENDPOINT;

let cached: Container | undefined;

function container(): Container | undefined {
  if (!endpoint) return undefined;
  if (!cached) {
    const client = new CosmosClient({ endpoint, aadCredentials: new DefaultAzureCredential() });
    cached = client.database(DATABASE).container(CONTAINER);
  }
  return cached;
}

/** Strip Cosmos system fields (`_rid`, `_ts`, …) down to the profile shape. */
function clean(doc: Record<string, unknown>): TravellerProfile {
  return {
    traveller: String(doc.traveller ?? TRAVELLER_NAME),
    programme: String(doc.programme ?? PROFILE.programme),
    membershipNumber: String(doc.membershipNumber ?? PROFILE.membershipNumber),
    tier: String(doc.tier ?? PROFILE.tier),
    rewardPoints: Number(doc.rewardPoints ?? PROFILE.rewardPoints),
    preferredAirlines: (doc.preferredAirlines as string[]) ?? PROFILE.preferredAirlines,
    preferredCabin: (doc.preferredCabin as TravellerProfile['preferredCabin']) ?? PROFILE.preferredCabin,
    seat: (doc.seat as TravellerProfile['seat']) ?? PROFILE.seat,
    dietary: (doc.dietary as TravellerProfile['dietary']) ?? PROFILE.dietary,
    pastDestinations: (doc.pastDestinations as TravellerProfile['pastDestinations']) ?? PROFILE.pastDestinations,
  };
}

export interface ProfileResult {
  profile: TravellerProfile;
  source: 'cosmos' | 'offline';
}

/** Read the traveller profile from Cosmos (seeding on first run) or fall back offline. */
export async function readTravellerProfile(): Promise<ProfileResult> {
  const c = container();
  if (!c) return { profile: PROFILE, source: 'offline' };
  try {
    const { resource } = await c.item(TRAVELLER_ID, TRAVELLER_NAME).read<Record<string, unknown>>();
    if (resource) return { profile: clean(resource), source: 'cosmos' };
    await c.items.upsert({ id: TRAVELLER_ID, ...PROFILE });
    return { profile: PROFILE, source: 'cosmos' };
  } catch {
    return { profile: PROFILE, source: 'offline' };
  }
}

/** True when a Cosmos endpoint is configured (the live path). */
export function cosmosConfigured(): boolean {
  return Boolean(endpoint);
}
