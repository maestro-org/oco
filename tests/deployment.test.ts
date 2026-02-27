import { describe, expect, test } from 'bun:test';
import { resolveDeploymentProvider, resolveOrgKubernetesDefaults } from '../src/deployment';

describe('deployment', () => {
  test('resolveDeploymentProvider defaults to docker', () => {
    const resolved = resolveDeploymentProvider({ version: 1, instances: [] });
    expect(resolved.provider).toBe('docker');
    expect(resolved.source).toBe('default');
  });

  test('resolveDeploymentProvider uses organization deployment provider', () => {
    const resolved = resolveDeploymentProvider({
      version: 1,
      organization: {
        deployment: {
          provider: 'kubernetes',
        },
      },
      instances: [],
    });

    expect(resolved.provider).toBe('kubernetes');
    expect(resolved.source).toBe('organization');
  });

  test('resolveDeploymentProvider allows env override', () => {
    const previous = process.env.OCO_DEPLOYMENT_PROVIDER;
    process.env.OCO_DEPLOYMENT_PROVIDER = 'kubernetes';
    try {
      const resolved = resolveDeploymentProvider({
        version: 1,
        organization: {
          deployment: {
            provider: 'docker',
          },
        },
        instances: [],
      });
      expect(resolved.provider).toBe('kubernetes');
      expect(resolved.source).toBe('env');
    } finally {
      if (previous === undefined) {
        delete process.env.OCO_DEPLOYMENT_PROVIDER;
      } else {
        process.env.OCO_DEPLOYMENT_PROVIDER = previous;
      }
    }
  });

  test('resolveDeploymentProvider rejects invalid env override', () => {
    const previous = process.env.OCO_DEPLOYMENT_PROVIDER;
    process.env.OCO_DEPLOYMENT_PROVIDER = 'bad';
    try {
      expect(() => resolveDeploymentProvider({ version: 1, instances: [] })).toThrow(
        'OCO_DEPLOYMENT_PROVIDER must be "docker" or "kubernetes"',
      );
    } finally {
      if (previous === undefined) {
        delete process.env.OCO_DEPLOYMENT_PROVIDER;
      } else {
        process.env.OCO_DEPLOYMENT_PROVIDER = previous;
      }
    }
  });

  test('resolveOrgKubernetesDefaults prefers env overrides', () => {
    const prevContext = process.env.OCO_KUBE_CONTEXT;
    const prevNamespace = process.env.OCO_KUBE_NAMESPACE;
    const prevKubeconfig = process.env.OCO_KUBECONFIG;

    process.env.OCO_KUBE_CONTEXT = 'env-context';
    process.env.OCO_KUBE_NAMESPACE = 'env-namespace';
    process.env.OCO_KUBECONFIG = '/tmp/kubeconfig';

    try {
      const resolved = resolveOrgKubernetesDefaults({
        version: 1,
        organization: {
          deployment: {
            kubernetes: {
              context: 'org-context',
              namespace: 'org-namespace',
              kubeconfig: '/tmp/org-kubeconfig',
            },
          },
        },
        instances: [],
      });

      expect(resolved.context).toBe('env-context');
      expect(resolved.namespace).toBe('env-namespace');
      expect(resolved.kubeconfig).toBe('/tmp/kubeconfig');
    } finally {
      if (prevContext === undefined) {
        delete process.env.OCO_KUBE_CONTEXT;
      } else {
        process.env.OCO_KUBE_CONTEXT = prevContext;
      }

      if (prevNamespace === undefined) {
        delete process.env.OCO_KUBE_NAMESPACE;
      } else {
        process.env.OCO_KUBE_NAMESPACE = prevNamespace;
      }

      if (prevKubeconfig === undefined) {
        delete process.env.OCO_KUBECONFIG;
      } else {
        process.env.OCO_KUBECONFIG = prevKubeconfig;
      }
    }
  });
});
