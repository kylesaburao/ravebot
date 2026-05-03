import EN from './translation.en.json';

export const getTranslation = (key: string) => {
    const text = EN[key as keyof typeof EN];
    return text
        ? text
        : key;
};
