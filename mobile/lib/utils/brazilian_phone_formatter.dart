import 'package:flutter/services.dart';

/// Formatador de telefone brasileiro com suporte a 10 dígitos (fixo) e 11 dígitos (celular).
/// - Preserva a posição do cursor ao editar no meio do texto ou no DDD.
/// - Trata backspace sobre separadores apagando o dígito correspondente.
/// - Normaliza colagem e preenchimento com código de país (+55 / 55) ou zero inicial (0XX).
/// - Não trunca dígitos finais silenciosamente ao colar +55.
class BrazilianPhoneFormatter extends TextInputFormatter {
  @override
  TextEditingValue formatEditUpdate(
      TextEditingValue oldValue, TextEditingValue newValue) {
    if (newValue.text.isEmpty) {
      return newValue.copyWith(text: '');
    }

    final bool isDeleting = newValue.text.length < oldValue.text.length;

    // Contagem de dígitos antes do cursor no novo valor
    final int safeCursorOffset = newValue.selection.baseOffset.clamp(0, newValue.text.length);
    final String textBeforeCursor = newValue.text.substring(0, safeCursorOffset);
    int digitsBeforeCursor = _countDigits(textBeforeCursor);

    // Extrair apenas dígitos
    String rawDigits = newValue.text.replaceAll(RegExp(r'\D'), '');

    // Se estava apagando e nenhum dígito foi removido (apagou apenas um separador)
    if (isDeleting) {
      final String oldDigits = oldValue.text.replaceAll(RegExp(r'\D'), '');
      if (rawDigits.length == oldDigits.length && digitsBeforeCursor > 0) {
        // Remove o dígito imediatamente anterior ao cursor
        rawDigits = rawDigits.substring(0, digitsBeforeCursor - 1) +
            rawDigits.substring(digitsBeforeCursor);
        digitsBeforeCursor--;
      }
    }

    // Normalização de código de país (+55 / 55) em colagem/autofill
    // Se começar com 55 e tiver 12 ou 13 dígitos no total (55 + DDD + 8 ou 9 dígitos)
    if (rawDigits.startsWith('55') && rawDigits.length >= 12) {
      rawDigits = rawDigits.substring(2);
      digitsBeforeCursor = (digitsBeforeCursor - 2).clamp(0, rawDigits.length);
    }

    // Normalização de zero inicial de operadora (ex: 061999998888 -> 61999998888)
    if (rawDigits.startsWith('0') && rawDigits.length >= 11) {
      rawDigits = rawDigits.substring(1);
      digitsBeforeCursor = (digitsBeforeCursor - 1).clamp(0, rawDigits.length);
    }

    // Limite máximo de 11 dígitos nacionais (DDD + 9 dígitos)
    if (rawDigits.length > 11) {
      rawDigits = rawDigits.substring(0, 11);
      digitsBeforeCursor = digitsBeforeCursor.clamp(0, 11);
    }

    if (rawDigits.isEmpty) {
      return newValue.copyWith(text: '', selection: const TextSelection.collapsed(offset: 0));
    }

    final formattedText = _formatDigits(rawDigits);
    final int newCursorOffset = _calculateCursorPosition(formattedText, digitsBeforeCursor);

    return TextEditingValue(
      text: formattedText,
      selection: TextSelection.collapsed(offset: newCursorOffset),
    );
  }

  static int _countDigits(String text) {
    int count = 0;
    for (int i = 0; i < text.length; i++) {
      final code = text.codeUnitAt(i);
      if (code >= 48 && code <= 57) count++;
    }
    return count;
  }

  static String _formatDigits(String digits) {
    final buffer = StringBuffer();
    final len = digits.length;

    if (len == 0) return '';

    buffer.write('(');
    if (len <= 2) {
      buffer.write(digits);
    } else {
      buffer.write(digits.substring(0, 2));
      buffer.write(') ');

      if (len <= 6) {
        buffer.write(digits.substring(2));
      } else if (len <= 10) {
        // Telefone fixo ou móvel incompleto: (XX) XXXX-XXXX
        buffer.write(digits.substring(2, 6));
        buffer.write('-');
        buffer.write(digits.substring(6));
      } else {
        // Celular 9 dígitos: (XX) XXXXX-XXXX
        buffer.write(digits.substring(2, 7));
        buffer.write('-');
        buffer.write(digits.substring(7, len));
      }
    }

    return buffer.toString();
  }

  static int _calculateCursorPosition(String formatted, int digitsBeforeCursor) {
    if (digitsBeforeCursor <= 0) return 0;

    int digitsSeen = 0;
    for (int i = 0; i < formatted.length; i++) {
      final code = formatted.codeUnitAt(i);
      if (code >= 48 && code <= 57) {
        digitsSeen++;
        if (digitsSeen == digitsBeforeCursor) {
          return i + 1;
        }
      }
    }
    return formatted.length;
  }

  /// Método utilitário para normalizar números salvos ou pré-existentes
  static String format(String? raw) {
    if (raw == null || raw.trim().isEmpty) return '';
    String digits = raw.replaceAll(RegExp(r'\D'), '');
    if (digits.startsWith('55') && digits.length >= 12) {
      digits = digits.substring(2);
    }
    if (digits.startsWith('0') && digits.length >= 11) {
      digits = digits.substring(1);
    }
    if (digits.length > 11) {
      digits = digits.substring(0, 11);
    }
    return _formatDigits(digits);
  }
}
