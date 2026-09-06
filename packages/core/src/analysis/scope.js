class Scope {
  /**
   * @param {Scope | null} parent
   */
  constructor(parent = null) {
    this.parent = parent;
    this.children = [];
    this.variables = new Map(); // name -> { declarations: [], references: [], writes: [] }
    if (parent) {
      parent.children.push(this);
    }
  }

  declare(name, node) {
    if (!this.variables.has(name)) {
      this.variables.set(name, {
        declarations: [],
        references: [],
        writes: []
      });
    }
    this.variables.get(name).declarations.push(node);
  }

  reference(name, node) {
    let scope = this;
    while (scope) {
      if (scope.variables.has(name)) {
        scope.variables.get(name).references.push(node);
        return;
      }
      scope = scope.parent;
    }
  }

  write(name, node) {
    let scope = this;
    while (scope) {
      if (scope.variables.has(name)) {
        scope.variables.get(name).writes.push(node);
        return;
      }
      scope = scope.parent;
    }
  }

  resolve(name) {
    let scope = this;
    while (scope) {
      if (scope.variables.has(name)) {
        return scope.variables.get(name);
      }
      scope = scope.parent;
    }
    return null;
  }
}

module.exports = { Scope };
