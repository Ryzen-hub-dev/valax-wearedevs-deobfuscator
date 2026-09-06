const TokenType = {
  // Keywords
  AND: 'AND',
  BREAK: 'BREAK',
  DO: 'DO',
  ELSE: 'ELSE',
  ELSEIF: 'ELSEIF',
  END: 'END',
  FALSE: 'FALSE',
  FOR: 'FOR',
  FUNCTION: 'FUNCTION',
  IF: 'IF',
  IN: 'IN',
  LOCAL: 'LOCAL',
  NIL: 'NIL',
  NOT: 'NOT',
  OR: 'OR',
  REPEAT: 'REPEAT',
  RETURN: 'RETURN',
  THEN: 'THEN',
  TRUE: 'TRUE',
  UNTIL: 'UNTIL',
  WHILE: 'WHILE',

  // Luau keywords
  CONTINUE: 'CONTINUE',

  // Identifiers & Literals
  IDENT: 'IDENT',
  NUMBER: 'NUMBER',
  STRING: 'STRING',

  // Operators & Delimiters
  PLUS: '+',
  MINUS: '-',
  STAR: '*',
  SLASH: '/',
  PERCENT: '%',
  CARET: '^',
  HASH: '#',
  EQ_EQ: '==',
  TILDE_EQ: '~=',
  LT_EQ: '<=',
  GT_EQ: '>=',
  LT: '<',
  GT: '>',
  ASSIGN: '=',
  LPAREN: '(',
  RPAREN: ')',
  LBRACE: '{',
  RBRACE: '}',
  LBRACKET: '[',
  RBRACKET: ']',
  SEMICOLON: ';',
  COLON: ':',
  COMMA: ',',
  DOT: '.',
  DOT_DOT: '..',
  DOT_DOT_DOT: '...',

  // Luau compound assignments
  PLUS_EQ: '+=',
  MINUS_EQ: '-=',
  STAR_EQ: '*=',
  SLASH_EQ: '/=',
  CONCAT_EQ: '..=',

  // End of file
  EOF: 'EOF'
};

const KEYWORDS = {
  'and': TokenType.AND,
  'break': TokenType.BREAK,
  'do': TokenType.DO,
  'else': TokenType.ELSE,
  'elseif': TokenType.ELSEIF,
  'end': TokenType.END,
  'false': TokenType.FALSE,
  'for': TokenType.FOR,
  'function': TokenType.FUNCTION,
  'if': TokenType.IF,
  'in': TokenType.IN,
  'local': TokenType.LOCAL,
  'nil': TokenType.NIL,
  'not': TokenType.NOT,
  'or': TokenType.OR,
  'repeat': TokenType.REPEAT,
  'return': TokenType.RETURN,
  'then': TokenType.THEN,
  'true': TokenType.TRUE,
  'until': TokenType.UNTIL,
  'while': TokenType.WHILE,
  'continue': TokenType.CONTINUE
};

class Token {
  /**
   * @param {string} type
   * @param {any} value
   * @param {number} line
   * @param {number} column
   * @param {number} offset
   * @param {string} [raw]
   */
  constructor(type, value, line, column, offset, raw = '') {
    this.type = type;
    this.value = value;
    this.line = line;
    this.column = column;
    this.offset = offset;
    this.raw = raw;
  }
}

module.exports = {
  TokenType,
  KEYWORDS,
  Token
};
