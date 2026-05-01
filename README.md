# ravebot

![deadmau5](./resources/img/deadmau5.gif)

## Requirements

- Docker and Docker Compose

## Configuration

Copy `.env.template` to `.env` and fill in the values.

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
