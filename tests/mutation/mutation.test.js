const { describe, test, expect } = require('../test-framework');
const { parse } = require('../../packages/core/src/parser');
const { generate } = require('../../packages/core/src/generator');
const { transform } = require('../../packages/core/src/ast/visitor');
const { ASTNodeType, identifier } = require('../../packages/core/src/ast/nodes');
const { RecoveryPipeline } = require('../../packages/core/src/transforms/pipeline');

function runMutationTests() {
  describe('Rule 10: Non-Semantic Mutation Testing Suite', () => {
    const pipeline = new RecoveryPipeline();

    test('1. Renaming local variables preserves recovery semantics', () => {
      const src1 = 'local x = 10 + 20; local y = x * 2; print(y)';
      const src2 = 'local myVar = 10 + 20; local myResult = myVar * 2; print(myResult)';

      const res1 = pipeline.run(src1);
      const res2 = pipeline.run(src2);

      expect(res1.report.roundtripVerified).toBe(true);
      expect(res2.report.roundtripVerified).toBe(true);
      expect(res1.report.constantsFolded).toBe(res2.report.constantsFolded);
    });

    test('2. Changing whitespace and formatting preserves recovery output', () => {
      const src1 = 'local a=1+2\nlocal b=3+4\nprint(a,b)';
      const src2 = '   local   a  =   1  +  2   ;\n\n\n   local   b  =  3  +  4  ;\n   print( a , b )  ';

      const res1 = pipeline.run(src1);
      const res2 = pipeline.run(src2);

      expect(res1.report.constantsFolded).toBe(2);
      expect(res2.report.constantsFolded).toBe(2);
      expect(res1.code.trim()).toBe(res2.code.trim());
    });

    test('3. Reordering independent local declarations preserves pipeline stability', () => {
      const src1 = 'local a = 10 + 5; local b = 20 + 4; print(a + b)';
      const src2 = 'local b = 20 + 4; local a = 10 + 5; print(a + b)';

      const res1 = pipeline.run(src1);
      const res2 = pipeline.run(src2);

      expect(res1.report.constantsFolded).toBe(res2.report.constantsFolded);
      expect(res1.report.roundtripVerified).toBe(true);
      expect(res2.report.roundtripVerified).toBe(true);
    });

    test('4. Altering generated identifiers preserves recovery structure', () => {
      const ast = parse('local __gen1 = 5 * 10; print(__gen1)');
      const mutatedAst = transform(ast, (node) => {
        if (node.type === ASTNodeType.Identifier && node.name === '__gen1') {
          return identifier('__mutatedVar99');
        }
        return undefined;
      });

      const mutatedCode = generate(mutatedAst);
      const res = pipeline.run(mutatedCode);
      expect(res.report.constantsFolded).toBe(1);
      expect(res.code.includes('__mutatedVar99')).toBe(true);
    });
  });
}

module.exports = { runMutationTests };

if (require.main === module) {
  runMutationTests();
  const { printSummary } = require('../test-framework');
  printSummary();
}
