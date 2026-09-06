/**
 * ByteString abstraction for byte-safe handling of Lua strings.
 * Lua strings are 8-bit clean byte buffers and may contain arbitrary binary sequences,
 * null bytes, or non-UTF-8 characters.
 */
class ByteString {
  /**
   * @param {Buffer | Uint8Array | string | number[]} input
   */
  constructor(input) {
    if (Buffer.isBuffer(input)) {
      this.buffer = Buffer.from(input);
    } else if (input instanceof Uint8Array) {
      this.buffer = Buffer.from(input);
    } else if (typeof input === 'string') {
      this.buffer = Buffer.from(input, 'latin1');
    } else if (Array.isArray(input)) {
      this.buffer = Buffer.from(input);
    } else if (input instanceof ByteString) {
      this.buffer = Buffer.from(input.buffer);
    } else {
      this.buffer = Buffer.alloc(0);
    }
  }

  get length() {
    return this.buffer.length;
  }

  get(index) {
    return this.buffer[index];
  }

  slice(start, end) {
    return new ByteString(this.buffer.slice(start, end));
  }

  concat(other) {
    const oBuf = other instanceof ByteString ? other.buffer : new ByteString(other).buffer;
    return new ByteString(Buffer.concat([this.buffer, oBuf]));
  }

  equals(other) {
    if (!(other instanceof ByteString)) {
      other = new ByteString(other);
    }
    return this.buffer.equals(other.buffer);
  }

  toString(encoding = 'utf8') {
    return this.buffer.toString(encoding);
  }

  /**
   * Check if all bytes are printable ASCII (32..126) plus common whitespace (\t, \n, \r)
   */
  isPrintableAscii() {
    for (let i = 0; i < this.buffer.length; i++) {
      const b = this.buffer[i];
      if (b === 9 || b === 10 || b === 13) continue;
      if (b < 32 || b > 126) return false;
    }
    return true;
  }

  /**
   * Formats into a clean Lua string literal with proper escaping.
   * Printable characters are preserved, quotes/newlines escaped,
   * non-printable/binary bytes formatted as decimal \ddd.
   * @param {'"' | "'"} quoteChar
   */
  toLuaLiteral(quoteChar = '"') {
    let out = quoteChar;
    for (let i = 0; i < this.buffer.length; i++) {
      const b = this.buffer[i];
      if (b === 0) {
        out += '\\0';
      } else if (b === 7) {
        out += '\\a';
      } else if (b === 8) {
        out += '\\b';
      } else if (b === 9) {
        out += '\\t';
      } else if (b === 10) {
        out += '\\n';
      } else if (b === 11) {
        out += '\\v';
      } else if (b === 12) {
        out += '\\f';
      } else if (b === 13) {
        out += '\\r';
      } else if (b === 92) { // \
        out += '\\\\';
      } else if (b === quoteChar.charCodeAt(0)) {
        out += '\\' + quoteChar;
      } else if (b >= 32 && b <= 126) {
        out += String.fromCharCode(b);
      } else {
        // Decimal escape \ddd
        out += '\\' + String(b).padStart(3, '0');
      }
    }
    out += quoteChar;
    return out;
  }

  /**
   * Decodes Lua escape sequences from a source string token.
   * Supports: \ddd, \xXX, \a, \b, \f, \n, \r, \t, \v, \\, \", \'
   * @param {string} rawStringLiteral
   */
  static fromLuaLiteral(rawStringLiteral) {
    let str = rawStringLiteral;
    // Strip surrounding quotes if present
    if ((str.startsWith('"') && str.endsWith('"')) ||
        (str.startsWith("'") && str.endsWith("'"))) {
      str = str.slice(1, -1);
    } else if (str.startsWith('[') && str.endsWith(']')) {
      // Multiline string [[ ... ]] or [=[ ... ]=]
      const match = str.match(/^\[(=*)\[([\s\S]*?)\]\1\]$/);
      if (match) {
        let content = match[2];
        if (content.startsWith('\n')) content = content.slice(1);
        return new ByteString(Buffer.from(content, 'latin1'));
      }
    }

    const bytes = [];
    let i = 0;
    while (i < str.length) {
      if (str[i] === '\\' && i + 1 < str.length) {
        i++;
        const next = str[i];
        if (next >= '0' && next <= '9') {
          // Up to 3 decimal digits
          let numStr = next;
          if (i + 1 < str.length && str[i + 1] >= '0' && str[i + 1] <= '9') {
            i++;
            numStr += str[i];
            if (i + 1 < str.length && str[i + 1] >= '0' && str[i + 1] <= '9') {
              i++;
              numStr += str[i];
            }
          }
          bytes.push(parseInt(numStr, 10) & 0xff);
        } else if (next === 'x' || next === 'X') {
          // Hex escape \xXX
          if (i + 2 < str.length && /[0-9a-fA-F]{2}/.test(str.slice(i + 1, i + 3))) {
            const hex = str.slice(i + 1, i + 3);
            bytes.push(parseInt(hex, 16));
            i += 2;
          } else {
            bytes.push('x'.charCodeAt(0));
          }
        } else if (next === 'a') {
          bytes.push(7);
        } else if (next === 'b') {
          bytes.push(8);
        } else if (next === 'f') {
          bytes.push(12);
        } else if (next === 'n') {
          bytes.push(10);
        } else if (next === 'r') {
          bytes.push(13);
        } else if (next === 't') {
          bytes.push(9);
        } else if (next === 'v') {
          bytes.push(11);
        } else if (next === '\\') {
          bytes.push(92);
        } else if (next === '"') {
          bytes.push(34);
        } else if (next === "'") {
          bytes.push(39);
        } else if (next === 'z') {
          // Lua 5.2/Luau skip whitespace
          while (i + 1 < str.length && /\s/.test(str[i + 1])) {
            i++;
          }
        } else {
          bytes.push(str.charCodeAt(i));
        }
      } else {
        bytes.push(str.charCodeAt(i) & 0xff);
      }
      i++;
    }

    return new ByteString(Buffer.from(bytes));
  }
}

module.exports = { ByteString };
