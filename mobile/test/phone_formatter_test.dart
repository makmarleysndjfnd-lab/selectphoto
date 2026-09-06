import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/utils/brazilian_phone_formatter.dart';

void main() {
  group('BrazilianPhoneFormatter - Testes Unitários de Formatação e Edição', () {
    final formatter = BrazilianPhoneFormatter();

    test('1. Digitação sequencial simples de 11 dígitos', () {
      TextEditingValue current = const TextEditingValue(text: '');

      final input = '61988887777';
      final expectedOutputs = [
        '(6',
        '(61',
        '(61) 9',
        '(61) 98',
        '(61) 988',
        '(61) 9888',
        '(61) 9888-8',
        '(61) 9888-87',
        '(61) 9888-877',
        '(61) 9888-8777',
        '(61) 98888-7777', // Rollover para 11 dígitos
      ];

      for (int i = 0; i < input.length; i++) {
        final char = input[i];
        final next = TextEditingValue(
          text: current.text + char,
          selection: TextSelection.collapsed(offset: current.text.length + 1),
        );
        current = formatter.formatEditUpdate(current, next);
        expect(current.text, equals(expectedOutputs[i]), reason: 'Falha no caractere $i ($char)');
      }
    });

    test('2. Colagem com código de país +55 preserva todos os 11 dígitos', () {
      final oldVal = const TextEditingValue(text: '');
      final pastedVal = const TextEditingValue(
        text: '+55 (61) 99999-8888',
        selection: TextSelection.collapsed(offset: 20),
      );

      final result = formatter.formatEditUpdate(oldVal, pastedVal);
      expect(result.text, equals('(61) 99999-8888'));
      expect(result.selection.baseOffset, equals(result.text.length));
    });

    test('3. Colagem com 55 colado sem formatação (13 dígitos) não corta últimos dígitos', () {
      final oldVal = const TextEditingValue(text: '');
      final pastedVal = const TextEditingValue(
        text: '5561998887766',
        selection: TextSelection.collapsed(offset: 13),
      );

      final result = formatter.formatEditUpdate(oldVal, pastedVal);
      // Deve descartar '55' inicial e formatar '61998887766'
      expect(result.text, equals('(61) 99888-7766'));
      expect(result.selection.baseOffset, equals(result.text.length));
    });

    test('4. Colagem com zero inicial de operadora (061998887766) normaliza DDD', () {
      final oldVal = const TextEditingValue(text: '');
      final pastedVal = const TextEditingValue(
        text: '061998887766',
        selection: TextSelection.collapsed(offset: 12),
      );

      final result = formatter.formatEditUpdate(oldVal, pastedVal);
      expect(result.text, equals('(61) 99888-7766'));
    });

    test('5. Telefone fixo (10 dígitos) mantém formatação (XX) XXXX-XXXX', () {
      final oldVal = const TextEditingValue(text: '');
      final pastedVal = const TextEditingValue(
        text: '6133334444',
        selection: TextSelection.collapsed(offset: 10),
      );

      final result = formatter.formatEditUpdate(oldVal, pastedVal);
      expect(result.text, equals('(61) 3333-4444'));
    });

    test('6. Preservação do cursor ao editar no meio do DDD', () {
      // Estado anterior: (61) 99888-7766
      // Cursor após o '6' do DDD: offset 2
      final oldVal = const TextEditingValue(
        text: '(61) 99888-7766',
        selection: TextSelection.collapsed(offset: 2),
      );

      // Usuário apagou o '6' (ficando apenas '1' no DDD)
      final afterBackspaceVal = const TextEditingValue(
        text: '(1) 99888-7766',
        selection: TextSelection.collapsed(offset: 1),
      );

      final result = formatter.formatEditUpdate(oldVal, afterBackspaceVal);
      // Os dígitos agora são 1998887766 (10 dígitos) -> (19) 9888-7766
      expect(result.text, equals('(19) 9888-7766'));
      // O cursor deve estar logo após o início, não jogado para o final!
      expect(result.selection.baseOffset, lessThan(result.text.length));
    });

    test('7. Backspace sobre parênteses ou espaço apaga o dígito anterior', () {
      // Texto: (61) 
      // Cursor na posição 5 (após o espaço)
      final oldVal = const TextEditingValue(
        text: '(61) ',
        selection: TextSelection.collapsed(offset: 5),
      );

      // Usuário aperta backspace, apagando o espaço: texto vira '(61)'
      final backspaceVal = const TextEditingValue(
        text: '(61)',
        selection: TextSelection.collapsed(offset: 4),
      );

      final result = formatter.formatEditUpdate(oldVal, backspaceVal);
      // Deve apagar o '1' e reformatar para '(6'
      expect(result.text, equals('(6'));
      expect(result.selection.baseOffset, equals(2));
    });

    test('8. Backspace sobre o hífen apaga o dígito anterior ao hífen', () {
      // Texto: (61) 99888-7766
      // Cursor na posição 11 (após o hífen '-')
      final oldVal = const TextEditingValue(
        text: '(61) 99888-7766',
        selection: TextSelection.collapsed(offset: 11),
      );

      // Usuário apaga o '-', ficando com (61) 998887766
      final backspaceVal = const TextEditingValue(
        text: '(61) 998887766',
        selection: TextSelection.collapsed(offset: 10),
      );

      final result = formatter.formatEditUpdate(oldVal, backspaceVal);
      // O dígito '8' anterior ao hífen deve ser removido, ficando com 10 dígitos: (61) 9988-7766
      expect(result.text, equals('(61) 9988-7766'));
      expect(result.text.contains('9988-7766'), isTrue);
    });

    test('9. Método estático BrazilianPhoneFormatter.format()', () {
      expect(BrazilianPhoneFormatter.format('+5561999991111'), equals('(61) 99999-1111'));
      expect(BrazilianPhoneFormatter.format('556133334444'), equals('(61) 3333-4444'));
      expect(BrazilianPhoneFormatter.format('061999992222'), equals('(61) 99999-2222'));
      expect(BrazilianPhoneFormatter.format(''), equals(''));
      expect(BrazilianPhoneFormatter.format(null), equals(''));
    });
  });
}
