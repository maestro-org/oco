#!/usr/bin/env node

import { Command } from 'commander';
import { addAgent, listAgents, removeAgent } from './agents';
import { startAdminApiServer } from './admin/api';
import { devDown, devLogs, devUp, stackDown, stackStatus, stackUp } from './admin/stack';
import { OcoError } from './errors';
import {
  findInstance,
  getInstances,
  initializeInventory,
  inventoryPath,
  loadInventoryFile,
  saveInventoryFile,
  validateInventory,
} from './inventory';
import { effectivePolicySummary, listSupportedIntegrations, validatePolicies } from './policy';
import {
  deploymentTargetForInstance,
  generateComposeForInstance,
  healthInstance,
  preflightInstance,
  pairingApprove,
  pairingList,
  renderInstance,
  revisionsForInstance,
  rollbackInstance,
  runCompose,
  updateInstance,
  validateOnly,
} from './workflow';
import { healOpenAiReasoningSessions, resetSessions } from './sessions';
import { applySoulTemplate, listSoulTemplates } from './soul';
import { applyToolsTemplate, listToolsTemplates } from './tools';

function printJson(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function registerRuntimeCommands(
  command: Command,
  inventoryPathProvider: () => string | undefined,
): void {
  command
    .command('generate')
    .requiredOption('--instance <id>', 'Instance ID')
    .action((options: { instance: string }) => {
      printJson(generateComposeForInstance(inventoryPathProvider(), options.instance));
    });

  for (const action of ['up', 'down', 'restart', 'ps', 'pull', 'logs']) {
    command
      .command(action)
      .requiredOption('--instance <id>', 'Instance ID')
      .action((options: { instance: string }) => {
        printJson(runCompose(inventoryPathProvider(), options.instance, action));
      });
  }
}

async function run(): Promise<void> {
  const program = new Command();

  program
    .name('oco')
    .description('OpenClaw orchestrator CLI')
    .option('--inventory <path>', 'Path to inventory YAML');

  const inventory = program.command('inventory').description('Inventory configuration helpers');

  inventory
    .command('init')
    .description('Initialize a local inventory from the tracked template')
    .option('--path <path>', 'Target inventory path', 'inventory/instances.local.yaml')
    .option('--template <path>', 'Template inventory path')
    .option('--force', 'Overwrite target inventory if it exists', false)
    .action((options: { path: string; template?: string; force: boolean }) => {
      printJson(initializeInventory(options.path, options.template, options.force));
    });

  const soul = program.command('soul').description('SOUL.md template helpers');

  soul
    .command('list')
    .description('List available SOUL templates')
    .action(() => {
      const { inventory: invFile } = program.opts<{ inventory?: string }>();
      printJson(listSoulTemplates(invFile));
    });

  soul
    .command('apply')
    .description('Apply a SOUL template to an agent workspace')
    .requiredOption('--instance <id>', 'Instance ID')
    .requiredOption('--agent-id <id>', 'Agent ID')
    .requiredOption('--template <name>', 'Template id from templates/souls')
    .option('--force', 'Overwrite an existing SOUL.md', false)
    .action(
      (options: {
        instance: string;
        agentId: string;
        template: string;
        force: boolean;
      }) => {
        const { inventory: invFile } = program.opts<{ inventory?: string }>();
        printJson(
          applySoulTemplate(invFile, options.instance, options.agentId, options.template, options.force),
        );
      },
    );

  const tools = program.command('tools').description('TOOLS.md template helpers');

  tools
    .command('list')
    .description('List available TOOLS templates')
    .action(() => {
      const { inventory: invFile } = program.opts<{ inventory?: string }>();
      printJson(listToolsTemplates(invFile));
    });

  tools
    .command('apply')
    .description('Apply a TOOLS template to an agent workspace')
    .requiredOption('--instance <id>', 'Instance ID')
    .requiredOption('--agent-id <id>', 'Agent ID')
    .requiredOption('--template <name>', 'Template id from templates/tools')
    .option('--force', 'Overwrite an existing TOOLS.md', false)
    .action(
      (options: {
        instance: string;
        agentId: string;
        template: string;
        force: boolean;
      }) => {
        const { inventory: invFile } = program.opts<{ inventory?: string }>();
        printJson(
          applyToolsTemplate(invFile, options.instance, options.agentId, options.template, options.force),
        );
      },
    );

  program
    .command('validate')
    .description('Validate inventory and policies')
    .action(() => {
      const { inventory: invFile } = program.opts<{ inventory?: string }>();
      const { invPath, inventory } = validateOnly(invFile);
      printJson({
        inventory: invPath,
        instances: getInstances(inventory).length,
        status: 'ok',
      });
    });

  program
    .command('render')
    .description('Render resolved OpenClaw config')
    .requiredOption('--instance <id>', 'Instance ID')
    .option('--dry-run', 'Do not write files', false)
    .action((options: { instance: string; dryRun: boolean }) => {
      const { inventory: invFile } = program.opts<{ inventory?: string }>();
      printJson(renderInstance(invFile, options.instance, options.dryRun));
    });

  program
    .command('preflight')
    .description('Run preflight checks for one instance')
    .requiredOption('--instance <id>', 'Instance ID')
    .action((options: { instance: string }) => {
      const { inventory: invFile } = program.opts<{ inventory?: string }>();
      printJson(preflightInstance(invFile, options.instance));
    });

  program
    .command('health')
    .description('Check runtime health for one instance (docker or kubernetes)')
    .requiredOption('--instance <id>', 'Instance ID')
    .action((options: { instance: string }) => {
      const { inventory: invFile } = program.opts<{ inventory?: string }>();
      printJson(healthInstance(invFile, options.instance));
    });

  const compose = program
    .command('compose')
    .description('Runtime actions (provider-aware: docker compose or kubernetes)');

  registerRuntimeCommands(compose, () => program.opts<{ inventory?: string }>().inventory);

  const runtime = program
    .command('runtime')
    .description('Runtime actions (provider-aware: docker compose or kubernetes)');
  registerRuntimeCommands(runtime, () => program.opts<{ inventory?: string }>().inventory);

  const deployment = program.command('deployment').description('Deployment target resolution');
  deployment
    .command('target')
    .requiredOption('--instance <id>', 'Instance ID')
    .action((options: { instance: string }) => {
      const { inventory: invFile } = program.opts<{ inventory?: string }>();
      printJson(deploymentTargetForInstance(invFile, options.instance));
    });

  const pairing = program.command('pairing').description('Pairing workflow helpers');

  pairing
    .command('list')
    .requiredOption('--instance <id>', 'Instance ID')
    .requiredOption('--account <id>', 'Channel account id')
    .option('--channel <name>', 'Channel name', 'telegram')
    .option('--json', 'Pass --json to OpenClaw pairing list', false)
    .action((options: { instance: string; account: string; channel: string; json: boolean }) => {
      const { inventory: invFile } = program.opts<{ inventory?: string }>();
      printJson(pairingList(invFile, options.instance, options.channel, options.account, options.json));
    });

  pairing
    .command('approve')
    .requiredOption('--instance <id>', 'Instance ID')
    .requiredOption('--account <id>', 'Channel account id')
    .requiredOption('--code <code>', 'Pairing code')
    .option('--channel <name>', 'Channel name', 'telegram')
    .action((options: { instance: string; account: string; code: string; channel: string }) => {
      const { inventory: invFile } = program.opts<{ inventory?: string }>();
      printJson(pairingApprove(invFile, options.instance, options.channel, options.code, options.account));
    });

  const session = program.command('session').description('Session maintenance');

  session
    .command('reset')
    .description('Inspect and optionally clear local agent session indexes and session jsonl files')
    .requiredOption('--instance <id>', 'Instance ID')
    .option('--agent-id <id>', 'Filter to a single agent')
    .option('--apply', 'Back up and delete session state for selected agents', false)
    .action((options: { instance: string; agentId?: string; apply: boolean }) => {
      const { inventory: invFile } = program.opts<{ inventory?: string }>();
      printJson(resetSessions(invFile, options.instance, options.apply, options.agentId));
    });

  session
    .command('heal-openai')
    .description('Detect and optionally clear sessions stuck in OpenAI reasoning-chain 400 loops')
    .requiredOption('--instance <id>', 'Instance ID')
    .option('--agent-id <id>', 'Filter to a single agent')
    .option('--apply', 'Delete broken session entries from sessions.json', false)
    .action((options: { instance: string; agentId?: string; apply: boolean }) => {
      const { inventory: invFile } = program.opts<{ inventory?: string }>();
      printJson(healOpenAiReasoningSessions(invFile, options.instance, options.apply, options.agentId));
    });

  const agent = program.command('agent').description('Agent lifecycle commands');

  agent
    .command('add')
    .requiredOption('--instance <id>', 'Instance ID')
    .requiredOption('--agent-id <id>', 'Agent ID')
    .option('--role <role>', 'Agent role (e.g. human|usecase|operations)', 'usecase')
    .requiredOption('--account <channel:accountId...>', 'Account mapping(s)')
    .option('--integration <name...>', 'Integrations', [])
    .option('--skill <name...>', 'Skills', [])
    .option('--model <provider/model>', 'Model')
    .option('--soul-template <name>', 'Apply SOUL template after agent creation')
    .option('--tools-template <name>', 'Apply TOOLS template after agent creation')
    .action(
      (options: {
        instance: string;
        agentId: string;
        role: string;
        account: string[];
        integration: string[];
        skill: string[];
        model?: string;
        soulTemplate?: string;
        toolsTemplate?: string;
      }) => {
        const { inventory: invFile } = program.opts<{ inventory?: string }>();
        const invPath = inventoryPath(invFile);
        const inventory = loadInventoryFile(invPath);
        validateInventory(inventory, invPath);

        const instance = findInstance(inventory, options.instance);
        addAgent(
          instance,
          options.agentId,
          options.role,
          options.account,
          options.integration,
          options.skill,
          options.model,
        );

        saveInventoryFile(invPath, inventory);
        validateInventory(inventory, invPath);
        validatePolicies(inventory, getInstances(inventory));
        let soul: Record<string, unknown> | undefined;
        if (typeof options.soulTemplate === 'string' && options.soulTemplate.trim()) {
          soul = applySoulTemplate(
            invFile,
            options.instance,
            options.agentId,
            options.soulTemplate.trim(),
            false,
          );
        }
        let toolsTemplateResult: Record<string, unknown> | undefined;
        if (typeof options.toolsTemplate === 'string' && options.toolsTemplate.trim()) {
          toolsTemplateResult = applyToolsTemplate(
            invFile,
            options.instance,
            options.agentId,
            options.toolsTemplate.trim(),
            false,
          );
        }

        const payload: Record<string, unknown> = {
          status: 'added',
          instance: options.instance,
          agent: options.agentId,
        };
        if (soul) {
          payload.soul = {
            template: soul.template,
            path: soul.soul_path,
            status: soul.status,
          };
        }
        if (toolsTemplateResult) {
          payload.tools = {
            template: toolsTemplateResult.template,
            path: toolsTemplateResult.tools_path,
            status: toolsTemplateResult.status,
          };
        }

        printJson(payload);
      },
    );

  agent
    .command('remove')
    .requiredOption('--instance <id>', 'Instance ID')
    .requiredOption('--agent-id <id>', 'Agent ID')
    .option('--keep-accounts', 'Do not prune unused accounts', false)
    .action((options: { instance: string; agentId: string; keepAccounts: boolean }) => {
      const { inventory: invFile } = program.opts<{ inventory?: string }>();
      const invPath = inventoryPath(invFile);
      const inventory = loadInventoryFile(invPath);
      validateInventory(inventory, invPath);

      const instance = findInstance(inventory, options.instance);
      removeAgent(instance, options.agentId, !options.keepAccounts);

      saveInventoryFile(invPath, inventory);
      validateInventory(inventory, invPath);
      validatePolicies(inventory, getInstances(inventory));

      printJson({ status: 'removed', instance: options.instance, agent: options.agentId });
    });

  agent
    .command('list')
    .requiredOption('--instance <id>', 'Instance ID')
    .action((options: { instance: string }) => {
      const { inventory: invFile } = program.opts<{ inventory?: string }>();
      const invPath = inventoryPath(invFile);
      const inventory = loadInventoryFile(invPath);
      validateInventory(inventory, invPath);

      const instance = findInstance(inventory, options.instance);
      const agents = listAgents(instance).map((agent) => ({
        id: agent.id,
        role: agent.role,
        model: agent.model,
        integrations: Array.isArray(agent.integrations) ? agent.integrations : [],
        skills: Array.isArray(agent.skills) ? agent.skills : [],
        bindings: Array.isArray(agent.bindings) ? agent.bindings.length : 0,
      }));

      printJson({ instance: options.instance, agents });
    });

  const policy = program.command('policy').description('Policy inspection and validation');

  policy
    .command('validate')
    .description('Validate policies')
    .action(() => {
      const { inventory: invFile } = program.opts<{ inventory?: string }>();
      const invPath = inventoryPath(invFile);
      const inventory = loadInventoryFile(invPath);
      validateInventory(inventory, invPath);
      validatePolicies(inventory, getInstances(inventory));
      printJson({ status: 'ok' });
    });

  policy
    .command('integrations')
    .description('List supported integration classifications')
    .action(() => {
      printJson(listSupportedIntegrations());
    });

  policy
    .command('effective')
    .requiredOption('--instance <id>', 'Instance ID')
    .option('--agent-id <id>', 'Agent ID')
    .action((options: { instance: string; agentId?: string }) => {
      const { inventory: invFile } = program.opts<{ inventory?: string }>();
      const invPath = inventoryPath(invFile);
      const inventory = loadInventoryFile(invPath);
      validateInventory(inventory, invPath);

      const instance = findInstance(inventory, options.instance);

      if (!options.agentId) {
        printJson(effectivePolicySummary(inventory, instance));
        return;
      }

      const agent = listAgents(instance).find((item) => item.id === options.agentId);
      if (!agent) {
        throw new OcoError(`agent not found: ${options.instance}/${options.agentId}`);
      }

      printJson(effectivePolicySummary(inventory, instance, agent));
    });

  const deploy = program.command('deploy').description('Update and rollback workflows');

  deploy
    .command('update')
    .requiredOption('--instance <id>', 'Instance ID')
    .option('--image-tag <tag>', 'Image tag')
    .action((options: { instance: string; imageTag?: string }) => {
      const { inventory: invFile } = program.opts<{ inventory?: string }>();
      printJson(updateInstance(invFile, options.instance, options.imageTag));
    });

  deploy
    .command('rollback')
    .requiredOption('--instance <id>', 'Instance ID')
    .requiredOption('--revision <id>', 'Revision ID')
    .action((options: { instance: string; revision: string }) => {
      const { inventory: invFile } = program.opts<{ inventory?: string }>();
      printJson(rollbackInstance(invFile, options.instance, options.revision));
    });

  deploy
    .command('revisions')
    .requiredOption('--instance <id>', 'Instance ID')
    .action((options: { instance: string }) => {
      printJson({
        instance: options.instance,
        revisions: revisionsForInstance(options.instance),
      });
    });

  const admin = program.command('admin').description('Admin dashboard/API commands');
  const adminApi = admin.command('api').description('Admin API lifecycle commands');

  adminApi
    .command('serve')
    .description('Start the admin API server')
    .option('--host <host>', 'Bind host', '127.0.0.1')
    .option('--port <port>', 'Bind port', '4180')
    .option('--db-path <path>', 'Database path', '.generated/admin/dashboard.sqlite')
    .action(async (options: { host: string; port: string; dbPath: string }) => {
      const requestedPort = Number.parseInt(options.port, 10);
      const server = await startAdminApiServer({
        host: options.host,
        port: Number.isFinite(requestedPort) ? requestedPort : 4180,
        dbPath: options.dbPath,
      });

      printJson({
        status: 'listening',
        host: server.host,
        port: server.port,
        db_path: server.dbPath,
      });

      let closed = false;
      const closeServer = async (): Promise<void> => {
        if (closed) {
          return;
        }
        closed = true;
        await server.close();
      };

      process.once('SIGINT', () => {
        void closeServer();
      });
      process.once('SIGTERM', () => {
        void closeServer();
      });

      await server.waitUntilClosed();
    });

  const stack = program.command('stack').description('Deploy and manage runtime + admin dashboard stack');

  stack
    .command('up')
    .option('--provider <provider>', 'Override deployment provider (docker|kubernetes)')
    .option('--dry-run', 'Plan actions only', false)
    .option('--admin-host <host>', 'Admin API host', '127.0.0.1')
    .option('--admin-port <port>', 'Admin API port', '4180')
    .option('--admin-db-path <path>', 'Admin DB path', '.generated/admin/dashboard.sqlite')
    .action((options: { provider?: string; dryRun: boolean; adminHost: string; adminPort: string; adminDbPath: string }) => {
      const { inventory: invFile } = program.opts<{ inventory?: string }>();
      const provider = options.provider === 'docker' || options.provider === 'kubernetes'
        ? options.provider
        : undefined;
      const requestedPort = Number.parseInt(options.adminPort, 10);
      printJson(
        stackUp({
          inventoryPath: invFile,
          provider,
          dryRun: options.dryRun,
          adminHost: options.adminHost,
          adminPort: Number.isFinite(requestedPort) ? requestedPort : 4180,
          adminDbPath: options.adminDbPath,
        }),
      );
    });

  stack
    .command('down')
    .option('--provider <provider>', 'Override deployment provider (docker|kubernetes)')
    .option('--dry-run', 'Plan actions only', false)
    .action((options: { provider?: string; dryRun: boolean }) => {
      const { inventory: invFile } = program.opts<{ inventory?: string }>();
      const provider = options.provider === 'docker' || options.provider === 'kubernetes'
        ? options.provider
        : undefined;
      printJson(
        stackDown({
          inventoryPath: invFile,
          provider,
          dryRun: options.dryRun,
        }),
      );
    });

  stack
    .command('status')
    .option('--provider <provider>', 'Override deployment provider (docker|kubernetes)')
    .option('--no-runtime', 'Skip runtime health checks')
    .option('--admin-host <host>', 'Admin API host', '127.0.0.1')
    .option('--admin-port <port>', 'Admin API port', '4180')
    .action((options: { provider?: string; runtime: boolean; adminHost: string; adminPort: string }) => {
      const { inventory: invFile } = program.opts<{ inventory?: string }>();
      const provider = options.provider === 'docker' || options.provider === 'kubernetes'
        ? options.provider
        : undefined;
      const requestedPort = Number.parseInt(options.adminPort, 10);
      printJson(
        stackStatus({
          inventoryPath: invFile,
          provider,
          includeRuntimeStatus: options.runtime,
          adminHost: options.adminHost,
          adminPort: Number.isFinite(requestedPort) ? requestedPort : 4180,
        }),
      );
    });

  const dev = program.command('dev').description('Local admin dashboard development helpers');

  dev
    .command('up')
    .option('--admin-host <host>', 'Admin API host', '127.0.0.1')
    .option('--admin-port <port>', 'Admin API port', '4180')
    .option('--admin-db-path <path>', 'Admin DB path', '.generated/admin/dashboard.sqlite')
    .action((options: { adminHost: string; adminPort: string; adminDbPath: string }) => {
      const requestedPort = Number.parseInt(options.adminPort, 10);
      printJson(
        devUp({
          adminHost: options.adminHost,
          adminPort: Number.isFinite(requestedPort) ? requestedPort : 4180,
          adminDbPath: options.adminDbPath,
        }),
      );
    });

  dev
    .command('down')
    .action(() => {
      printJson(devDown());
    });

  dev
    .command('logs')
    .option('--lines <n>', 'Number of lines', '120')
    .action((options: { lines: string }) => {
      const lines = Number.parseInt(options.lines, 10);
      printJson(devLogs({ lines: Number.isFinite(lines) ? lines : 120 }));
    });

  await program.parseAsync(process.argv);
}

void run().catch((error) => {
  if (error instanceof Error) {
    process.stderr.write(`error: ${error.message}\n`);
  } else {
    process.stderr.write(`error: ${String(error)}\n`);
  }
  process.exit(1);
});
