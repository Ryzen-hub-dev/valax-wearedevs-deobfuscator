const { describe, test, expect } = require('../test-framework');
const { parse } = require('../../packages/core/src/parser');
const { generate } = require('../../packages/core/src/generator');
const { ASTNodeType } = require('../../packages/core/src/ast/nodes');

function runParserTests() {
  describe('Phase 1: Lua/Luau Frontend (Parser & Lexer)', () => {
    test('parses simple assignment and print', () => {
      const ast = parse('local a = 10\nprint(a)');
      expect(ast.type).toBe(ASTNodeType.Chunk);
      expect(ast.body.length).toBe(2);
      expect(ast.body[0].type).toBe(ASTNodeType.LocalStatement);
      expect(ast.body[0].variables[0].name).toBe('a');
      expect(ast.body[0].init[0].value).toBe(10);
      expect(ast.body[1].type).toBe(ASTNodeType.CallStatement);
    });

    test('parses functions and closures', () => {
      const src = `
        local function add(a, b)
          return a + b
        end
        local f = function(...) return select("#", ...) end
      `;
      const ast = parse(src);
      expect(ast.body.length).toBe(2);
      expect(ast.body[0].type).toBe(ASTNodeType.LocalFunctionStatement);
      expect(ast.body[0].identifier.name).toBe('add');
      expect(ast.body[0].params.length).toBe(2);
      expect(ast.body[1].type).toBe(ASTNodeType.LocalStatement);
      expect(ast.body[1].init[0].type).toBe(ASTNodeType.FunctionExpression);
      expect(ast.body[1].init[0].isVararg).toBe(true);
    });

    test('parses tables with mixed separators (commas and semicolons)', () => {
      const src = 'local t = { a = 1; b = 2, [3] = "three"; "four", "five" }';
      const ast = parse(src);
      const tDecl = ast.body[0];
      const tableCons = tDecl.init[0];
      expect(tableCons.type).toBe(ASTNodeType.TableConstructor);
      expect(tableCons.fields.length).toBe(5);
    });

    test('parses control flow: if, elseif, else, while, repeat, for', () => {
      const src = `
        if x < 10 then
          print("small")
        elseif x == 10 then
          print("ten")
        else
          print("large")
        end

        while true do
          break
        end

        repeat
          x = x + 1
        until x > 100

        for i = 1, 10, 2 do
          print(i)
        end

        for k, v in pairs(t) do
          print(k, v)
        end
      `;
      const ast = parse(src);
      expect(ast.body.length).toBe(5);
      expect(ast.body[0].type).toBe(ASTNodeType.IfStatement);
      expect(ast.body[1].type).toBe(ASTNodeType.WhileStatement);
      expect(ast.body[2].type).toBe(ASTNodeType.RepeatStatement);
      expect(ast.body[3].type).toBe(ASTNodeType.NumericForStatement);
      expect(ast.body[4].type).toBe(ASTNodeType.GenericForStatement);
    });

    test('parses decimal byte escape strings', () => {
      const src = 'local s = "\\067\\086\\084\\076"';
      const ast = parse(src);
      const strNode = ast.body[0].init[0];
      expect(strNode.type).toBe(ASTNodeType.StringLiteral);
      expect(strNode.value.toString('latin1')).toBe('CVTL');
    });

    test('preserves operator precedence and associativity', () => {
      const src = 'local x = 1 + 2 * 3 ^ 4 .. "a"';
      const ast = parse(src);
      const gen = generate(ast);
      expect(gen).toContain('1 + 2 * 3 ^ 4 .. "a"');
    });

    test('parses method call and member indexing', () => {
      const src = 'game.Players.LocalPlayer:Kick("banned")';
      const ast = parse(src);
      expect(ast.body[0].type).toBe(ASTNodeType.CallStatement);
      const call = ast.body[0].expression;
      expect(call.type).toBe(ASTNodeType.MethodCallExpression);
      expect(call.method.name).toBe('Kick');
      expect(call.base.type).toBe(ASTNodeType.MemberExpression);
      expect(call.base.property.name).toBe('LocalPlayer');
    });

    test('code generator roundtrips faithfully', () => {
      const src = `local a = 10
local function test(x, y)
  if x > y then
    return x - y
  else
    return y - x
  end
end
print(test(5, 12))`;
      const ast1 = parse(src);
      const emitted = generate(ast1);
      const ast2 = parse(emitted);
      expect(ast2.body.length).toBe(ast1.body.length);
    });
  });
}

module.exports = { runParserTests };
if (require.main === module) {
  runParserTests();
  const { printSummary } = require('../test-framework');
  printSummary();
}
