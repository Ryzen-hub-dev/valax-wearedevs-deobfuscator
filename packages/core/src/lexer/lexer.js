const { TokenType, KEYWORDS, Token } = require('./tokens');
const { ParseError, ByteString } = require('../../../shared/src');

class Lexer {
  /**
   * @param {string} source
   */
  constructor(source) {
    this.source = source;
    this.length = source.length;
    this.pos = 0;
    this.line = 1;
    this.col = 1;
    this.tokens = [];
  }

  peek(offset = 0) {
    const idx = this.pos + offset;
    return idx < this.length ? this.source[idx] : '\0';
  }

  advance() {
    if (this.pos < this.length) {
      const ch = this.source[this.pos++];
      if (ch === '\n') {
        this.line++;
        this.col = 1;
      } else {
        this.col++;
      }
      return ch;
    }
    return '\0';
  }

  tokenize() {
    while (this.pos < this.length) {
      const ch = this.peek();

      // Whitespace
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
        this.advance();
        continue;
      }

      // Comments: --
      if (ch === '-' && this.peek(1) === '-') {
        this.skipComment();
        continue;
      }

      const startLine = this.line;
      const startCol = this.col;
      const startPos = this.pos;

      // Strings
      if (ch === '"' || ch === "'") {
        this.readString(ch);
        continue;
      }

      // Long strings: [[ ... ]] or [=[ ... ]=]
      if (ch === '[' && (this.peek(1) === '[' || this.peek(1) === '=')) {
        const longStr = this.tryReadLongStringOrComment();
        if (longStr !== null) {
          const byteStr = ByteString.fromLuaLiteral(longStr);
          this.tokens.push(new Token(TokenType.STRING, byteStr, startLine, startCol, startPos, longStr));
          continue;
        }
      }

      // Numbers: digits or . followed by digit
      if ((ch >= '0' && ch <= '9') || (ch === '.' && this.peek(1) >= '0' && this.peek(1) <= '9')) {
        this.readNumber();
        continue;
      }

      // Identifiers and Keywords
      if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_') {
        this.readIdentifier();
        continue;
      }

      // Symbols / Operators
      this.readPunctuation();
    }

    this.tokens.push(new Token(TokenType.EOF, null, this.line, this.col, this.pos, ''));
    return this.tokens;
  }

  skipComment() {
    this.advance(); // -
    this.advance(); // -

    // Check for multiline comment --[[ or --[=[
    if (this.peek() === '[' && (this.peek(1) === '[' || this.peek(1) === '=')) {
      const startPos = this.pos;
      let eqCount = 0;
      this.advance(); // [
      while (this.peek() === '=') {
        eqCount++;
        this.advance();
      }
      if (this.peek() === '[') {
        this.advance(); // [
        // Find matching ]=...]
        const closeSeq = ']' + '='.repeat(eqCount) + ']';
        while (this.pos < this.length) {
          if (this.source.startsWith(closeSeq, this.pos)) {
            for (let i = 0; i < closeSeq.length; i++) this.advance();
            return;
          }
          this.advance();
        }
        return; // Unterminated long comment reaches EOF
      } else {
        // Not a long comment, backtrack and treat as single line
        this.pos = startPos;
      }
    }

    // Single line comment
    while (this.pos < this.length && this.peek() !== '\n') {
      this.advance();
    }
  }

  tryReadLongStringOrComment() {
    const startPos = this.pos;
    let eqCount = 0;
    this.advance(); // [
    while (this.peek() === '=') {
      eqCount++;
      this.advance();
    }
    if (this.peek() === '[') {
      this.advance(); // [
      const closeSeq = ']' + '='.repeat(eqCount) + ']';
      const contentStart = this.pos;
      while (this.pos < this.length) {
        if (this.source.startsWith(closeSeq, this.pos)) {
          const content = this.source.slice(contentStart, this.pos);
          for (let i = 0; i < closeSeq.length; i++) this.advance();
          const fullRaw = this.source.slice(startPos, this.pos);
          return fullRaw;
        }
        this.advance();
      }
      throw new ParseError('Unterminated long bracket string', this.line, this.col, startPos);
    } else {
      // Not a long string, backtrack
      this.pos = startPos;
      return null;
    }
  }

  readString(quote) {
    const startLine = this.line;
    const startCol = this.col;
    const startPos = this.pos;

    this.advance(); // quote
    while (this.pos < this.length) {
      const ch = this.peek();
      if (ch === '\\') {
        this.advance();
        if (this.pos < this.length) {
          this.advance(); // escape target
        }
      } else if (ch === quote) {
        this.advance(); // closing quote
        const raw = this.source.slice(startPos, this.pos);
        const byteStr = ByteString.fromLuaLiteral(raw);
        this.tokens.push(new Token(TokenType.STRING, byteStr, startLine, startCol, startPos, raw));
        return;
      } else if (ch === '\n' || ch === '\r') {
        throw new ParseError('Unfinished string literal before newline', startLine, startCol, startPos);
      } else {
        this.advance();
      }
    }

    throw new ParseError('Unterminated string literal at EOF', startLine, startCol, startPos);
  }

  readNumber() {
    const startLine = this.line;
    const startCol = this.col;
    const startPos = this.pos;

    let raw = '';
    // Check for hex 0x / 0X
    if (this.peek() === '0' && (this.peek(1) === 'x' || this.peek(1) === 'X')) {
      raw += this.advance(); // 0
      raw += this.advance(); // x
      while (/[0-9a-fA-F]/.test(this.peek())) {
        raw += this.advance();
      }
      if (this.peek() === '.') {
        raw += this.advance();
        while (/[0-9a-fA-F]/.test(this.peek())) {
          raw += this.advance();
        }
      }
      if (this.peek() === 'p' || this.peek() === 'P') {
        raw += this.advance();
        if (this.peek() === '+' || this.peek() === '-') {
          raw += this.advance();
        }
        while (/[0-9]/.test(this.peek())) {
          raw += this.advance();
        }
      }
      const numVal = Number(raw);
      this.tokens.push(new Token(TokenType.NUMBER, numVal, startLine, startCol, startPos, raw));
      return;
    }

    // Decimal
    while (/[0-9]/.test(this.peek())) {
      raw += this.advance();
    }
    if (this.peek() === '.' && this.peek(1) !== '.') {
      raw += this.advance();
      while (/[0-9]/.test(this.peek())) {
        raw += this.advance();
      }
    }
    if (this.peek() === 'e' || this.peek() === 'E') {
      raw += this.advance();
      if (this.peek() === '+' || this.peek() === '-') {
        raw += this.advance();
      }
      while (/[0-9]/.test(this.peek())) {
        raw += this.advance();
      }
    }

    const numVal = Number(raw);
    this.tokens.push(new Token(TokenType.NUMBER, numVal, startLine, startCol, startPos, raw));
  }

  readIdentifier() {
    const startLine = this.line;
    const startCol = this.col;
    const startPos = this.pos;

    let name = '';
    while (/[a-zA-Z0-9_]/.test(this.peek())) {
      name += this.advance();
    }

    const kw = KEYWORDS[name];
    if (kw) {
      if (kw === TokenType.TRUE) {
        this.tokens.push(new Token(TokenType.TRUE, true, startLine, startCol, startPos, name));
      } else if (kw === TokenType.FALSE) {
        this.tokens.push(new Token(TokenType.FALSE, false, startLine, startCol, startPos, name));
      } else if (kw === TokenType.NIL) {
        this.tokens.push(new Token(TokenType.NIL, null, startLine, startCol, startPos, name));
      } else {
        this.tokens.push(new Token(kw, name, startLine, startCol, startPos, name));
      }
    } else {
      this.tokens.push(new Token(TokenType.IDENT, name, startLine, startCol, startPos, name));
    }
  }

  readPunctuation() {
    const startLine = this.line;
    const startCol = this.col;
    const startPos = this.pos;
    const ch = this.advance();

    // 3-char operators: ...
    if (ch === '.' && this.peek() === '.' && this.peek(1) === '.') {
      this.advance();
      this.advance();
      this.tokens.push(new Token(TokenType.DOT_DOT_DOT, '...', startLine, startCol, startPos, '...'));
      return;
    }

    // 3-char compound: ..=
    if (ch === '.' && this.peek() === '.' && this.peek(1) === '=') {
      this.advance();
      this.advance();
      this.tokens.push(new Token(TokenType.CONCAT_EQ, '..=', startLine, startCol, startPos, '..='));
      return;
    }

    // 2-char operators: ==, ~=, <=, >=, .., +=, -=, *=, /=
    const next = this.peek();
    if (ch === '=' && next === '=') {
      this.advance();
      this.tokens.push(new Token(TokenType.EQ_EQ, '==', startLine, startCol, startPos, '=='));
      return;
    }
    if (ch === '~' && next === '=') {
      this.advance();
      this.tokens.push(new Token(TokenType.TILDE_EQ, '~=', startLine, startCol, startPos, '~='));
      return;
    }
    if (ch === '<' && next === '=') {
      this.advance();
      this.tokens.push(new Token(TokenType.LT_EQ, '<=', startLine, startCol, startPos, '<='));
      return;
    }
    if (ch === '>' && next === '=') {
      this.advance();
      this.tokens.push(new Token(TokenType.GT_EQ, '>=', startLine, startCol, startPos, '>='));
      return;
    }
    if (ch === '.' && next === '.') {
      this.advance();
      this.tokens.push(new Token(TokenType.DOT_DOT, '..', startLine, startCol, startPos, '..'));
      return;
    }
    if (ch === '+' && next === '=') {
      this.advance();
      this.tokens.push(new Token(TokenType.PLUS_EQ, '+=', startLine, startCol, startPos, '+='));
      return;
    }
    if (ch === '-' && next === '=') {
      this.advance();
      this.tokens.push(new Token(TokenType.MINUS_EQ, '-=', startLine, startCol, startPos, '-='));
      return;
    }
    if (ch === '*' && next === '=') {
      this.advance();
      this.tokens.push(new Token(TokenType.STAR_EQ, '*=', startLine, startCol, startPos, '*='));
      return;
    }
    if (ch === '/' && next === '=') {
      this.advance();
      this.tokens.push(new Token(TokenType.SLASH_EQ, '/=', startLine, startCol, startPos, '/='));
      return;
    }

    // 1-char operators & delimiters
    const singleTokens = {
      '+': TokenType.PLUS,
      '-': TokenType.MINUS,
      '*': TokenType.STAR,
      '/': TokenType.SLASH,
      '%': TokenType.PERCENT,
      '^': TokenType.CARET,
      '#': TokenType.HASH,
      '=': TokenType.ASSIGN,
      '<': TokenType.LT,
      '>': TokenType.GT,
      '(': TokenType.LPAREN,
      ')': TokenType.RPAREN,
      '{': TokenType.LBRACE,
      '}': TokenType.RBRACE,
      '[': TokenType.LBRACKET,
      ']': TokenType.RBRACKET,
      ';': TokenType.SEMICOLON,
      ':': TokenType.COLON,
      ',': TokenType.COMMA,
      '.': TokenType.DOT
    };

    const t = singleTokens[ch];
    if (t) {
      this.tokens.push(new Token(t, ch, startLine, startCol, startPos, ch));
      return;
    }

    throw new ParseError(`Unexpected character: '${ch}' (ASCII ${ch.charCodeAt(0)})`, startLine, startCol, startPos);
  }
}

module.exports = { Lexer };
