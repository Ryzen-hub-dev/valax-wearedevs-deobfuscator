const { WeAreDevsAdapter } = require('../adapters/wearedevs/wearedevs-adapter');

class FormatDetector {
  constructor() {
    this.adapters = [
      new WeAreDevsAdapter()
    ];
  }

  /**
   * Detect the obfuscation format and version.
   * @param {object} ast
   * @param {string} rawSource
   * @returns {{ format: string, version: string, confidence: number, adapter: object | null }}
   */
  detect(ast, rawSource) {
    for (const adapter of this.adapters) {
      const res = adapter.detect(ast, rawSource);
      if (res.detected) {
        return {
          format: 'WeAreDevs',
          version: res.version,
          confidence: res.confidence,
          adapter
        };
      }
    }

    return {
      format: 'Generic/Unknown',
      version: 'unknown',
      confidence: 0.1,
      adapter: null
    };
  }
}

module.exports = { FormatDetector };
