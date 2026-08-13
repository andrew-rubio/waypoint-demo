@audit @inc-2 @frd-002
Feature: Audit Trail Side Panel
  As described in frd-audit-trail.md (FRD-002), a Demo Presenter can toggle a live,
  chronological side panel that shows the agent's observable activity for the current
  chat: app-generated decisions, skill/MCP/API calls, each with a request/response
  summary, a duration, and a status. The panel rides the same event stream as the
  chat (FRD-001). Secrets are redacted server-side and never reach the panel. Hidden
  model reasoning is never requested or displayed.

  Background:
    Given the traveller has opened Waypoint

  # ── AC-002-1 — Toggle visibility ────────────────────────────────────────
  @smoke
  Scenario: The presenter toggles the audit panel in and out of view
    Given the audit panel is hidden
    When the presenter opens the audit panel
    Then the audit panel is visible
    When the presenter closes the audit panel
    Then the audit panel is hidden

  Scenario: Toggling the audit panel does not disturb the conversation
    Given the traveller has exchanged a message with the agent
    When the presenter opens the audit panel
    Then the conversation is unchanged
    And the audit panel is visible

  # ── Empty state (edge case) ─────────────────────────────────────────────
  Scenario: The audit panel shows an empty state before any activity
    Given the audit panel is open
    And there has been no agent activity yet
    Then the audit panel shows an empty state

  # ── AC-002-3 — Decision entries, no hidden reasoning ────────────────────
  Scenario: A plain conversation records an observable decision entry
    Given the audit panel is open
    When the traveller sends "Where should I go?"
    Then an audit entry of type "decision" appears
    And the decision entry reads as human-readable text
    And no audit entry contains hidden model reasoning

  # ── AC-002-2 — Live tool entry resolves pending to ok ───────────────────
  Scenario: A tool call renders a live entry that resolves from pending to ok
    Given the presenter runs a turn that calls a tool
    And the audit panel is open
    Then an audit entry of type "mcp" appears
    And that entry resolves to a status of "ok" with a duration

  # ── AC-002-2 — Entries are grouped by turn ──────────────────────────────
  Scenario: Audit entries are grouped by conversation turn
    Given the audit panel is open
    And the traveller has exchanged two messages with the agent
    Then the audit trail shows two turn groups

  # ── FR-002-4 — Truncation and expand ────────────────────────────────────
  Scenario: A long payload is truncated with an expand affordance
    Given the presenter runs a turn that calls a tool
    And the audit panel is open
    When the presenter expands the tool entry
    Then the entry reveals its request and response detail

  # ── AC-002-4 — Secret redaction ─────────────────────────────────────────
  Scenario: Secrets are redacted before they reach the audit panel
    Given the presenter runs a turn whose tool call carries an API key
    And the audit panel is open
    When the presenter expands the tool entry
    Then the API key value is not shown
    And the entry shows a redacted placeholder in its place

  # ── AC-002-5 — Clear between runs ───────────────────────────────────────
  Scenario: Clearing the audit trail empties the panel
    Given the audit panel is open
    And the traveller has exchanged a message with the agent
    When the presenter clears the audit trail
    Then the audit panel shows an empty state
    And the conversation is unchanged

  # ── FR-002-9 — New chat clears the trail ────────────────────────────────
  Scenario: Starting a new chat clears the audit trail
    Given the audit panel is open
    And the traveller has exchanged a message with the agent
    When the traveller starts a new chat
    Then the audit panel shows an empty state

  # ── AC-002-6 — Error entry, not a crash ─────────────────────────────────
  @error
  Scenario: A failed turn renders an error entry and keeps the panel working
    Given the audit panel is open
    When a turn fails partway through
    Then an audit entry with a status of "error" appears
    And the audit panel keeps functioning
