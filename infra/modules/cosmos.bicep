// Azure Cosmos DB for the synthetic traveller profile (ADR-007). Serverless,
// keyless (managed identity data-plane RBAC), one database + container. The
// waypoint-data MCP server reads the profile and seeds it on first run.
param location string
param tags object
param name string
@description('Principal ID of the user-assigned managed identity granted data-plane access.')
param principalId string

// Public access is enabled with a scoped firewall (an org policy that forced it
// off is exempted for this RG). 0.0.0.0 = "Azure datacenters only", which lets
// the Container Apps egress reach Cosmos; the rest are the portal Data Explorer
// ranges. Add a personal IP for Data Explorer via `az cosmosdb update`.
@description('IP firewall allowlist. 0.0.0.0 permits Azure datacenters (Container Apps); the others are the Azure portal Data Explorer ranges.')
param allowedIpRules array = [
  '0.0.0.0'
  '104.42.195.92'
  '40.76.54.131'
  '52.176.6.30'
  '52.169.50.45'
  '52.187.184.26'
]

resource account 'Microsoft.DocumentDB/databaseAccounts@2024-11-15' = {
  name: name
  location: location
  tags: tags
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    // Serverless: pay-per-request, ~£0 at demo scale.
    capabilities: [
      { name: 'EnableServerless' }
    ]
    // Keyless — force Microsoft Entra (managed identity) auth only.
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
    ipRules: [for ip in allowedIpRules: { ipAddressOrRange: ip }]
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    locations: [
      {
        locationName: location
        failoverPriority: 0
      }
    ]
  }
}

resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-11-15' = {
  parent: account
  name: 'waypoint'
  properties: {
    resource: {
      id: 'waypoint'
    }
  }
}

resource container 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = {
  parent: database
  name: 'profiles'
  properties: {
    resource: {
      id: 'profiles'
      partitionKey: {
        paths: [ '/traveller' ]
        kind: 'Hash'
      }
    }
  }
}

// Built-in Cosmos DB Data Contributor (…0002) — read + the one-time seed upsert,
// keyless. Scoped to the account, granted to the shared user-assigned identity.
resource dataContributor 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-11-15' = {
  parent: account
  name: guid(account.id, principalId, 'cosmos-data-contributor')
  properties: {
    roleDefinitionId: '${account.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002'
    principalId: principalId
    scope: account.id
  }
}

output endpoint string = account.properties.documentEndpoint
output accountName string = account.name
