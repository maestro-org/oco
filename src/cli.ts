#!/usr/bin/env node

import { Command } from 'commander';
import { addAgent, listAgents, removeAgent } from './agents';
import { OcoError } from './errors';
import {
  findInstance,
  getInstances,
  inventoryPath,
  loadInventoryFile,
  saveInventoryFile,
  validateInventory,
} from './inventory';
import { effectivePolicySummary, listSupportedIntegrations, validatePolicies } from './policy';
import {
  generateComposeForInstance,
  healthInstance,
  preflightInstance,
  renderInstance,
  revisionsForInstance,
  rollbackInstance,
  runCompose,
  updateInstance,
  validateOnly,
} from './workflow';

function printJson(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function run(): void {
  const program = new Command();

  program.name('oco').description('OpenClaw orchestrator CLI').option('--inventory <path>', 'Path to inventory YAML', 'inventory/instances.yaml');

  program
    .command('validate')
    .description('Validate inventory and policies')
    .action(() => {
      const { inventory: invFile } = program.opts<{ inventory: string }>();
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
      const { inventory: invFile } = program.opts<{ inventory: string }>();
      printJson(renderInstance(invFile, options.instance, options.dryRun));
    });

  program
    .command('preflight')
    .description('Run preflight checks for one instance')
    .requiredOption('--instance <id>', 'Instance ID')
    .action((options: { instance: string }) => {
      const { inventory: invFile } = program.opts<{ inventory: string }>();
      printJson(preflightInstance(invFile, options.instance));
    });

  program
    .command('health')
    .description('Check runtime health for one instance')
    .requiredOption('--instance <id>', 'Instance ID')
    .action((options: { instance: string }) => {
      const { inventory: invFile } = program.opts<{ inventory: string }>();
      printJson(healthInstance(invFile, options.instance));
    });

  const compose = program.command('compose').description('Docker compose actions');

  compose
    .command('generate')
    .requiredOption('--instance <id>', 'Instance ID')
    .action((options: { instance: string }) => {
      const { inventory: invFile } = program.opts<{ inventory: string }>();
      printJson(generateComposeForInstance(invFile, options.instance));
    });

  for (const action of ['up', 'down', 'restart', 'ps', 'pull']) {
    compose
      .command(action)
      .requiredOption('--instance <id>', 'Instance ID')
      .action((options: { instance: string }) => {
        const { inventory: invFile } = program.opts<{ inventory: string }>();
        printJson(runCompose(invFile, options.instance, action));
      });
  }

  const agent = program.command('agent').description('Agent lifecycle commands');

  agent
    .command('add')
    .requiredOption('--instance <id>', 'Instance ID')
    .requiredOption('--agent-id <id>', 'Agent ID')
    .option('--role <role>', 'human|usecase', 'usecase')
    .requiredOption('--account <channel:accountId...>', 'Account mapping(s)')
    .option('--integration <name...>', 'Integrations', [])
    .option('--skill <name...>', 'Skills', [])
    .option('--model <provider/model>', 'Model')
    .action(
      (options: {
        instance: string;
        agentId: string;
        role: 'human' | 'usecase';
        account: string[];
        integration: string[];
        skill: string[];
        model?: string;
      }) => {
        const { inventory: invFile } = program.opts<{ inventory: string }>();
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

        printJson({ status: 'added', instance: options.instance, agent: options.agentId });
      },
    );

  agent
    .command('remove')
    .requiredOption('--instance <id>', 'Instance ID')
    .requiredOption('--agent-id <id>', 'Agent ID')
    .option('--keep-accounts', 'Do not prune unused accounts', false)
    .action((options: { instance: string; agentId: string; keepAccounts: boolean }) => {
      const { inventory: invFile } = program.opts<{ inventory: string }>();
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
      const { inventory: invFile } = program.opts<{ inventory: string }>();
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
      const { inventory: invFile } = program.opts<{ inventory: string }>();
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
      const { inventory: invFile } = program.opts<{ inventory: string }>();
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
      const { inventory: invFile } = program.opts<{ inventory: string }>();
      printJson(updateInstance(invFile, options.instance, options.imageTag));
    });

  deploy
    .command('rollback')
    .requiredOption('--instance <id>', 'Instance ID')
    .requiredOption('--revision <id>', 'Revision ID')
    .action((options: { instance: string; revision: string }) => {
      const { inventory: invFile } = program.opts<{ inventory: string }>();
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

  program.parse(process.argv);
}

try {
  run();
} catch (error) {
  if (error instanceof Error) {
    process.stderr.write(`error: ${error.message}\n`);
  } else {
    process.stderr.write(`error: ${String(error)}\n`);
  }
  process.exit(1);
}
