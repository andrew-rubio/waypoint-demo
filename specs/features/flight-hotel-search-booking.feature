Feature: Flight & hotel search + simulated booking
  As described in frd-flight-hotel-search-booking.md (FRD-005),
  once a destination is chosen the Traveller can search live flights and hotels
  via the RouteStack sandbox, see up to three clear options each with prices
  normalised to GBP, and "book" a selection to receive a clearly-simulated
  confirmation. No payment is ever taken. Every RouteStack call, currency
  conversion, and the booking simulation are visible in the audit trail.

  Background:
    Given the Traveller is on the Waypoint welcome screen

  @flights-hotels @happy @smoke
  Scenario: Search returns flight and hotel options in GBP
    Given the Traveller has chosen "Lisbon" with valid dates and a party of 2 departing from London
    When the Traveller asks to find flights and hotels
    Then a flight options list should contain between 1 and 3 options
    And every flight option should show its airline, route, duration, stops, and a price in GBP
    And a hotel options list should contain between 1 and 3 options
    And every hotel option should show its name, rating, and nightly rate in GBP
    And any taxes or fees inclusion should be labelled

  @flights-hotels @happy
  Scenario: A best option is indicated where available
    Given the Traveller has chosen "Lisbon" with valid dates and a party of 2 departing from London
    When the Traveller asks to find flights and hotels
    Then at most one flight option should be marked as the best choice
    And at most one hotel option should be marked as the best choice

  @flights-hotels @happy
  Scenario: Supplier prices are normalised to GBP through the currency service
    Given the Traveller has chosen "Lisbon" with valid dates and a party of 2 departing from London
    And the flight supplier quotes prices in EUR
    When the Traveller asks to find flights and hotels
    Then every displayed price should be shown in GBP
    And the Traveller opens the audit trail
    Then the audit trail should contain a successful currency conversion entry
    And the currency conversion entry should record the exchange rate and a rate timestamp

  @flights-hotels @edge
  Scenario: Missing departure city is requested before searching
    Given the Traveller has chosen "Lisbon" with valid dates and a party of 2 and no known departure city
    When the Traveller asks to find flights and hotels
    Then the agent should ask for the departure city
    And no flight options list should be shown
    And no hotel options list should be shown

  @flights-hotels @happy @smoke
  Scenario: Selecting options produces a clearly-simulated booking confirmation
    Given the Traveller has been shown flight and hotel options for Lisbon
    When the Traveller says "book the first flight and the first hotel"
    Then a booking confirmation should be shown with a reference code
    And the booking confirmation should echo the chosen flight and hotel itinerary
    And the booking confirmation should be clearly marked as a demo simulation
    And no payment should be taken

  @flights-hotels @edge
  Scenario: No availability for the chosen criteria
    Given the Traveller has chosen a destination and dates with no available inventory in the sandbox
    When the Traveller asks to find flights and hotels
    Then the agent should explain that there is no availability
    And the agent should suggest adjusting the dates or destination
    And no flight options list should be shown

  @flights-hotels @edge
  Scenario: Past travel dates are rejected
    Given the Traveller has chosen "Lisbon" departing from London with dates in the past
    When the Traveller asks to find flights and hotels
    Then the agent should flag that the dates are not valid
    And the agent should ask for valid travel dates
    And no flight options list should be shown

  @flights-hotels @edge
  Scenario: A return date before the outbound date is corrected
    Given the Traveller has chosen "Lisbon" departing from London with a return date before the outbound date
    When the Traveller asks to find flights and hotels
    Then the agent should point out that the return is before the outbound date
    And the agent should ask the Traveller to correct the dates
    And no flight options list should be shown

  @flights-hotels @edge
  Scenario: A destination outside sandbox coverage is explained
    Given the Traveller has chosen a destination that the sandbox does not cover
    When the Traveller asks to find flights and hotels
    Then the agent should explain that demo coverage is limited
    And the agent should suggest a covered city

  @flights-hotels @edge
  Scenario: An unusually large party size is clarified before searching
    Given the Traveller has chosen "Lisbon" departing from London with valid dates and a party of 20
    When the Traveller asks to find flights and hotels
    Then the agent should clarify or cap the party size
    And the agent should continue with a supported party size

  @flights-hotels @error
  Scenario: Travel search service failure degrades gracefully
    Given the RouteStack travel search service will fail
    When the Traveller asks to find flights and hotels for Lisbon
    Then the Traveller should see "Travel search is unavailable right now"
    And the conversation should remain usable
    And the audit trail should contain an error entry for the RouteStack service

  @flights-hotels @error
  Scenario: Sandbox search quota reached
    Given the RouteStack sandbox search quota has been reached
    When the Traveller asks to find flights and hotels for Lisbon
    Then the Traveller should see "Search quota reached for the demo"
    And the search should not be retried

  @flights-hotels @error
  Scenario: Booking simulation failure issues no confirmation
    Given the Traveller has been shown flight and hotel options for Lisbon
    And the booking simulation will fail
    When the Traveller says "book the first flight and the first hotel"
    Then the Traveller should see "Couldn't complete the (simulated) booking"
    And no booking confirmation should be shown
    And the audit trail should contain an error entry for the booking simulation

  @flights-hotels @happy
  Scenario: Travel search activity is visible in the audit trail
    Given the Traveller has chosen "Lisbon" with valid dates and a party of 2 departing from London
    When the Traveller asks to find flights and hotels
    And the Traveller opens the audit trail
    Then the audit trail should contain a successful RouteStack flight search entry
    And the audit trail should contain a successful RouteStack hotel search entry
    And each RouteStack entry should summarise its request and response
