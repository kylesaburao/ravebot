export const getDateLocaleString = (date: Date) => date.toLocaleString('en-US', { timeZone: 'America/Vancouver', timeZoneName: 'short' });
export const getCurrentTime = () => getDateLocaleString(new Date());
