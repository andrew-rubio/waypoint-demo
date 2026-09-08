/**
 * Itinerary-bound booking approval (FRD-010 FR-010-11, ADR-012 D2/M2).
 *
 * A consequential simulated booking requires an explicit approval bound to the EXACT
 * itinerary being acted on. A generic instruction such as "Book…" is deliberately NOT
 * sufficient — the human-in-the-loop control would otherwise be trivially bypassable.
 * The booking remains SIMULATED; no real payment or booking service is ever called.
 */
export interface BookingApproval {
  approvalId: string;
  itineraryId: string;
  approvedBy: string;
  approvedAt: string;
  scope: 'simulated-booking';
}

/** Deterministic guard: an approval authorises a booking only for its exact itinerary. */
export function isApprovedFor(itineraryId: string, approval: BookingApproval | undefined): boolean {
  return (
    !!approval &&
    approval.scope === 'simulated-booking' &&
    approval.itineraryId === itineraryId &&
    approval.itineraryId.length > 0
  );
}
