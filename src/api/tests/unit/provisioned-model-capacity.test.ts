import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function repositoryFile(path: string): string {
  return readFileSync(resolve(import.meta.dirname, '../../../../', path), 'utf8');
}

describe('Provisioned model capacity infrastructure (FRD-011)', () => {
  const main = repositoryFile('infra/main.bicep');
  const foundry = repositoryFile('infra/modules/foundry.bicep');
  const hostedAgent = repositoryFile('foundry/azure.yaml');

  it('keeps GlobalStandard as the default chat deployment SKU', () => {
    expect(main).toContain("param foundryModelDeploymentSku string = 'GlobalStandard'");
    expect(foundry).toContain('name: modelDeploymentSku');
  });

  it('declares a separately named Global Provisioned deployment', () => {
    expect(main).toContain("param foundryPtuModelName string = 'gpt-5.4-mini-ptu'");
    expect(foundry).toContain("name: 'GlobalProvisionedManaged'");
    expect(foundry).toContain('resource provisionedDeployment');
  });

  it('uses GPT-5.4-mini version 2026-03-17 at the 15 PTU minimum', () => {
    expect(main).toContain("param foundryModelName string = 'gpt-5.4-mini'");
    expect(main).toContain("param foundryModelVersion string = '2026-03-17'");
    expect(main).toContain('param foundryPtuCapacity int = 15');
    expect(foundry).toContain('capacity: provisionedCapacity');
  });

  it('can omit the billable PTU deployment while retaining PAYG', () => {
    expect(main).toContain('param deployFoundryPtu bool = false');
    expect(foundry).toContain('if (deployProvisionedModel)');
    expect(foundry).toMatch(/resource deployment[\s\S]*?name:\s*modelName/);
  });

  it('keeps the embedding deployment on GlobalStandard', () => {
    expect(foundry).toContain('resource provisionedDeployment');
    expect(foundry).toMatch(/embeddingDeployment[\s\S]*?name:\s*'GlobalStandard'/);
  });

  it('selects PAYG or PTU by deployment name without changing the endpoint', () => {
    expect(main).toContain('param useFoundryPtu bool = false');
    expect(main).toContain('var activeFoundryModelName');
    expect(main).toContain('value: activeFoundryModelName');
    expect(main).toContain('value: foundry!.outputs.openAiEndpoint');
  });

  it('exports both deployment names for verification and rollback', () => {
    expect(foundry).toContain('output paygDeploymentName');
    expect(foundry).toContain('output ptuDeploymentName');
    expect(main).toContain('output FOUNDRY_PAYG_DEPLOYMENT');
    expect(main).toContain('output FOUNDRY_PTU_DEPLOYMENT');
  });

  it('does not let the hosted-agent definition create a conflicting PAYG deployment', () => {
    expect(hostedAgent).not.toMatch(/^\s+deployments:\s*$/m);
    expect(hostedAgent).toContain('AZURE_AI_MODEL_DEPLOYMENT_NAME');
  });
});

