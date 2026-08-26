import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/telas/visao_fechamento_admin.dart';

void main() {
  group('Regras de fechamento e comissão', () {
    test('taxa decimal 0.20 aparece como 20%, nunca 2000%', () {
      expect(normalizeCommissionPercentage(0.20, null), 20);
    });

    test('taxa decimal 0.25 aparece como 25%', () {
      expect(normalizeCommissionPercentage(0.25, null), 25);
    });

    test('compatibilidade: taxa antiga já percentual 20 permanece 20%', () {
      expect(normalizeCommissionPercentage(20, null), 20);
    });
  });
}
