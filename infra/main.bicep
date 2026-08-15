// Waypoint infrastructure (INC-1). Generated to match specs/contracts/infra/resources.yaml.
// Two Azure Container Apps (web + api) on a shared environment, ACR, monitoring,
// and a user-assigned managed identity for ACR pull. Cheap by design:
// scale-to-zero, Basic ACR, capped Log Analytics.
targetScope = 'subscription'

@minLength(1)
@description('Name of the azd environment — used to name the resource group and derive resource names.')
param environmentName string

@minLength(1)
@description('Primary location for all resources.')
param location string

@secure()
@description('GitHub/Copilot service token for the agent (ADR-002, superseded by ADR-005). Kept for the demo; unused while Foundry BYOK is active.')
param copilotGitHubToken string = ''

@secure()
@description('RouteStack sandbox public API key (INC-5). Empty = deterministic offline catalogue fallback.')
param routestackApiKey string = ''

@secure()
@description('RouteStack HMAC signing secret for the partner-token exchange (INC-5).')
param routestackSecret string = ''

@description('Use BYOK → Microsoft Foundry for the agent model (ADR-005). When false, falls back to the GitHub-token path.')
param useFoundry bool = true

@description('Foundry model deployment name (also passed to the SDK as `model`).')
param foundryModelName string = 'gpt-5.4-mini'

@description('Foundry model version to deploy.')
param foundryModelVersion string = '2026-03-17'

var resourceToken = toLower(uniqueString(subscription().id, environmentName, location))
var tags = { 'azd-env-name': environmentName }

resource rg 'Microsoft.Resources/resourceGroups@2023-07-01' = {
  name: 'rg-${environmentName}'
  location: location
  tags: tags
}

module monitoring 'modules/monitoring.bicep' = {
  scope: rg
  name: 'monitoring'
  params: {
    location: location
    tags: tags
    logAnalyticsName: 'log-${resourceToken}'
    applicationInsightsName: 'appi-${resourceToken}'
  }
}

module identity 'modules/identity.bicep' = {
  scope: rg
  name: 'identity'
  params: {
    location: location
    tags: tags
    identityName: 'id-${resourceToken}'
  }
}

module registry 'modules/registry.bicep' = {
  scope: rg
  name: 'registry'
  params: {
    location: location
    tags: tags
    registryName: 'acr${resourceToken}'
    principalId: identity.outputs.principalId
  }
}

module env 'modules/container-apps-environment.bicep' = {
  scope: rg
  name: 'container-apps-env'
  params: {
    location: location
    tags: tags
    name: 'cae-${resourceToken}'
    logAnalyticsName: monitoring.outputs.logAnalyticsName
  }
}

// Microsoft Foundry model for BYOK (ADR-005). Only provisioned when useFoundry.
module foundry 'modules/foundry.bicep' = if (useFoundry) {
  scope: rg
  name: 'foundry'
  params: {
    location: location
    tags: tags
    accountName: 'aif-${resourceToken}'
    modelName: foundryModelName
    modelVersion: foundryModelVersion
    principalId: identity.outputs.principalId
  }
}

// Cosmos DB for the traveller profile (ADR-007). Serverless + keyless; the shared
// user-assigned identity gets data-plane Data Contributor.
module cosmos 'modules/cosmos.bicep' = {
  scope: rg
  name: 'cosmos'
  params: {
    location: location
    tags: tags
    name: 'cosmos-${resourceToken}'
    principalId: identity.outputs.principalId
  }
}

// waypoint-data MCP server (ADR-009). Internal ingress only — reachable by the
// api Container App inside the environment, not from the public internet.
module waypointData 'modules/container-app.bicep' = {
  scope: rg
  name: 'waypoint-data'
  params: {
    location: location
    tags: tags
    name: 'ca-mcp-${resourceToken}'
    serviceName: 'waypoint-data'
    environmentId: env.outputs.id
    registryLoginServer: registry.outputs.loginServer
    identityId: identity.outputs.id
    targetPort: 8081
    cpu: '0.25'
    memory: '0.5Gi'
    external: false
    minReplicas: 1
    maxReplicas: 1
    envVars: [
      {
        name: 'COSMOS_ENDPOINT'
        value: cosmos.outputs.endpoint
      }
      {
        name: 'COSMOS_DATABASE'
        value: 'waypoint'
      }
      {
        name: 'COSMOS_CONTAINER'
        value: 'profiles'
      }
      {
        // Selects the user-assigned identity for DefaultAzureCredential.
        name: 'AZURE_CLIENT_ID'
        value: identity.outputs.clientId
      }
    ]
    secrets: []
  }
}

// ── B1 / ADR-005: BYOK → Foundry with managed identity (this environment disables
//    API keys). No secret to wire — the agent authenticates with Entra. ──
// ── ORIGINAL (ADR-002, swapped out): a GitHub Copilot service token secret. ──
var baseApiSecrets = useFoundry
  ? []
  : (empty(copilotGitHubToken)
      ? []
      : [
          {
            name: 'copilot-github-token'
            value: copilotGitHubToken
          }
        ])

// INC-5: RouteStack sandbox credentials (public key + HMAC secret). Wired only
// when both are set; otherwise the travel-search tool uses the offline catalogue.
var hasRoutestack = !empty(routestackApiKey) && !empty(routestackSecret)
var routestackSecrets = hasRoutestack
  ? [
      {
        name: 'routestack-api-key'
        value: routestackApiKey
      }
      {
        name: 'routestack-secret'
        value: routestackSecret
      }
    ]
  : []

var apiSecrets = concat(baseApiSecrets, routestackSecrets)

var routestackEnv = hasRoutestack
  ? [
      {
        name: 'ROUTESTACK_API_KEY'
        secretRef: 'routestack-api-key'
      }
      {
        name: 'ROUTESTACK_SECRET'
        secretRef: 'routestack-secret'
      }
    ]
  : []

var apiEnv = concat(
  [
    {
      name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
      value: monitoring.outputs.applicationInsightsConnectionString
    }
    {
      // Internal URL of the waypoint-data MCP server (ADR-009).
      name: 'WAYPOINT_DATA_MCP_URL'
      value: '${waypointData.outputs.uri}/mcp'
    }
  ],
  useFoundry
    ? [
        {
          name: 'FOUNDRY_MODEL_URL'
          value: foundry!.outputs.openAiEndpoint
        }
        {
          name: 'FOUNDRY_MODEL'
          value: foundryModelName
        }
        {
          name: 'FOUNDRY_USE_MANAGED_IDENTITY'
          value: 'true'
        }
        {
          // Selects the user-assigned identity for DefaultAzureCredential.
          name: 'AZURE_CLIENT_ID'
          value: identity.outputs.clientId
        }
      ]
    : (empty(copilotGitHubToken)
        ? []
        : [
            {
              name: 'COPILOT_GITHUB_TOKEN'
              secretRef: 'copilot-github-token'
            }
          ]),
  routestackEnv
)

module api 'modules/container-app.bicep' = {
  scope: rg
  name: 'api'
  params: {
    location: location
    tags: tags
    name: 'ca-api-${resourceToken}'
    serviceName: 'api'
    environmentId: env.outputs.id
    registryLoginServer: registry.outputs.loginServer
    identityId: identity.outputs.id
    targetPort: 8080
    cpu: '0.5'
    memory: '1Gi'
    minReplicas: 1
    maxReplicas: 1
    envVars: apiEnv
    secrets: apiSecrets
  }
}

module web 'modules/container-app.bicep' = {
  scope: rg
  name: 'web'
  params: {
    location: location
    tags: tags
    name: 'ca-web-${resourceToken}'
    serviceName: 'web'
    environmentId: env.outputs.id
    registryLoginServer: registry.outputs.loginServer
    identityId: identity.outputs.id
    targetPort: 3000
    cpu: '0.25'
    memory: '0.5Gi'
    envVars: [
      {
        name: 'API_BASE_URL'
        value: api.outputs.uri
      }
    ]
    secrets: []
  }
}

// azd reads these outputs to push images and report endpoints.
output AZURE_LOCATION string = location
output AZURE_RESOURCE_GROUP string = rg.name
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = registry.outputs.loginServer
output AZURE_CONTAINER_REGISTRY_NAME string = registry.outputs.name
output SERVICE_API_ENDPOINT_URL string = api.outputs.uri
output SERVICE_WEB_ENDPOINT_URL string = web.outputs.uri
output COSMOS_ENDPOINT string = cosmos.outputs.endpoint
output APPLICATIONINSIGHTS_CONNECTION_STRING string = monitoring.outputs.applicationInsightsConnectionString
