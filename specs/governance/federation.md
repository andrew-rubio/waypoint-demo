# Portability & federated operating model (narrative)

> How this repository would participate in a federated IAG factory model. This is an
> architectural description, not an implemented capability. No full runtime portability is
> promised; complete agents are not claimed to be copyable unchanged across clouds.

## Future shape

- **Central standards & controls** are versioned **outside** the application repository. The
  synthetic `specs/governance/controls.yaml` here stands in for that central catalogue.
- **Application repos pin a policy + selector version** (as this repo pins the catalogue
  version and the `@waypoint/governance` engine version) so control selection is
  reproducible and auditable.
- **Reusable components** — skills, MCP servers, evaluation datasets, control schemas, and
  shared workflow components (see `reuse-inventory.yaml`) — can be consumed across Operating
  Companies through open interfaces.
- **Runtime hosting may differ** by Operating Company (Azure Container Apps, Foundry Agent
  Service, other). The harness integration + deployment configuration are the
  runtime-specific seams.
- **Telemetry and evidence export** through standard interfaces (OpenTelemetry GenAI spans,
  the evidence manifest + release decision schemas) so a central evidence index could
  aggregate them.
- **The application repository retains** proposition-specific contracts, approvals, and
  evidence references, linking to authoritative central services rather than duplicating them.

## Structural extraction demonstrated now

The `@waypoint/governance` package loads its catalogue **by path**, so the policy source is
already decoupled from the engine. Extracting the engine to a shared package, or the
catalogue to a central policy repository, is a packaging change — not a rewrite — because
the interface (`loadCatalogue` → `selectControls` → `buildControlContract` → `verifyRelease`)
is stable and data-agnostic.

## Not claimed

Central Group policy repository · Group-wide control-selection service · cross-Operating-
Company deployment · full cross-cloud runtime portability of complete agents · Durable
Functions multi-day orchestration · enterprise identity-backed approvals · full proposition
cost allocation · a central factory control-plane UI · automatic cross-provider model
rerouting.
