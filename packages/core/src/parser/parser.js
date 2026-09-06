const { TokenType } = require('../lexer/tokens');
const { Lexer } = require('../lexer/lexer');
const { ParseError } = require('../../../shared/src');
const ast = require('../ast/nodes');

class Parser {
  /**
   * @param {string | Token[]} input
   */
  constructor(input) {
    if (typeof input === 'string') {
      const lexer = new Lexer(input);
      this.tokens = lexer.tokenize();
    } else {
      this.tokens = input;
    }
    this.pos = 0;
  }

  peek(offset = 0) {
    const idx = this.pos + offset;
    return idx < this.tokens.length ? this.tokens[idx] : this.tokens[this.tokens.length - 1];
  }

  is(type, offset = 0) {
    return this.peek(offset).type === type;
  }

  advance() {
    const t = this.peek();
    if (this.pos < this.tokens.length - 1) {
      this.pos++;
    }
    return t;
  }

  consume(type, errorMsg) {
    const t = this.peek();
    if (t.type !== type) {
      throw new ParseError(errorMsg || `Expected '${type}' but found '${t.type}' (${t.raw || t.value})`, t.line, t.column, t.offset);
    }
    return this.advance();
  }

  match(...types) {
    for (const t of types) {
      if (this.is(t)) {
        return this.advance();
      }
    }
    return null;
  }

  parseChunk() {
    const body = this.parseBlock();
    if (!this.is(TokenType.EOF)) {
      const t = this.peek();
      throw new ParseError(`Unexpected token '${t.type}' (${t.raw || t.value}) after chunk`, t.line, t.column, t.offset);
    }
    return ast.chunk(body);
  }

  parseBlock() {
    const statements = [];
    while (!this.is(TokenType.EOF) &&
           !this.is(TokenType.END) &&
           !this.is(TokenType.ELSEIF) &&
           !this.is(TokenType.ELSE) &&
           !this.is(TokenType.UNTIL)) {
      const stmt = this.parseStatement();
      if (stmt) {
        statements.push(stmt);
      }
    }
    return statements;
  }

  parseStatement() {
    // Semicolon
    if (this.match(TokenType.SEMICOLON)) {
      return ast.emptyStatement();
    }

    // Local
    if (this.match(TokenType.LOCAL)) {
      if (this.match(TokenType.FUNCTION)) {
        return this.parseLocalFunction();
      }
      return this.parseLocalVariables();
    }

    // Function
    if (this.match(TokenType.FUNCTION)) {
      return this.parseFunctionDeclaration();
    }

    // If
    if (this.match(TokenType.IF)) {
      return this.parseIfStatement();
    }

    // While
    if (this.match(TokenType.WHILE)) {
      return this.parseWhileStatement();
    }

    // Repeat
    if (this.match(TokenType.REPEAT)) {
      return this.parseRepeatStatement();
    }

    // Do
    if (this.match(TokenType.DO)) {
      const body = this.parseBlock();
      this.consume(TokenType.END, "Expected 'end' to close 'do' block");
      return ast.doStatement(body);
    }

    // For
    if (this.match(TokenType.FOR)) {
      return this.parseForStatement();
    }

    // Break
    if (this.match(TokenType.BREAK)) {
      this.match(TokenType.SEMICOLON);
      return ast.breakStatement();
    }

    // Continue
    if (this.match(TokenType.CONTINUE)) {
      this.match(TokenType.SEMICOLON);
      return ast.continueStatement();
    }

    // Return
    if (this.match(TokenType.RETURN)) {
      const args = [];
      if (!this.is(TokenType.END) &&
          !this.is(TokenType.ELSEIF) &&
          !this.is(TokenType.ELSE) &&
          !this.is(TokenType.UNTIL) &&
          !this.is(TokenType.SEMICOLON) &&
          !this.is(TokenType.EOF)) {
        args.push(this.parseExpression());
        while (this.match(TokenType.COMMA)) {
          args.push(this.parseExpression());
        }
      }
      this.match(TokenType.SEMICOLON);
      return ast.returnStatement(args);
    }

    // Function call or Assignment
    return this.parseCallOrAssignment();
  }

  parseLocalFunction() {
    const idToken = this.consume(TokenType.IDENT, 'Expected function name after local function');
    const id = ast.identifier(idToken.value);
    const { params, isVararg, body } = this.parseFunctionBody();
    return ast.localFunctionStatement(id, params, isVararg, body);
  }

  parseLocalVariables() {
    const variables = [];
    const idToken = this.consume(TokenType.IDENT, 'Expected variable name in local statement');
    variables.push(ast.identifier(idToken.value));

    while (this.match(TokenType.COMMA)) {
      const nextId = this.consume(TokenType.IDENT, 'Expected variable name after comma in local statement');
      variables.push(ast.identifier(nextId.value));
    }

    const init = [];
    if (this.match(TokenType.ASSIGN)) {
      init.push(this.parseExpression());
      while (this.match(TokenType.COMMA)) {
        init.push(this.parseExpression());
      }
    }

    this.match(TokenType.SEMICOLON);
    return ast.localStatement(variables, init);
  }

  parseFunctionDeclaration() {
    // Name can be a.b.c or a.b:c
    let name = ast.identifier(this.consume(TokenType.IDENT, 'Expected function name').value);
    let isMethod = false;

    while (this.match(TokenType.DOT)) {
      const prop = ast.identifier(this.consume(TokenType.IDENT, 'Expected property name after .').value);
      name = ast.memberExpression(name, prop);
    }

    if (this.match(TokenType.COLON)) {
      const method = ast.identifier(this.consume(TokenType.IDENT, 'Expected method name after :').value);
      name = ast.memberExpression(name, method);
      isMethod = true;
    }

    const { params, isVararg, body } = this.parseFunctionBody();
    return ast.functionDeclaration(name, params, isVararg, body, isMethod);
  }

  parseFunctionBody() {
    this.consume(TokenType.LPAREN, "Expected '(' for parameter list");
    const params = [];
    let isVararg = false;

    if (!this.is(TokenType.RPAREN)) {
      if (this.match(TokenType.DOT_DOT_DOT)) {
        isVararg = true;
      } else {
        params.push(ast.identifier(this.consume(TokenType.IDENT, 'Expected parameter name').value));
        while (this.match(TokenType.COMMA)) {
          if (this.match(TokenType.DOT_DOT_DOT)) {
            isVararg = true;
            break;
          }
          params.push(ast.identifier(this.consume(TokenType.IDENT, 'Expected parameter name after comma').value));
        }
      }
    }
    this.consume(TokenType.RPAREN, "Expected ')' to close parameter list");

    const body = this.parseBlock();
    this.consume(TokenType.END, "Expected 'end' to close function body");

    return { params, isVararg, body };
  }

  parseIfStatement() {
    const clauses = [];
    const condition = this.parseExpression();
    this.consume(TokenType.THEN, "Expected 'then' after if condition");
    const body = this.parseBlock();
    clauses.push({ condition, body });

    while (this.match(TokenType.ELSEIF)) {
      const elifCond = this.parseExpression();
      this.consume(TokenType.THEN, "Expected 'then' after elseif condition");
      const elifBody = this.parseBlock();
      clauses.push({ condition: elifCond, body: elifBody });
    }

    let elseBody = null;
    if (this.match(TokenType.ELSE)) {
      elseBody = this.parseBlock();
    }

    this.consume(TokenType.END, "Expected 'end' to close if statement");
    return ast.ifStatement(clauses, elseBody);
  }

  parseWhileStatement() {
    const condition = this.parseExpression();
    this.consume(TokenType.DO, "Expected 'do' after while condition");
    const body = this.parseBlock();
    this.consume(TokenType.END, "Expected 'end' to close while loop");
    return ast.whileStatement(condition, body);
  }

  parseRepeatStatement() {
    const body = this.parseBlock();
    this.consume(TokenType.UNTIL, "Expected 'until' after repeat block");
    const condition = this.parseExpression();
    this.match(TokenType.SEMICOLON);
    return ast.repeatStatement(condition, body);
  }

  parseForStatement() {
    const firstId = ast.identifier(this.consume(TokenType.IDENT, 'Expected variable name after for').value);

    // Numeric for: for i = start, end [, step] do
    if (this.match(TokenType.ASSIGN)) {
      const start = this.parseExpression();
      this.consume(TokenType.COMMA, "Expected ',' after for start expression");
      const end = this.parseExpression();
      let step = null;
      if (this.match(TokenType.COMMA)) {
        step = this.parseExpression();
      }
      this.consume(TokenType.DO, "Expected 'do' in numeric for loop");
      const body = this.parseBlock();
      this.consume(TokenType.END, "Expected 'end' to close numeric for loop");
      return ast.numericForStatement(firstId, start, end, step, body);
    }

    // Generic for: for k, v in iter do
    const variables = [firstId];
    while (this.match(TokenType.COMMA)) {
      variables.push(ast.identifier(this.consume(TokenType.IDENT, 'Expected variable name after comma').value));
    }

    this.consume(TokenType.IN, "Expected '=' or 'in' in for loop");
    const iterators = [this.parseExpression()];
    while (this.match(TokenType.COMMA)) {
      iterators.push(this.parseExpression());
    }

    this.consume(TokenType.DO, "Expected 'do' in generic for loop");
    const body = this.parseBlock();
    this.consume(TokenType.END, "Expected 'end' to close generic for loop");
    return ast.genericForStatement(variables, iterators, body);
  }

  parseCallOrAssignment() {
    const first = this.parsePrefixExp();

    // If followed by comma, =, or compound assignment => assignment
    if (this.is(TokenType.COMMA) ||
        this.is(TokenType.ASSIGN) ||
        this.is(TokenType.PLUS_EQ) ||
        this.is(TokenType.MINUS_EQ) ||
        this.is(TokenType.STAR_EQ) ||
        this.is(TokenType.SLASH_EQ) ||
        this.is(TokenType.CONCAT_EQ)) {
      const variables = [first];
      while (this.match(TokenType.COMMA)) {
        variables.push(this.parsePrefixExp());
      }

      const assignOp = this.advance(); // =, +=, etc.
      const init = [this.parseExpression()];
      while (this.match(TokenType.COMMA)) {
        init.push(this.parseExpression());
      }
      this.match(TokenType.SEMICOLON);

      // Handle Luau compound assignments: x += y => x = x + y
      if (assignOp.type !== TokenType.ASSIGN) {
        const binOp = assignOp.type.replace('=', '');
        init[0] = ast.binaryExpression(binOp, variables[0], init[0]);
      }

      return ast.assignmentStatement(variables, init);
    }

    // Otherwise must be a CallStatement
    if (first.type === ast.ASTNodeType.CallExpression ||
        first.type === ast.ASTNodeType.MethodCallExpression) {
      this.match(TokenType.SEMICOLON);
      return ast.callStatement(first);
    }

    const t = this.peek();
    throw new ParseError(`Expected assignment or function call, found ${first.type}`, t.line, t.column, t.offset);
  }

  parseExpression() {
    return this.parseSubExpression(0);
  }

  // Precedence levels:
  // 1: or
  // 2: and
  // 3: <, >, <=, >=, ~=, ==
  // 4: .. (right-assoc)
  // 5: +, -
  // 6: *, /, %
  // 7: unary: not, #, -
  // 8: ^ (right-assoc)
  getBinaryPrecedence(type) {
    switch (type) {
      case TokenType.OR: return 1;
      case TokenType.AND: return 2;
      case TokenType.LT:
      case TokenType.GT:
      case TokenType.LT_EQ:
      case TokenType.GT_EQ:
      case TokenType.TILDE_EQ:
      case TokenType.EQ_EQ: return 3;
      case TokenType.DOT_DOT: return 4;
      case TokenType.PLUS:
      case TokenType.MINUS: return 5;
      case TokenType.STAR:
      case TokenType.SLASH:
      case TokenType.PERCENT: return 6;
      case TokenType.CARET: return 8;
      default: return 0;
    }
  }

  isRightAssociative(type) {
    return type === TokenType.DOT_DOT || type === TokenType.CARET;
  }

  parseSubExpression(minPrec) {
    let left = this.parseSimpleExpression();

    while (true) {
      const opToken = this.peek();
      const prec = this.getBinaryPrecedence(opToken.type);
      if (prec === 0 || prec < minPrec) {
        break;
      }

      this.advance();
      const nextMinPrec = this.isRightAssociative(opToken.type) ? prec : prec + 1;
      const right = this.parseSubExpression(nextMinPrec);

      if (opToken.type === TokenType.AND || opToken.type === TokenType.OR) {
        left = ast.logicalExpression(opToken.value, left, right);
      } else {
        left = ast.binaryExpression(opToken.value, left, right);
      }
    }

    return left;
  }

  parseSimpleExpression() {
    // Unary: not, #, -
    if (this.match(TokenType.NOT)) {
      return ast.unaryExpression('not', this.parseSubExpression(7));
    }
    if (this.match(TokenType.HASH)) {
      return ast.unaryExpression('#', this.parseSubExpression(7));
    }
    if (this.match(TokenType.MINUS)) {
      return ast.unaryExpression('-', this.parseSubExpression(7));
    }

    // Literals
    if (this.is(TokenType.NUMBER)) {
      const t = this.advance();
      return ast.numericLiteral(t.value, t.raw);
    }
    if (this.is(TokenType.STRING)) {
      const t = this.advance();
      return ast.stringLiteral(t.value, t.raw);
    }
    if (this.is(TokenType.TRUE) || this.is(TokenType.FALSE)) {
      const t = this.advance();
      return ast.booleanLiteral(t.value);
    }
    if (this.is(TokenType.NIL)) {
      this.advance();
      return ast.nilLiteral();
    }
    if (this.is(TokenType.DOT_DOT_DOT)) {
      this.advance();
      return ast.varargLiteral();
    }

    // Table Constructor
    if (this.is(TokenType.LBRACE)) {
      return this.parseTableConstructor();
    }

    // Anonymous Function
    if (this.match(TokenType.FUNCTION)) {
      const { params, isVararg, body } = this.parseFunctionBody();
      return ast.functionExpression(params, isVararg, body);
    }

    // Prefix expression (identifier, (expr), call, index, member)
    return this.parsePrefixExp();
  }

  parsePrefixExp() {
    let base;
    if (this.match(TokenType.LPAREN)) {
      base = this.parseExpression();
      this.consume(TokenType.RPAREN, "Expected ')' after parenthesized expression");
      if (base) base.inParens = true;
    } else if (this.is(TokenType.IDENT)) {
      base = ast.identifier(this.advance().value);
    } else {
      const t = this.peek();
      throw new ParseError(`Unexpected token in expression: '${t.type}' (${t.raw || t.value})`, t.line, t.column, t.offset);
    }

    // Suffixes: [expr], .ident, :ident(args), (args), string literal, table constructor
    while (true) {
      if (this.match(TokenType.LBRACKET)) {
        const index = this.parseExpression();
        this.consume(TokenType.RBRACKET, "Expected ']' after indexing expression");
        base = ast.indexExpression(base, index);
      } else if (this.match(TokenType.DOT)) {
        const prop = ast.identifier(this.consume(TokenType.IDENT, 'Expected property name after .').value);
        base = ast.memberExpression(base, prop);
      } else if (this.match(TokenType.COLON)) {
        const method = ast.identifier(this.consume(TokenType.IDENT, 'Expected method name after :').value);
        const args = this.parseCallArgs();
        base = ast.methodCallExpression(base, method, args);
      } else if (this.is(TokenType.LPAREN) || this.is(TokenType.STRING) || this.is(TokenType.LBRACE)) {
        const args = this.parseCallArgs();
        base = ast.callExpression(base, args);
      } else {
        break;
      }
    }

    return base;
  }

  parseCallArgs() {
    if (this.match(TokenType.LPAREN)) {
      const args = [];
      if (!this.is(TokenType.RPAREN)) {
        args.push(this.parseExpression());
        while (this.match(TokenType.COMMA)) {
          args.push(this.parseExpression());
        }
      }
      this.consume(TokenType.RPAREN, "Expected ')' to close function arguments");
      return args;
    }

    if (this.is(TokenType.STRING)) {
      const t = this.advance();
      return [ast.stringLiteral(t.value, t.raw)];
    }

    if (this.is(TokenType.LBRACE)) {
      return [this.parseTableConstructor()];
    }

    const t = this.peek();
    throw new ParseError(`Expected function arguments, found '${t.type}'`, t.line, t.column, t.offset);
  }

  parseTableConstructor() {
    this.consume(TokenType.LBRACE, "Expected '{'");
    const fields = [];

    while (!this.is(TokenType.RBRACE) && !this.is(TokenType.EOF)) {
      // [exp] = exp
      if (this.match(TokenType.LBRACKET)) {
        const key = this.parseExpression();
        this.consume(TokenType.RBRACKET, "Expected ']' after table key");
        this.consume(TokenType.ASSIGN, "Expected '=' after table key");
        const val = this.parseExpression();
        fields.push(ast.tableKey(key, val));
      }
      // Name = exp (peek ahead to see if followed by =)
      else if (this.is(TokenType.IDENT) && this.peek(1).type === TokenType.ASSIGN) {
        const key = ast.identifier(this.advance().value);
        this.consume(TokenType.ASSIGN, "Expected '=' after field name");
        const val = this.parseExpression();
        fields.push(ast.tableKeyString(key, val));
      }
      // exp (array style)
      else {
        const val = this.parseExpression();
        fields.push(ast.tableValue(val));
      }

      // Separator: comma or semicolon
      if (!this.match(TokenType.COMMA) && !this.match(TokenType.SEMICOLON)) {
        break;
      }
    }

    this.consume(TokenType.RBRACE, "Expected '}' to close table constructor");
    return ast.tableConstructor(fields);
  }
}

module.exports = { Parser };
