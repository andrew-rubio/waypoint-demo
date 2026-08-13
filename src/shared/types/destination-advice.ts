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

export interface DestinationAdviceRequest {
  interests: string[];
  constraints: string[];
  candidates?: DestinationCandidate[];
  previousSuggestions?: DestinationSuggestion[];
}

export interface DestinationShortlistResult {
  kind: 'shortlist';
  suggestions: DestinationSuggestion[];
  message?: string;
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