/**
 * Slash command specification for /valax-recover
 */
const ValaxRecoverCommand = {
  name: 'valax-recover',
  description: 'Deobfuscate and normalize heavily transformed Lua/Luau source code',
  options: [
    {
      name: 'file',
      description: 'The obfuscated Lua/Luau script file to analyze and recover',
      type: 11, // ATTACHMENT
      required: true
    },
    {
      name: 'stage',
      description: 'Target recovery level (default: L5)',
      type: 3, // STRING
      required: false,
      choices: [
        { name: 'L1 - Constants Normalized', value: 'L1' },
        { name: 'L2 - Strings Recovered', value: 'L2' },
        { name: 'L3 - Runtime Simplified', value: 'L3' },
        { name: 'L4 - Control Flow Recovered', value: 'L4' },
        { name: 'L5 - Source Reconstructed', value: 'L5' }
      ]
    }
  ]
};

module.exports = { ValaxRecoverCommand };
