const { StringRecoveryTransform } = require('./string-recovery');
const { AliasRecoveryTransform } = require('./alias-recovery');
const { StateMachineRestructurer } = require('./state-restructure');
const { CleanupPasses } = require('./cleanup');
const { RecoveryPipeline } = require('./pipeline');

module.exports = {
  StringRecoveryTransform,
  AliasRecoveryTransform,
  StateMachineRestructurer,
  CleanupPasses,
  RecoveryPipeline
};
