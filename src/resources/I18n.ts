import EN from './translation.en.json';

export const getTranslation = (key: string) => {
    const text = EN[key as keyof typeof EN];
    return text
        ? text
        : key;
};

export const formatTranslation = (key: string, values: Record<string, string | number>): string =>
    Object.entries(values).reduce(
        (message, [name, value]) => message.replaceAll(`{${name}}`, String(value)),
        getTranslation(key)
    );
