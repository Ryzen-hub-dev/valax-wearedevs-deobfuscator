class RuntimeClassifier {
  /**
   * Classify runtime architecture based on structural AST and CFG evidence.
   * @param {object} astChunk
   * @param {object} [cfgInfo]
   * @param {object} [adapterInfo]
   */
  classify(astChunk, cfgInfo = null, adapterInfo = null) {
    const evidence = {
      hasInstructionPointer: false,
      hasOpcodeTable: false,
      hasStackStorage: false,
      hasBinarySearchDispatcher: false,
      hasStateVariable: false,
      hasConstantPool: false,
      hasCustomAlphabetDecoder: false,
      hasUpvalueClosureWrappers: false,
      hasReferenceCountedRegisters: false
    };

    if (adapterInfo && adapterInfo.stringsFound > 50) {
      evidence.hasConstantPool = true;
    }
    if (adapterInfo && adapterInfo.hasAlphabet) {
      evidence.hasCustomAlphabetDecoder = true;
    }

    if (cfgInfo && cfgInfo.states > 10) {
      evidence.hasBinarySearchDispatcher = true;
      evidence.hasStateVariable = true;
    }

    // Inspect AST for closure wrappers and register management
    const rawAst = JSON.stringify(astChunk);
    if (rawAst.includes('getfenv') && rawAst.includes('newproxy')) {
      evidence.hasUpvalueClosureWrappers = true;
    }
    if (rawAst.includes('table.concat') && rawAst.includes('string.sub')) {
      evidence.hasCustomAlphabetDecoder = true;
    }

    // Determine classification
    let classification = 'Standard Lua Script';
    let confidence = 0.5;

    if (evidence.hasOpcodeTable && evidence.hasInstructionPointer) {
      classification = 'Custom Bytecode Virtual Machine';
      confidence = 0.95;
    } else if (evidence.hasBinarySearchDispatcher && evidence.hasStateVariable) {
      classification = 'State-Driven Transformed Runtime (Flattened Dispatcher)';
      confidence = 0.98;
    } else if (evidence.hasConstantPool || evidence.hasCustomAlphabetDecoder) {
      classification = 'Encoded String-Pool Protected Script';
      confidence = 0.90;
    }

    return {
      classification,
      confidence,
      evidence
    };
  }
}

module.exports = { RuntimeClassifier };
