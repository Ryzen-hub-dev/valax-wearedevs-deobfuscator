class BasicBlock {
  /**
   * @param {number | string} id State ID or unique identifier
   */
  constructor(id) {
    this.id = id;
    this.statements = [];
    this.predecessors = []; // Array of Edge
    this.successors = [];   // Array of Edge
    this.stateTransitions = []; // { targetState, condition?: any }
    this.isEntry = false;
    this.isExit = false;
  }

  addStatement(stmt) {
    this.statements.push(stmt);
  }

  addSuccessor(edge) {
    this.successors.push(edge);
  }

  addPredecessor(edge) {
    this.predecessors.push(edge);
  }
}

module.exports = { BasicBlock };
