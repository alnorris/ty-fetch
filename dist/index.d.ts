import type ts from "typescript";
declare function init(modules: {
    typescript: typeof import("typescript");
}): {
    create: (info: ts.server.PluginCreateInfo) => ts.LanguageService;
};
export = init;
