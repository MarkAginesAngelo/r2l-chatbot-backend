const { AppError } = require('./errorHandler');

/**
 * Usage: router.post('/', validate(schema), controller)
 * Validates req.body against a zod schema and replaces it with the parsed
 * (and type-coerced) result, so controllers can trust their inputs.
 */
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      throw new AppError('Validation failed', 400, result.error.flatten().fieldErrors);
    }
    req.body = result.data;
    next();
  };
}

module.exports = { validate };
