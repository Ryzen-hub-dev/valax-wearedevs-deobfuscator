/**
 * Representation of semantic callable identities and variable aliases.
 */
class KnownBuiltin {
  constructor(name) {
    this.type = 'KnownBuiltin';
    this.name = name;
  }

  toString() {
    return this.name;
  }
}

class UnknownCallable {
  constructor(id) {
    this.type = 'UnknownCallable';
    this.id = id;
  }

  toString() {
    return `unknown_${this.id}`;
  }
}

const STANDARD_BUILTINS = new Set([
  'assert', 'collectgarbage', 'dofile', 'error', 'getfenv', 'getmetatable',
  'ipairs', 'load', 'loadfile', 'loadstring', 'next', 'pairs', 'pcall',
  'print', 'rawequal', 'rawget', 'rawset', 'select', 'setfenv', 'setmetatable',
  'tonumber', 'tostring', 'type', 'unpack', 'xpcall', '_G', '_VERSION',
  // Libraries
  'string', 'table', 'math', 'os', 'io', 'debug', 'coroutine', 'bit32', 'utf8',
  // Roblox / Luau common globals
  'game', 'workspace', 'script', 'Instance', 'Vector3', 'CFrame', 'Color3',
  'UDim2', 'Enum', 'task', 'typeof', 'warn', 'tick', 'time', 'delay', 'spawn',
  'wait', 'newproxy'
]);

module.exports = {
  KnownBuiltin,
  UnknownCallable,
  STANDARD_BUILTINS
};
