'use strict';

/**
 * Lambda handlers (files matching packages/api/**\/handlers/*.ts or
 * packages/runner/**\/handler.ts) must import a Zod schema from
 * @agent-village/shared and invoke `.parse(...)` on input within the handler.
 *
 * Self-correcting message: tells the author exactly which schema location to
 * import from.
 */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Lambda handlers must validate inputs with a Zod schema from @agent-village/shared.',
    },
    schema: [],
    messages: {
      missingSchemaImport:
        'Handler file must import a Zod schema from @agent-village/shared/schemas. Add `import { <Schema> } from "@agent-village/shared/schemas";` at the top.',
      missingParseCall:
        'Handler must validate input with `<Schema>.parse(rawInput)` before using it. Untyped input crosses the trust boundary.',
    },
  },
  create(context) {
    const filename = context.filename || context.getFilename();
    if (/\.(test|spec)\.ts$/.test(filename)) return {};
    const isHandler =
      /packages\/api\/.*\/handlers\/.*\.ts$/.test(filename) ||
      /packages\/runner\/.*\/handler\.ts$/.test(filename);
    if (!isHandler) return {};

    let importsSchema = false;
    let callsParse = false;

    return {
      ImportDeclaration(node) {
        const src = node.source.value;
        if (typeof src === 'string' && src.startsWith('@agent-village/shared')) {
          importsSchema = true;
        }
      },
      CallExpression(node) {
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'parse'
        ) {
          callsParse = true;
        }
      },
      'Program:exit'(node) {
        if (!importsSchema) {
          context.report({ node, messageId: 'missingSchemaImport' });
        }
        if (!callsParse) {
          context.report({ node, messageId: 'missingParseCall' });
        }
      },
    };
  },
};
