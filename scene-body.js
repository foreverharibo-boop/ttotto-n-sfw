// Comparison only: never remove another extension's data from the live message.
// Archive/CHARM removes these protocol blocks after MESSAGE_RECEIVED. Treat that
// cleanup as the same narrative, but keep arbitrary HTML and Info_panel content.
export function stripAuxiliarySceneReports(text) {
    return String(text ?? '').replace(
        /\s*<\s*charm[-_]?now\s*>(?:(?!<\s*charm[-_]?now\s*>)[\s\S])*?<\s*\/\s*charm[-_]?now\s*>\s*/gi,
        '\n',
    ).trimEnd();
}
