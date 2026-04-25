import 'dotenv/config';
import main from './src/Main';
import { randomUUID } from 'crypto';

const initId = randomUUID();

main({
    DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN ?? '',
    SYSTEM_TEXT_CHANNEL_ID: process.env.SYSTEM_TEXT_CHANNEL_ID ?? '',
    initId: initId
}).catch(error => {
    console.error('A critical fault was encountered:', error);
    process.exit(1);
});
