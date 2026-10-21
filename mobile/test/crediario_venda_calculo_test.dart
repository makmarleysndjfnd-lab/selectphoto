import 'package:flutter_test/flutter_test.dart';

int parseCentsHelper(String text) {
  final clean = text.trim();
  if (clean.isEmpty) return 0;
  if (clean.contains(',')) {
    final withoutThousandDots = clean.replaceAll('.', '');
    final parts = withoutThousandDots.split(',');
    final reais = int.tryParse(parts[0].replaceAll(RegExp(r'\D'), '')) ?? 0;
    int centavos = 0;
    if (parts.length > 1) {
      final centStr = parts[1].replaceAll(RegExp(r'\D'), '');
      if (centStr.length == 1) {
        centavos = (int.tryParse(centStr) ?? 0) * 10;
      } else if (centStr.length >= 2) {
        centavos = int.tryParse(centStr.substring(0, 2)) ?? 0;
      }
    }
    return (reais * 100) + centavos;
  }
  if (clean.contains('.')) {
    final parts = clean.split('.');
    if (parts.length == 2 && parts[1].length <= 2) {
      final reais = int.tryParse(parts[0].replaceAll(RegExp(r'\D'), '')) ?? 0;
      final centStr = parts[1].replaceAll(RegExp(r'\D'), '');
      int centavos = 0;
      if (centStr.length == 1) {
        centavos = (int.tryParse(centStr) ?? 0) * 10;
      } else if (centStr.length >= 2) {
        centavos = int.tryParse(centStr.substring(0, 2)) ?? 0;
      }
      return (reais * 100) + centavos;
    }
  }
  final digits = clean.replaceAll(RegExp(r'\D'), '');
  if (digits.isEmpty) return 0;
  final val = int.tryParse(digits) ?? 0;
  return val * 100;
}

double parseMonetaryHelper(String text) {
  return parseCentsHelper(text) / 100.0;
}

List<Map<String, dynamic>> calculateScheduleHelper(
    int financedCents, int count, String periodicity, DateTime firstDate) {
  if (count <= 0 || financedCents <= 0) return [];
  final baseAmount = financedCents ~/ count;
  final remainder = financedCents % count;

  final List<Map<String, dynamic>> schedule = [];
  for (int i = 0; i < count; i++) {
    DateTime due;
    if (periodicity == 'BIWEEKLY') {
      due = firstDate.add(Duration(days: i * 14));
    } else {
      due = DateTime(firstDate.year, firstDate.month + i, firstDate.day);
    }
    final amountCents = (i == count - 1) ? (baseAmount + remainder) : baseAmount;
    schedule.add({
      'number': i + 1,
      'dueDate': due,
      'amountCents': amountCents,
      'amount': amountCents / 100.0,
    });
  }
  return schedule;
}

bool isValidCpfHelper(String? cpf) {
  if (cpf == null) return false;
  final clean = cpf.replaceAll(RegExp(r'\D'), '');
  if (clean.length != 11) return false;
  if (RegExp(r'^(\d)\1{10}$').hasMatch(clean)) return false;

  int sum1 = 0;
  for (int i = 0; i < 9; i++) {
    sum1 += int.parse(clean[i]) * (10 - i);
  }
  int rest1 = (sum1 * 10) % 11;
  if (rest1 == 10) rest1 = 0;
  if (rest1 != int.parse(clean[9])) return false;

  int sum2 = 0;
  for (int i = 0; i < 10; i++) {
    sum2 += int.parse(clean[i]) * (11 - i);
  }
  int rest2 = (sum2 * 10) % 11;
  if (rest2 == 10) rest2 = 0;
  if (rest2 != int.parse(clean[10])) return false;

  return true;
}

void main() {
  group('1. Validador e Parser Monetário (Correção do Multiplicador x100 do vídeo)', () {
    test('Entrada "150" não multiplica por 100: retorna R\$ 150.00 (15000 centavos)', () {
      final cents = parseCentsHelper('150');
      final reais = parseMonetaryHelper('150');
      expect(cents, equals(15000));
      expect(reais, equals(150.0));
    });

    test('Entrada com vírgula "150,00" retorna R\$ 150.00 (15000 centavos)', () {
      final cents = parseCentsHelper('150,00');
      final reais = parseMonetaryHelper('150,00');
      expect(cents, equals(15000));
      expect(reais, equals(150.0));
    });

    test('Entrada com separador de milhar "1.000,00" retorna R\$ 1.000.00 (100000 centavos)', () {
      final cents = parseCentsHelper('1.000,00');
      final reais = parseMonetaryHelper('1.000,00');
      expect(cents, equals(100000));
      expect(reais, equals(1000.0));
    });

    test('Entrada com centavos "150,75" retorna R\$ 150.75 (15075 centavos)', () {
      final cents = parseCentsHelper('150,75');
      final reais = parseMonetaryHelper('150,75');
      expect(cents, equals(15075));
      expect(reais, equals(150.75));
    });

    test('Entrada com ponto decimal "150.50" retorna R\$ 150.50 (15050 centavos)', () {
      final cents = parseCentsHelper('150.50');
      final reais = parseMonetaryHelper('150.50');
      expect(cents, equals(15050));
      expect(reais, equals(150.5));
    });

    test('Entrada vazia retorna 0', () {
      expect(parseCentsHelper(''), equals(0));
      expect(parseMonetaryHelper(''), equals(0.0));
    });
  });

  group('2. Composição da Venda e Cronograma de Crediário', () {
    test('Venda R\$ 1.000 com 4 entradas de R\$ 100 financia R\$ 600 em 6x de R\$ 100', () {
      final totalVendaCents = parseCentsHelper('1.000,00'); // 100.000 cents
      final downPayments = ['100,00', '100,00', '100,00', '100,00'];
      int totalDownCents = 0;
      for (final dp in downPayments) {
        totalDownCents += parseCentsHelper(dp);
      }

      expect(totalDownCents, equals(40000)); // R$ 400.00
      final financedCents = totalVendaCents - totalDownCents;
      expect(financedCents, equals(60000)); // R$ 600.00

      // Modo "Valor da Parcela" desejando R$ 100 por parcela
      final desiredInstallmentCents = parseCentsHelper('100,00'); // 10.000 cents
      final calculatedInstallmentsCount =
          (financedCents + desiredInstallmentCents - 1) ~/ desiredInstallmentCents;
      expect(calculatedInstallmentsCount, equals(6));

      final schedule = calculateScheduleHelper(
        financedCents,
        calculatedInstallmentsCount,
        'MONTHLY',
        DateTime(2026, 11, 20),
      );

      expect(schedule.length, equals(6));
      for (final inst in schedule) {
        expect(inst['amountCents'], equals(10000));
        expect(inst['amount'], equals(100.0));
      }

      // Soma total das parcelas + entradas deve bater rigorosamente 100.000 centavos
      final sumScheduleCents = schedule.fold<int>(0, (acc, item) => acc + (item['amountCents'] as int));
      expect(sumScheduleCents, equals(60000));
      expect(sumScheduleCents + totalDownCents, equals(totalVendaCents));
    });

    test('Divisão ímpar ajusta centavos residuais na última parcela sem perder centavo', () {
      final financedCents = 10000; // R$ 100.00 em 3 parcelas
      final schedule = calculateScheduleHelper(
        financedCents,
        3,
        'MONTHLY',
        DateTime(2026, 11, 20),
      );

      expect(schedule.length, equals(3));
      expect(schedule[0]['amountCents'], equals(3333));
      expect(schedule[1]['amountCents'], equals(3333));
      expect(schedule[2]['amountCents'], equals(3334)); // centavo residual somado aqui

      final sum = schedule.fold<int>(0, (acc, item) => acc + (item['amountCents'] as int));
      expect(sum, equals(10000));
    });
  });

  group('3. Validação de CPF do Responsável Legal (LGPD & Anti-Fraude)', () {
    test('Aceita CPFs matematicamente válidos', () {
      // CPFs de teste com DV correto
      expect(isValidCpfHelper('52998224725'), isTrue);
      expect(isValidCpfHelper('529.982.247-25'), isTrue);
    });

    test('Rejeita sequências repetidas e DVs incorretos', () {
      expect(isValidCpfHelper('11111111111'), isFalse);
      expect(isValidCpfHelper('00000000000'), isFalse);
      expect(isValidCpfHelper('12345678900'), isFalse);
      expect(isValidCpfHelper('123'), isFalse);
      expect(isValidCpfHelper(null), isFalse);
    });
  });
}
