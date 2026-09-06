const ASTNodeType = {
  Chunk: 'Chunk',

  // Statements
  LocalStatement: 'LocalStatement',
  AssignmentStatement: 'AssignmentStatement',
  LocalFunctionStatement: 'LocalFunctionStatement',
  FunctionDeclaration: 'FunctionDeclaration',
  CallStatement: 'CallStatement',
  IfStatement: 'IfStatement',
  WhileStatement: 'WhileStatement',
  RepeatStatement: 'RepeatStatement',
  NumericForStatement: 'NumericForStatement',
  GenericForStatement: 'GenericForStatement',
  DoStatement: 'DoStatement',
  ReturnStatement: 'ReturnStatement',
  BreakStatement: 'BreakStatement',
  ContinueStatement: 'ContinueStatement',
  EmptyStatement: 'EmptyStatement',

  // Expressions
  Identifier: 'Identifier',
  NumericLiteral: 'NumericLiteral',
  StringLiteral: 'StringLiteral',
  BooleanLiteral: 'BooleanLiteral',
  NilLiteral: 'NilLiteral',
  VarargLiteral: 'VarargLiteral',
  UnaryExpression: 'UnaryExpression',
  BinaryExpression: 'BinaryExpression',
  LogicalExpression: 'LogicalExpression',
  CallExpression: 'CallExpression',
  MethodCallExpression: 'MethodCallExpression',
  MemberExpression: 'MemberExpression',
  IndexExpression: 'IndexExpression',
  FunctionExpression: 'FunctionExpression',
  TableConstructor: 'TableConstructor',
  TableKey: 'TableKey',
  TableKeyString: 'TableKeyString',
  TableValue: 'TableValue'
};

class ASTNode {
  constructor(type, loc = null) {
    this.type = type;
    this.loc = loc;
  }
}

// Builders
function chunk(body, loc = null) {
  return { type: ASTNodeType.Chunk, body, loc };
}

function localStatement(variables, init = [], loc = null) {
  return { type: ASTNodeType.LocalStatement, variables, init, loc };
}

function assignmentStatement(variables, init = [], loc = null) {
  return { type: ASTNodeType.AssignmentStatement, variables, init, loc };
}

function localFunctionStatement(identifier, params, isVararg, body, loc = null) {
  return { type: ASTNodeType.LocalFunctionStatement, identifier, params, isVararg, body, loc };
}

function functionDeclaration(name, params, isVararg, body, isMethod = false, loc = null) {
  return { type: ASTNodeType.FunctionDeclaration, name, params, isVararg, body, isMethod, loc };
}

function callStatement(expression, loc = null) {
  return { type: ASTNodeType.CallStatement, expression, loc };
}

function ifStatement(clauses, elseBody = null, loc = null) {
  return { type: ASTNodeType.IfStatement, clauses, elseBody, loc };
}

function whileStatement(condition, body, loc = null) {
  return { type: ASTNodeType.WhileStatement, condition, body, loc };
}

function repeatStatement(condition, body, loc = null) {
  return { type: ASTNodeType.RepeatStatement, condition, body, loc };
}

function numericForStatement(variable, start, end, step, body, loc = null) {
  return { type: ASTNodeType.NumericForStatement, variable, start, end, step, body, loc };
}

function genericForStatement(variables, iterators, body, loc = null) {
  return { type: ASTNodeType.GenericForStatement, variables, iterators, body, loc };
}

function doStatement(body, loc = null) {
  return { type: ASTNodeType.DoStatement, body, loc };
}

function returnStatement(args = [], loc = null) {
  return { type: ASTNodeType.ReturnStatement, arguments: args, loc };
}

function breakStatement(loc = null) {
  return { type: ASTNodeType.BreakStatement, loc };
}

function continueStatement(loc = null) {
  return { type: ASTNodeType.ContinueStatement, loc };
}

function emptyStatement(loc = null) {
  return { type: ASTNodeType.EmptyStatement, loc };
}

// Expressions
function identifier(name, loc = null) {
  return { type: ASTNodeType.Identifier, name, loc };
}

function numericLiteral(value, raw = '', loc = null) {
  return { type: ASTNodeType.NumericLiteral, value, raw: raw || String(value), loc };
}

function stringLiteral(value, raw = '', loc = null) {
  return { type: ASTNodeType.StringLiteral, value, raw: raw || (typeof value === 'string' ? JSON.stringify(value) : value.toLuaLiteral()), loc };
}

function booleanLiteral(value, loc = null) {
  return { type: ASTNodeType.BooleanLiteral, value, loc };
}

function nilLiteral(loc = null) {
  return { type: ASTNodeType.NilLiteral, loc };
}

function varargLiteral(loc = null) {
  return { type: ASTNodeType.VarargLiteral, loc };
}

function unaryExpression(operator, argument, loc = null) {
  return { type: ASTNodeType.UnaryExpression, operator, argument, loc };
}

function binaryExpression(operator, left, right, loc = null) {
  return { type: ASTNodeType.BinaryExpression, operator, left, right, loc };
}

function logicalExpression(operator, left, right, loc = null) {
  return { type: ASTNodeType.LogicalExpression, operator, left, right, loc };
}

function callExpression(base, args = [], loc = null) {
  return { type: ASTNodeType.CallExpression, base, arguments: args, loc };
}

function methodCallExpression(base, method, args = [], loc = null) {
  return { type: ASTNodeType.MethodCallExpression, base, method, arguments: args, loc };
}

function memberExpression(base, property, loc = null) {
  return { type: ASTNodeType.MemberExpression, base, property, loc };
}

function indexExpression(base, index, loc = null) {
  return { type: ASTNodeType.IndexExpression, base, index, loc };
}

function functionExpression(params, isVararg, body, loc = null) {
  return { type: ASTNodeType.FunctionExpression, params, isVararg, body, loc };
}

function tableConstructor(fields = [], loc = null) {
  return { type: ASTNodeType.TableConstructor, fields, loc };
}

function tableKey(key, value, loc = null) {
  return { type: ASTNodeType.TableKey, key, value, loc };
}

function tableKeyString(key, value, loc = null) {
  return { type: ASTNodeType.TableKeyString, key, value, loc };
}

function tableValue(value, loc = null) {
  return { type: ASTNodeType.TableValue, value, loc };
}

module.exports = {
  ASTNodeType,
  ASTNode,
  chunk,
  localStatement,
  assignmentStatement,
  localFunctionStatement,
  functionDeclaration,
  callStatement,
  ifStatement,
  whileStatement,
  repeatStatement,
  numericForStatement,
  genericForStatement,
  doStatement,
  returnStatement,
  breakStatement,
  continueStatement,
  emptyStatement,
  identifier,
  numericLiteral,
  stringLiteral,
  booleanLiteral,
  nilLiteral,
  varargLiteral,
  unaryExpression,
  binaryExpression,
  logicalExpression,
  callExpression,
  methodCallExpression,
  memberExpression,
  indexExpression,
  functionExpression,
  tableConstructor,
  tableKey,
  tableKeyString,
  tableValue
};
