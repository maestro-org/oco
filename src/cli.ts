#!/usr/bin/env node

import { Command } from 'commander';
import { addAgent, listAgents, removeAgent } from './agents';
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
import { applySoulTemplate, listSoulTemplates } from './soul';
import { applyToolsTemplate, listToolsTemplates } from './tools';

function printJson(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function run(): void {
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
    .description('Check runtime health for one instance')
    .requiredOption('--instance <id>', 'Instance ID')
    .action((options: { instance: string }) => {
      const { inventory: invFile } = program.opts<{ inventory?: string }>();
      printJson(healthInstance(invFile, options.instance));
    });

  const compose = program.command('compose').description('Docker compose actions');

  compose
    .command('generate')
    .requiredOption('--instance <id>', 'Instance ID')
    .action((options: { instance: string }) => {
      const { inventory: invFile } = program.opts<{ inventory?: string }>();
      printJson(generateComposeForInstance(invFile, options.instance));
    });

  for (const action of ['up', 'down', 'restart', 'ps', 'pull', 'logs']) {
    compose
      .command(action)
      .requiredOption('--instance <id>', 'Instance ID')
      .action((options: { instance: string }) => {
        const { inventory: invFile } = program.opts<{ inventory?: string }>();
        printJson(runCompose(invFile, options.instance, action));
      });
  }

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
