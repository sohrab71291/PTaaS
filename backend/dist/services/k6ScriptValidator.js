"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isBraceBalanced = isBraceBalanced;
// Lightweight structural sanity check for LLM-generated k6 scripts. This is not
// a full JS parser — it just verifies that every `{` / template `${` is closed
// before end of file, skipping over string/template literal contents and
// comments so quoted braces don't throw off the count. It exists to catch the
// most common LLM generation failure mode: a missing closing brace somewhere in
// a long script, which k6's goja engine reports opaquely as something like
// "export only allowed in global scope" instead of a clear brace-mismatch error.
function isBraceBalanced(code) {
    const stack = [];
    let i = 0;
    const n = code.length;
    while (i < n) {
        const inTemplate = stack[stack.length - 1] === 'template';
        const c = code[i];
        if (!inTemplate) {
            if (c === '/' && code[i + 1] === '/') {
                const nl = code.indexOf('\n', i);
                i = nl === -1 ? n : nl;
                continue;
            }
            if (c === '/' && code[i + 1] === '*') {
                const end = code.indexOf('*/', i + 2);
                i = end === -1 ? n : end + 2;
                continue;
            }
            if (c === '\'' || c === '"') {
                const quote = c;
                let j = i + 1;
                while (j < n && code[j] !== quote) {
                    if (code[j] === '\\')
                        j++;
                    j++;
                }
                i = j + 1;
                continue;
            }
            if (c === '`') {
                stack.push('template');
                i++;
                continue;
            }
            if (c === '{') {
                stack.push('brace');
                i++;
                continue;
            }
            if (c === '}') {
                if (stack[stack.length - 1] !== 'brace')
                    return false; // stray close brace
                stack.pop();
                i++;
                continue;
            }
            i++;
            continue;
        }
        // Inside a template literal: only `\`, closing backtick, and `${` matter.
        if (c === '\\') {
            i += 2;
            continue;
        }
        if (c === '`') {
            stack.pop();
            i++;
            continue;
        }
        if (c === '$' && code[i + 1] === '{') {
            stack.push('brace');
            i += 2;
            continue;
        }
        i++;
    }
    return stack.length === 0;
}
