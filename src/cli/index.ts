import { Command } from 'commander';
import pkg from '../../package.json';
import { runAdd } from './commands/add';
import { runAsk } from './commands/ask';
import { runMigrate } from './commands/migrate';
import { runKillCli, runBotsList } from './commands/ps';
import {
  runSecretsGet,
  runSecretsList,
  runSecretsRemove,
  runSecretsSet,
} from './commands/secrets';
import {
  runServiceRestart,
  runServiceStart,
  runServiceStatus,
  runServiceStop,
  runServiceUnregister,
} from './commands/service';
import { runStart } from './commands/start';

const program = new Command();

program
  .name('lark-channel-bridge')
  .description('Bridge Feishu/Lark messenger with local CLI coding agents')
  .version(pkg.version, '-v, --version');

// === bot setup ===

program
  .command('add')
  .description('Add a new bot — scan QR code, create named config, optionally bind a team role')
  .option('--name <id>', 'bot id (auto-generated if omitted)')
  .option('--agent <name>', 'bind a standard-team agent role (snapshot persona)')
  .option('--skills <list>', 'comma-separated preferred skill names')
  .action(async (opts: { name?: string; agent?: string; skills?: string }) => {
    await runAdd(opts);
  });

// === process-level commands (work directly on bridge processes) ===

program
  .command('run')
  .description('Run the bridge in the foreground (was `start` in older versions)')
  .option('-c, --config <path>', 'path to config file')
  .option('--bot <id>', 'bot id to run (uses config-<id>.json)')
  .option('--skip-check-lark-cli', 'skip lark-cli pre-flight check (auto-install + bind)')
  .action(async (opts: { config?: string; skipCheckLarkCli?: boolean; bot?: string }) => {
    await runStart(opts);
  });

program
  .command('ask')
  .description('Internal bridge command: send an interactive question card and wait for the answer')
  .option('-c, --config <path>', 'path to config file')
  .requiredOption('--chat-id <id>', 'target Feishu/Lark chat_id')
  .requiredOption('--operator-open-id <id>', 'expected answering user open_id')
  .requiredOption('--question <text>', 'question shown to the user')
  .requiredOption('--options <json>', 'JSON array of options')
  .option('--timeout-seconds <seconds>', 'max wait time before failing', (value) => Number(value))
  .action(
    async (opts: {
      config?: string;
      chatId: string;
      operatorOpenId: string;
      question: string;
      options: string;
      timeoutSeconds?: number;
    }) => {
      await runAsk(opts);
    },
  );

program
  .command('ps')
  .description('List all configured bots and their running status')
  .action(() => {
    void runBotsList();
  });

program
  .command('kill <target>')
  .description('Kill a running bridge process by short id or list index (SIGTERM, then SIGKILL after 2s).')
  .action(async (target: string) => {
    await runKillCli(target);
  });

// === service-level commands (OS-managed daemon: launchd/systemd/schtasks) ===

program
  .command('start')
  .description('Install (if needed) and start the bridge as an OS-managed daemon')
  .option('--bot <id>', 'bot id to start')
  .option('--skip-check-lark-cli', 'skip lark-cli pre-flight check (auto-install + bind)')
  .action(async (opts: { skipCheckLarkCli?: boolean; bot?: string }) => {
    await runServiceStart(opts);
  });

program
  .command('stop')
  .description('Stop the OS-managed daemon (unload from launchd; plist stays)')
  .option('--bot <id>', 'bot id to stop')
  .action(async (opts: { bot?: string }) => {
    await runServiceStop(opts.bot);
  });

program
  .command('restart')
  .description('Restart the OS-managed daemon')
  .option('--bot <id>', 'bot id to restart')
  .action(async (opts: { bot?: string }) => {
    await runServiceRestart(opts.bot);
  });

program
  .command('status')
  .description('Show OS service status (pid, last exit, log paths)')
  .option('--bot <id>', 'bot id to check')
  .action(async (opts: { bot?: string }) => {
    await runServiceStatus(opts.bot);
  });

program
  .command('unregister')
  .description('Remove the OS service registration (bootout + delete plist)')
  .option('--bot <id>', 'bot id to unregister')
  .action(async (opts: { bot?: string }) => {
    await runServiceUnregister(opts.bot);
  });

const secrets = program
  .command('secrets')
  .description('Manage the bridge\'s encrypted secret keystore (~/.lark-channel/secrets.enc)');

secrets
  .command('get')
  .description('Exec-provider protocol: read JSON request from stdin, write JSON response to stdout. Used by lark-cli config bind --source lark-channel.')
  .action(async () => {
    await runSecretsGet();
  });

secrets
  .command('set')
  .description('Encrypt and store an App Secret. Prompts for the secret without echoing.')
  .requiredOption('--app-id <id>', 'App ID (e.g. cli_xxxxxxxxxxxx)')
  .action(async (opts: { appId: string }) => {
    await runSecretsSet(opts.appId);
  });

secrets
  .command('list')
  .description('List the IDs of secrets in the encrypted keystore (no secrets shown)')
  .action(async () => {
    await runSecretsList();
  });

secrets
  .command('remove')
  .description('Delete an entry from the encrypted keystore')
  .requiredOption('--app-id <id>', 'App ID to remove')
  .action(async (opts: { appId: string }) => {
    await runSecretsRemove(opts.appId);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
