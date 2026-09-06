let currentSuite = '';
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures = [];

function describe(suiteName, fn) {
  const prevSuite = currentSuite;
  currentSuite = prevSuite ? `${prevSuite} > ${suiteName}` : suiteName;
  console.log(`\n=== ${currentSuite} ===`);
  try {
    fn();
  } catch (err) {
    console.error(`Suite error in ${currentSuite}:`, err);
    failedTests++;
    failures.push({ suite: currentSuite, test: 'suite initialization', error: err });
  } finally {
    currentSuite = prevSuite;
  }
}

function test(testName, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  [PASS] ${testName}`);
  } catch (err) {
    failedTests++;
    console.error(`  [FAIL] ${testName}`);
    console.error(`         ${err.message}`);
    failures.push({ suite: currentSuite, test: testName, error: err });
  }
}

function expect(actual) {
  return {
    toBe(expected) {
      if (actual !== expected) {
        throw new Error(`Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
      }
    },
    toEqual(expected) {
      const a = JSON.stringify(actual);
      const e = JSON.stringify(expected);
      if (a !== e) {
        throw new Error(`Expected deep equality:\nExpected: ${e}\nReceived: ${a}`);
      }
    },
    toBeTruthy() {
      if (!actual) {
        throw new Error(`Expected truthy value but got ${JSON.stringify(actual)}`);
      }
    },
    toBeFalsy() {
      if (actual) {
        throw new Error(`Expected falsy value but got ${JSON.stringify(actual)}`);
      }
    },
    toBeGreaterThan(expected) {
      if (!(actual > expected)) {
        throw new Error(`Expected ${actual} to be greater than ${expected}`);
      }
    },
    toBeGreaterThanOrEqual(expected) {
      if (!(actual >= expected)) {
        throw new Error(`Expected ${actual} to be greater than or equal to ${expected}`);
      }
    },
    toBeLessThan(expected) {
      if (!(actual < expected)) {
        throw new Error(`Expected ${actual} to be less than ${expected}`);
      }
    },
    toBeLessThanOrEqual(expected) {
      if (!(actual <= expected)) {
        throw new Error(`Expected ${actual} to be less than or equal to ${expected}`);
      }
    },
    toContain(expected) {
      if (typeof actual === 'string') {
        if (!actual.includes(expected)) {
          throw new Error(`Expected string to contain ${JSON.stringify(expected)}`);
        }
      } else if (Array.isArray(actual)) {
        if (!actual.includes(expected)) {
          throw new Error(`Expected array to contain ${JSON.stringify(expected)}`);
        }
      } else {
        throw new Error(`toContain not supported on type ${typeof actual}`);
      }
    },
    toThrow(expectedErrorClass) {
      let threw = false;
      let error = null;
      try {
        actual();
      } catch (e) {
        threw = true;
        error = e;
      }
      if (!threw) {
        throw new Error(`Expected function to throw, but it did not`);
      }
      if (expectedErrorClass && !(error instanceof expectedErrorClass)) {
        throw new Error(`Expected error of type ${expectedErrorClass.name}, but caught ${error.constructor.name}: ${error.message}`);
      }
    }
  };
}

function printSummary() {
  console.log('\n========================================');
  console.log(`Test Results: ${passedTests}/${totalTests} Passed (${failedTests} Failed)`);
  if (failedTests > 0) {
    console.log('\nFailed Tests:');
    for (const f of failures) {
      console.log(`- ${f.suite} > ${f.test}: ${f.error.message}`);
    }
    console.log('========================================\n');
    process.exit(1);
  } else {
    console.log('ALL TESTS PASSED [PASS]');
    console.log('========================================\n');
  }
}

module.exports = {
  describe,
  test,
  expect,
  printSummary
};
