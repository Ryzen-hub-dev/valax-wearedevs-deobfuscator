const { ASTNodeType } = require('./nodes');

/**
 * Traverses an AST with enter and/or leave callbacks.
 * @param {object} node
 * @param {{ enter?: (node: object, parent: object | null, key: string | null) => any, leave?: (node: object, parent: object | null, key: string | null) => any }} visitor
 * @param {object} [parent]
 * @param {string} [key]
 */
function traverse(node, visitor, parent = null, key = null) {
  const stack = [{ kind: 'enter', value: node, parent, key }];

  while (stack.length > 0) {
    const frame = stack.pop();

    if (frame.kind === 'leave') {
      visitor.leave(frame.value, frame.parent, frame.key);
      continue;
    }

    const value = frame.value;
    if (!value || typeof value !== 'object') continue;

    if (Array.isArray(value)) {
      for (let i = value.length - 1; i >= 0; i--) {
        stack.push({ kind: 'enter', value: value[i], parent: frame.parent, key: frame.key });
      }
      continue;
    }

    if (value.type && visitor.enter) {
      const res = visitor.enter(value, frame.parent, frame.key);
      if (res === false) continue;
    }

    if (value.type && visitor.leave) {
      stack.push({ kind: 'leave', value, parent: frame.parent, key: frame.key });
    }

    const props = Object.keys(value);
    for (let i = props.length - 1; i >= 0; i--) {
      const prop = props[i];
      if (prop === 'loc' || prop === 'type' || prop === 'parent') continue;
      const child = value[prop];
      if (child && typeof child === 'object') {
        stack.push({ kind: 'enter', value: child, parent: value, key: prop });
      }
    }
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
  let result = node;
  const stack = [{
    kind: 'value',
    value: node,
    parent,
    key,
    assign: value => { result = value; }
  }];

  while (stack.length > 0) {
    const frame = stack.pop();

    if (frame.kind === 'finish-array') {
      const output = [];
      for (const item of frame.items) {
        if (item === null || item === undefined) continue;
        if (Array.isArray(item)) output.push(...item);
        else output.push(item);
      }
      frame.assign(output);
      continue;
    }

    if (frame.kind === 'finish-object') {
      if (frame.value.type) {
        const replacement = transformer(frame.value, frame.parent, frame.key);
        frame.assign(replacement !== undefined ? replacement : frame.value);
      } else {
        frame.assign(frame.value);
      }
      continue;
    }

    const value = frame.value;
    if (!value || typeof value !== 'object') {
      frame.assign(value);
      continue;
    }

    if (Array.isArray(value)) {
      const items = new Array(value.length);
      stack.push({ kind: 'finish-array', items, assign: frame.assign });
      for (let i = value.length - 1; i >= 0; i--) {
        stack.push({
          kind: 'value',
          value: value[i],
          parent: frame.parent,
          key: frame.key,
          assign: transformed => { items[i] = transformed; }
        });
      }
      continue;
    }

    stack.push({
      kind: 'finish-object',
      value,
      parent: frame.parent,
      key: frame.key,
      assign: frame.assign
    });

    const props = Object.keys(value);
    for (let i = props.length - 1; i >= 0; i--) {
      const prop = props[i];
      if (prop === 'loc' || prop === 'type' || prop === 'parent') continue;
      const child = value[prop];
      if (child && typeof child === 'object') {
        stack.push({
          kind: 'value',
          value: child,
          parent: value,
          key: prop,
          assign: transformed => { value[prop] = transformed; }
        });
      }
    }
  }

  return result;
}

module.exports = {
  traverse,
  transform
};
