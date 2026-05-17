# AGENTS.md

Guidance for Codex and other coding agents working in this repository.

## Project Shape

`ravebot` is a stateful Discord bot written in TypeScript/CommonJS. It uses `discord.js` for Discord events, `croner` for scheduled backups, Jest for tests, and ESLint via `typescript-eslint`.

There is no external database. Runtime state is held in memory and persisted by serializing compressed JSON into Discord channel messages. On restart, the bot recovers by scanning channel history.

## Commands

Use these from the repo root:

```bash
npm run build
npm test
npm run lint
npm run dev
npm start
```

Targeted tests:

```bash
npm test -- test/bot/events/CounterGame.test.ts
npm test -- --testNamePattern="parses safe integer"
```

Prefer running the narrowest relevant test first, then `npm test`, `npm run lint`, and `npm run build` when the change touches shared behavior or TypeScript contracts.

## Files To Read First

- `src/Main.ts`: bot startup and service/event registration.
- `src/bot/persistence/SessionPersistence.ts`: `InstanceManager`, `SessionState`, atomic state updates, compression/reconstruction helpers.
- `src/bot/events/CounterGame.ts`: counting-game message handling.
- `src/bot/events/DebugHandler.ts`: debug/admin command handling.
- `src/bot/services/`: persistence, recovery, backup scheduling, and lifecycle shutdown behavior.
- `src/bot/types/BotConfig.ts`: required environment-backed config.
- `src/resources/translation.en.json`: user-facing strings.
- `test/`: Jest coverage organized to mirror `src/`.

## Architecture Notes

- `InstanceManager` is the central state owner. It stores `SessionState`, metadata, task queues, and event buses.
- Mutate session state only through `instanceManager.runAtomicStateUpdate(...)`. The callback receives a snapshot plus a `writeState` function. `writeState` may be called once per atomic update.
- A state write creates a new `stateId`; backup code uses that ID to skip redundant automatic persists.
- The bot uses two event-bus concepts: main game/debug events and backup coordination. Check constants before adding new IDs.
- Persistence format is gzip-compressed JSON encoded as Base64 and wrapped in a Discord message with `REBUILD_STATE_HEADER`.
- Recovery code must remain backward compatible with older persisted messages when practical. Existing reconstruct helpers fill missing legacy fields.

## Coding Conventions

- TypeScript is strict, targets ES2022, and compiles to `dist/`.
- Keep modules small and testable. Prefer pure helper functions around Discord side effects, matching `CounterGame.ts` and service tests.
- Use type-only imports where appropriate; ESLint enforces `@typescript-eslint/consistent-type-imports`.
- Semicolons are required.
- Avoid `any`; it is currently a warning, but prefer explicit types or narrower mocks.
- User-facing text should usually live in `src/resources/translation.en.json` and be fetched via `getTranslation`.
- Do not commit generated `dist/`, local `.env`, or `node_modules`.

## Testing Guidance

- Add or update Jest tests when changing parsing, state transitions, persistence/recovery, task queues, event bus behavior, or lifecycle/backup logic.
- For Discord-facing handlers, mock only the Discord surface needed by the function under test.
- For state mutation behavior, assert both success paths and failure/no-op paths, especially around atomic updates and single-write guarantees.
- For persistence format changes, include compatibility tests for reconstructing older messages if the serialized shape changes.

## Operational Notes

- Required environment variables are shown in `.env.template` and validated in `src/bot/types/BotConfig.ts`.
- `npm run dev` runs `tsx watch index.ts` and expects real Discord credentials.
- Docker Compose is the documented deployment path in `README.md`.
- Be careful with changes that can spam Discord channels: backup intervals, manual backup behavior, recovery scans, and message replies should remain deliberate.

## Agent Workflow

1. Start with `git status --short` and do not overwrite unrelated user changes.
2. Use `rg` / `rg --files` for repo navigation.
3. Read the relevant source and matching tests before editing.
4. Keep changes scoped to the requested behavior.
5. Run targeted tests first; broaden verification based on risk.
6. Report any commands that could not be run and why.
