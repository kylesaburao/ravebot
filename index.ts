import 'dotenv/config';
import main from './src/Main';

main({
    DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN ?? '',
}).catch(error => {
    console.error('A critical fault was encountered:', error);
    process.exit(1);
});
