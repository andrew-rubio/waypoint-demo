Feature: Control selection & release contract governance (FRD-010)
  As a governance lead
  I want deterministic control selection, hash-bound approval and a blocking release gate
  So that only assured, approved artefacts can be released — with synthetic demonstration policy

  # These scenarios are proven by src/governance/tests/*.test.ts (engine) and
  # src/api/tests/unit/governance-runtime.test.ts (runtime behaviours). Policies are synthetic.

  @governance @selection
  Scenario: Deterministic control selection from proposition characteristics
    Given the Waypoint proposition and the synthetic control catalogue
    When control selection runs
    Then the same applicable controls are selected every time
    And each selected control records its rationale and matching predicates

  @governance @approval
  Scenario: A material change invalidates a hash-bound approval
    Given an approved control contract
    When a control obligation, threshold, severity or the proposition changes
    Then the contract hash changes
    And the prior approval is no longer valid

  @governance @release
  Scenario: Missing or failing blocking evidence blocks release
    Given an approved contract
    When a blocking control has missing, failing, errored or foreign-commit evidence
    Then the release decision is blocked
    And the failed control and remediation are named

  @governance @mcp
  Scenario: An undeclared MCP tool blocks release
    Given the approved MCP allowlist
    When an undeclared tool appears in the configuration
    Then release is blocked naming SEC-MCP-001
    And the repository is left in a valid state

  @governance @evidence-mode
  Scenario: Local evidence is never deployable
    Given all blocking controls pass with local-demonstration evidence
    When verification runs
    Then the decision is demonstration-only
    And it is not deployable

  @governance @booking @human-in-the-loop
  Scenario: Simulated booking requires an itinerary-bound approval
    Given an itinerary has been proposed
    And no approval exists for that itinerary
    When the agent requests simulated booking execution
    Then execution is blocked
    And an approval-required outcome is emitted to the audit stream
    And the response does not claim the booking is complete

  @governance @booking @human-in-the-loop
  Scenario: An explicit itinerary-bound approval allows the simulated booking
    Given an itinerary has been proposed
    And the user explicitly approves that exact itinerary
    When the agent requests simulated booking execution
    Then the simulated booking proceeds
    And the approval id is included in the audit event

  @governance @runtime @stale-currency
  Scenario: Stale currency data is contained without downing the service
    Given a currency result older than the approved freshness threshold
    When a budget or booking confirmation is attempted
    Then deterministic code detects the stale data
    And the final budget and simulated booking are blocked
    And the service remains available and the itinerary is preserved
    And a runtime finding is recorded for a proposed learning artefact

  @governance @runtime-proof
  Scenario: The local fallback never claims Foundry-hosted execution
    Given no Foundry hosting is configured
    When the runtime metadata is read
    Then the active driver is reported as the local deterministic driver
    And it is never labelled as the Foundry hosted agent
