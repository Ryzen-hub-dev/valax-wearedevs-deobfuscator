const { describe, test, expect } = require('../test-framework');
const { recover } = require('../../packages/core/src');
const { parse } = require('../../packages/core/src/parser');
const { generate } = require('../../packages/core/src/generator');
const { CompletenessVerifier } = require('../../packages/core/src/analysis/completeness-verifier');
const { SemanticOracle } = require('../../packages/core/src/oracle/semantic-oracle');

function runL5AuthenticityNegativeTests() {
  describe('Rule 3-9 & 18: L5 Authenticity & Negative Anti-Deletion Test Suite', () => {

    test('1. Statically constant branch folds cleanly (Test A)', () => {
      const code = `
        local x = true
        if x then
          print("A")
        else
          print("B")
        end
      `;
      const res = recover(code);
      expect(res.code).toContain('print("A")');
      expect(res.code.includes('print("B")')).toBe(false);
    });

    test('2. External-input branch survives without dynamic-only deletion (Test B)', () => {
      const code = `
        local x = externalValue
        if x then
          print("A")
        else
          print("B")
        end
      `;
      const res = recover(code);
      // Both branches MUST be preserved because externalValue is unknown
      expect(res.code).toContain('print("A")');
      expect(res.code).toContain('print("B")');
      expect(res.code).toContain('if');
      expect(res.report.recoveryLevel === 'L5-W').toBe(false);
    });

    test('2b. External-input if-else hi/bye survives without dynamic-only deletion', () => {
      const code = `
        local x = externalValue
        if x then
          print("hi")
        else
          print("bye")
        end
      `;
      const res = recover(code);
      expect(res.code).toContain('print("hi")');
      expect(res.code).toContain('print("bye")');
      expect(res.code).toContain('if');
      expect(res.report.recoveryLevel === 'L5-W').toBe(false);
    });

    test('3. Deferred callback passed to register() survives', () => {
      const code = `
        local function callback(x)
          print(x)
        end
        register(callback)
      `;
      const res = recover(code);
      expect(res.code).toContain('callback');
      expect(res.code).toContain('print(x)');
      expect(res.report.recoveryLevel === 'L5-W').toBe(false);
    });

    test('4. Event handler callback in event:Connect() survives', () => {
      const code = `
        event:Connect(function(v)
          print(v)
        end)
      `;
      const res = recover(code);
      expect(res.code).toContain('print(v)');
      expect(res.code).toContain('Connect');
      expect(res.report.recoveryLevel === 'L5-W').toBe(false);
    });

    test('5. Function-never-called survives without static dead code proof', () => {
      const code = `
        local function hidden()
          print("hidden")
        end
        print("main")
      `;
      const res = recover(code);
      expect(res.code).toContain('hidden');
      expect(res.code).toContain('print("hidden")');
      expect(res.code).toContain('print("main")');
    });

    test('6. Alternate-input function branch survives single-input call', () => {
      const code = `
        local function f(x)
          if x == 1 then
            return "A"
          else
            return "B"
          end
        end
        print(f(1))
      `;
      const res = recover(code);
      expect(res.code).toContain('"A"');
      expect(res.code).toContain('"B"');
      expect(res.code).toContain('else');
    });

    test('7. Unknown loop bounds preserve loop structure', () => {
      const code = `
        for i = 1, externalLimit do
          print(i)
        end
      `;
      const res = recover(code);
      expect(res.code).toContain('for i = 1, externalLimit do');
      expect(res.code).toContain('print(i)');
      expect(res.report.recoveryLevel === 'L5-W').toBe(false);
    });

    test('8. Table-stored function survives in recovered output', () => {
      const code = `
        local handlers = {
          onAction = function(x)
            print(x)
          end
        }
        print("ready")
      `;
      const res = recover(code);
      expect(res.code).toContain('onAction');
      expect(res.code).toContain('print(x)');
      expect(res.code).toContain('print("ready")');
    });

    test('9. CompletenessVerifier correctly identifies L5-W eligibility', () => {
      const verifier = new CompletenessVerifier();

      // Case A: Closed minimal print
      const closedAst = parse('print("hi")');
      const closedReport = verifier.verify(closedAst, null, { success: true, events: [{ type: 'CALL', target: 'print', args: [{ value: 'hi', type: 'string' }] }] });
      expect(closedReport.wholeProgramClosed).toBe(true);
      expect(closedReport.allReachableBehaviorCovered).toBe(true);
      expect(closedReport.isL5WEligible).toBe(true);
      expect(closedReport.recommendedLevel).toBe('L5-W');

      // Case B: Open external value
      const openAst = parse('local x = externalValue; if x then print("A") else print("B") end');
      const openReport = verifier.verify(openAst, null, { success: true, events: [{ type: 'CALL', target: 'print', args: [{ value: 'A', type: 'string' }] }] });
      expect(openReport.wholeProgramClosed).toBe(false);
      expect(openReport.isL5WEligible).toBe(false);
      expect(openReport.audit.externalInputs).toContain('externalValue');
    });

    test('10. Escaping nested closure with externalValue preserves function and prevents L5-W', () => {
      const code = `
        local function outer()
            local function inner()
                return externalValue
            end

            return inner
        end

        local f = outer()
        print(f())
      `;
      const res = recover(code);
      expect(res.code).toContain('function');
      expect(res.code).toContain('externalValue');
      expect(res.report.recoveryLevel === 'L5-W').toBe(false);
    });

    test('11. Escaping table passed to external consumer prevents L5-W', () => {
      const code = `
        local t = {
            message = "hi"
        }

        externalConsumer(t)
        print(t.message)
      `;
      const res = recover(code);
      expect(res.code).toContain('externalConsumer');
      expect(res.report.recoveryLevel === 'L5-W').toBe(false);
    });

    test('12. Table with metatable and __index callback prevents naive constant elimination', () => {
      const code = `
        local t = setmetatable({
            message = "hi"
        }, {
            __index = function()
                return "fallback"
            end
        })

        print(t.message)
      `;
      const res = recover(code);
      expect(res.code).toContain('setmetatable');
      expect(res.report.recoveryLevel === 'L5-W').toBe(false);
    });

    test('13. Multi-return TEST A — Single assignment truncation discards excess returns', () => {
      const code = `
        local function f()
            return "a", "b"
        end

        local x = f()
        print(x)
      `;
      const oracle = new SemanticOracle();
      const verifier = new CompletenessVerifier();
      const trace = oracle.trace(code);
      expect(trace.success).toBe(true);
      expect(trace.events.length).toBe(1);
      expect(trace.events[0].args.length).toBe(1);
      expect(trace.events[0].args[0].value).toBe('a');

      const ast = parse(code);
      const rep = verifier.verify(ast, null, trace);
      expect(rep.multiReturn.returnValueCount).toBe(2);
      expect(rep.multiReturn.assignmentTargetCount).toBe(1);
      expect(rep.multiReturn.truncationApplied).toBe(true);
      expect(rep.multiReturn.expansionPreserved).toBe(false);

      const synthesized = oracle.synthesizeAST(trace.events);
      const genCode = generate(synthesized);
      expect(genCode).toContain('print("a")');
      expect(genCode.includes('"b"')).toBe(false);
    });

    test('14. Multi-return TEST B — Tail position call expands all return values', () => {
      const code = `
        local function f()
            return "a", "b"
        end

        print(f())
      `;
      const oracle = new SemanticOracle();
      const verifier = new CompletenessVerifier();
      const trace = oracle.trace(code);
      expect(trace.success).toBe(true);
      expect(trace.events.length).toBe(1);
      expect(trace.events[0].args.length).toBe(2);
      expect(trace.events[0].args[0].value).toBe('a');
      expect(trace.events[0].args[1].value).toBe('b');

      const ast = parse(code);
      const rep = verifier.verify(ast, null, trace);
      expect(rep.multiReturn.returnValueCount).toBe(2);
      expect(rep.multiReturn.truncationApplied).toBe(false);
      expect(rep.multiReturn.expansionPreserved).toBe(true);

      const synthesized = oracle.synthesizeAST(trace.events);
      const genCode = generate(synthesized);
      expect(genCode).toContain('print("a", "b")');
    });

    test('15. Multi-return TEST C — Non-tail call argument truncates to exactly 1 value', () => {
      const code = `
        local function f()
            return "a", "b"
        end

        print(f(), "c")
      `;
      const oracle = new SemanticOracle();
      const trace = oracle.trace(code);
      expect(trace.success).toBe(true);
      expect(trace.events.length).toBe(1);
      expect(trace.events[0].args.length).toBe(2);
      expect(trace.events[0].args[0].value).toBe('a');
      expect(trace.events[0].args[1].value).toBe('c');

      const synthesized = oracle.synthesizeAST(trace.events);
      const genCode = generate(synthesized);
      expect(genCode).toContain('print("a", "c")');
      expect(genCode.includes('"b"')).toBe(false);
    });

    test('16. Multi-return TEST D — Multi-assignment truncates excess return values', () => {
      const code = `
        local function f()
            return "a", "b", "c"
        end

        local x, y = f()
        print(x)
        print(y)
      `;
      const oracle = new SemanticOracle();
      const verifier = new CompletenessVerifier();
      const trace = oracle.trace(code);
      expect(trace.success).toBe(true);
      expect(trace.events.length).toBe(2);
      expect(trace.events[0].args[0].value).toBe('a');
      expect(trace.events[1].args[0].value).toBe('b');

      const ast = parse(code);
      const rep = verifier.verify(ast, null, trace);
      expect(rep.multiReturn.returnValueCount).toBe(3);
      expect(rep.multiReturn.assignmentTargetCount).toBe(2);
      expect(rep.multiReturn.truncationApplied).toBe(true);
      expect(rep.multiReturn.expansionPreserved).toBe(false);

      const synthesized = oracle.synthesizeAST(trace.events);
      const genCode = generate(synthesized);
      expect(genCode).toContain('print("a")');
      expect(genCode).toContain('print("b")');
      expect(genCode.includes('"c"')).toBe(false);
    });

    test('17. TupleFlow IR context-aware value adjustment', () => {
      const { SingleValue, MultiValue, ContextKind, TupleFlow } = require('../../packages/core/src/ir/function-ir');
      const flow = new MultiValue([new SingleValue('a'), new SingleValue('b'), new SingleValue('c')]);

      // Non-tail assignment truncates to 1
      const nonTailAdj = TupleFlow.adjustForContext(flow, ContextKind.ASSIGNMENT_NON_TAIL, 1);
      expect(nonTailAdj instanceof SingleValue).toBe(true);
      expect(nonTailAdj.value.value).toBe('a');

      // Parenthesized expression truncates to 1
      const parenAdj = TupleFlow.adjustForContext(flow, ContextKind.PARENTHESIZED, 1);
      expect(parenAdj instanceof SingleValue).toBe(true);
      expect(parenAdj.value.value).toBe('a');

      // Non-tail call argument truncates to 1
      const callNonTailAdj = TupleFlow.adjustForContext(flow, ContextKind.CALL_ARG_NON_TAIL, 1);
      expect(callNonTailAdj instanceof SingleValue).toBe(true);
      expect(callNonTailAdj.value.value).toBe('a');

      // Tail call argument preserves full expansion
      const callTailAdj = TupleFlow.adjustForContext(flow, ContextKind.CALL_ARG_TAIL);
      expect(callTailAdj instanceof MultiValue).toBe(true);
      expect(callTailAdj.getCount()).toBe(3);

      // Tail assignment with 2 targets truncates to 2
      const assign2Adj = TupleFlow.adjustForContext(flow, ContextKind.ASSIGNMENT_TAIL, 2);
      expect(assign2Adj instanceof MultiValue).toBe(true);
      expect(assign2Adj.getCount()).toBe(2);
      expect(assign2Adj.values[0].value).toBe('a');
      expect(assign2Adj.values[1].value).toBe('b');
    });

    test('18. Vararg TEST A — Two variable assignment receives both values', () => {
      const code = `
        local function f(...)
            local a, b = ...
            print(a)
            print(b)
        end
        f("a", "b")
      `;
      const oracle = new SemanticOracle();
      const verifier = new CompletenessVerifier();
      const trace = oracle.trace(code);
      expect(trace.success).toBe(true);
      expect(trace.events.length).toBe(2);
      expect(trace.events[0].args[0].value).toBe('a');
      expect(trace.events[1].args[0].value).toBe('b');

      const rep = verifier.verify(parse(code), null, trace);
      expect(rep.vararg.varargDetected).toBe(true);
      expect(rep.vararg.suppliedArgumentCount).toBe(2);
      expect(rep.vararg.assignmentTargetCount).toBe(2);
      expect(rep.vararg.consumedValueCount).toBe(2);
      expect(rep.vararg.truncatedValueCount).toBe(0);
      expect(rep.vararg.expansionContext).toBe('ASSIGNMENT_TAIL');
      expect(rep.vararg.safeToInline).toBe(true);
    });

    test('19. Vararg TEST B — Return statement full expansion preserves multiple values', () => {
      const code = `
        local function f(...)
            return ...
        end
        local a, b = f("a", "b")
        print(a)
        print(b)
      `;
      const oracle = new SemanticOracle();
      const verifier = new CompletenessVerifier();
      const trace = oracle.trace(code);
      expect(trace.success).toBe(true);
      expect(trace.events.length).toBe(2);
      expect(trace.events[0].args[0].value).toBe('a');
      expect(trace.events[1].args[0].value).toBe('b');

      const rep = verifier.verify(parse(code), null, trace);
      expect(rep.vararg.varargDetected).toBe(true);
      expect(rep.vararg.expansionContext).toBe('RETURN_TAIL');
      expect(rep.vararg.consumedValueCount).toBe(2);
      expect(rep.vararg.truncatedValueCount).toBe(0);
      expect(rep.vararg.safeToInline).toBe(true);
    });

    test('20. Vararg TEST C — Call tail expansion passes all arguments', () => {
      const code = `
        local function f(...)
            print(...)
        end
        f("a", "b", "c")
      `;
      const oracle = new SemanticOracle();
      const verifier = new CompletenessVerifier();
      const trace = oracle.trace(code);
      expect(trace.success).toBe(true);
      expect(trace.events.length).toBe(1);
      expect(trace.events[0].args.length).toBe(3);
      expect(trace.events[0].args[0].value).toBe('a');
      expect(trace.events[0].args[1].value).toBe('b');
      expect(trace.events[0].args[2].value).toBe('c');

      const rep = verifier.verify(parse(code), null, trace);
      expect(rep.vararg.varargDetected).toBe(true);
      expect(rep.vararg.expansionContext).toBe('CALL_ARG_TAIL');
      expect(rep.vararg.suppliedArgumentCount).toBe(3);
      expect(rep.vararg.consumedValueCount).toBe(3);
      expect(rep.vararg.truncatedValueCount).toBe(0);
      expect(rep.vararg.safeToInline).toBe(true);
    });

    test('21. Vararg TEST D — Call non-tail argument truncates to exactly 1 value', () => {
      const code = `
        local function f(...)
            print(..., "x")
        end
        f("a", "b")
      `;
      const oracle = new SemanticOracle();
      const verifier = new CompletenessVerifier();
      const trace = oracle.trace(code);
      expect(trace.success).toBe(true);
      expect(trace.events.length).toBe(1);
      expect(trace.events[0].args.length).toBe(2);
      expect(trace.events[0].args[0].value).toBe('a');
      expect(trace.events[0].args[1].value).toBe('x');

      const rep = verifier.verify(parse(code), null, trace);
      expect(rep.vararg.varargDetected).toBe(true);
      expect(rep.vararg.expansionContext).toBe('CALL_ARG_NON_TAIL');
      expect(rep.vararg.suppliedArgumentCount).toBe(2);
      expect(rep.vararg.consumedValueCount).toBe(1);
      expect(rep.vararg.truncatedValueCount).toBe(1);
      expect(rep.vararg.safeToInline).toBe(true);
    });

    test('22. Vararg TEST E — Parenthesized vararg enforces single-value context', () => {
      const code = `
        local function f(...)
            print((...))
        end
        f("a", "b")
      `;
      const oracle = new SemanticOracle();
      const verifier = new CompletenessVerifier();
      const trace = oracle.trace(code);
      expect(trace.success).toBe(true);
      expect(trace.events.length).toBe(1);
      expect(trace.events[0].args.length).toBe(1);
      expect(trace.events[0].args[0].value).toBe('a');

      const rep = verifier.verify(parse(code), null, trace);
      expect(rep.vararg.varargDetected).toBe(true);
      expect(rep.vararg.expansionContext).toBe('PARENTHESIZED');
      expect(rep.vararg.consumedValueCount).toBe(1);
      expect(rep.vararg.truncatedValueCount).toBe(1);
      expect(rep.vararg.safeToInline).toBe(true);
    });

    test('23. Vararg TEST F — Zero varargs evaluates to nil', () => {
      const code = `
        local function f(...)
            local a = ...
            print(a)
        end
        f()
      `;
      const oracle = new SemanticOracle();
      const verifier = new CompletenessVerifier();
      const trace = oracle.trace(code);
      expect(trace.success).toBe(true);
      expect(trace.events.length).toBe(1);
      expect(trace.events[0].args[0].type).toBe('nil');

      const rep = verifier.verify(parse(code), null, trace);
      expect(rep.vararg.varargDetected).toBe(true);
      expect(rep.vararg.suppliedArgumentCount).toBe(0);
      expect(rep.vararg.consumedValueCount).toBe(0);
      expect(rep.vararg.safeToInline).toBe(true);
    });

    test('24. Vararg TEST G — Dynamic argument source prevents whole-program fold / L5-W promotion', () => {
      const code = `
        local function f(...)
            return ...
        end
        return f(externalValue())
      `;
      const verifier = new CompletenessVerifier();
      const ast = parse(code);
      const rep = verifier.verify(ast);
      expect(rep.wholeProgramClosed).toBe(false);
      expect(rep.isL5WEligible).toBe(false);
      expect(rep.audit.externalInputs.includes('externalValue')).toBe(true);
      expect(rep.vararg.safeToInline).toBe(false);
      expect(rep.vararg.dynamicVarargCount).toBe(true);
    });

    test('25. Vararg TEST H — Side-effect evaluation order is strictly preserved', () => {
      const code = `
        local sideEffects = {}
        local function track(x)
            table.insert(sideEffects, x)
            return x
        end
        local function f(...)
            local a = ...
            return a
        end
        local res = f(track("first"), track("second"))
        print(res)
        print(sideEffects[1])
        print(sideEffects[2])
      `;
      const oracle = new SemanticOracle();
      const trace = oracle.trace(code);
      expect(trace.success).toBe(true);
      expect(trace.events.length).toBe(3);
      expect(trace.events[0].args[0].value).toBe('first');
      expect(trace.events[1].args[0].value).toBe('first');
      expect(trace.events[2].args[0].value).toBe('second');
    });

    test('26. Vararg + MultiReturn Section 8 — Interop values() -> pass(...) -> print(a, b)', () => {
      const code = `
        local function values()
            return "a", "b"
        end

        local function pass(...)
            return ...
        end

        local a, b = pass(values())
        print(a)
        print(b)
      `;
      const oracle = new SemanticOracle();
      const verifier = new CompletenessVerifier();
      const trace = oracle.trace(code);
      expect(trace.success).toBe(true);
      expect(trace.events.length).toBe(2);
      expect(trace.events[0].args[0].value).toBe('a');
      expect(trace.events[1].args[0].value).toBe('b');

      const rep = verifier.verify(parse(code), null, trace);
      expect(rep.vararg.varargDetected).toBe(true);
      expect(rep.vararg.suppliedArgumentCount).toBe(2);
      expect(rep.vararg.varargValueCount).toBe(2);
      expect(rep.vararg.consumedValueCount).toBe(2);
      expect(rep.vararg.truncatedValueCount).toBe(0);
      expect(rep.vararg.safeToInline).toBe(true);

      const synthesized = oracle.synthesizeAST(trace.events);
      const genCode = generate(synthesized);
      expect(genCode).toContain('print("a")');
      expect(genCode).toContain('print("b")');
    });

    test('27. TupleFlow IR Vararg context-aware value adjustment', () => {
      const {
        VarargValue,
        VarargMultiValue,
        ContextKind,
        TupleFlow,
        ValueOrigin
      } = require('../../packages/core/src/ir/function-ir');

      const flow = new VarargMultiValue([
        new VarargValue('a', 0),
        new VarargValue('b', 1),
        new VarargValue('c', 2)
      ]);

      expect(flow.origin).toBe(ValueOrigin.VARARG);

      // Non-tail assignment truncates to 1
      const nonTailAdj = TupleFlow.adjustForContext(flow, ContextKind.ASSIGNMENT_NON_TAIL, 1);
      expect(nonTailAdj instanceof VarargValue).toBe(true);
      expect(nonTailAdj.value.value).toBe('a');

      // Parenthesized expression truncates to 1
      const parenAdj = TupleFlow.adjustForContext(flow, ContextKind.PARENTHESIZED, 1);
      expect(parenAdj instanceof VarargValue).toBe(true);
      expect(parenAdj.value.value).toBe('a');

      // Non-tail call argument truncates to 1
      const callNonTailAdj = TupleFlow.adjustForContext(flow, ContextKind.CALL_ARG_NON_TAIL, 1);
      expect(callNonTailAdj instanceof VarargValue).toBe(true);
      expect(callNonTailAdj.value.value).toBe('a');

      // Tail call argument preserves full expansion
      const callTailAdj = TupleFlow.adjustForContext(flow, ContextKind.CALL_ARG_TAIL);
      expect(callTailAdj instanceof VarargMultiValue).toBe(true);
      expect(callTailAdj.getCount()).toBe(3);

      // Tail assignment with 2 targets truncates to 2
      const assign2Adj = TupleFlow.adjustForContext(flow, ContextKind.ASSIGNMENT_TAIL, 2);
      expect(assign2Adj instanceof VarargMultiValue).toBe(true);
      expect(assign2Adj.getCount()).toBe(2);
      expect(assign2Adj.values[0].value).toBe('a');
      expect(assign2Adj.values[1].value).toBe('b');

      // Tail assignment with 4 targets pads with nil VarargValue
      const assign4Adj = TupleFlow.adjustForContext(flow, ContextKind.ASSIGNMENT_TAIL, 4);
      expect(assign4Adj instanceof VarargMultiValue).toBe(true);
      expect(assign4Adj.getCount()).toBe(4);
      expect(assign4Adj.values[3].value).toBe(null);
    });

    test('28. Closure Mutation Test (capture-by-reference semantics)', () => {
      const { ClosureCaptureAnalyzer } = require('../../packages/core/src/analysis/closure-capture-analyzer');
      const code = `
        local x = "before"
        local function f()
            return x
        end
        f()
        x = "after"
        print(f())
      `;
      const ast = parse(code);
      const analyzer = new ClosureCaptureAnalyzer();
      const analysis = analyzer.analyze(ast, null, { isL5WEligible: true });
      expect(analysis.closureRecovered).toBe(true);
      expect(analysis.captureMode).toBe('LEXICAL_UPVALUE');
      expect(analysis.captureByReference).toBe(true);
      expect(analysis.capturedBindings.includes('x')).toBe(true);
      expect(analysis.safeToInline).toBe(true);
      expect(analysis.proof).toContain("'after'");
    });

    test('29. Shared Upvalue Test between multiple closures', () => {
      const code = `
        local c = 0
        local function inc()
            c = c + 1
        end
        local function get()
            return c
        end
        inc()
        inc()
        print(get())
      `;
      const ast = parse(code);
      const { ClosureCaptureAnalyzer } = require('../../packages/core/src/analysis/closure-capture-analyzer');
      const analyzer = new ClosureCaptureAnalyzer();
      const analysis = analyzer.analyze(ast, null, { isL5WEligible: true });
      expect(analysis.closureRecovered).toBe(true);
      expect(analysis.capturedBindings.includes('c')).toBe(true);
      expect(analysis.upvalueWrites).toBeGreaterThanOrEqual(1);
    });

    test('30. Persistence Across Multiple Invocations (Stateful Counter)', () => {
      const code = `
        local function makeCounter()
            local c = 0
            return function()
                c = c + 1
                return c
            end
        end
        local count = makeCounter()
        print(count())
        print(count())
        print(count())
      `;
      const ast = parse(code);
      const { ClosureCaptureAnalyzer } = require('../../packages/core/src/analysis/closure-capture-analyzer');
      const analyzer = new ClosureCaptureAnalyzer();
      const analysis = analyzer.analyze(ast, null, { isL5WEligible: false });
      expect(analysis.closureRecovered).toBe(true);
      expect(analysis.capturedBindings.includes('c')).toBe(true);
      expect(analysis.safeToInline).toBe(false); // Persistent state cannot be inlined into a single constant
    });

    test('31. Independent Closure Instances do not leak upvalue cells', () => {
      const code = `
        local function makeCounter()
            local c = 0
            return function()
                c = c + 1
                return c
            end
        end
        local a = makeCounter()
        local b = makeCounter()
        print(a())
        print(a())
        print(b())
      `;
      const ast = parse(code);
      const { ClosureCaptureAnalyzer } = require('../../packages/core/src/analysis/closure-capture-analyzer');
      const analyzer = new ClosureCaptureAnalyzer();
      const analysis = analyzer.analyze(ast, null, { isL5WEligible: false });
      expect(analysis.closureRecovered).toBe(true);
      expect(analysis.safeToInline).toBe(false);
    });

    test('32. Lexical Shadowing binds to innermost declaration', () => {
      const code = `
        local x = "outer"
        local function f()
            local x = "inner"
            local function g()
                return x
            end
            return g()
        end
        print(f())
      `;
      const ast = parse(code);
      const { ClosureCaptureAnalyzer } = require('../../packages/core/src/analysis/closure-capture-analyzer');
      const analyzer = new ClosureCaptureAnalyzer();
      const analysis = analyzer.analyze(ast, null, { isL5WEligible: true });
      expect(analysis.closureRecovered).toBe(true);
      expect(analysis.proof).toContain("'inner'");
      expect(analysis.proof.includes("'outer'")).toBe(false);
    });

    test('33. Escaping Closure prohibits unsafe inlining (Negative Test)', () => {
      const code = `
        local x = "hi"
        local function f()
            return x
        end
        externalConsumer(f)
      `;
      const ast = parse(code);
      const { ClosureCaptureAnalyzer } = require('../../packages/core/src/analysis/closure-capture-analyzer');
      const analyzer = new ClosureCaptureAnalyzer();
      const analysis = analyzer.analyze(ast, null, { isL5WEligible: true });
      expect(analysis.closureRecovered).toBe(true);
      expect(analysis.closureEscapes).toBe(true);
      expect(analysis.safeToInline).toBe(false);
    });

    test('34. Unknown External Mutation prevents constant inlining (Negative Test)', () => {
      const code = `
        local t = { val = "hi" }
        local function f()
            return t.val
        end
        externalConsumer(t)
        print(f())
      `;
      const ast = parse(code);
      const { ClosureCaptureAnalyzer } = require('../../packages/core/src/analysis/closure-capture-analyzer');
      const analyzer = new ClosureCaptureAnalyzer();
      const analysis = analyzer.analyze(ast, null, { isL5WEligible: true });
      expect(analysis.bindingValueKnownAtCall).toBe(false);
      expect(analysis.safeToInline).toBe(false);
    });

    test('35. Nested Capture Chain across multi-level scopes', () => {
      const code = `
        local function outer()
            local a = "hi"
            local function middle()
                local function inner()
                    return a
                end
                return inner()
            end
            return middle()
        end
        print(outer())
      `;
      const ast = parse(code);
      const { ClosureCaptureAnalyzer } = require('../../packages/core/src/analysis/closure-capture-analyzer');
      const analyzer = new ClosureCaptureAnalyzer();
      const analysis = analyzer.analyze(ast, null, { isL5WEligible: true });
      expect(analysis.closureRecovered).toBe(true);
      expect(analysis.capturedBindings.includes('a')).toBe(true);
    });

    test('36. Interleaved Evaluation Order preserves side effects', () => {
      const code = `
        local state = 0
        local function read()
            return state
        end
        local function write()
            state = 1
            return state
        end
        print(read(), write(), read())
      `;
      const ast = parse(code);
      const { ClosureCaptureAnalyzer } = require('../../packages/core/src/analysis/closure-capture-analyzer');
      const analyzer = new ClosureCaptureAnalyzer();
      const analysis = analyzer.analyze(ast, null, { isL5WEligible: true });
      expect(analysis.closureRecovered).toBe(true);
      expect(analysis.upvalueWrites).toBeGreaterThanOrEqual(1);
    });

    test('37. MixedClosed TEST A — Dynamic argument prevents static folding of second call', () => {
      const { MixedClosedAnalyzer } = require('../../packages/core/src/analysis/mixed-closed-analyzer');
      const code = `
        local function make(...)
            local args = {...}
            local count = 0
            return function(extra)
                count = count + 1
                if count == 1 then
                    return "hi", args[1], extra
                end
                return "hi", args[2], extra
            end
        end
        local f = make("one", externalValue)
        print(f("x"))
        print(f("y"))
      `;
      const ast = parse(code);
      const analyzer = new MixedClosedAnalyzer();
      const analysis = analyzer.analyze(ast, null, { isL5WEligible: true });
      expect(analysis.closureRecovered).toBe(true);
      expect(analysis.safeWholeProgramReplacement).toBe(false);
    });

    test('38. MixedClosed TEST B — Escaping factory closure prohibits whole-program replacement', () => {
      const { MixedClosedAnalyzer } = require('../../packages/core/src/analysis/mixed-closed-analyzer');
      const code = `
        local function make(...)
            local args = {...}
            local count = 0
            return function(extra)
                count = count + 1
                return "hi", args[1], extra
            end
        end
        local f = make("one", "two")
        externalConsumer(f)
      `;
      const ast = parse(code);
      const analyzer = new MixedClosedAnalyzer();
      const analysis = analyzer.analyze(ast, null, { isL5WEligible: true });
      expect(analysis.closureRecovered).toBe(true);
      expect(analysis.safeWholeProgramReplacement).toBe(false);
    });

    test('39. MixedClosed TEST C — External table mutation invalidates captured table identity', () => {
      const { MixedClosedAnalyzer } = require('../../packages/core/src/analysis/mixed-closed-analyzer');
      const code = `
        local function make(...)
            local args = {...}
            externalConsumer(args)
            local count = 0
            return function(extra)
                count = count + 1
                return "hi", args[1], extra
            end
        end
        local f = make("one", "two")
        print(f("x"))
      `;
      const ast = parse(code);
      const analyzer = new MixedClosedAnalyzer();
      const analysis = analyzer.analyze(ast, null, { isL5WEligible: true });
      expect(analysis.closureRecovered).toBe(true);
      expect(analysis.capturedTableIdentityProven).toBe(false);
      expect(analysis.safeWholeProgramReplacement).toBe(false);
    });

    test('40. MixedClosed TEST D — Three invocations track sequential state transitions', () => {
      const { MixedClosedAnalyzer } = require('../../packages/core/src/analysis/mixed-closed-analyzer');
      const code = `
        local function make(...)
            local args = {...}
            local count = 0
            return function(extra)
                count = count + 1
                if count == 1 then
                    return "hi", args[1], extra
                end
                return "hi", args[2], extra
            end
        end
        local f = make("one", "two")
        print(f("x"))
        print(f("y"))
        print(f("z"))
      `;
      const ast = parse(code);
      const analyzer = new MixedClosedAnalyzer();
      const analysis = analyzer.analyze(ast, null, { isL5WEligible: true });
      expect(analysis.closureRecovered).toBe(true);
      expect(analysis.invocationCount).toBe(3);
      expect(analysis.branchOutcomes.length).toBe(3);
      expect(analysis.branchOutcomes[0]).toBe(true);
      expect(analysis.branchOutcomes[1]).toBe(false);
      expect(analysis.branchOutcomes[2]).toBe(false);
    });

    test('41. MixedClosed TEST E — Multiple closure instances maintain isolated environments', () => {
      const { MixedClosedAnalyzer } = require('../../packages/core/src/analysis/mixed-closed-analyzer');
      const code = `
        local function make(...)
            local args = {...}
            local count = 0
            return function(extra)
                count = count + 1
                return "hi", args[1], extra
            end
        end
        local f1 = make("one", "two")
        local f2 = make("a", "b")
        print(f1("x"))
        print(f1("y"))
        print(f2("z"))
      `;
      const ast = parse(code);
      const analyzer = new MixedClosedAnalyzer();
      const analysis = analyzer.analyze(ast, null, { isL5WEligible: true });
      expect(analysis.closureRecovered).toBe(true);
      expect(analysis.closureInstanceCount).toBe(2);
      expect(analysis.environmentInstanceCount).toBe(2);
    });

    test('42. Metamorphic TEST 1 — Rename everything (p, factory, q, n, v)', () => {
      const { MixedClosedAnalyzer } = require('../../packages/core/src/analysis/mixed-closed-analyzer');
      const code = `
        local p = "hello"

        local function factory(...)
            local q = {...}
            local n = 0

            return function(v)
                n = n + 1

                if n == 1 then
                    return p, q[1], v
                end

                return p, q[2], v
            end
        end
        local f = factory("one", "two")
        print(f("x"))
        print(f("y"))
      `;
      const ast = parse(code);
      const analyzer = new MixedClosedAnalyzer();
      const analysis = analyzer.analyze(ast, null, { isL5WEligible: true });
      expect(analysis.closureRecovered).toBe(true);
      expect(analysis.varargToTableExpansionProven).toBe(true);
      expect(analysis.capturedBindings).toEqual(['n', 'p', 'q']);
      expect(analysis.persistentStateProven).toBe(true);
      expect(analysis.stateProvenance.upvalueBinding).toBe('n');
      expect(analysis.branchOutcomes).toEqual([true, false]);
      expect(analysis.multiReturnValueCount).toBe(3);
    });

    test('43. Metamorphic TEST 2 — Branch threshold changed (if count == 2 then)', () => {
      const { MixedClosedAnalyzer } = require('../../packages/core/src/analysis/mixed-closed-analyzer');
      const code = `
        local function make(...)
            local args = {...}
            local count = 0
            return function(extra)
                count = count + 1
                if count == 2 then
                    return "hi", args[1], extra
                end
                return "hi", args[2], extra
            end
        end
        local f = make("one", "two")
        print(f("x"))
        print(f("y"))
        print(f("z"))
      `;
      const ast = parse(code);
      const analyzer = new MixedClosedAnalyzer();
      const analysis = analyzer.analyze(ast, null, { isL5WEligible: true });
      expect(analysis.closureRecovered).toBe(true);
      expect(analysis.invocationCount).toBe(3);
      expect(analysis.branchOutcomes).toEqual([false, true, false]);
    });

    test('44. Metamorphic TEST 3 — Four return values dynamically derived from ReturnStatement', () => {
      const { MixedClosedAnalyzer } = require('../../packages/core/src/analysis/mixed-closed-analyzer');
      const code = `
        local function make(...)
            local args = {...}
            local count = 0
            return function(extra)
                count = count + 1
                return "prefix", args[1], extra, count
            end
        end
        local f = make("one", "two")
        print(f("x"))
      `;
      const ast = parse(code);
      const analyzer = new MixedClosedAnalyzer();
      const analysis = analyzer.analyze(ast, null, { isL5WEligible: true });
      expect(analysis.closureRecovered).toBe(true);
      expect(analysis.multiReturnValueCount).toBe(4);
    });

    test('45. Metamorphic TEST 4 — Single return value dynamically derived', () => {
      const { MixedClosedAnalyzer } = require('../../packages/core/src/analysis/mixed-closed-analyzer');
      const code = `
        local function make(...)
            local args = {...}
            local count = 0
            return function(extra)
                count = count + 1
                return extra
            end
        end
        local f = make("one", "two")
        print(f("x"))
      `;
      const ast = parse(code);
      const analyzer = new MixedClosedAnalyzer();
      const analysis = analyzer.analyze(ast, null, { isL5WEligible: true });
      expect(analysis.closureRecovered).toBe(true);
      expect(analysis.multiReturnValueCount).toBe(1);
    });

    test('46. Metamorphic TEST 5 — No branch produces empty branchOutcomes', () => {
      const { MixedClosedAnalyzer } = require('../../packages/core/src/analysis/mixed-closed-analyzer');
      const code = `
        local function make(...)
            local args = {...}
            local count = 0
            return function(extra)
                count = count + 1
                return "prefix", args[1], extra
            end
        end
        local f = make("one", "two")
        print(f("x"))
      `;
      const ast = parse(code);
      const analyzer = new MixedClosedAnalyzer();
      const analysis = analyzer.analyze(ast, null, { isL5WEligible: true });
      expect(analysis.closureRecovered).toBe(true);
      expect(analysis.branchOutcomes).toEqual([]);
    });

    test('47. Metamorphic TEST 6 — Different capture set without count upvalue', () => {
      const { MixedClosedAnalyzer } = require('../../packages/core/src/analysis/mixed-closed-analyzer');
      const code = `
        local p = "hi"

        local function make(...)
            local q = {...}

            return function(extra)
                return p, q[1], extra
            end
        end
        local f = make("one", "two")
        print(f("x"))
      `;
      const ast = parse(code);
      const analyzer = new MixedClosedAnalyzer();
      const analysis = analyzer.analyze(ast, null, { isL5WEligible: true });
      expect(analysis.closureRecovered).toBe(true);
      expect(analysis.capturedBindings).toEqual(['p', 'q']);
      expect(analysis.capturedBindings.includes('count')).toBe(false);
    });

    test('48. Metamorphic TEST 7 — 6 prints in unrelated program yields NO fake mixed-closed recovery', () => {
      const { MixedClosedAnalyzer } = require('../../packages/core/src/analysis/mixed-closed-analyzer');
      const code = `
        print("1")
        print("2")
        print("3")
        print("4")
        print("5")
        print("6")
      `;
      const ast = parse(code);
      const analyzer = new MixedClosedAnalyzer();
      const analysis = analyzer.analyze(ast, null, { isL5WEligible: true });
      expect(analysis).toBe(null);
    });

    test('49. ProofIntegrityValidator rejects prohibited trace provenance', () => {
      const { ProofIntegrityValidator } = require('../../packages/core/src/analysis/proof-integrity-validator');
      const { FailureCategory } = require('../../packages/core/src/diagnostics/failure-taxonomy');
      const validator = new ProofIntegrityValidator();

      const fakeReport = {
        mixedClosed: {
          varargRecovered: true,
          varargProvenance: { source: 'SEMANTIC_TRACE' },
          closureRecovered: true,
          closureProvenance: { source: 'STATIC_IR' },
          safeWholeProgramReplacement: true,
          capturedBindings: ['prefix', 'args', 'count'],
          multiReturnValueCount: 3
        }
      };

      const result = validator.validate(fakeReport);
      expect(result.pass).toBe(false);
      expect(result.failureCategory).toBe(FailureCategory.ORACLE_DRIVEN_PROOF_SYNTHESIS);
      expect(result.violations.some(v => v.includes('PROHIBITED_SOURCE'))).toBe(true);
    });

    test('50. Admission Contradiction Regression — safeWholeProgramReplacement=false rejects L5-W', () => {
      const { RequiredProofValidator } = require('../../packages/core/src/analysis/required-proof-validator');
      const { FailureCategory } = require('../../packages/core/src/diagnostics/failure-taxonomy');
      const validator = new RequiredProofValidator();

      // Directly construct contradiction: integrity is true, but safeWholeProgramReplacement is false
      const report = {
        wholeProgramClosed: true,
        proofIntegrity: { pass: true },
        mixedClosed: {
          invocationCount: 2,
          safeWholeProgramReplacement: false,
          varargToTableExpansionProven: false,
          closureRecovered: false
        }
      };

      const res = validator.validate(report);
      expect(res.pass).toBe(false);
      expect(res.failureCategory).toBe(FailureCategory.L5W_ADMISSION_INCONSISTENCY);
      expect(res.missing.length).toBeGreaterThan(0);
    });

    test('51. RequiredProofValidator rejects promotion when mandatory proofs missing', () => {
      const { CompletenessVerifier } = require('../../packages/core/src/analysis/completeness-verifier');
      const verifier = new CompletenessVerifier();

      // Trace exhibits cross-feature outputs (6 print events)
      const fakeTrace = {
        success: true,
        events: [
          { type: 'CALL', target: 'print', args: [{ value: 'hi' }] },
          { type: 'CALL', target: 'print', args: [{ value: 'one' }] },
          { type: 'CALL', target: 'print', args: [{ value: 'x' }] },
          { type: 'CALL', target: 'print', args: [{ value: 'hi' }] },
          { type: 'CALL', target: 'print', args: [{ value: 'two' }] },
          { type: 'CALL', target: 'print', args: [{ value: 'y' }] }
        ]
      };

      // Ast is a dummy block without static cross-feature proofs
      const dummyAst = parse('print("hi") print("one") print("x") print("hi") print("two") print("y")');
      const report = verifier.verify(dummyAst, null, fakeTrace);

      // Must strictly reject L5-W eligibility
      expect(report.isL5WEligible).toBe(false);
      expect(report.requiredProofs.pass).toBe(false);
      expect(report.requiredProofs.missing.length).toBeGreaterThan(0);
      expect(report.recommendedLevel !== 'L5-W').toBe(true);
    });
  });
}

module.exports = { runL5AuthenticityNegativeTests };

if (require.main === module) {
  runL5AuthenticityNegativeTests();
  const { printSummary } = require('../test-framework');
  printSummary();
}
