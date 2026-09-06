class ValaxError extends Error {
  constructor(message, code = 'VALAX_ERROR') {
    super(message);
    this.name = 'ValaxError';
    this.code = code;
  }
}

class ParseError extends ValaxError {
  constructor(message, line, column, offset) {
    super(`${message} at line ${line}, col ${column} (offset ${offset})`, 'PARSE_ERROR');
    this.name = 'ParseError';
    this.line = line;
    this.column = column;
    this.offset = offset;
  }
}

class LimitExceededError extends ValaxError {
  constructor(message) {
    super(message, 'LIMIT_EXCEEDED');
    this.name = 'LimitExceededError';
  }
}

class DeobfuscationError extends ValaxError {
  constructor(message, phase = 'UNKNOWN') {
    super(`[${phase}] ${message}`, 'DEOBFUSCATION_ERROR');
    this.name = 'DeobfuscationError';
    this.phase = phase;
  }
}

module.exports = {
  ValaxError,
  ParseError,
  LimitExceededError,
  DeobfuscationError
};
