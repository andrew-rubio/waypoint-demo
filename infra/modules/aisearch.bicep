// Azure AI Search for the travel-guide knowledge base (ADR-008, INC-8). Free tier
// (50 MB, 3 indexes, vector search). RBAC/Entra auth is enabled so the
// waypoint-data MCP reads keyless and the Foundry project connection can browse
// the index; local (key) auth stays on for the one-time ingestion seed.
param location string
param tags object
param name string

@description('Principal ID of the user-assigned managed identity that queries the index (MCP read path).')
param principalId string

@description('Optional principal ID of the deployer/ingestion identity (creates + seeds the index). Empty skips the grant.')
param ingestionPrincipalId string = ''

resource search 'Microsoft.Search/searchServices@2024-06-01-preview' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: 'free'
  }
  properties: {
    replicaCount: 1
    partitionCount: 1
    hostingMode: 'default'
    publicNetworkAccess: 'enabled'
    // RBAC (Entra) for the MCP + Foundry connection; keys remain on for ingestion.
    disableLocalAuth: false
    authOptions: {
      aadOrApiKey: {
        aadAuthFailureMode: 'http403'
      }
    }
    semanticSearch: 'free'
  }
}

// Search Index Data Reader — the waypoint-data MCP queries the index keyless.
var indexDataReaderRoleId = '1407120a-92aa-4202-b7e9-c0e197c71c8f'
resource readerRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: search
  name: guid(search.id, principalId, indexDataReaderRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', indexDataReaderRoleId)
    principalId: principalId
    principalType: 'ServicePrincipal'
  }
}

// Ingestion identity (the deployer) — create the index definition + upload docs.
var indexDataContributorRoleId = '8ebe5a00-799e-43f5-93ac-243d3dce84a7'
var serviceContributorRoleId = '7ca78c08-252a-4471-8644-bb5ff32d4ba0'

resource ingestionDataRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(ingestionPrincipalId)) {
  scope: search
  name: guid(search.id, ingestionPrincipalId, indexDataContributorRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', indexDataContributorRoleId)
    principalId: ingestionPrincipalId
    principalType: 'User'
  }
}

resource ingestionServiceRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(ingestionPrincipalId)) {
  scope: search
  name: guid(search.id, ingestionPrincipalId, serviceContributorRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', serviceContributorRoleId)
    principalId: ingestionPrincipalId
    principalType: 'User'
  }
}

output endpoint string = 'https://${search.name}.search.windows.net'
output name string = search.name
output id string = search.id
