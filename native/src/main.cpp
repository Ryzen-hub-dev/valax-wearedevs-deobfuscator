#include <algorithm>
#include <cctype>
#include <cstddef>
#include <iostream>
#include <iterator>
#include <string>
#include <string_view>

namespace {

struct Profile {
  std::size_t bytes = 0;
  std::size_t tokens = 0;
  std::size_t lines = 1;
  std::size_t max_depth = 0;
  std::size_t max_line_length = 0;
};

bool is_identifier_start(char value) {
  const auto byte = static_cast<unsigned char>(value);
  return std::isalpha(byte) != 0 || value == '_';
}

bool is_identifier_part(char value) {
  const auto byte = static_cast<unsigned char>(value);
  return std::isalnum(byte) != 0 || value == '_';
}

void consume_line_character(char value, Profile& profile, std::size_t& line_length) {
  if (value == '\n') {
    profile.lines++;
    profile.max_line_length = std::max(profile.max_line_length, line_length);
    line_length = 0;
  } else {
    line_length++;
  }
}

Profile scan(std::string_view source) {
  Profile profile;
  profile.bytes = source.size();
  std::size_t index = 0;
  std::size_t depth = 0;
  std::size_t line_length = 0;

  while (index < source.size()) {
    const char current = source[index];
    const char next = index + 1 < source.size() ? source[index + 1] : '\0';

    if (std::isspace(static_cast<unsigned char>(current)) != 0) {
      consume_line_character(current, profile, line_length);
      index++;
      continue;
    }

    if (current == '-' && next == '-') {
      line_length += 2;
      index += 2;
      if (index + 1 < source.size() && source[index] == '[' && source[index + 1] == '[') {
        line_length += 2;
        index += 2;
        while (index < source.size() &&
               !(index + 1 < source.size() && source[index] == ']' && source[index + 1] == ']')) {
          consume_line_character(source[index], profile, line_length);
          index++;
        }
        if (index + 1 < source.size()) {
          line_length += 2;
          index += 2;
        }
      } else {
        while (index < source.size() && source[index] != '\n') {
          line_length++;
          index++;
        }
      }
      continue;
    }

    if (current == '"' || current == '\'') {
      profile.tokens++;
      const char quote = current;
      line_length++;
      index++;
      while (index < source.size()) {
        if (source[index] == '\\') {
          line_length++;
          index++;
          if (index < source.size()) {
            consume_line_character(source[index], profile, line_length);
            index++;
          }
          continue;
        }
        const char value = source[index];
        consume_line_character(value, profile, line_length);
        index++;
        if (value == quote) break;
      }
      continue;
    }

    if (current == '[' && next == '[') {
      profile.tokens++;
      line_length += 2;
      index += 2;
      while (index < source.size() &&
             !(index + 1 < source.size() && source[index] == ']' && source[index + 1] == ']')) {
        consume_line_character(source[index], profile, line_length);
        index++;
      }
      if (index + 1 < source.size()) {
        line_length += 2;
        index += 2;
      }
      continue;
    }

    if (is_identifier_start(current)) {
      profile.tokens++;
      while (index < source.size() && is_identifier_part(source[index])) {
        line_length++;
        index++;
      }
      continue;
    }

    if (std::isdigit(static_cast<unsigned char>(current)) != 0) {
      profile.tokens++;
      bool seen_exponent = false;
      while (index < source.size()) {
        const char value = source[index];
        const bool numeric_part = std::isalnum(static_cast<unsigned char>(value)) != 0 ||
                                  value == '.' || value == '_';
        const bool exponent_sign = (value == '+' || value == '-') && seen_exponent;
        if (!numeric_part && !exponent_sign) break;
        if (value == 'e' || value == 'E' || value == 'p' || value == 'P') {
          seen_exponent = true;
        } else if (value != '+' && value != '-') {
          seen_exponent = false;
        }
        line_length++;
        index++;
      }
      continue;
    }

    profile.tokens++;
    line_length++;
    if (current == '(' || current == '{' || current == '[') {
      depth++;
      profile.max_depth = std::max(profile.max_depth, depth);
    } else if ((current == ')' || current == '}' || current == ']') && depth > 0) {
      depth--;
    }
    index++;
  }

  profile.max_line_length = std::max(profile.max_line_length, line_length);
  return profile;
}

std::string_view recommend_stage(const Profile& profile) {
  if (profile.bytes > 1'200'000 || profile.tokens > 350'000 || profile.max_line_length > 1'200'000) {
    return "L2";
  }
  if (profile.bytes > 640'000 || profile.tokens > 190'000 || profile.max_depth > 1'000) {
    return "L3";
  }
  if (profile.bytes > 320'000 || profile.tokens > 100'000 || profile.max_depth > 350) {
    return "L4";
  }
  return "L5";
}

void write_json(const Profile& profile) {
  std::cout << "{\"protocolVersion\":\"1\","
            << "\"engine\":\"valax-native-cpp\","
            << "\"bytes\":" << profile.bytes << ','
            << "\"tokens\":" << profile.tokens << ','
            << "\"lines\":" << profile.lines << ','
            << "\"maxDepth\":" << profile.max_depth << ','
            << "\"maxLineLength\":" << profile.max_line_length << ','
            << "\"recommendedStage\":\"" << recommend_stage(profile) << "\"}"
            << '\n';
}

int self_test() {
  const auto profile = scan("local value = { 1, 2, 3 }\nprint(value[1])\n");
  if (profile.bytes == 0 || profile.tokens < 10 || profile.lines != 3 || profile.max_depth == 0) {
    std::cerr << "native preflight self-test failed\n";
    return 1;
  }
  std::cout << "valax-native self-test passed\n";
  return 0;
}

}  // namespace

int main(int argc, char** argv) {
  const std::string command = argc > 1 ? argv[1] : "preflight";
  if (command == "--version") {
    std::cout << "valax-native 0.1.0\n";
    return 0;
  }
  if (command == "--self-test") return self_test();
  if (command != "preflight") {
    std::cerr << "usage: valax-native [preflight|--version|--self-test]\n";
    return 2;
  }

  const std::string source{
    std::istreambuf_iterator<char>{std::cin},
    std::istreambuf_iterator<char>{}
  };
  write_json(scan(source));
  return 0;
}
