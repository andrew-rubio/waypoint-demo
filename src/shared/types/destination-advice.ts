/** Shared contract for the FRD-003 destination-advisor skill. */
export interface DestinationSuggestion {
  /** Canonical downstream-ready place name, e.g. "Lisbon, Portugal". */
  name: string;
  rationale: string;
  tags: string[];
}

/** A destination the agent proposes for validation and ranking by the tool. */
export interface DestinationCandidate {
  name: string;
  rationale: string;
  matchedPreferences?: string[];
  tags?: string[];
}

/**
 * A month-tagged passage retrieved from the travel-guide knowledge base
 * (Azure AI Search) via `travel-guide.searchByMonth` (INC-8). Offline, a
 * deterministic dataset derived from the guide PDF backs the same shape.
 */
export interface GuidePassage {
  /** Canonical downstream-ready place name, e.g. "Seville, Spain". */
  name: string;
  /** One-line, month-appropriate reason drawn from the travel guide. */
  rationale: string;
  tags: string[];
  /** The month this passage was retrieved for, e.g. "June". */
  month: string;
}

export interface DestinationAdviceRequest {
  interests: string[];
  constraints: string[];
  candidates?: DestinationCandidate[];
  previousSuggestions?: DestinationSuggestion[];
  /** INC-8: target month extracted from the request, when present. */
  month?: string;
  /** INC-8: guide passages retrieved for the month — the grounded candidate pool. */
  guidePassages?: GuidePassage[];
  /** INC-8: canonical past-destination names to exclude, e.g. ["Lisbon, Portugal"]. */
  pastDestinations?: string[];
}

export interface DestinationShortlistResult {
  kind: 'shortlist';
  suggestions: DestinationSuggestion[];
  message?: string;
  /**
   * INC-8: true when the shortlist was grounded in travel-guide passages for a
   * month; false when the guide had no strong match and the agent fell back to
   * preference-based suggestions.
   */
  guideMatched?: boolean;
  /** INC-8: the month the shortlist was produced for, when month-aware. */
  month?: string;
}

export interface DestinationClarificationResult {
  kind: 'clarification';
  message: string;
}

export interface DestinationNoMatchResult {
  kind: 'no-match';
  message: string;
  suggestions: DestinationSuggestion[];
}

export interface DestinationRedirectResult {
  kind: 'redirect';
  message: string;
}

export type DestinationAdviceResult =
  | DestinationShortlistResult
  | DestinationClarificationResult
  | DestinationNoMatchResult
  | DestinationRedirectResult;