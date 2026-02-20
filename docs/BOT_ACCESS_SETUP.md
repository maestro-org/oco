# Bot Access Setup (Telegram + Discord)

This guide covers bot provisioning and channel account wiring for `oco`.

## 1. Telegram Setup

1. Create bot(s) with `@BotFather`.
2. Record token(s).
3. Optional BotFather settings:
- `/setjoingroups`
- `/setprivacy`

Token wiring:
- single default: `TELEGRAM_BOT_TOKEN`
- multi-account: `TELEGRAM_BOT_TOKEN_<ACCOUNT>` (recommended)

Inventory channel accounts:

```yaml
channels:
  telegram:
    accounts:
      support: {}
```

Instance override example:

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

Pairing (DM policy):

```bash
oco pairing list --instance <instance-id> --channel telegram --account support --json
oco pairing approve --instance <instance-id> --channel telegram --account support --code <PAIRING_CODE>
```

## 2. Discord Setup

1. Create app + bot in Discord Developer Portal.
2. Enable intents:
- Message Content Intent
- Server Members Intent (recommended)

3. OAuth2 scopes:
- `bot`
- `applications.commands`

4. Invite bot with least privilege:
- View Channels
- Send Messages
- Read Message History
- Embed Links
- Attach Files

Token wiring:
- single default: `DISCORD_BOT_TOKEN`
- multi-account: `DISCORD_BOT_TOKEN_<ACCOUNT>` (recommended)

Inventory channel accounts:

```yaml
channels:
  discord:
    accounts:
      brain_qa: {}
```

Instance override example:

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

Optional DM pairing:

```bash
oco pairing list --instance <instance-id> --channel discord --account brain_qa --json
oco pairing approve --instance <instance-id> --channel discord --account brain_qa --code <PAIRING_CODE>
```

## 3. Validation Checklist

```bash
oco validate
oco policy validate
oco preflight --instance <instance-id>
oco health --instance <instance-id>
```

Verify:
- tokens are loaded in shell env
- bindings map expected `channel:accountId`
- bot visibility is limited to intended channels/accounts

## 4. References

- Telegram docs: https://docs.openclaw.ai/channels/telegram
- Discord docs: https://docs.openclaw.ai/channels/discord
- Pairing docs: https://docs.openclaw.ai/channels/pairing
- E2E Telegram: `docs/E2E_OCO_TELEGRAM.md`
- E2E Discord: `docs/E2E_OCO_DISCORD_FUNCTIONAL_AGENTS.md`
