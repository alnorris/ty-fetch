"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findFetchCalls = findFetchCalls;
/**
 * Find all fetch()/tf.get()/api.post() calls in a source file.
 */
function findFetchCalls(ts, sourceFile) {
    const results = [];
    function nodeStart(node) { return node.getStart(sourceFile); }
    function nodeLen(node) { return node.getEnd() - nodeStart(node); }
    function visit(node) {
        if (ts.isCallExpression(node) && node.arguments.length > 0) {
            const expr = node.expression;
            let httpMethod = null;
            if (ts.isIdentifier(expr) && (expr.text === "fetch" || expr.text === "typedFetch")) {
                httpMethod = null;
            }
            else if (ts.isPropertyAccessExpression(expr) &&
                ts.isIdentifier(expr.expression) &&
                ["get", "post", "put", "patch", "delete", "head", "request"].includes(expr.name.text)) {
                httpMethod = expr.name.text === "request" || expr.name.text === "head" ? null : expr.name.text;
            }
            else if (ts.isIdentifier(expr)) {
                httpMethod = null;
            }
            else {
                ts.forEachChild(node, visit);
                return;
            }
            const arg = node.arguments[0];
            if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
                const urlStart = nodeStart(arg) + 1; // skip opening quote
                const urlLength = nodeLen(arg) - 2; // exclude quotes
                let jsonBody = null;
                if (node.arguments.length >= 2) {
                    const optionsArg = node.arguments[1];
                    if (ts.isObjectLiteralExpression(optionsArg)) {
                        const jsonProp = optionsArg.properties.find((p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "body");
                        if (jsonProp && ts.isObjectLiteralExpression(jsonProp.initializer)) {
                            jsonBody = extractJsonProperties(ts, sourceFile, jsonProp.initializer);
                        }
                    }
                }
                results.push({
                    url: arg.text,
                    httpMethod,
                    urlStart,
                    urlLength,
                    callStart: nodeStart(node),
                    callLength: nodeLen(node),
                    jsonBody,
                });
            }
        }
        ts.forEachChild(node, visit);
    }
    visit(sourceFile);
    return results;
}
function extractJsonProperties(ts, sf, obj) {
    function nodeStart(n) { return n.getStart(sf); }
    function nodeLen(n) { return n.getEnd() - nodeStart(n); }
    const props = [];
    for (const prop of obj.properties) {
        if (!ts.isPropertyAssignment(prop))
            continue;
        const name = ts.isIdentifier(prop.name) ? prop.name.text
            : ts.isStringLiteral(prop.name) ? prop.name.text
                : null;
        if (!name)
            continue;
        const valueNode = prop.initializer;
        let valueKind = "other";
        let valueText = "";
        if (ts.isNumericLiteral(valueNode)) {
            valueKind = "number";
            valueText = valueNode.text;
        }
        else if (ts.isStringLiteral(valueNode)) {
            valueKind = "string";
            valueText = valueNode.text;
        }
        else if (valueNode.kind === ts.SyntaxKind.TrueKeyword || valueNode.kind === ts.SyntaxKind.FalseKeyword) {
            valueKind = "boolean";
            valueText = valueNode.kind === ts.SyntaxKind.TrueKeyword ? "true" : "false";
        }
        else if (valueNode.kind === ts.SyntaxKind.NullKeyword) {
            valueKind = "null";
        }
        else if (ts.isArrayLiteralExpression(valueNode)) {
            valueKind = "array";
        }
        else if (ts.isObjectLiteralExpression(valueNode)) {
            valueKind = "object";
        }
        props.push({
            name,
            nameStart: nodeStart(prop.name),
            nameLength: nodeLen(prop.name),
            valueStart: nodeStart(valueNode),
            valueLength: nodeLen(valueNode),
            valueText,
            valueKind,
        });
    }
    return props;
}
