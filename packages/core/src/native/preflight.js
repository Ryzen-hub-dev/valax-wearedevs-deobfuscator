const { spawnSync } = require('child_process');

const STAGES = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'];
const DEFAULT_NATIVE_TIMEOUT_MS = 10_000;

function isIdentifierStart(char) {
  return /[A-Za-z_]/.test(char);
}

function isIdentifierPart(char) {
  return /[A-Za-z0-9_]/.test(char);
}

function profileSourceJs(source) {
  let index = 0;
  let tokens = 0;
  let depth = 0;
  let maxDepth = 0;
  let lines = 1;
  let currentLineLength = 0;
  let maxLineLength = 0;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (char === '\n') {
      lines++;
      maxLineLength = Math.max(maxLineLength, currentLineLength);
      currentLineLength = 0;
      index++;
      continue;
    }
    currentLineLength++;

    if (/\s/.test(char)) {
      index++;
      continue;
    }

    if (char === '-' && next === '-') {
      index += 2;
      if (source[index] === '[' && source[index + 1] === '[') {
        index += 2;
        while (index < source.length && !(source[index] === ']' && source[index + 1] === ']')) {
          if (source[index] === '\n') {
            lines++;
            maxLineLength = Math.max(maxLineLength, currentLineLength);
            currentLineLength = 0;
          } else {
            currentLineLength++;
          }
          index++;
        }
        index = Math.min(source.length, index + 2);
      } else {
        while (index < source.length && source[index] !== '\n') index++;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      tokens++;
      const quote = char;
      index++;
      while (index < source.length) {
        if (source[index] === '\\') {
          index += 2;
          continue;
        }
        if (source[index] === quote) {
          index++;
          break;
        }
        if (source[index] === '\n') {
          lines++;
          maxLineLength = Math.max(maxLineLength, currentLineLength);
          currentLineLength = 0;
        } else {
          currentLineLength++;
        }
        index++;
      }
      continue;
    }

    if (char === '[' && next === '[') {
      tokens++;
      index += 2;
      while (index < source.length && !(source[index] === ']' && source[index + 1] === ']')) {
        if (source[index] === '\n') {
          lines++;
          maxLineLength = Math.max(maxLineLength, currentLineLength);
          currentLineLength = 0;
        } else {
          currentLineLength++;
        }
        index++;
      }
      index = Math.min(source.length, index + 2);
      continue;
    }

    if (isIdentifierStart(char)) {
      tokens++;
      index++;
      while (index < source.length && isIdentifierPart(source[index])) index++;
      continue;
    }

    if (/[0-9]/.test(char)) {
      tokens++;
      index++;
      while (index < source.length && /[A-Fa-f0-9._xXpP+-]/.test(source[index])) index++;
      continue;
    }

    tokens++;
    if (char === '(' || char === '{' || char === '[') {
      depth++;
      maxDepth = Math.max(maxDepth, depth);
    } else if ((char === ')' || char === '}' || char === ']') && depth > 0) {
      depth--;
    }
    index++;
  }

  maxLineLength = Math.max(maxLineLength, currentLineLength);
  const bytes = Buffer.byteLength(source, 'utf8');
  return {
    engine: 'javascript-preflight',
    bytes,
    tokens,
    lines,
    maxDepth,
    maxLineLength,
    recommendedStage: recommendStage({ bytes, tokens, maxDepth, maxLineLength })
  };
}

function recommendStage(profile) {
  if (profile.bytes > 1_200_000 || profile.tokens > 350_000 || profile.maxLineLength > 1_200_000) return 'L2';
  if (profile.bytes > 640_000 || profile.tokens > 190_000 || profile.maxDepth > 1_000) return 'L3';
  if (profile.bytes > 320_000 || profile.tokens > 100_000 || profile.maxDepth > 350) return 'L4';
  return 'L5';
}

function capStage(requestedStage, recommendedStage) {
  const requestedIndex = STAGES.indexOf(requestedStage);
  const recommendedIndex = STAGES.indexOf(recommendedStage);
  if (requestedIndex < 0 || recommendedIndex < 0) return requestedStage;
  return STAGES[Math.min(requestedIndex, recommendedIndex)];
}

function profileSourceNative(source, options = {}) {
  const binaryPath = options.binaryPath || process.env.VALAX_NATIVE_ENGINE_PATH;
  if (!binaryPath) return null;

  const result = spawnSync(binaryPath, ['preflight'], {
    input: source,
    encoding: 'utf8',
    timeout: options.timeoutMs || DEFAULT_NATIVE_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
    windowsHide: true
  });

  if (result.error || result.status !== 0 || !result.stdout) return null;

  try {
    const profile = JSON.parse(result.stdout);
    if (!profile || !Number.isFinite(profile.bytes) || !Number.isFinite(profile.tokens)) return null;
    return profile;
  } catch {
    return null;
  }
}

function profileSource(source, options = {}) {
  if (options.preferNative !== false) {
    const nativeProfile = profileSourceNative(source, options);
    if (nativeProfile) return nativeProfile;
  }
  return profileSourceJs(source);
}

module.exports = {
  STAGES,
  capStage,
  profileSource,
  profileSourceJs,
  profileSourceNative,
  recommendStage
};
