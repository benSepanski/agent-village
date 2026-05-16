'use strict';

module.exports = {
  rules: {
    'logger-must-use-event-envelope': require('./rules/logger-must-use-event-envelope.js'),
    'handler-must-validate-with-zod': require('./rules/handler-must-validate-with-zod.js'),
  },
};
