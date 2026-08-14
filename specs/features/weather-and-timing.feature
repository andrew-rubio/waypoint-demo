Feature: Weather & best-time-to-travel
  As described in frd-weather-and-timing.md (FRD-004),
  travellers receive grounded weather guidance — monthly climate for a place and
  the best (and worst) months to travel — drawn from the Open-Meteo MCP and never
  fabricated. Every Open-Meteo call is visible in the audit trail.

  Background:
    Given the Traveller is on the Waypoint welcome screen

  @weather @happy @smoke
  Scenario: Monthly weather for a destination
    When the Traveller asks "What's the weather like in Lisbon in June?"
    Then a weather summary should name the resolved destination "Lisbon, Portugal"
    And the weather summary should report June daily temperatures in °C and precipitation in mm
    And the weather summary should cite Open-Meteo as the source

  @weather @happy
  Scenario: Best time to visit a destination
    When the Traveller asks "When's the best time to visit Iceland?"
    Then the weather summary should recommend one or more months, each with a reason
    And the weather summary should list one or more months to avoid, each with a reason
    And the weather summary should cite Open-Meteo as the source

  @weather @happy
  Scenario: Weather guidance is grounded in Open-Meteo data
    When the Traveller asks "What's the weather like in Lisbon in June?"
    And the Traveller opens the audit trail
    Then the audit trail should contain a successful Open-Meteo geocoding entry
    And the audit trail should contain a successful Open-Meteo climate entry
    And the reported figures should come from the Open-Meteo response, not invented

  @weather @edge
  Scenario: Unknown place cannot be located
    When the Traveller asks "What's the weather like in Wakanda?"
    Then the agent should say it could not locate the place
    And the agent should ask for a real destination
    And no weather summary should be shown

  @weather @edge
  Scenario: An ambiguous place name asks the Traveller to choose
    When the Traveller asks "What's the weather like in Springfield?"
    Then the agent should offer candidate places to choose from
    And no weather summary should be shown

  @weather @edge
  Scenario: No climate data for an open-ocean point is reported, not guessed
    When the Traveller asks "What's the typical weather at Point Nemo in the South Pacific?"
    Then the agent should explain that climate data is not available for that point
    And no fabricated temperature or precipitation figures should be shown
    And no weather summary should be shown

  @weather @error
  Scenario: Weather service failure degrades gracefully
    Given the Open-Meteo weather service will fail
    When the Traveller asks "What's the weather like in Lisbon in June?"
    Then the Traveller should see "Weather data is unavailable right now"
    And the conversation should remain usable
    And the audit trail should contain an error entry for the Open-Meteo service

  @weather @happy
  Scenario: Weather activity is visible in the audit trail
    When the Traveller asks "When's the best time to visit Iceland?"
    And the Traveller opens the audit trail
    Then the audit trail should contain a successful Open-Meteo geocoding entry
    And the Open-Meteo geocoding entry should summarise its request and response
