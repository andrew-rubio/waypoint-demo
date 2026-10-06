@provisioned-model-capacity @frd-011
Feature: Provisioned model capacity with preserved observability
  As described in frd-provisioned-model-capacity.md (FRD-011), a Demo Presenter
  can switch Waypoint from its PAYG GPT-5.4-mini deployment to an hourly Global
  Provisioned deployment without changing the agent or losing Foundry
  observability. PAYG remains available for comparison and rollback.

  @provisioned-model-capacity @happy
  Scenario: PAYG remains the default deployment configuration
    Given the model infrastructure uses its default configuration
    When the planned model deployments are inspected
    Then GPT-5.4-mini uses the PAYG deployment by default
    And the embedding model remains on PAYG

  @provisioned-model-capacity @happy
  Scenario: A PTU configuration plans the approved provisioned capacity
    Given GPT-5.4-mini version "2026-03-17" is selected
    And Global Provisioned is selected with 15 PTUs
    When the planned model deployments are inspected
    Then the plan contains a separate Global Provisioned deployment
    And its capacity is 15 PTUs

  @provisioned-model-capacity @happy @smoke
  Scenario: Provision PTU without replacing PAYG
    Given the GPT-5.4-mini PAYG deployment is healthy
    And the hourly price for 15 PTUs has been approved
    When the Global Provisioned deployment is created
    Then the GPT-5.4-mini PTU deployment is healthy at 15 PTUs
    And the PAYG deployment remains healthy

  @provisioned-model-capacity @happy @smoke
  Scenario: Switch the agent from PAYG to PTU through configuration
    Given the PAYG and PTU deployments are healthy
    And the agent is using the PAYG deployment
    When the presenter selects the PTU deployment
    Then the agent completes the representative holiday-planning conversation
    And the agent implementation, tools, prompts, and identity are unchanged

  @provisioned-model-capacity @happy
  Scenario: PTU preserves Foundry trace correlation
    Given the representative conversation has run against PAYG and PTU
    When the operator inspects Foundry Observability and Application Insights
    Then both runs contain correlated agent, model, and tool spans
    And the PTU run identifies the provisioned deployment

  @provisioned-model-capacity @happy
  Scenario: Operator can observe provisioned utilization
    Given traffic has been sent to the PTU deployment
    When the operator inspects provisioned utilization
    Then utilization data is available for the PTU deployment

  @provisioned-model-capacity @happy
  Scenario: Roll back from PTU to PAYG
    Given the agent is using the healthy PTU deployment
    When the presenter selects the PAYG deployment
    Then the agent completes the representative holiday-planning conversation
    And the PTU deployment remains independently removable

  @provisioned-model-capacity @happy
  Scenario: Hourly cost requires explicit approval
    Given GPT-5.4-mini Global Provisioned is configured for 15 PTUs
    When the Foundry portal displays the hourly price
    Then provisioning waits for explicit presenter approval
    And no Azure Reservation is purchased

  @provisioned-model-capacity @edge-case
  Scenario: PTU quota is below the minimum deployment size
    Given fewer than 15 Global Provisioned PTUs are available in the subscription
    When the presenter prepares the PTU deployment
    Then provisioning is blocked with the required quota
    And the agent remains on PAYG

  @provisioned-model-capacity @edge-case
  Scenario: Live PTU capacity is unavailable
    Given the subscription has sufficient PTU quota
    But fewer than 15 GPT-5.4-mini PTUs are currently deployable
    When the presenter prepares the PTU deployment
    Then provisioning is blocked because live capacity is unavailable
    And the agent remains on PAYG

  @provisioned-model-capacity @error
  Scenario: PTU deployment creation fails
    Given the agent is using the healthy PAYG deployment
    When creation of the PTU deployment fails
    Then the failure is reported explicitly
    And the agent remains on PAYG

  @provisioned-model-capacity @edge-case
  Scenario: PTU throttling is captured for comparison
    Given the agent is using the PTU deployment
    When the representative workload receives a throttled response
    Then the throttled response is recorded in the comparison results
    And the provisioned utilization for that period is retained

  @provisioned-model-capacity @edge-case
  Scenario: Telemetry ingestion is delayed
    Given the representative PTU conversation has completed
    But its trace has not appeared yet
    When observability verification runs
    Then verification waits for the configured telemetry delay
    And does not report observability success prematurely

  @provisioned-model-capacity @happy
  Scenario: Delete the PTU deployment after the demonstration
    Given the agent has been switched back to PAYG
    And the PTU deployment is no longer required
    When the operator performs the approved cleanup
    Then the PTU deployment is deleted
    And the PAYG deployment remains healthy

  @provisioned-model-capacity @error
  Scenario: Invalid deployment configuration is rejected
    Given an unsupported model version or deployment type is configured
    When the model infrastructure is validated
    Then validation fails with the invalid configuration identified
    And no model deployment is changed

  @provisioned-model-capacity @error
  Scenario: An unhealthy PTU deployment is not selected
    Given the PTU deployment was created but fails its health check
    When the presenter attempts to select it
    Then the selection is blocked
    And the agent remains on PAYG

  @provisioned-model-capacity @error
  Scenario: Missing trace correlation blocks verification
    Given the representative PTU conversation has completed
    And its telemetry ingestion delay has elapsed
    When the operator cannot correlate its agent, model, and tool spans
    Then the observability verification fails
    And the PTU demonstration is not marked complete

