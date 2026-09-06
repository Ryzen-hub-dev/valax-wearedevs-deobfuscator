const functionIR = require('./function-ir');
const semanticOp = require('./semantic-op');

module.exports = {
  ...functionIR,
  ...semanticOp
};
