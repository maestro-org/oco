# Bot Access Setup (Telegram + Discord)

This guide covers how to provision bot access and connect those bots to `oco` instances.

## 1. Telegram Bot Access

1. Create a bot in Telegram via `@BotFather`:
- run `/newbot`
- choose bot name + username
- copy the bot token

2. Configure Telegram-side settings in BotFather when needed:
- `/setjoingroups` (allow/deny bot joining groups)
- `/setprivacy` (controls whether the bot sees all group messages)
- if you change privacy mode, remove and re-add the bot in each group

3. Decide token wiring:
- Single/default account fallback: `TELEGRAM_BOT_TOKEN`
- Multi-account (recommended for multi-agent): per-account env vars like `TELEGRAM_BOT_TOKEN_<ACCOUNT>`

4. Configure inventory channel account(s) for the instance:

```yaml
channels:
  telegram:
    accounts:
      support: {}
```

5. Configure token(s) in instance override JSON5:

```json5
{
  channels: {
    telegram: {
      dmPolicy: "pairing",
      groupPolicy: "allowlist",
      accounts: {
        support: {
          botToken: "${TELEGRAM_BOT_TOKEN_SUPPORT}",
        },
      },
    },
  },
}
```

6. Deploy and approve first DM pairing:

```bash
oco pairing list --instance <instance-id> --channel telegram --account support --json
oco pairing approve --instance <instance-id> --channel telegram --account support --code <PAIRING_CODE>
```

Notes:
- Pairing is the secure default for Telegram DMs.
- For group behavior, configure group allowlists/mention requirements in channel config.

## 2. Discord Bot Access

1. Create an application and bot in Discord Developer Portal.
2. In bot settings, enable:
- Message Content Intent
- Server Members Intent (recommended; required for role-based allowlists/routing)

3. In OAuth2 URL generator, include scopes:
- `bot`
- `applications.commands`

4. Invite bot to your Discord server with least-privilege permissions:
- View Channels
- Send Messages
- Read Message History
- Embed Links
- Attach Files
- Add Reactions (optional)

5. If you plan DM pairing, enable DMs from server members in your server privacy settings.

6. Decide token wiring:
- Single/default account fallback: `DISCORD_BOT_TOKEN`
- Multi-account (recommended): per-account env vars like `DISCORD_BOT_TOKEN_<ACCOUNT>`
- Token resolution is account-aware: config token values win; env fallback applies to default account only.

7. Configure inventory channel account(s):

```yaml
channels:
  discord:
    accounts:
      brain_qa: {}
```

8. Configure token(s) in instance override JSON5:

```json5
{
  channels: {
    discord: {
      groupPolicy: "allowlist",
      guilds: {
        "<GUILD_ID>": {
          channels: {
            "<CHANNEL_ID>": {
              allow: true,
              requireMention: true,
            },
          },
        },
      },
      accounts: {
        brain_qa: {
          token: "${DISCORD_BOT_TOKEN_BRAIN_QA}",
        },
      },
    },
  },
}
```

9. Deploy and approve first DM pairing if needed:

```bash
oco pairing list --instance <instance-id> --channel discord --account brain_qa --json
oco pairing approve --instance <instance-id> --channel discord --account brain_qa --code <PAIRING_CODE>
```

Notes:
- For shared guild channels, use mention gating and channel allowlists.
- If `groupPolicy` is `allowlist` and no guild/channel is listed, the bot will not reply in guild channels.
- Enable Discord Developer Mode if you need to copy server/channel/user IDs for allowlists.
- Keep one bot/account per agent for deterministic routing in this repo model.

## 3. Validation Checklist

Run:

```bash
oco validate
oco policy validate
oco preflight --instance <instance-id>
oco health --instance <instance-id>
```

Verify:
- Bot token env vars are loaded in current shell.
- Agent bindings match intended `channel:accountId`.
- Bot only has access to intended DM/channel scope.

## 4. References

- Telegram channel docs: https://docs.openclaw.ai/channels/telegram
- Discord channel docs: https://docs.openclaw.ai/channels/discord
- Pairing docs: https://docs.openclaw.ai/channels/pairing
- Repo-specific Telegram E2E: `docs/E2E_OCO_TELEGRAM.md`
- Repo-specific Discord E2E: `docs/E2E_OCO_DISCORD_MAESTRO.md`
