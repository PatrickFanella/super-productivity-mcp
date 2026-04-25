function typedError(code, message, retryable = false, details = {}) {
  return { code, message, retryable, details };
}

module.exports = {
  typedError,
};
