# ravebot

![deadmau5](./resources/img/deadmau5.gif)

## Requirements

- Docker and Docker Compose
- nvm

## Configuration

Copy `.env.template` to `.env` and fill in the values.

## Setup

Use the Node version from `.nvmrc`:

```bash
nvm install
nvm use
```

Run the setup script once after cloning:

```bash
npm run setup
```

This configures Git to use the tracked hooks in `.githooks/`:

- `pre-commit` runs `npm run lint`
- `pre-push` runs `npm run build` and `npm test`

## Running

**Local deploy (detached):**
```bash
sudo docker compose build && sudo docker compose up -d
```

## Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `build` | `npm run build` | Compile TypeScript to `dist/` |
| `start` | `npm start` | Run the compiled bot |
| `dev` | `npm run dev` | Run with hot reload via `tsx watch` |
| `setup` | `npm run setup` | Configure local Git hooks |
