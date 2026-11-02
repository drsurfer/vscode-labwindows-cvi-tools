export type CviWarningLevel = 'None' | 'Common' | 'Extended' | 'All';

export interface CviWarningItem {
  id: number;
  name: string;
  flag: string;
  level: 'Common' | 'Extended' | 'All';
  description: string;
}

export const CVI_WARNING_CATALOG: CviWarningItem[] = [
  {
    "id": 1,
    "name": "Pointer sign",
    "flag": "-Wpointer-sign",
    "level": "Common",
    "description": "Warn if a signed/unsigned pointer mismatch is detected."
  },
  {
    "id": 2,
    "name": "Unreachable code",
    "flag": "-Wunreachable-code",
    "level": "Common",
    "description": "Warn if unreachable code is detected."
  },
  {
    "id": 3,
    "name": "Parentheses",
    "flag": "-Wparentheses",
    "level": "Common",
    "description": "Warn if operators are mixed in a way that suggests that a problem can occur due to operator precendence, which can be resolved by the use of parentheses."
  },
  {
    "id": 4,
    "name": "Unused variable",
    "flag": "-Wunused-variable",
    "level": "Common",
    "description": "Warn if an unreferenced identifier is detected."
  },
  {
    "id": 5,
    "name": "Uninitialized locals",
    "flag": "-Wuninitialized",
    "level": "Common",
    "description": "Warn if an uninitialized local variable is detected."
  },
  {
    "id": 6,
    "name": "Division by zero",
    "flag": "-Wdivision-by-zero",
    "level": "Common",
    "description": "Warn if division by zero is detected."
  },
  {
    "id": 7,
    "name": "Array bounds",
    "flag": "-Warray-bounds",
    "level": "Common",
    "description": "Warn if an array is accessed out of bounds."
  },
  {
    "id": 8,
    "name": "Null dereference",
    "flag": "-Wnull-dereference",
    "level": "Common",
    "description": "Warn if a null pointer is dereferenced."
  },
  {
    "id": 9,
    "name": "Ignored qualifiers",
    "flag": "-Wignored-qualifiers",
    "level": "Common",
    "description": "Warn if the type qualifier of a return type is ignored."
  },
  {
    "id": 10,
    "name": "Return type",
    "flag": "-Wreturn-type",
    "level": "Common",
    "description": "Warn if a non-void function does not have a return type."
  },
  {
    "id": 11,
    "name": "Panel handle",
    "flag": "-Wpanel-handle",
    "level": "Common",
    "description": "Warn if a constant expression is used as a panel handle."
  },
  {
    "id": 12,
    "name": "Tautological compare",
    "flag": "-Wtautological-compare",
    "level": "Extended",
    "description": "Warn if fixed-result comparisons are detected."
  },
  {
    "id": 13,
    "name": "Empty body",
    "flag": "-Wempty-body",
    "level": "Extended",
    "description": "Warn if a for, if, or while statement contains an empty body."
  },
  {
    "id": 14,
    "name": "Missing braces",
    "flag": "-Wmissing-braces",
    "level": "Extended",
    "description": "Warn if an aggregate or union initializer is bracketed incompletely."
  },
  {
    "id": 15,
    "name": "Overlength strings",
    "flag": "-Woverlength-strings",
    "level": "Extended",
    "description": "Warn if a string constant is longer than what the C standard requires compilers to handle."
  },
  {
    "id": 16,
    "name": "Cast align",
    "flag": "-Wcast-align",
    "level": "Extended",
    "description": "Warn if a pointer cast increases alignment."
  },
  {
    "id": 17,
    "name": "Missing noreturn",
    "flag": "-Wmissing-noreturn",
    "level": "Extended",
    "description": "Warn if a function that might be a candidate for the noreturn attribute is detected."
  },
  {
    "id": 18,
    "name": "Invalid noreturn",
    "flag": "-Winvalid-noreturn",
    "level": "Extended",
    "description": "Warn if a function specifies the noreturn attribute but does return."
  },
  {
    "id": 19,
    "name": "Shadow",
    "flag": "-Wshadow",
    "level": "Extended",
    "description": "Warn if a local variable shadows another existing local variable, parameter, or global variable."
  },
  {
    "id": 20,
    "name": "Switch",
    "flag": "-Wswitch",
    "level": "Extended",
    "description": "Warn if an enumerated value does not have a case in the switch statement. If a default case exists, this warning is not displayed."
  },
  {
    "id": 21,
    "name": "Switch enum",
    "flag": "-Wswitch-enum",
    "level": "Extended",
    "description": "Warn if an enumerated value does not have a case in the switch statement. If a default case exists, this warning is still displayed."
  },
  {
    "id": 22,
    "name": "Unused function",
    "flag": "-Wunused-function",
    "level": "Extended",
    "description": "Warn if a static function is declared but is not defined. Also warns if a non-inline static function is unused."
  },
  {
    "id": 23,
    "name": "Unused label",
    "flag": "-Wunused-label",
    "level": "Extended",
    "description": "Warn if a label is unused."
  },
  {
    "id": 24,
    "name": "Unused parameter",
    "flag": "-Wunused-parameter",
    "level": "All",
    "description": "Warn if a function parameter is unused."
  },
  {
    "id": 25,
    "name": "Unused value",
    "flag": "-Wunused-value",
    "level": "Extended",
    "description": "Warn if an expression value is unused."
  },
  {
    "id": 26,
    "name": "Used but marked unused",
    "flag": "-Wused-but-marked-unused",
    "level": "Extended",
    "description": "Warn if a parameter marked as unused is in fact used in the function."
  },
  {
    "id": 27,
    "name": "Precision loss",
    "flag": "-Wconversion",
    "level": "Extended",
    "description": "Warn if implicit conversions might result in the loss of precision."
  },
  {
    "id": 28,
    "name": "Sign compare",
    "flag": "-Wsign-compare",
    "level": "Extended",
    "description": "Warn if a comparison between signed and unsigned values might produce an incorrect result when the signed value is converted to unsigned."
  },
  {
    "id": 29,
    "name": "Char subscripts",
    "flag": "-Wchar-subscripts",
    "level": "Extended",
    "description": "Warn if an array subscript has type char."
  },
  {
    "id": 30,
    "name": "Declaration after statement",
    "flag": "-Wdeclaration-after-statement",
    "level": "Extended",
    "description": "Warn if a declaration is found after a statement in a block, which is not supported in ISO 90. This warning is not displayed when C99 extensions are enabled."
  },
  {
    "id": 31,
    "name": "Typecheck convert",
    "flag": "-Wtypecheck-convert",
    "level": "Extended",
    "description": "Detect type mismatch."
  },
  {
    "id": 32,
    "name": "Float comparisons",
    "flag": "-Wfloat-equal",
    "level": "Extended",
    "description": "Warn if floating-point numbers are compared using == or !=."
  },
  {
    "id": 33,
    "name": "Variable-length array",
    "flag": "-Wvla",
    "level": "All",
    "description": "Warn if a variable-length array is used when C99 extensions are disabled."
  },
  {
    "id": 34,
    "name": "Ignored Attributes",
    "flag": "-Wignored-attributes",
    "level": "All",
    "description": "Warn about invalid or inconsistent attribute usage."
  },
  {
    "id": 35,
    "name": "Unknown attributes",
    "flag": "-Wunknown-attributes",
    "level": "All",
    "description": "Warn about unknown attributes."
  },
  {
    "id": 36,
    "name": "Deprecated declaration",
    "flag": "-Wdeprecated-declarations",
    "level": "All",
    "description": "Warn if an \\_\\_attribute\\_\\_((deprecated)) declaration is used."
  },
  {
    "id": 37,
    "name": "Packed",
    "flag": "-Wpacked",
    "level": "All",
    "description": "Warn if the packed attribute has no effect on struct layout."
  },
  {
    "id": 38,
    "name": "Padded",
    "flag": "-Wpadded",
    "level": "All",
    "description": "Warn if padding is required to align structure members."
  },
  {
    "id": 39,
    "name": "Comment",
    "flag": "-Wcomment",
    "level": "All",
    "description": "Warn if a comment start sequence /\\* appears within a /\\* \\*/ comment, or if a backslash-newline appears within a // comment."
  },
  {
    "id": 40,
    "name": "Format",
    "flag": "-Wformat",
    "level": "All",
    "description": "Warn if the arguments supplied to printf, scanf, and similar functions are not the appropriate type for the format string specified. Also warns if any conversion specified in the format string is not valid."
  },
  {
    "id": 41,
    "name": "Implicit int",
    "flag": "-Wimplicit-int",
    "level": "All",
    "description": "Warn if a declaration does not include a type."
  },
  {
    "id": 42,
    "name": "Implicit function declarations",
    "flag": "-Wimplicit-function-declaration",
    "level": "All",
    "description": "Warn if a function is used before it is declared. This warning is not displayed when C99 extensions are enabled."
  },
  {
    "id": 43,
    "name": "Built-in requires header",
    "flag": "-Wbuiltin-requires-header",
    "level": "All",
    "description": "Warn about a built-in function requiring a header."
  },
  {
    "id": 44,
    "name": "Missing declarations",
    "flag": "-Wmissing-declarations",
    "level": "All",
    "description": "Warn if a declaration is missing or it is invalid."
  },
  {
    "id": 45,
    "name": "Missing field initializers",
    "flag": "-Wmissing-field-initializers",
    "level": "All",
    "description": "Warn if the initializer of a structure is missing fields."
  },
  {
    "id": 46,
    "name": "Trigraphs",
    "flag": "-Wtrigraphs",
    "level": "All",
    "description": "Warn if any trigraphs that might change the meaning of the application are encountered. Warnings are not displayed for trigraphs within comments."
  },
  {
    "id": 47,
    "name": "Multichar",
    "flag": "-Wmultichar",
    "level": "All",
    "description": "Warn if a multicharacter constant is used."
  },
  {
    "id": 48,
    "name": "Long long",
    "flag": "-Wlong-long",
    "level": "All",
    "description": "Warn if the long long type is used. This warning is not displayed when C99 extensions are enabled."
  },
  {
    "id": 49,
    "name": "Unknown pragmas",
    "flag": "-Wunknown-pragmas",
    "level": "All",
    "description": "Warn if a #pragma directive is encountered that is not understood."
  },
  {
    "id": 50,
    "name": "Ignored pragmas",
    "flag": "-Wignored-pragmas",
    "level": "All",
    "description": "Warn if a pragma option is ignored."
  },
  {
    "id": 51,
    "name": "Pragma reset",
    "flag": "-Wpragma-reset",
    "level": "All",
    "description": "Warn if the pragma reset option is ignored. This warning is not displayed when C99 extensions are enabled."
  },
  {
    "id": 52,
    "name": "Pragma on-off switch",
    "flag": "-Wpragma-on-off-switch",
    "level": "All",
    "description": "Warn if the pragma does not specify ON, OFF, or DEFAULT."
  },
  {
    "id": 53,
    "name": "Pragma unused",
    "flag": "-Wpragma-unused",
    "level": "All",
    "description": "Warn if inconsistencies in #pragma unused arguments are detected."
  },
  {
    "id": 54,
    "name": "End of directive",
    "flag": "-Wend-of-directive",
    "level": "All",
    "description": "Warn if the end of the directive is missing in a pragma declaration."
  },
  {
    "id": 55,
    "name": "Pragma not supported",
    "flag": "-Wpragma-not-supported",
    "level": "All",
    "description": "Warn if an unsupported pragma is encountered."
  },
  {
    "id": 56,
    "name": "Unexpected token",
    "flag": "-Wunexpected-token",
    "level": "All",
    "description": "Warn about unexpected tokens."
  },
  {
    "id": 57,
    "name": "Four char constants",
    "flag": "-Wfour-char-constants",
    "level": "All",
    "description": "Warn if a four-character constant is detected."
  },
  {
    "id": 58,
    "name": "Discard qualifiers",
    "flag": "-Wdiscard-qual",
    "level": "All",
    "description": "Warn if a qualification is discarded in a situation such as initialization, assignment, or passing an argument."
  },
  {
    "id": 59,
    "name": "Sign conversion",
    "flag": "-Wsign-conversion",
    "level": "All",
    "description": "Warn if an unsigned value is implicitly converted to a signed value."
  },
  {
    "id": 60,
    "name": "Variadic macros",
    "flag": "-Wvariadic-macros",
    "level": "All",
    "description": "Warn if variadic macros are used when C99 extensions are disabled."
  },
  {
    "id": 61,
    "name": "Macro name",
    "flag": "-Wmacro-name",
    "level": "All",
    "description": "Warn if whitespaces are missing after the macro name."
  },
  {
    "id": 62,
    "name": "Macro poisoning",
    "flag": "-Wmacro-poisoning",
    "level": "All",
    "description": "Warn if the #pragma GCC poison directive is used on an existing macro."
  },
  {
    "id": 63,
    "name": "Macro redefined",
    "flag": "-Wmacro-redefined",
    "level": "All",
    "description": "Warn if a macro is redefined. This warning is not displayed when C99 extensions are enabled."
  },
  {
    "id": 64,
    "name": "Built-in macro redefined",
    "flag": "-Wbuiltin-macro-redefined",
    "level": "All",
    "description": "Warn if built-in macros, such as \\_\\_TIME\\_\\_, are redefined on the command line or by directives."
  },
  {
    "id": 65,
    "name": "Built-in macro undefined",
    "flag": "-Wbuiltin-macro-undefined",
    "level": "All",
    "description": "Warn if built-in macros, such as \\_\\_TIME\\_\\_, are undefined on the command line or by directives."
  },
  {
    "id": 66,
    "name": "Unused macros",
    "flag": "-Wunused-macros",
    "level": "All",
    "description": "Warn if unused macros are detected."
  },
  {
    "id": 67,
    "name": "GNU designator",
    "flag": "-Wgnu-designator",
    "level": "All",
    "description": "Warn if a GNU old-style field designator extension is used."
  },
  {
    "id": 68,
    "name": "Non-null",
    "flag": "-Wnonnull",
    "level": "All",
    "description": "Warn if a NULL pointer is passed for an argument marked by the nonnull function attribute."
  },
  {
    "id": 69,
    "name": "Constant conversion",
    "flag": "-Wconstant-conversion",
    "level": "All",
    "description": "Warn about implicit value-altering conversions of constants."
  },
  {
    "id": 70,
    "name": "Out-of-scope declarations",
    "flag": "-Wout-of-scope-declarations",
    "level": "All",
    "description": "Warn about out-of-scope declarations."
  },
  {
    "id": 71,
    "name": "Static/non-static declarations",
    "flag": "-Wstatic-non-static",
    "level": "All",
    "description": "Warn if a static declaration follows a non-static declaration."
  },
  {
    "id": 72,
    "name": "Constant too large",
    "flag": "-Wconstant-too-large",
    "level": "All",
    "description": "Warn if an integer constant is too large for its type."
  },
  {
    "id": 73,
    "name": "Pound warnings",
    "flag": "-W#warnings",
    "level": "All",
    "description": "Display warnings specified by the #warning directive."
  },
  {
    "id": 74,
    "name": "Undefined identifier",
    "flag": "-Wundef",
    "level": "All",
    "description": "Warn if an identifier, that is not a macro, is encountered in a #if directive. Undefined identifiers evaluate to zero."
  },
  {
    "id": 75,
    "name": "Include next",
    "flag": "-Winclude-next",
    "level": "All",
    "description": "Warn if a #include_next directive is in the primary source file."
  },
  {
    "id": 76,
    "name": "Extra tokens",
    "flag": "-Wextra-tokens",
    "level": "All",
    "description": "Warn if there is an extra token in a directive."
  },
  {
    "id": 77,
    "name": "Line number",
    "flag": "-Wline-number",
    "level": "All",
    "description": "Warn if the #line directive is provided with a non-decimal number."
  },
  {
    "id": 78,
    "name": "Weak attribute",
    "flag": "-Wweak",
    "level": "All",
    "description": "Warn about improper usages of constructs containing the weak attribute"
  },
  {
    "id": 79,
    "name": "Member redeclare",
    "flag": "-Wmember-redeclare",
    "level": "All",
    "description": "Warn if a member of a struct or union is redeclared."
  },
  {
    "id": 80,
    "name": "Expected semicolon",
    "flag": "-Wexpected-semi",
    "level": "All",
    "description": "Warn if a semicolon (;) is missing at the end of a declaration list."
  },
  {
    "id": 81,
    "name": "Too many arguments",
    "flag": "-Wtoo-many-args",
    "level": "All",
    "description": "Warn if a function call with too many arguments is detected."
  },
  {
    "id": 82,
    "name": "Literal range",
    "flag": "-Wliteral-range",
    "level": "All",
    "description": "Warn if a constant is too large for the type."
  },
  {
    "id": 83,
    "name": "Unknown escape sequence",
    "flag": "-Wunknown-escape",
    "level": "All",
    "description": "Warn about unknown escape sequences."
  },
  {
    "id": 84,
    "name": "Shift",
    "flag": "-Wshift",
    "level": "All",
    "description": "Warn about unsafe shift operations."
  },
  {
    "id": 85,
    "name": "Char initialization",
    "flag": "-Wchar-init",
    "level": "Common",
    "description": "Warn if an improper char array initialization is detected."
  },
  {
    "id": 86,
    "name": "Initialization braces",
    "flag": "-Wbraces-init",
    "level": "All",
    "description": "Warn if initializer braces are used improperly."
  },
  {
    "id": 87,
    "name": "Incomplete fields",
    "flag": "-Wincomplete-field",
    "level": "All",
    "description": "Incomplete fields may be used only at the end of a struct."
  },
  {
    "id": 88,
    "name": "Tentative strings",
    "flag": "-Wtentative",
    "level": "All",
    "description": "Warn if improper uses of tentative strings are detected."
  },
  {
    "id": 89,
    "name": "Ordered comparison",
    "flag": "-Wordered-comparison",
    "level": "All",
    "description": "Warn about improper comparisons of memory addresses."
  },
  {
    "id": 90,
    "name": "Pointer compare",
    "flag": "-Wpointer-compare",
    "level": "All",
    "description": "Warn about comparisons involving pointers of different types."
  },
  {
    "id": 91,
    "name": "Return stack address",
    "flag": "-Wreturn-stack-address",
    "level": "All",
    "description": "Warn if return of address/reference of stack memory is detected."
  },
  {
    "id": 92,
    "name": "Excess elements",
    "flag": "-Wexcess-elements",
    "level": "All",
    "description": "Warn if excess elements are in a construct."
  },
  {
    "id": 93,
    "name": "Invalid preprocessing token",
    "flag": "-Winvalid-pp-token",
    "level": "All",
    "description": "Warn about an invalid preprocessing token."
  },
  {
    "id": 94,
    "name": "Illegal storage",
    "flag": "-Willegal-storage",
    "level": "All",
    "description": "Warn about illegal storage class on functions."
  },
  {
    "id": 95,
    "name": "Clang-specific extensions",
    "flag": "-Wclang",
    "level": "All",
    "description": "Warn if extensions specific to the Clang compiler are detected. Examples: casting to union types, forward references to enum types, zero-length arrays, and other similar situations."
  },
  {
    "id": 96,
    "name": "Backslash newline escape",
    "flag": "-Wbackslash-newline-escape",
    "level": "All",
    "description": "Warn if backslash and newline are separated by space."
  },
  {
    "id": 97,
    "name": "Visibility",
    "flag": "-Wvisibility",
    "level": "All",
    "description": "Warn about visibility of redefinitions/declarations in function parameter list."
  },
  {
    "id": 98,
    "name": "Negative to unsigned conversions",
    "flag": "-Wnegative-to-unsigned",
    "level": "All",
    "description": "Warn if a negative value is converted to unsigned."
  },
  {
    "id": 99,
    "name": "Extern variables initialized",
    "flag": "-Wextern-initializer",
    "level": "All",
    "description": "Warn if an extern variable is initialized."
  },
  {
    "id": 100,
    "name": "Constant logical operand",
    "flag": "-Wconstant-logical-operand",
    "level": "All",
    "description": "Warn if a logical operator is used instead of a bitwise operator."
  },
  {
    "id": 101,
    "name": "Initializer overrides",
    "flag": "-Winitializer-overrides",
    "level": "All",
    "description": "Warn if subobject initialization overrides the initialization of other fields or if initializer overrides prior initialization of this subobject."
  },
  {
    "id": 102,
    "name": "Variadic call convention",
    "flag": "-Wvariadic-call-conv",
    "level": "All",
    "description": "Warn if a variadic function is declared with the \\_\\_stdcall calling convention in a 32-bit configuration."
  },
  {
    "id": 103,
    "name": "Single-parameter main",
    "flag": "-Wmain",
    "level": "All",
    "description": "Warn if the main function has only one parameter."
  },
  {
    "id": 104,
    "name": "OpenMP: nested parallel",
    "flag": "-Womp-nested-parallel",
    "level": "Common",
    "description": "Warn if a nested parallel construct is ignored. OpenMP support and C99 extensions must be enabled to receive this warning."
  },
  {
    "id": 105,
    "name": "OpenMP: repeated ordered",
    "flag": "-Womp-repeated-ordered",
    "level": "Common",
    "description": "Warn if multiple ordered regions are detected in a loop iteration. OpenMP support and C99 extensions must be enabled to receive this warning."
  },
  {
    "id": 106,
    "name": "Pointer to int conversions",
    "flag": "-Wpointer-int-conv",
    "level": "Common",
    "description": "Detect incompatible conversions involving pointers and integers."
  },
  {
    "id": 107,
    "name": "Integer precision loss",
    "flag": "-Wint-conversion",
    "level": "Common",
    "description": "Warn about precision loss in conversions involving integer numbers. This warning is especially useful for porting code to 64-bit."
  },
  {
    "id": 108,
    "name": "Pointer conversions",
    "flag": "-Wpointer-conv",
    "level": "Common",
    "description": "Detect incompatible conversions involving pointers."
  },
  {
    "id": 109,
    "name": "Missing return value",
    "flag": "-Wmissing-return-value",
    "level": "Common",
    "description": "Warn when the return statement is missing the value for non-void functions."
  },
  {
    "id": 110,
    "name": "Invalid return",
    "flag": "-Winvalid-return",
    "level": "Common",
    "description": "Warn when return statements return values for void functions. This warning turns into an error when C99 extensions are enabled."
  },
  {
    "id": 111,
    "name": "Duplicate declaration specifier",
    "flag": "-Wduplicate-decl-specifier",
    "level": "Common",
    "description": "Warn if a declaration contains a duplicate type specifier."
  },
  {
    "id": 112,
    "name": "KnR promoted parameter compatibility",
    "flag": "-Wknr-promoted-parameter",
    "level": "Common",
    "description": "Warn if a promoted old-style function parameter is not compatible with the parameter type of the previous function declaration."
  },
  {
    "id": 113,
    "name": "Strict function prototypes",
    "flag": "-Wstrict-prototypes",
    "level": "Extended",
    "description": "Warn for old-style function declarations or definitions."
  },
  {
    "id": 114,
    "name": "Variable named argument",
    "flag": "-Wva-named-param",
    "level": "Extended",
    "description": "Warn if the second parameter of 'va_start' is not the last named argument."
  },
  {
    "id": 115,
    "name": "Invalid token pasting",
    "flag": "-Winvalid-token-paste",
    "level": "Extended",
    "description": "Warn if an invalid preprocessing token was encountered while applying the token pasting operator."
  },
  {
    "id": 116,
    "name": "Sequence point",
    "flag": "-Wsequence-point",
    "level": "Common",
    "description": "Warn about a sequencing ambiguity within an expression."
  },
  {
    "id": 117,
    "name": "C99 extensions",
    "flag": "-Wc99-extensions",
    "level": "Extended",
    "description": "Warn about C99 extensions."
  },
  {
    "id": 118,
    "name": "Assign enum",
    "flag": "-Wassign-enum",
    "level": "Common",
    "description": "Warn if an enum variable is assigned a value that is not covered by the enum."
  },
  {
    "id": 119,
    "name": "Integer overflow",
    "flag": "-Winteger-overflow",
    "level": "Extended",
    "description": "Warn if an overflow occurs in an arithmetic expression."
  },
  {
    "id": 120,
    "name": "Integer to pointer cast",
    "flag": "-Wint-to-pointer-cast",
    "level": "Extended",
    "description": "Warn about casting from a smaller integer type to a pointer type."
  },
  {
    "id": 121,
    "name": "Missing variable declarations",
    "flag": "-Wmissing-variable-declarations",
    "level": "All",
    "description": "Warn if a global variable declaration is not preceded by an extern declaration."
  },
  {
    "id": 122,
    "name": "Sizeof array argument",
    "flag": "-Wsizeof-array-argument",
    "level": "Common",
    "description": "Warn about possible unintended usage of sizeof applied to an array function parameter."
  },
  {
    "id": 123,
    "name": "Array bounds pointer arithmetic",
    "flag": "-Warray-bounds-pointer-arithmetic",
    "level": "Extended",
    "description": "Warn about pointer operation reaching out of array bounds."
  },
  {
    "id": 124,
    "name": "Bad function cast",
    "flag": "-Wbad-function-cast",
    "level": "Extended",
    "description": "Warn about casting a function call to a non-matching type."
  },
  {
    "id": 125,
    "name": "Covered switch default",
    "flag": "-Wcovered-switch-default",
    "level": "Common",
    "description": "Warn if a switch that covers all values of an enum has a default case."
  },
  {
    "id": 126,
    "name": "Duplicate enum",
    "flag": "-Wduplicate-enum",
    "level": "Extended",
    "description": "Warn if an enum has duplicate values."
  },
  {
    "id": 127,
    "name": "Loop analysis",
    "flag": "-Wloop-analysis",
    "level": "Common",
    "description": "Warn if variable(s) used in loop condition are not modified in loop body."
  },
  {
    "id": 128,
    "name": "Sizeof array decay",
    "flag": "-Wsizeof-array-decay",
    "level": "Common",
    "description": "Warn about possible unintended usage of sizeof applied to pointer arithmetic on an array variable."
  },
  {
    "id": 129,
    "name": "strncat size",
    "flag": "-Wstrncat-size",
    "level": "Common",
    "description": "Warn about wrong values passed to size argument of strncat function."
  },
  {
    "id": 130,
    "name": "Invalid source encoding",
    "flag": "-Winvalid-source-encoding",
    "level": "Common",
    "description": "Warn about illegal character encoding in character or string literals."
  },
  {
    "id": 131,
    "name": "Unicode",
    "flag": "-Wunicode",
    "level": "All",
    "description": "Warn about universal character names."
  },
  {
    "id": 132,
    "name": "Disabled macro expansion",
    "flag": "-Wdisabled-macro-expansion",
    "level": "Common",
    "description": "Warn about recursive macros, for which expansion is disabled."
  },
  {
    "id": 133,
    "name": "Dangling else",
    "flag": "-Wdangling-else",
    "level": "Extended",
    "description": "Warn about possible unintended matching of an else."
  },
  {
    "id": 134,
    "name": "GNU folding constant",
    "flag": "-Wgnu-folding-constant",
    "level": "All",
    "description": "Warn about variable length arrays being folded to constant arrays as a GNU extension. This warning is not displayed when C99 extensions are enabled."
  },
  {
    "id": 135,
    "name": "GNU binary literal",
    "flag": "-Wgnu-binary-literal",
    "level": "All",
    "description": "Warn about binary literals being a GNU extension."
  },
  {
    "id": 136,
    "name": "GNU compound literal initializer",
    "flag": "-Wgnu-compound-literal-initializer",
    "level": "All",
    "description": "Warn that initialization of objects with static storage duration by compound literals is a GNU extension."
  },
  {
    "id": 137,
    "name": "GNU imaginary constant",
    "flag": "-Wgnu-imaginary-constant",
    "level": "All",
    "description": "Warn about an imaginary constant being a GNU extension."
  },
  {
    "id": 138,
    "name": "GNU complex integer",
    "flag": "-Wgnu-complex-integer",
    "level": "All",
    "description": "Warn about a complex integer being a GNU extension."
  },
  {
    "id": 139,
    "name": "Enum value too large",
    "flag": "-Wmicrosoft-enum-value",
    "level": "All",
    "description": "Warn if an enum value is not representable in the underlying type."
  }
];

export function getWarningById(id: number): CviWarningItem | undefined {
  return CVI_WARNING_CATALOG.find((w) => w.id === id);
}

export function parseWarningIdList(str: string | undefined): number[] {
  if (!str) return [];
  return str.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => !isNaN(n));
}

export function formatWarningIdList(ids: number[]): string {
  return ids.filter((id) => id !== 0).join(',');
}

export function getDefaultWarningsForLevel(level: CviWarningLevel): Set<number> {
  const result = new Set<number>();
  if (level === 'None') return result;
  for (const w of CVI_WARNING_CATALOG) {
    if (level === 'Common' && w.level === 'Common') {
      result.add(w.id);
    } else if (level === 'Extended' && (w.level === 'Common' || w.level === 'Extended')) {
      result.add(w.id);
    } else if (level === 'All') {
      result.add(w.id);
    }
  }
  return result;
}
