# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Hot-reload development (tsx watch)
npm run build     # Compile TypeScript to dist/
npm start         # Run compiled bot
npm test          # Run all tests
npm run lint      # ESLint
```

Run a single test file or by name:
```bash
npm test -- test/bot/events/CounterGame.test.ts
npm test -- --testNamePattern="parses safe integer"
```

## Architecture

**ravebot** is a stateful Discord bot (discord.js) with no external database — all state is persisted by serializing compressed JSON to Discord channel messages and recovered on restart by scanning channel history.

### Core Abstractions

**`InstanceManager`** (`src/bot/persistence/SessionPersistence.ts`) is the central orchestrator. It holds the in-memory `SessionState`, owns the main and backup `EventBus` instances, and exposes a `TaskQueue`-backed atomic update API. All handlers and services receive it as a dependency. State mutations go through promise-chained atomic updates to prevent race conditions.

**`EventBus`** (`src/utils/EventBus.ts`) is a typed pub-sub system with `on()` / `once()` / `notify()`. Two buses exist: a MAIN bus for game/debug events and a BACKUP_BUS for coordinating backup timing.

**`TaskQueue`** (`src/utils/TaskQueue.ts`) is a concurrency-controlled FIFO scheduler with configurable concurrency limits and cooldown periods. Used by debug commands and the backup pipeline.

### Data Flow

```
Discord.js Client events
  → Event Handlers (CounterGame, DebugHandler)
    → InstanceManager atomic state updates
      → BackupService (periodic: every 5 min + daily keep-alive)
        → state serialized as gzip+Base64 JSON written to Discord
          → RecoveryService (on restart: scans channel history to restore)
```

### Services (`src/bot/services/`)

| Service | Responsibility |
|---|---|
| `BackupService` | Scheduled backups via cron + EventBus triggers |
| `RecoveryService` | Restores last state from Discord channel message history |
| `PersistenceService` | Serializes state to Discord; skips redundant writes |
| `LifecycleService` | Graceful shutdown on SIGTERM / SIGINT |

### Event Handlers (`src/bot/events/`)

- **CounterGame**: Collaborative counting game — sequential increments, no consecutive posts by the same user
- **DebugHandler**: Admin commands (`HELP`, `MANUAL_BACKUP`, `FORCE_UPDATE`)

### Environment

Bot config is loaded from `.env` (token, channel IDs, bot ID) via dotenv in `index.ts`. TypeScript targets ES2022 with strict mode. Tests run under Jest + ts-jest in a Node environment.
