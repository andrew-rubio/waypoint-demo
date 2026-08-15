Feature: Personalisation via Cosmos DB
  As described in frd-personalisation.md (FRD-006),
  the agent enriches its recommendations using a synthetic traveller profile
  stored in Azure Cosmos DB and retrieved via the self-hosted waypoint-data MCP —
  loyalty status and reward points, past destinations (city + country), and travel
  preferences (aisle seat, vegetarian meal). All data is fictional for one demo
  traveller, "John Doe" (Gold Tier, 7,463 points). Personalisation is explained,
  visible in the audit trail, and degrades gracefully when the store is unavailable.

  Background:
    Given the Traveller is on the Waypoint welcome screen

  @personalisation @happy @smoke
  Scenario: Destination suggestions are personalised from the traveller profile
    When the Traveller asks "Where should I go for a warm coastal break?"
    Then the agent should query Cosmos for the traveller's profile
    And a personalisation note should reference the traveller's Gold Tier status or a past trip
    And the personalisation note should explain why the suggestions were personalised

  @personalisation @happy
  Scenario: The personalisation note reflects the traveller's reward points
    When the Traveller asks "Where should I go for a warm coastal break?"
    Then a personalisation note should mention the traveller's 7,463 reward point balance
    And the reward points balance shown should come from the Cosmos profile, not invented

  @personalisation @happy
  Scenario: Saved preferences are applied when flights are presented
    Given flights and hotels have been shown for a covered destination
    When the agent presents the flight options
    Then a personalisation note should say an aisle seat will be pre-selected
    And the personalisation note should say a vegetarian meal will be pre-selected

  @personalisation @happy
  Scenario: The booking confirmation echoes the assigned seat and meal
    Given flights and hotels have been shown for a covered destination
    When the Traveller books the first flight and hotel
    Then the booking confirmation should state an aisle seat assignment
    And the booking confirmation should note a vegetarian in-flight meal

  @personalisation @happy
  Scenario: The booking confirmation shows reward points earned on the membership
    Given flights and hotels have been shown for a covered destination
    When the Traveller books the first flight and hotel
    Then the booking confirmation should show the reward points earned on this trip
    And it should reference the traveller's saved membership number
    And it should show the updated reward points balance
    And the accrual should be presented as a simulation, not a real reservation

  @personalisation @happy @audit
  Scenario: Cosmos activity is visible in the audit trail
    When the Traveller asks "Where should I go for a warm coastal break?"
    And the Traveller opens the audit trail
    Then the audit trail should contain a successful Cosmos entry of type "mcp"
    And the Cosmos entry should summarise its query and a redacted result
    And no Cosmos credential or secret should appear in the audit trail

  @personalisation @edge
  Scenario: Partial profile data uses only what is available
    Given the traveller's saved preferences are available but the trip history is missing
    When the Traveller asks "Where should I go for a warm coastal break?"
    Then the personalisation note should reference the available preferences
    And the personalisation note should not fabricate any past-destination details

  @personalisation @edge
  Scenario: A live preference overrides the stored preference
    Given the traveller's saved seat preference is an aisle seat
    When the Traveller says "Actually, I'd like a window seat this time"
    Then the personalisation note should apply a window seat
    And the personalisation note should acknowledge it differs from the saved preference

  @personalisation @error
  Scenario: Cosmos unavailable degrades gracefully
    Given the Cosmos profile store will fail
    When the Traveller asks "Where should I go for a warm coastal break?"
    Then the Traveller should see "Personalised data is unavailable right now"
    And the agent should still suggest destinations from the conversation
    And the conversation should remain usable
    And the audit trail should contain an error entry for the Cosmos profile store

  @personalisation @error
  Scenario: Cosmos errors do not block the rest of the reply
    Given the Cosmos profile store will fail
    When the Traveller asks "Where should I go for a warm coastal break?"
    Then no personalisation note should claim to know the traveller's profile
    And the conversation should remain usable
