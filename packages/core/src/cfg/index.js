const { BasicBlock } = require('./basic-block');
const { Edge, EdgeType } = require('./edge');
const { ControlFlowGraph } = require('./cfg');
const { DispatcherAnalyzer } = require('./dispatcher');

module.exports = {
  BasicBlock,
  Edge,
  EdgeType,
  ControlFlowGraph,
  DispatcherAnalyzer
};
