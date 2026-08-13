// Generic Container App used for both web and api. Scale-to-zero, pulls images
// from ACR via the user-assigned managed identity. Tagged with azd-service-name
// so `azd deploy` knows which built image to push here.
param location string
param tags object
param name string
@description('azd service name (matches azure.yaml): "api" or "web".')
param serviceName string
param environmentId string
param registryLoginServer string
param identityId string
@description('Container image. Placeholder until azd deploy pushes the built image.')
param image string = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
param targetPort int
param cpu string
param memory string
param external bool = true
param minReplicas int = 0
param maxReplicas int = 1
param envVars array = []
@description('Secrets as [{ name, value }]. Referenced from envVars via secretRef.')
param secrets array = []

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: name
  location: location
  tags: union(tags, { 'azd-service-name': serviceName })
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identityId}': {}
    }
  }
  properties: {
    managedEnvironmentId: environmentId
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: external
        targetPort: targetPort
        transport: 'auto'
        allowInsecure: false
      }
      registries: [
        {
          server: registryLoginServer
          identity: identityId
        }
      ]
      secrets: [for secret in secrets: {
        name: secret.name
        value: secret.value
      }]
    }
    template: {
      containers: [
        {
          name: serviceName
          image: image
          resources: {
            cpu: json(cpu)
            memory: memory
          }
          env: envVars
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
      }
    }
  }
}

output name string = containerApp.name
output fqdn string = containerApp.properties.configuration.ingress.fqdn
output uri string = 'https://${containerApp.properties.configuration.ingress.fqdn}'
