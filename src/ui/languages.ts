const display = new Intl.DisplayNames(['en'], { type: 'language' });
const names = new Map<string, string>();
for (let a = 97; a <= 122; a++)
    for (let b = 97; b <= 122; b++) {
        const code = String.fromCharCode(a, b), name = display.of(code);
        if (name && name !== code)
            names.set(code, name);
    }
for (const [code, name] of [['es-la', 'Spanish (Latin America)'], ['pt-br', 'Portuguese (Brazil)'], ['zh-hk', 'Chinese (Traditional)'], ['zh-ro', 'Chinese (Romanized)'], ['fil', 'Filipino']])
    names.set(code, name);
export const languageOptions = [...names].sort((a, b) => a[1].localeCompare(b[1]));
export const languageName = (code: string) => names.get(code) ?? 'Other language';
