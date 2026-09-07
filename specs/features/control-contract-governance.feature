Feature: Control selection & release contract governance (FRD-010)
  As a governance lead
  I want deterministic control selection, hash-bound approval and a blocking release gate
  So that only assured, approved artefacts can be released — using synthetic demonstration policy

  # Proven by src/governance/tests/*.test.ts and the gov:* CLI. Policies are SYNTHETIC.
  # This governance-only cut does not exercise application runtime behaviour; the app,
  # evaluation, runtime and observability proofs come from separately-recorded segments.

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

  @governance @release @missing-evidence
  Scenario: Missing or failing blocking evidence blocks release
    Given an approved contract
    When a blocking control has missing, failing, errored or foreign-commit evidence
    Then the release decision is blocked
    And the failed control and remediation are named

  @governance @mcp
  Scenario: An undeclared MCP tool blocks release
    Given the approved MCP allowlist
    When an undeclared tool appears in the configuration fixture
    Then release is blocked naming SEC-MCP-001
    And the repository is left in a valid state

  @governance @evaluation
  Scenario: A below-threshold evaluation result blocks release
    Given a control contract requiring a grounding evaluation
    When the evaluation result is below the approved threshold
    Then release is blocked naming EVAL-GRD-001
    And correcting the evidence produces an approved release decision

  @governance @evidence-mode
  Scenario: Local evidence is never deployable
    Given all blocking controls pass with local-demonstration evidence
    When verification runs
    Then the decision is demonstration-only
    And it is not deployable

  @governance @lifecycle
  Scenario: Lifecycle status regresses when a required artefact is removed
    Given a complete set of governance artefacts
    When a required artefact is removed or its approval is invalidated
    Then the corresponding lifecycle stage regresses to incomplete
