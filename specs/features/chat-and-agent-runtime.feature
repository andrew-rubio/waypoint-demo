@chat @inc-1 @frd-001
Feature: Conversational Chat & Agent Runtime
  As described in frd-chat-and-agent-runtime.md (FRD-001), a traveller can talk to
  the Waypoint holiday-planning agent and receive streamed replies. This is the
  walking skeleton: the agent replies conversationally (no travel tools yet), the
  conversation is kept per session, a New chat control resets the session, and the
  logo returns to the home screen.

  Background:
    Given the traveller has opened Waypoint

  # ── AC-001-1 — Send and stream (happy path) ─────────────────────────────
  @smoke
  Scenario: Traveller sends a message and receives a streamed reply
    Given the chat is on the welcome screen
    When the traveller sends "Hi, I want to plan a holiday"
    Then their message appears in the conversation
    And an assistant reply appears and fills in progressively
    And the reply finishes completely

  # ── AC-001-2 — Empty message rejected ───────────────────────────────────
  Scenario: The send control is disabled when there is nothing to send
    Given the chat is on the welcome screen
    When the message box is empty
    Then the send control is disabled

  @error
  Scenario: A whitespace-only message is not sent
    Given the chat is on the welcome screen
    When the traveller tries to send a message containing only spaces
    Then no message is added to the conversation
    And no reply is generated

  # ── AC-001-3 — Conversation ordering ────────────────────────────────────
  Scenario: Messages appear in the order they were sent
    Given the traveller has already exchanged two messages with the agent
    When the traveller sends "What about somewhere sunny?"
    Then all messages appear in the order they were sent
    And the traveller's messages and the agent's replies are visually distinct

  # ── Composer behaviour (FR-001-2) ───────────────────────────────────────
  Scenario: Enter sends the message
    Given the traveller has typed "Somewhere warm please"
    When the traveller presses Enter
    Then the message is sent

  Scenario: Shift and Enter inserts a new line instead of sending
    Given the traveller has typed "Line one"
    When the traveller presses Shift and Enter
    Then a new line is added to the message box
    And the message is not sent

  # ── AC-001-4 — Observable decision before the reply, no hidden reasoning ─
  Scenario: The agent records an observable decision before it starts replying
    Given the chat is on the welcome screen
    When the traveller sends "Where should I go?"
    Then the agent records at least one observable decision before the reply text begins
    And the recorded activity contains no hidden model reasoning

  # ── AC-001-5 — Mid-stream error surfaced ────────────────────────────────
  @error
  Scenario: A failure during the reply is shown without losing the conversation
    Given the traveller has sent a message and the agent has started replying
    When the agent's reply fails partway through
    Then the traveller sees a non-blocking error notice
    And the earlier messages remain in the conversation

  # ── AC-001-6 — New chat resets the session ──────────────────────────────
  Scenario: Starting a new chat clears the conversation
    Given the traveller has an ongoing conversation with several messages
    When the traveller starts a new chat
    Then the conversation is cleared
    And the welcome screen is shown again
    And the next message begins a fresh session

  # ── FR-001-12 — Logo returns home ───────────────────────────────────────
  Scenario: Selecting the logo returns to the home screen
    Given the traveller is in an ongoing conversation
    When the traveller selects the Waypoint logo
    Then the home screen is shown

  # ── Edge cases (FRD-001 Edge Cases table) ───────────────────────────────
  @edge-case
  Scenario: A second message cannot be sent while the agent is still replying
    Given the traveller has sent a message and the agent is still replying
    When the traveller tries to send another message
    Then the send control is unavailable until the current reply finishes

  @edge-case
  Scenario: A very long message is accepted and the traveller is told if it was shortened
    Given the chat is on the welcome screen
    When the traveller sends a message longer than four thousand characters
    Then the message is accepted
    And the traveller is told if the message was shortened for the agent

  @edge-case
  Scenario: Refreshing the browser starts a fresh session
    Given the traveller has an ongoing conversation
    When the traveller refreshes the browser
    Then a new empty conversation is shown

  @edge-case
  Scenario: A dropped connection preserves the partial reply
    Given the agent is in the middle of replying
    When the connection is lost
    Then the traveller is told the connection was lost
    And the partial reply so far remains visible

  @edge-case
  Scenario: Starting a new chat while the agent is replying cancels the reply
    Given the agent is in the middle of replying
    When the traveller starts a new chat
    Then the in-progress reply is cancelled
    And a fresh conversation is shown

  # ── Error handling (FRD-001 Error Handling table) ───────────────────────
  @error
  Scenario: The agent is unavailable
    Given the agent runtime cannot start
    When the traveller sends "Plan me a trip"
    Then the traveller sees a message that the agent is unavailable
    And the traveller is invited to try again

  @error
  Scenario: The model is unavailable or the credential is invalid
    Given the agent cannot reach a model
    When the traveller sends "Plan me a trip"
    Then the traveller sees a non-blocking error notice
    And the earlier messages remain in the conversation

  @error
  Scenario: The agent takes too long to respond
    Given the agent does not respond within the allowed time
    When the traveller sends "Plan me a trip"
    Then the reply attempt stops
    And the traveller sees a timeout notice and can resend
