'use strict';

/**
 * Forbid `logger.<level>("free-form string")`. Every log call MUST pass an
 * object literal with a closed-enum `event` key, so logs are filterable
 * machine-readable, and so structured-log queries always work.
 *
 * Self-correcting message: tells the author the exact fix.
 */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require structured logging: logger.<level>({ event: "name", ...payload }) instead of free-form strings.',
    },
    schema: [],
    messages: {
      stringArg:
        'Replace `{{name}}.{{level}}("...")` with `{{name}}.{{level}}({{ event: "<closed-enum>", ...payload }})`. See packages/shared/src/observability/events.ts for the allowed event names. Free-form string logs make the timeline view in the run UI unfilterable.',
      missingEvent:
        '`{{name}}.{{level}}(...)` must include an `event` key from LOG_EVENTS. Add `event: "<one of LOG_EVENTS>"` to the object literal.',
    },
  },
  create(context) {
    const LEVELS = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);

    function isLoggerName(name) {
      return name === 'logger' || name === 'log' || /Logger$/.test(name);
    }

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression') return;
        if (callee.object.type !== 'Identifier') return;
        if (!isLoggerName(callee.object.name)) return;
        if (callee.property.type !== 'Identifier') return;
        if (!LEVELS.has(callee.property.name)) return;

        const firstArg = node.arguments[0];
        if (!firstArg) return;

        if (firstArg.type === 'Literal' && typeof firstArg.value === 'string') {
          context.report({
            node: firstArg,
            messageId: 'stringArg',
            data: { name: callee.object.name, level: callee.property.name },
          });
          return;
        }
        if (firstArg.type === 'TemplateLiteral') {
          context.report({
            node: firstArg,
            messageId: 'stringArg',
            data: { name: callee.object.name, level: callee.property.name },
          });
          return;
        }
        if (firstArg.type === 'ObjectExpression') {
          const hasEvent = firstArg.properties.some(
            (p) => p.type === 'Property' && p.key.type === 'Identifier' && p.key.name === 'event',
          );
          if (!hasEvent) {
            context.report({
              node: firstArg,
              messageId: 'missingEvent',
              data: { name: callee.object.name, level: callee.property.name },
            });
          }
        }
      },
    };
  },
};
