/**
 * Structural Clustering for Obfuscated Fixtures
 */

class StructuralClusterer {
  /**
   * Classify a structural fingerprint into a Variant Family.
   * @param {object} fingerprint
   * @returns {string} Variant Family identifier
   */
  classify(fingerprint) {
    if (!fingerprint) return 'UNKNOWN_FAMILY';

    if (fingerprint.dispatcherTopology === 'binary_search_tree') {
      if (fingerprint.alphabetHash && fingerprint.stringPoolShape.size > 50) {
        return 'Variant_Family_A_WeAreDevs_BST_Alphabet';
      }
      if (fingerprint.alphabetHash) {
        return 'Variant_Family_A2_BST_Alphabet_Compact';
      }
      return 'Variant_Family_A3_BST_Custom_Pool';
    }

    if (fingerprint.dispatcherTopology === 'flat_switch') {
      return 'Variant_Family_B_Flat_Switch';
    }

    if (fingerprint.dispatcherTopology === 'linear_elseif') {
      return 'Variant_Family_C_Linear_Dispatcher';
    }

    if (fingerprint.totalClosureConstructors > 0) {
      return 'Variant_Family_D_Closure_Only';
    }

    return 'Variant_Family_E_Clean_Or_Minimal';
  }

  /**
   * Clusters a list of fixtures by their structural fingerprints.
   * @param {Array<object>} fixturesList [{ fixtureId, fingerprint }]
   * @returns {Map<string, Array<string>>}
   */
  cluster(fixturesList) {
    const clusters = new Map();
    for (const f of fixturesList) {
      const fam = this.classify(f.fingerprint);
      if (!clusters.has(fam)) {
        clusters.set(fam, []);
      }
      clusters.get(fam).push(f.fixtureId);
    }
    return clusters;
  }
}

module.exports = { StructuralClusterer };
