Feature: Destination advice
  As described in frd-destination-advice.md (FRD-003, reworked for INC-8),
  travellers receive month-aware, guide-grounded, personalised destination
  suggestions. Recommendations are drawn from a travel-guide knowledge base
  (Azure AI Search) via the travel-guide.searchByMonth MCP tool and personalised
  from the Cosmos profile via cosmos.getTravellerProfile — two real MCP calls the
  agent reasons over. Both are visible in the audit trail. See ADR-008, ADR-009.

  Background:
    Given the Traveller is on the Waypoint welcome screen

  @destination-advice @happy @smoke
  Scenario: A month produces month-aware, guide-grounded, personalised suggestions
    When the Traveller asks "Where should I go in June?"
    Then a destination list should contain between 3 and 5 ranked suggestions
    And the suggestions should be grounded in the travel guide
    And the suggestions should reflect the Traveller's saved preferences
    And the suggestions should avoid the Traveller's recently visited destinations
    And every destination should include descriptive tags

  @destination-advice @happy
  Scenario: The guide and the profile are both fetched and shown in the audit trail
    When the Traveller asks "Where should I go in June?"
    And the Traveller opens the audit trail
    Then the audit trail should contain a successful travel-guide search entry
    And the audit trail should contain a successful Cosmos entry of type "mcp"
    And the audit trail should contain a successful skill entry named "destination-advisor"
    And the travel-guide search entry should summarise the requested month and result

  @destination-advice @edge
  Scenario: Suggestions avoid places the Traveller has recently visited
    When the Traveller asks "Where should I go in June?"
    Then a destination list should contain between 3 and 5 ranked suggestions
    And no suggestion should be one of the Traveller's recently visited destinations

  @destination-advice @edge
  Scenario: A month with no strong guide match falls back to preferences
    Given the travel guide has no strong match for the request
    When the Traveller asks "Where should I go in February?"
    Then the agent should say the travel guide had no strong match
    And the agent should still suggest destinations based on the Traveller's preferences
    And the audit trail should contain a successful travel-guide search entry

  @destination-advice @happy
  Scenario: Interests produce a ranked shortlist
    When the Traveller asks for destinations with "warm weather, hiking, and good seafood"
    Then a destination list should contain between 3 and 5 ranked suggestions
    And every destination should have a rationale tied to the Traveller's interests
    And every destination should include descriptive tags

  @destination-advice @edge
  Scenario: Vague input triggers one focused clarifying question
    When the Traveller asks to "recommend somewhere"
    Then the agent should ask exactly one focused travel-preference question
    And no destination list should be shown

  @destination-advice @happy
  Scenario: A follow-up refines the previous shortlist
    Given the Traveller received a destination list for "warm weather, hiking, and good seafood"
    When the Traveller asks for options that are "cheaper and more beach-focused"
    Then the destination list should be updated
    And the updated suggestions should reflect affordability and beach access

  @destination-advice @happy
  Scenario: Suggestions use downstream-ready canonical place names
    When the Traveller asks for destinations with "warm weather, hiking, and good seafood"
    Then every suggested destination should include a city or region and country
    When the Traveller chooses the first destination
    Then the chosen destination should retain its canonical place name

  @destination-advice @edge
  Scenario: Contradictory interests are acknowledged
    When the Traveller asks for "hot weather and snowy beaches"
    Then the agent should acknowledge the conflicting interests
    And the agent should offer options for each interpretation

  @destination-advice @edge
  Scenario: A niche request has no strong match
    When the Traveller asks for a destination with "midnight sun, tropical coral reefs, and nearby ski slopes"
    Then the agent should explain that there is no strong match
    And the agent should suggest the closest alternatives

  @destination-advice @edge
  Scenario: Non-travel input is redirected to trip planning
    When the Traveller asks "Can you review my tax return?"
    Then the agent should gently steer the conversation back to trip planning
    And no destination list should be shown

  @destination-advice @error
  Scenario: Destination advice fails without crashing the conversation
    Given the destination advisor will fail
    When the Traveller asks for destinations with "warm weather and hiking"
    Then the Traveller should see "I couldn't work that out — could you rephrase?"
    And the conversation should remain usable
    And the audit trail should contain an error entry for the destination advisor