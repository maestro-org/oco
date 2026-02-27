import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import YAML from 'yaml';
import {
  generateKubernetesManifest,
  kubernetesManifestPath,
  resolveKubernetesTarget,
  runKubernetesAction,
} from '../src/kubernetes';
import { InstanceContext } from '../src/types';

describe('kubernetes', () => {
  test('generateKubernetesManifest writes deployment, service, and configmap', () => {
    const root = mkdtempSync(join(tmpdir(), 'oco-k8s-'));
    try {
      const context: InstanceContext = {
        id: 'core',
        inventoryPath: join(root, 'inventory', 'instances.yaml'),
        inventoryDir: join(root, 'inventory'),
        generatedDir: join(root, '.generated', 'core'),
        configDir: join(root, 'instances', 'core', 'config'),
        stateDir: join(root, 'instances', 'core', 'state'),
        workspaceRoot: join(root, 'instances', 'core', 'workspaces'),
        gatewayPort: 19789,
        gatewayBind: '127.0.0.1',
      };

      mkdirSync(context.configDir, { recursive: true });
      mkdirSync(context.generatedDir, { recursive: true });
      const configPath = join(context.configDir, 'openclaw.json5');
      writeFileSync(configPath, '{ gateway: { bind: "127.0.0.1" } }\n', 'utf-8');

      const inventory: Record<string, unknown> = {
        version: 1,
        organization: {
          deployment: {
            provider: 'kubernetes',
            kubernetes: {
              namespace: 'agents',
            },
          },
        },
      };

      const instance: Record<string, unknown> = {
        id: 'core',
        openclaw: {
          docker: {
            image: 'ghcr.io/openclaw/openclaw:latest',
          },
          kubernetes: {
            deployment_name: 'openclaw-core',
            service_name: 'openclaw-core',
            replicas: 2,
            service_type: 'NodePort',
            node_port: 30080,
            command: ['gateway', 'start'],
          },
        },
      };

      const manifestPath = generateKubernetesManifest(inventory, instance, context, configPath);
      expect(existsSync(manifestPath)).toBe(true);
      expect(manifestPath).toBe(kubernetesManifestPath(context));

      const docs = YAML.parseAllDocuments(readFileSync(manifestPath, 'utf-8')).map((doc) => {
        const json = doc.toJSON();
        return (json ?? {}) as Record<string, unknown>;
      });

      const kinds = docs.map((doc) => doc.kind);
      expect(kinds).toContain('Namespace');
      expect(kinds).toContain('ConfigMap');
      expect(kinds).toContain('Deployment');
      expect(kinds).toContain('Service');

      const deployment = docs.find((doc) => doc.kind === 'Deployment') as Record<string, unknown>;
      const deploymentSpec = deployment.spec as Record<string, unknown>;
      const template = (deploymentSpec.template as Record<string, unknown>).spec as Record<string, unknown>;
      const container = (template.containers as Array<Record<string, unknown>>)[0];
      const env = container.env as Array<Record<string, unknown>>;
      const envKeys = env.map((entry) => String(entry.name));

      expect(container.image).toBe('ghcr.io/openclaw/openclaw:latest');
      expect(deployment.metadata && (deployment.metadata as Record<string, unknown>).namespace).toBe('agents');
      expect(envKeys).toContain('OPENCLAW_CONFIG_PATH');

      const service = docs.find((doc) => doc.kind === 'Service') as Record<string, unknown>;
      const serviceSpec = service.spec as Record<string, unknown>;
      expect(serviceSpec.type).toBe('NodePort');
      const ports = serviceSpec.ports as Array<Record<string, unknown>>;
      expect(ports[0].nodePort).toBe(30080);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('resolveKubernetesTarget inherits org defaults and instance overrides', () => {
    const inventory: Record<string, unknown> = {
      version: 1,
      organization: {
        deployment: {
          kubernetes: {
            namespace: 'org-namespace',
            context: 'org-context',
          },
        },
      },
    };

    const instance: Record<string, unknown> = {
      id: 'core',
      openclaw: {
        kubernetes: {
          namespace: 'instance-namespace',
          deployment_name: 'openclaw-core',
        },
      },
    };

    const target = resolveKubernetesTarget(inventory, instance);
    expect(target.namespace).toBe('instance-namespace');
    expect(target.context).toBe('org-context');
    expect(target.deploymentName).toBe('openclaw-core');
    expect(target.containerName).toBe('oco-core');
  });

  test('resolveKubernetesTarget uses oco-* defaults when names are omitted', () => {
    const target = resolveKubernetesTarget(
      { version: 1, organization: { deployment: { kubernetes: { namespace: 'default' } } } },
      { id: 'core' },
    );

    expect(target.deploymentName).toBe('oco-core');
    expect(target.serviceName).toBe('oco-core');
    expect(target.containerName).toBe('oco-core');
  });

  test('runKubernetesAction rejects unsupported actions before calling kubectl', () => {
    const root = mkdtempSync(join(tmpdir(), 'oco-k8s-action-'));
    try {
      const context: InstanceContext = {
        id: 'core',
        inventoryPath: join(root, 'inventory', 'instances.yaml'),
        inventoryDir: join(root, 'inventory'),
        generatedDir: join(root, '.generated', 'core'),
        configDir: join(root, 'instances', 'core', 'config'),
        stateDir: join(root, 'instances', 'core', 'state'),
        workspaceRoot: join(root, 'instances', 'core', 'workspaces'),
        gatewayPort: 19789,
        gatewayBind: '127.0.0.1',
      };

      expect(() =>
        runKubernetesAction({ version: 1 }, { id: 'core' }, context, 'explode'),
      ).toThrow('unsupported compose action');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
