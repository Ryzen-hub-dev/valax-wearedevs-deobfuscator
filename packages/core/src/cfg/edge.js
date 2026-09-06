const EdgeType = {
  UNCONDITIONAL: 'UNCONDITIONAL',
  CONDITIONAL_TRUE: 'CONDITIONAL_TRUE',
  CONDITIONAL_FALSE: 'CONDITIONAL_FALSE',
  TABLE_DISPATCH: 'TABLE_DISPATCH',
  DYNAMIC: 'DYNAMIC'
};

class Edge {
  /**
   * @param {BasicBlock} source
   * @param {BasicBlock} target
   * @param {string} type EdgeType
   * @param {object} [condition] AST condition expression for conditional edges
   */
  constructor(source, target, type = EdgeType.UNCONDITIONAL, condition = null) {
    this.source = source;
    this.target = target;
    this.type = type;
    this.condition = condition;
  }
}

module.exports = {
  Edge,
  EdgeType
};
