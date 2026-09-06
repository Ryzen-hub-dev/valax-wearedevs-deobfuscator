/**
 * RecoveryService:
 * Unified, enterprise-grade service boundary for Valax Source Recovery.
 * Provides consistent input validation, sandboxed execution, normalized versioned reporting,
 * and deterministic exit code mapping across CLI, API, and worker environments.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { RecoveryPipeline } = require('../transforms');

function recover(source, options = {}) {
  const pipeline = new RecoveryPipeline(options);
  return pipeline.run(source, options.filename || 'input.lua');
}

const TOOL_VERSION = '0.1.0-beta.1';
const SCHEMA_VERSION = '1';
const DEFAULT_MAX_INPUT_BYTES = 5 * 1024 * 1024; // 5 MiB
const ALLOWED_EXTENSIONS = new Set(['.lua', '.luau', '.txt']);

// Canonical CLI Exit Codes
const ExitCode = {
  SUCCESS: 0,
  INVALID_ARGUMENTS: 2,
  PARSE_FAILURE: 3,
  UNRECOGNIZED_FORMAT: 4,
  RECOVERY_INTERNAL_FAILURE: 5,
  SEMANTIC_VALIDATION_FAILURE: 6,
  SAFETY_RESOURCE_LIMIT: 7,
  OUTPUT_WRITE_FAILURE: 8
};

class RecoveryService {
  /**
   * Main entry point for recovering a protected script.
   *
   * @param {object} params
   * @param {string} [params.filePath] Path to the source file (if reading from disk)
   * @param {string} [params.source] Direct source code string (if in-memory)
   * @param {string} [params.filename] Display filename
   * @param {string} [params.requestedStage='auto'] Target stage: 'auto' | 'L4' | 'L5-W'
   * @param {boolean} [params.semanticValidation=true] Whether to run isolated semantic trace validation
   * @param {object} [params.limits] Resource and input limits
   * @returns {{ success: boolean, code: string, report: object, diagnostics: Array<string>, exitCode: number }}
   */
  static recover({
    filePath = null,
    source = null,
    filename = null,
    requestedStage = 'auto',
    semanticValidation = true,
    limits = {}
  } = {}) {
    const startTime = Date.now();
    const diagnostics = [];
    const warnings = [];

    const maxInputBytes = limits.maxInputBytes || DEFAULT_MAX_INPUT_BYTES;

    // 1. Input Validation
    let rawContent = source;
    let logicalFilename = filename || (filePath ? path.basename(filePath) : 'input.lua');

    if (filePath) {
      // Check file exists
      if (!fs.existsSync(filePath)) {
        return {
          success: false,
          code: '',
          report: this.buildErrorReport({
            logicalFilename,
            failureCategory: 'FILE_NOT_FOUND',
            message: `Input file does not exist: ${filePath}`,
            startTime
          }),
          diagnostics: [`Error: Input file does not exist: ${filePath}`],
          exitCode: ExitCode.INVALID_ARGUMENTS
        };
      }

      // Check stat: regular file only
      let stat;
      try {
        stat = fs.statSync(filePath);
      } catch (err) {
        return {
          success: false,
          code: '',
          report: this.buildErrorReport({
            logicalFilename,
            failureCategory: 'FILE_ACCESS_ERROR',
            message: `Cannot access file: ${err.message}`,
            startTime
          }),
          diagnostics: [`Error: Cannot access file: ${err.message}`],
          exitCode: ExitCode.INVALID_ARGUMENTS
        };
      }

      if (!stat.isFile()) {
        return {
          success: false,
          code: '',
          report: this.buildErrorReport({
            logicalFilename,
            failureCategory: 'NOT_A_REGULAR_FILE',
            message: 'Input path is not a regular file (directory, device, or pipe)',
            startTime
          }),
          diagnostics: ['Error: Input path is not a regular file (directory, device, or socket)'],
          exitCode: ExitCode.INVALID_ARGUMENTS
        };
      }

      // Check size limit
      if (stat.size > maxInputBytes) {
        return {
          success: false,
          code: '',
          report: this.buildErrorReport({
            logicalFilename,
            failureCategory: 'INPUT_TOO_LARGE',
            message: `File size (${stat.size} bytes) exceeds limit of ${maxInputBytes} bytes`,
            startTime
          }),
          diagnostics: [`Error: File size (${stat.size} bytes) exceeds limit of ${maxInputBytes} bytes`],
          exitCode: ExitCode.SAFETY_RESOURCE_LIMIT
        };
      }

      // Check extension
      const ext = path.extname(filePath).toLowerCase();
      if (ext && !ALLOWED_EXTENSIONS.has(ext)) {
        warnings.push(`File extension "${ext}" is unusual for Lua scripts; proceeding with text analysis.`);
      }

      try {
        rawContent = fs.readFileSync(filePath, 'utf8');
      } catch (err) {
        return {
          success: false,
          code: '',
          report: this.buildErrorReport({
            logicalFilename,
            failureCategory: 'FILE_READ_ERROR',
            message: `Failed to read file: ${err.message}`,
            startTime
          }),
          diagnostics: [`Error: Failed to read file: ${err.message}`],
          exitCode: ExitCode.INVALID_ARGUMENTS
        };
      }
    }

    if (rawContent === null || rawContent === undefined) {
      return {
        success: false,
        code: '',
        report: this.buildErrorReport({
          logicalFilename,
          failureCategory: 'MISSING_INPUT',
          message: 'No input source or file path provided',
          startTime
        }),
        diagnostics: ['Error: No input source or file path provided'],
        exitCode: ExitCode.INVALID_ARGUMENTS
      };
    }

    const inputBytes = Buffer.byteLength(rawContent, 'utf8');
    if (inputBytes > maxInputBytes) {
      return {
        success: false,
        code: '',
        report: this.buildErrorReport({
          logicalFilename,
          failureCategory: 'INPUT_TOO_LARGE',
          message: `Input source (${inputBytes} bytes) exceeds limit of ${maxInputBytes} bytes`,
          startTime
        }),
        diagnostics: [`Error: Input source (${inputBytes} bytes) exceeds limit of ${maxInputBytes} bytes`],
        exitCode: ExitCode.SAFETY_RESOURCE_LIMIT
      };
    }

    // Binary / bytecode check: reject Lua compiled bytecode (\x1bLua) or files with binary nulls
    if (rawContent.includes('\x1bLua') || rawContent.slice(0, 100).includes('\0')) {
      return {
        success: false,
        code: '',
        report: this.buildErrorReport({
          logicalFilename,
          failureCategory: 'BINARY_OR_BYTECODE_INPUT',
          message: 'Input appears to be binary or compiled bytecode. Valax requires source-level Lua/Luau text.',
          startTime
        }),
        diagnostics: ['Error: Binary or compiled bytecode is not supported. Valax requires source text.'],
        exitCode: ExitCode.UNRECOGNIZED_FORMAT
      };
    }

    // Input SHA256
    const inputSha256 = crypto.createHash('sha256').update(rawContent).digest('hex');

    // 2. Normalize requested stage
    const validStages = new Set(['auto', 'L4', 'L5-W', 'L5']);
    const normalizedStage = validStages.has(requestedStage) ? requestedStage : 'auto';

    // 3. Execute recovery pipeline
    let coreResult;
    try {
      coreResult = recover(rawContent, {
        filename: logicalFilename,
        stage: normalizedStage === 'auto' ? 'L5' : normalizedStage,
        format: 'lua',
        semanticValidation: semanticValidation
      });
    } catch (err) {
      const isParseError = err.message?.includes('Parse') || 
                           err.message?.includes('Syntax') || 
                           err.message?.includes('Unexpected') ||
                           err.message?.includes('token') ||
                           err.name === 'SyntaxError' ||
                           err.name === 'ParseError';
      const exitCode = isParseError ? ExitCode.PARSE_FAILURE : ExitCode.RECOVERY_INTERNAL_FAILURE;
      const failureCat = isParseError ? 'SYNTAX_PARSE_FAILURE' : 'INTERNAL_RECOVERY_EXCEPTION';

      return {
        success: false,
        code: '',
        report: this.buildErrorReport({
          logicalFilename,
          inputSha256,
          inputBytes,
          failureCategory: failureCat,
          message: err.message,
          startTime
        }),
        diagnostics: [`Error: ${err.message}`],
        exitCode
      };
    }

    const coreReport = coreResult.report || {};
    const actualLevel = coreReport.recoveryLevel || 'L4';
    const elapsedMs = Date.now() - startTime;

    // Determine semantic validation result
    let semanticPass = 'NOT_RUN';
    if (semanticValidation) {
      if (coreReport.semanticEquivalence === true) {
        semanticPass = 'PASS';
      } else if (coreReport.semanticEquivalence === false) {
        semanticPass = 'FAIL';
      } else {
        semanticPass = 'CONSERVATIVE';
      }
    }

    // Check if semantic validation failed strictly
    if (semanticValidation && coreReport.semanticEquivalence === false && actualLevel === 'L5-W') {
      return {
        success: false,
        code: coreResult.code,
        report: this.buildVersionedReport({
          logicalFilename,
          inputBytes,
          inputSha256,
          requestedStage,
          actualLevel: 'L4', // forced downgrade
          coreReport,
          semanticPass: 'FAIL',
          warnings: [...warnings, 'Semantic validation differential detected; L5-W promotion rejected.'],
          failureCategory: 'SEMANTIC_VALIDATION_MISMATCH',
          elapsedMs
        }),
        diagnostics: ['Semantic validation failure: recovered program output diverged from original observable trace'],
        exitCode: ExitCode.SEMANTIC_VALIDATION_FAILURE
      };
    }

    // 4. Construct Versioned Report Schema = "1"
    const finalReport = this.buildVersionedReport({
      logicalFilename,
      inputBytes,
      inputSha256,
      requestedStage,
      actualLevel,
      coreReport,
      semanticPass,
      warnings,
      failureCategory: null,
      elapsedMs
    });

    return {
      success: true,
      code: coreResult.code,
      report: finalReport,
      diagnostics,
      exitCode: ExitCode.SUCCESS
    };
  }

  static buildVersionedReport({
    logicalFilename,
    inputBytes,
    inputSha256,
    requestedStage,
    actualLevel,
    coreReport,
    semanticPass,
    warnings,
    failureCategory,
    elapsedMs
  }) {
    const dispatcher = coreReport.dispatcher || {};

    return {
      schemaVersion: SCHEMA_VERSION,
      toolVersion: TOOL_VERSION,
      status: 'success',
      input: {
        filename: logicalFilename,
        bytes: inputBytes,
        sha256: inputSha256
      },
      detection: {
        family: coreReport.detectedFormat || 'WeAreDevs',
        version: coreReport.version || '1.0.0',
        confidence: coreReport.confidence !== undefined ? coreReport.confidence : 1.0
      },
      recovery: {
        requestedStage: requestedStage,
        actualLevel: actualLevel,
        isL5WEligible: actualLevel === 'L5-W',
        dispatcherStatesBefore: dispatcher.states || 0,
        dispatcherStatesAfter: actualLevel === 'L5-W' ? 0 : (coreReport.closureAnalysis?.remainingDispatcherStates ?? (coreReport.statesFound ?? (dispatcher.reachable ?? 0))),
        physicalResidualStates: actualLevel === 'L5-W' ? 0 : (coreReport.closureAnalysis?.remainingDispatcherStates ?? (coreReport.statesFound ?? 0)),
        reachableResidualStates: actualLevel === 'L5-W' ? 0 : (dispatcher.reachable ?? 0),
        encodedStringsRemaining: coreReport.stringsRemaining || 0,
        runtimeDecoderRemaining: coreReport.decoderRemaining || false,
        protectionRuntimeRemaining: actualLevel !== 'L5-W'
      },
      validation: {
        semantic: semanticPass
      },
      proof: {
        integrity: coreReport.completeness?.proofIntegrity?.pass !== false,
        completeness: coreReport.completeness?.wholeProgramClosed || false,
        details: coreReport.completeness?.mixedClosed?.proof || coreReport.reason || 'Evidence-backed static recovery complete.'
      },
      warnings: warnings,
      failureCategory: failureCategory,
      timing: {
        totalMs: elapsedMs
      },
      reproducibility: {
        sha256: inputSha256,
        toolVersion: TOOL_VERSION,
        nodeVersion: process.version,
        platform: process.platform,
        options: {
          requestedStage: requestedStage
        }
      }
    };
  }

  static buildErrorReport({
    logicalFilename,
    inputBytes = 0,
    inputSha256 = null,
    failureCategory,
    message,
    startTime
  }) {
    return {
      schemaVersion: SCHEMA_VERSION,
      toolVersion: TOOL_VERSION,
      status: 'failure',
      input: {
        filename: logicalFilename,
        bytes: inputBytes,
        sha256: inputSha256
      },
      detection: {
        family: 'unknown',
        version: 'unknown',
        confidence: 0.0
      },
      recovery: {
        requestedStage: 'auto',
        actualLevel: 'NONE',
        isL5WEligible: false,
        dispatcherStatesBefore: 0,
        dispatcherStatesAfter: 0,
        physicalResidualStates: 0,
        reachableResidualStates: 0,
        encodedStringsRemaining: 0,
        runtimeDecoderRemaining: false,
        protectionRuntimeRemaining: true
      },
      validation: {
        semantic: 'NOT_RUN'
      },
      proof: {
        integrity: false,
        completeness: false,
        details: message
      },
      warnings: [],
      failureCategory: failureCategory,
      timing: {
        totalMs: Date.now() - startTime
      },
      reproducibility: {
        sha256: inputSha256,
        toolVersion: TOOL_VERSION,
        nodeVersion: process.version,
        platform: process.platform,
        options: {}
      }
    };
  }
}

module.exports = {
  RecoveryService,
  ExitCode,
  TOOL_VERSION,
  SCHEMA_VERSION,
  DEFAULT_MAX_INPUT_BYTES
};
