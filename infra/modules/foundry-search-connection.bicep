// INC-8 (ADR-008): attach the Azure AI Search service to the Foundry project as a
// CognitiveSearch connection, so the travel-guide index is visible inside the
// project at ai.azure.com (Management center → Connected resources; the index
// under Data + indexes → Indexes). Entra auth via the project's system-assigned
// identity — which is granted Search Index Data Reader on the service here.
param location string
param accountName string
param projectName string
param connectionName string = 'travel-guide-search'

@description('Endpoint of the AI Search service, e.g. https://<name>.search.windows.net')
param searchEndpoint string
param searchName string
param searchId string

@description('Principal ID of the Foundry project system-assigned identity.')
param projectPrincipalId string

// The connection is a child of the existing account/project (created by foundry.bicep).
resource connection 'Microsoft.CognitiveServices/accounts/projects/connections@2025-04-01-preview' = {
  name: '${accountName}/${projectName}/${connectionName}'
  properties: {
    category: 'CognitiveSearch'
    target: searchEndpoint
    authType: 'AAD'
    isSharedToAll: true
    metadata: {
      ApiType: 'Azure'
      ResourceId: searchId
      Location: location
    }
  }
}

resource search 'Microsoft.Search/searchServices@2024-06-01-preview' existing = {
  name: searchName
}

// The project identity reads the connected index (browse/query from the portal).
var indexDataReaderRoleId = '1407120a-92aa-4202-b7e9-c0e197c71c8f'
resource projectSearchReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: search
  name: guid(searchId, projectPrincipalId, indexDataReaderRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', indexDataReaderRoleId)
    principalId: projectPrincipalId
    principalType: 'ServicePrincipal'
  }
}
