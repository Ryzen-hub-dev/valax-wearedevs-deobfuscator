const { ASTNodeType } = require('./nodes');

/**
 * Traverses an AST with enter and/or leave callbacks.
 * @param {object} node
 * @param {{ enter?: (node: object, parent: object | null, key: string | null) => any, leave?: (node: object, parent: object | null, key: string | null) => any }} visitor
 * @param {object} [parent]
 * @param {string} [key]
 */
function traverse(node, visitor, parent = null, key = null) {
  if (!node || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      traverse(node[i], visitor, parent, key);
    }
    return;
  }

  if (node.type && visitor.enter) {
    const res = visitor.enter(node, parent, key);
    if (res === false) return;
  }

  // Visit child properties
  for (const prop of Object.keys(node)) {
    if (prop === 'loc' || prop === 'type' || prop === 'parent') continue;
    const val = node[prop];
    if (val && typeof val === 'object') {
      traverse(val, visitor, node, prop);
    }
  }

  if (node.type && visitor.leave) {
    visitor.leave(node, parent, key);
  }
}

/**
 * Recursively rewrites an AST.
 * If transformer returns a new node, it replaces the current node.
 * If it returns null/undefined, it keeps the current node.
 * @param {object} node
 * @param {(node: object, parent: object | null, key: string | null) => object | null | undefined} transformer
 * @param {object} [parent]
 * @param {string} [key]
 */
function transform(node, transformer, parent = null, key = null) {
  if (!node || typeof node !== 'object') return node;

  if (Array.isArray(node)) {
    const newArr = [];
    for (let i = 0; i < node.length; i++) {
      const res = transform(node[i], transformer, parent, key);
      if (res !== null && res !== undefined) {
        if (Array.isArray(res)) {
          newArr.push(...res);
        } else {
          newArr.push(res);
        }
      }
    }
    return newArr;
  }

  // First transform child properties
  for (const prop of Object.keys(node)) {
    if (prop === 'loc' || prop === 'type' || prop === 'parent') continue;
    const val = node[prop];
    if (val && typeof val === 'object') {
      node[prop] = transform(val, transformer, node, prop);
    }
  }

  // Then apply transformer to this node if typed
  if (node.type) {
    const replacement = transformer(node, parent, key);
    return replacement !== undefined ? replacement : node;
  }
  return node;
}

module.exports = {
  traverse,
  transform
};
