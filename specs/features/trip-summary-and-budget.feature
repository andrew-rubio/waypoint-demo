Feature: Trip summary, budget & currency
  As described in frd-trip-summary-and-budget.md (FRD-007),
  once a destination, dates, a flight and a hotel are chosen, the agent assembles a
  readable trip summary with a budget breakdown. Prices are shown in GBP by default,
  with an option to convert to EUR via the Currency service (rate + timestamp recorded
  in the audit trail). The summary reflects the traveller's applied preferences (aisle
  seat, vegetarian meal) and reward points balance from the Cosmos profile (FRD-006),
  and degrades gracefully when currency conversion or personalisation is unavailable.

  Background:
    Given the Traveller is on the Waypoint welcome screen

  @summary @happy @smoke
  Scenario: The trip summary card shows the itinerary and budget in GBP
    Given flights and hotels have been shown for a covered destination
    When the Traveller asks "Can you summarise the trip and total cost?"
    Then a trip summary card should show the destination and travel dates
    And it should show the selected flight and hotel
    And it should show the party size, number of nights and room count
    And it should show the flight and hotel budget line items
    And it should show an estimated total in GBP
    And the estimated total should equal the flight and hotel line items combined

  @summary @happy @smoke
  Scenario: The trip summary appears automatically when a booking completes
    Given flights and hotels have been shown for a covered destination
    When the Traveller books the first flight and hotel
    Then a trip summary card should show the destination and travel dates
    And the booking confirmation should be shown below the trip summary

  @summary @happy
  Scenario: The estimated total is labelled as excluding unspecified taxes and fees
    Given flights and hotels have been shown for a covered destination
    When the Traveller asks "Can you summarise the trip and total cost?"
    Then the estimated total should be labelled as excluding unspecified taxes and fees

  @summary @happy
  Scenario: The summary shows the applied preferences and reward points balance
    Given flights and hotels have been shown for a covered destination
    When the Traveller asks "Can you summarise the trip and total cost?"
    Then the summary should note the aisle seat and vegetarian meal are pre-selected
    And the summary should show the traveller's 7,463 reward point balance

  @summary @happy @audit
  Scenario: The summariser and budget estimator are visible in the audit trail
    Given flights and hotels have been shown for a covered destination
    When the Traveller asks "Can you summarise the trip and total cost?"
    And the Traveller opens the audit trail
    Then the audit trail should contain a successful skill entry named "trip-summariser"
    And the audit trail should contain a successful skill entry named "budget-estimator"

  @summary @currency @happy
  Scenario: The total can be shown in euros on request
    Given a trip summary with a GBP total has been shown
    When the Traveller says "show that in euros"
    Then the summary should show the total in EUR alongside the GBP total
    And the agent should call the currency service to convert GBP to EUR

  @summary @currency @happy @audit
  Scenario: The exchange rate and timestamp are visible in the audit trail
    Given a trip summary with a GBP total has been shown
    When the Traveller says "show that in euros"
    And the Traveller opens the audit trail
    Then the audit trail should contain a successful currency conversion entry
    And the currency conversion entry should record the exchange rate and a rate timestamp

  @summary @edge
  Scenario: A partial selection summarises what is chosen and notes what is missing
    Given a flight has been selected but no hotel
    When the Traveller asks "Can you summarise the trip so far?"
    Then the summary should show the selected flight and the total so far
    And it should note that no hotel is selected

  @summary @edge
  Scenario: There is nothing to summarise before any planning
    When the Traveller asks "Can you summarise my trip?"
    Then the agent should explain there is nothing to summarise yet
    And it should prompt the Traveller to choose a destination, flight and hotel

  @summary @currency @degraded
  Scenario: Currency conversion failure falls back to GBP
    Given a trip summary with a GBP total has been shown
    And the currency service is unavailable
    When the Traveller says "show that in euros"
    Then the summary should remain in GBP
    And the agent should note that conversion to EUR is unavailable
    And the audit trail should contain an error entry for the currency service

  @summary @degraded
  Scenario: The summary omits preferences and points when personalisation is unavailable
    Given the Cosmos profile store is unavailable
    And flights and hotels have been shown for a covered destination
    When the Traveller asks "Can you summarise the trip and total cost?"
    Then the summary should still show the itinerary and estimated total
    And it should not show a pre-selected seat or meal
    And it should note that personalisation is unavailable
