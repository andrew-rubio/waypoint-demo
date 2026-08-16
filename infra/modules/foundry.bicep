// Microsoft Foundry (v2) resource for the agent (ADR-005, B1 / BYOK).
// A Foundry v2 account is an AI Services account (kind: AIServices) with project
// management enabled + a project child — this opens the new ai.azure.com (v2)
// experience, unlike a plain kind: OpenAI account (classic/v1). Model deployments
// live on the account; the agent authenticates with the Container App's managed
// identity (this environment disables API keys).

@description('Primary location for the Foundry resource.')
param location string

@description('Resource tags.')
param tags object

@description('Name of the Foundry (AI Services) account.')
param accountName string

@description('Name of the Foundry project (v2).')
param projectName string = 'waypoint'

@description('Model deployment name (also passed to the SDK as `model`).')
param modelName string

@description('Model family/format.')
param modelFormat string = 'OpenAI'

@description('Model version to deploy.')
param modelVersion string

@description('Deployment capacity (thousands of tokens/min). Must fit regional quota.')
param capacity int = 20

@description('Embedding model deployment name (INC-8, ADR-008) — embeds the travel-guide guide.')
param embeddingModelName string = 'text-embedding-3-small'

@description('Embedding model version.')
param embeddingModelVersion string = '1'

@description('Embedding deployment capacity (thousands of tokens/min).')
param embeddingCapacity int = 20

@description('Principal ID of the managed identity to grant model-inference access (Entra auth).')
param principalId string

@description('Optional principal ID of the deployer running guide ingestion (embeds via the embedding deployment). Empty skips the grant.')
param ingestionPrincipalId string = ''

resource account 'Microsoft.CognitiveServices/accounts@2025-04-01-preview' = {
  name: accountName
  location: location
  tags: tags
  kind: 'AIServices'
  sku: {
    name: 'S0'
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    // Custom subdomain gives the *.openai.azure.com endpoint the SDK expects.
    customSubDomainName: accountName
    publicNetworkAccess: 'Enabled'
    // allowProjectManagement + a project child = the Foundry v2 experience.
    allowProjectManagement: true
    // Policy disables local auth; the agent uses Entra (managed identity) anyway.
    disableLocalAuth: true
  }
}

resource project 'Microsoft.CognitiveServices/accounts/projects@2025-04-01-preview' = {
  parent: account
  name: projectName
  location: location
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    displayName: projectName
    description: 'Waypoint holiday-planning agent'
  }
  // Serialize child ops: the account rejects concurrent deployment + project writes.
  dependsOn: [
    deployment
    embeddingDeployment
  ]
}

resource deployment 'Microsoft.CognitiveServices/accounts/deployments@2025-04-01-preview' = {
  parent: account
  name: modelName
  sku: {
    name: 'GlobalStandard'
    capacity: capacity
  }
  properties: {
    model: {
      format: modelFormat
      name: modelName
      version: modelVersion
    }
  }
}

// INC-8 (ADR-008): embedding deployment that vectorises the travel-guide guide
// into Azure AI Search. Serialized after the chat model — the account rejects
// concurrent deployment writes.
resource embeddingDeployment 'Microsoft.CognitiveServices/accounts/deployments@2025-04-01-preview' = {
  parent: account
  name: embeddingModelName
  sku: {
    name: 'GlobalStandard'
    capacity: embeddingCapacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: embeddingModelName
      version: embeddingModelVersion
    }
  }
  dependsOn: [
    deployment
  ]
}

// Grant the Container App's managed identity data-plane inference access. This
// environment disables API keys (local auth), so the agent authenticates with Entra.
var openAiUserRoleId = '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd' // Cognitive Services OpenAI User

resource inferenceRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: account
  name: guid(account.id, principalId, openAiUserRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', openAiUserRoleId)
    principalId: principalId
    principalType: 'ServicePrincipal'
  }
}

// INC-8: the deployer running guide ingestion embeds via the embedding deployment.
resource ingestionInferenceRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(ingestionPrincipalId)) {
  scope: account
  name: guid(account.id, ingestionPrincipalId, openAiUserRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', openAiUserRoleId)
    principalId: ingestionPrincipalId
    principalType: 'User'
  }
}

// OpenAI-compatible inference endpoint (BYOK `baseUrl`). Built from the custom
// subdomain so it's stable regardless of which endpoint `properties` reports.
output openAiEndpoint string = 'https://${accountName}.openai.azure.com/openai/v1/'
output accountName string = account.name
output accountId string = account.id
output projectName string = project.name
output projectPrincipalId string = project.identity.principalId
output embeddingDeploymentName string = embeddingDeployment.name
