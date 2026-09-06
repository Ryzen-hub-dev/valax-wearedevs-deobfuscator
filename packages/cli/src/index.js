/**
 * @valax/cli:
 * Production CLI interface for Valax Source Recovery.
 */

const fs = require('fs');
const path = require('path');
const { RecoveryService, ExitCode, TOOL_VERSION } = require('../../core/src');

const FORBIDDEN_BYPASS_FLAGS = new Set([
  '--force-l5w',
  '--ignore-proof-failure',
  '--unsafe-prune',
  '--force',
  '--bypass-gates',
  '--skip-verification'
]);

function printHelp(out) {
  out(`
Valax Source Recovery CLI (${TOOL_VERSION})
Evidence-based static recovery engine for WeAreDevs-protected Lua/Luau programs.

Usage:
  valax-recover <input.lua> [options]

Options:
  -o, --output <file>           Output path for recovered Lua code (default: recovered.lua)
  -r, --report <file>           Output path for diagnostic JSON report (default: report.json)
  -s, --stage <auto|L4|L5-W>    Target recovery stage (default: auto)
      --no-semantic-validation  Disable differential semantic trace validation
      --json                    Output machine-readable JSON to stdout
  -v, --version                 Print tool version and exit
  -h, --help                    Print this help message and exit

Exit Codes:
  0 = Recovery completed successfully (including conservative L4 downgrade)
  2 = Invalid CLI arguments or input validation failure
  3 = Input parse failure (syntax error)
  4 = Unsupported or unrecognized protected format
  5 = Recovery internal exception
  6 = Semantic validation failure
  7 = Safety or resource limit termination
  8 = Output or write failure
`);
}

function parseArgs(args) {
  const options = {
    input: null,
    output: 'recovered.lua',
    report: 'report.json',
    stage: 'auto',
    semanticValidation: true,
    json: false,
    help: false,
    version: false,
    errors: []
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (FORBIDDEN_BYPASS_FLAGS.has(arg)) {
      options.errors.push(`Correctness bypass flag "${arg}" is strictly prohibited.`);
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--version' || arg === '-v') {
      options.version = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--no-semantic-validation') {
      options.semanticValidation = false;
    } else if (arg === '--output' || arg === '-o') {
      if (i + 1 >= args.length || args[i + 1].startsWith('-')) {
        options.errors.push(`Missing argument for option "${arg}"`);
      } else {
        options.output = args[++i];
      }
    } else if (arg === '--report' || arg === '-r') {
      if (i + 1 >= args.length || args[i + 1].startsWith('-')) {
        options.errors.push(`Missing argument for option "${arg}"`);
      } else {
        options.report = args[++i];
      }
    } else if (arg === '--stage' || arg === '-s') {
      if (i + 1 >= args.length || args[i + 1].startsWith('-')) {
        options.errors.push(`Missing argument for option "${arg}"`);
      } else {
        const val = args[++i];
        if (!['auto', 'L4', 'L5-W', 'L5'].includes(val)) {
          options.errors.push(`Invalid stage "${val}". Valid stages: auto, L4, L5-W`);
        } else {
          options.stage = val;
        }
      }
    } else if (!arg.startsWith('-')) {
      if (!options.input) {
        options.input = arg;
      } else {
        options.errors.push(`Unexpected extra positional argument "${arg}"`);
      }
    } else {
      options.errors.push(`Unknown option "${arg}"`);
    }
  }

  return options;
}

function runCli(args, io = {}) {
  const stdout = io.stdout || (str => process.stdout.write(str));
  const stderr = io.stderr || (str => process.stderr.write(str));
  const exit = io.exit || (code => process.exit(code));

  const options = parseArgs(args);

  if (options.help) {
    printHelp(stdout);
    return exit(ExitCode.SUCCESS);
  }

  if (options.version) {
    stdout(`${TOOL_VERSION}\n`);
    return exit(ExitCode.SUCCESS);
  }

  if (options.errors.length > 0) {
    for (const err of options.errors) {
      stderr(`Error: ${err}\n`);
    }
    if (options.json) {
      stdout(JSON.stringify({
        schemaVersion: '1',
        toolVersion: TOOL_VERSION,
        status: 'failure',
        failureCategory: 'INVALID_CLI_ARGUMENTS',
        error: options.errors.join('; ')
      }, null, 2) + '\n');
    }
    return exit(ExitCode.INVALID_ARGUMENTS);
  }

  if (!options.input) {
    stderr('Error: No input file specified.\n');
    printHelp(stderr);
    if (options.json) {
      stdout(JSON.stringify({
        schemaVersion: '1',
        toolVersion: TOOL_VERSION,
        status: 'failure',
        failureCategory: 'MISSING_INPUT_FILE',
        error: 'No input file specified.'
      }, null, 2) + '\n');
    }
    return exit(ExitCode.INVALID_ARGUMENTS);
  }

  const inputPath = path.resolve(process.cwd(), options.input);

  // Invoke unified RecoveryService
  const result = RecoveryService.recover({
    filePath: inputPath,
    requestedStage: options.stage,
    semanticValidation: options.semanticValidation
  });

  if (!result.success) {
    if (options.json) {
      stdout(JSON.stringify({
        schemaVersion: result.report?.schemaVersion || '1',
        toolVersion: result.report?.toolVersion || TOOL_VERSION,
        status: 'failure',
        input: result.report?.input || { filename: options.input },
        failureCategory: result.report?.failureCategory || 'RECOVERY_ERROR',
        error: result.diagnostics.join('; ')
      }, null, 2) + '\n');
    } else {
      for (const diag of result.diagnostics) {
        stderr(`${diag}\n`);
      }
    }
    return exit(result.exitCode);
  }

  // Write outputs
  const outputPath = path.resolve(process.cwd(), options.output);
  const reportPath = path.resolve(process.cwd(), options.report);

  try {
    fs.writeFileSync(outputPath, result.code, 'utf8');
  } catch (err) {
    stderr(`Error writing recovered output file "${outputPath}": ${err.message}\n`);
    if (options.json) {
      stdout(JSON.stringify({
        schemaVersion: '1',
        toolVersion: TOOL_VERSION,
        status: 'failure',
        failureCategory: 'OUTPUT_WRITE_FAILURE',
        error: `Error writing output: ${err.message}`
      }, null, 2) + '\n');
    }
    return exit(ExitCode.OUTPUT_WRITE_FAILURE);
  }

  try {
    fs.writeFileSync(reportPath, JSON.stringify(result.report, null, 2), 'utf8');
  } catch (err) {
    stderr(`Error writing diagnostic report file "${reportPath}": ${err.message}\n`);
    if (options.json) {
      stdout(JSON.stringify({
        schemaVersion: '1',
        toolVersion: TOOL_VERSION,
        status: 'failure',
        failureCategory: 'OUTPUT_WRITE_FAILURE',
        error: `Error writing report: ${err.message}`
      }, null, 2) + '\n');
    }
    return exit(ExitCode.OUTPUT_WRITE_FAILURE);
  }

  // Print results
  if (options.json) {
    const jsonOutput = {
      schemaVersion: result.report.schemaVersion,
      toolVersion: result.report.toolVersion,
      status: 'success',
      input: result.report.input,
      detection: result.report.detection,
      recovery: {
        requestedStage: result.report.recovery.requestedStage,
        actualLevel: result.report.recovery.actualLevel,
        residualDispatcherStates: result.report.recovery.dispatcherStatesAfter
      },
      validation: {
        semantic: result.report.validation.semantic
      },
      outputs: {
        code: options.output,
        report: options.report
      },
      warnings: result.report.warnings || []
    };
    stdout(JSON.stringify(jsonOutput, null, 2) + '\n');
  } else {
    stdout(`Input: ${result.report.input.filename}\n`);
    stdout(`Protection: ${result.report.detection.family} v${result.report.detection.version}\n`);
    stdout(`Recovery Level: ${result.report.recovery.actualLevel}\n`);
    stdout(`Residual Dispatcher States: ${result.report.recovery.dispatcherStatesAfter}\n`);
    stdout(`Semantic Validation: ${result.report.validation.semantic}\n`);
    stdout(`Output: ${options.output}\n`);
    stdout(`Report: ${options.report}\n`);
  }

  if (result.report.warnings && result.report.warnings.length > 0 && !options.json) {
    for (const w of result.report.warnings) {
      stderr(`Warning: ${w}\n`);
    }
  }

  return exit(ExitCode.SUCCESS);
}

module.exports = {
  runCli,
  parseArgs,
  printHelp,
  ExitCode
};
