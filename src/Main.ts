import { initializeBot } from './bot/Bot';
import { type MainConfig } from './types/Config';

export default async function main(config: MainConfig): Promise<void> {
    const currentTime = new Date().toLocaleString('en-US', { timeZone: 'America/Vancouver', timeZoneName: 'short' });

    console.log(`STARTING UP @ ${currentTime}`);

    await initializeBot(config);
}
