const { Parser } = require('./parser');

function parse(source) {
  const parser = new Parser(source);
  return parser.parseChunk();
}

module.exports = {
  Parser,
  parse
};
