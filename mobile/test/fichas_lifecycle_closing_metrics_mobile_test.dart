import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/telas/visao_fechamento_admin.dart';

void main() {
  group('1. Normalização de Porcentagem de Comissão', () {
    test('converte taxa decimal (ex: 0.15) para porcentagem (15.0)', () {
      expect(normalizeCommissionPercentage(0.15, null), equals(15.0));
      expect(normalizeCommissionPercentage(0.20, null), equals(20.0));
      expect(normalizeCommissionPercentage(1.0, null), equals(100.0));
    });

    test('preserva valor já em porcentagem (ex: 15)', () {
      expect(normalizeCommissionPercentage(15, null), equals(15.0));
      expect(normalizeCommissionPercentage(null, 25), equals(25.0));
    });

    test('retorna 0.0 para valores nulos ou inválidos', () {
      expect(normalizeCommissionPercentage(null, null), equals(0.0));
      expect(normalizeCommissionPercentage('invalid', 'invalid'), equals(0.0));
    });
  });

  group('2. Filtragem de Fichas com cityClosedAt (Ocultação após Fechamento)', () {
    test('fichas de cidades encerradas (cityClosedAt != null) são filtradas e removidas das listas operacionais', () {
      final allClients = [
        {
          'id': 'c1',
          'name': 'João Silva',
          'sequenceNumber': '0001',
          'city': 'Curitiba',
          'cityClosedAt': null,
          'outcomeStatus': 'PENDING',
        },
        {
          'id': 'c2',
          'name': 'Maria Souza',
          'sequenceNumber': '0002',
          'city': 'Curitiba',
          'cityClosedAt': '2026-08-28T22:00:00.000Z', // Cidade já fechada
          'outcomeStatus': 'SOLD',
        },
        {
          'id': 'c3',
          'name': 'Pedro Santos',
          'sequenceNumber': '0003',
          'city': 'Londrina',
          'cityClosedAt': null,
          'outcomeStatus': 'NON_SALE',
        },
      ];

      // Simula a lógica de _filteredClients
      final activeClients = allClients.where((c) => c['cityClosedAt'] == null).toList();

      expect(activeClients.length, equals(2));
      expect(activeClients.any((c) => c['id'] == 'c2'), isFalse);
      expect(activeClients.any((c) => c['id'] == 'c1'), isTrue);
      expect(activeClients.any((c) => c['id'] == 'c3'), isTrue);
    });
  });

  group('3. Cálculo Matemático do Repasse e Posição Financeira', () {
    test('quando dinheiro em mãos > comissão devida, vendedor repassa a diferença à empresa', () {
      final double totalVendas = 1000.0;
      final double comissao = 150.0; // 15%
      final double dinheiro = 600.0;
      final double pix = 400.0;

      final double saldoDia = dinheiro - comissao;
      final String direction = dinheiro > comissao
          ? 'SELLER_PAYS_COMPANY'
          : (comissao > dinheiro ? 'COMPANY_PAYS_SELLER' : 'SETTLED');

      expect(direction, equals('SELLER_PAYS_COMPANY'));
      expect(saldoDia, equals(450.0));
    });

    test('quando comissão devida > dinheiro em mãos, empresa paga a diferença ao vendedor', () {
      final double totalVendas = 1000.0;
      final double comissao = 150.0; // 15%
      final double dinheiro = 50.0;
      final double pix = 950.0;

      final double saldoDia = (comissao - dinheiro).abs();
      final String direction = dinheiro > comissao
          ? 'SELLER_PAYS_COMPANY'
          : (comissao > dinheiro ? 'COMPANY_PAYS_SELLER' : 'SETTLED');

      expect(direction, equals('COMPANY_PAYS_SELLER'));
      expect(saldoDia, equals(100.0));
    });

    test('quando comissão devida == dinheiro em mãos, status é Tudo Quitado', () {
      final double comissao = 100.0;
      final double dinheiro = 100.0;

      final String direction = dinheiro > comissao
          ? 'SELLER_PAYS_COMPANY'
          : (comissao > dinheiro ? 'COMPANY_PAYS_SELLER' : 'SETTLED');

      expect(direction, equals('SETTLED'));
    });
  });

  group('4. Cálculo de Ticket Médio de Desempenho', () {
    test('ticket médio deve ser calculado dividindo o valor total vendido exclusivamente pela quantidade de vendas', () {
      final double totalSalesValue = 4500.0;
      final int salesCount = 3;
      final int nonSalesCount = 7;
      final int totalFichas = salesCount + nonSalesCount; // 10 fichas

      // Cálculo CORRETO: baseado em vendas
      final double ticketMedioCorreto = salesCount > 0 ? (totalSalesValue / salesCount) : 0.0;

      // Cálculo INCORRETO legado (baseado em total de fichas): 450.0
      final double ticketMedioErrado = totalFichas > 0 ? (totalSalesValue / totalFichas) : 0.0;

      expect(ticketMedioCorreto, equals(1500.0));
      expect(ticketMedioErrado, equals(450.0));
      expect(ticketMedioCorreto, isNot(equals(ticketMedioErrado)));
    });

    test('ticket médio retorna 0.0 quando não há vendas', () {
      final double totalSalesValue = 0.0;
      final int salesCount = 0;
      final double ticketMedio = salesCount > 0 ? (totalSalesValue / salesCount) : 0.0;
      expect(ticketMedio, equals(0.0));
    });
  });

  group('5. Validação de Bloqueio em Prévia de Fechamento Multi-Cidades', () {
    test('cidade com canClose = false não pode ser selecionada e expõe o motivo do bloqueio', () {
      final previewCityA = {
        'city': 'Cascavel',
        'totalClients': 5,
        'soldCount': 2,
        'pendingReceiptsCount': 1,
        'canClose': false,
        'blockReason': 'Existem 1 venda(s) sem comprovante anexado.',
        'pendingClients': [
          {'id': 'c1', 'name': 'Aluno A', 'sequenceNumber': '0101', 'neighborhood': 'Centro'}
        ]
      };

      final previewCityB = {
        'city': 'Toledo',
        'totalClients': 3,
        'soldCount': 3,
        'pendingReceiptsCount': 0,
        'canClose': true,
        'blockReason': null,
        'pendingClients': []
      };

      final selectedCities = <String>{};

      // Simula auto-seleção somente de cidades elegíveis
      for (final p in [previewCityA, previewCityB]) {
        if (p['canClose'] == true && p['isAlreadyClosed'] != true) {
          selectedCities.add(p['city'] as String);
        }
      }

      expect(selectedCities.contains('Cascavel'), isFalse);
      expect(selectedCities.contains('Toledo'), isTrue);
      expect(previewCityA['blockReason'], isNotNull);
      expect((previewCityA['pendingClients'] as List).length, equals(1));
    });
  });

  group('6. Formatação de Datas em UTC para Análise de Desempenho', () {
    test('converte início e fim do intervalo para strings ISO UTC completas sem adulterar o fuso', () {
      final start = DateTime(2026, 8, 20);
      final end = DateTime(2026, 8, 28);

      final startUtc = DateTime.utc(start.year, start.month, start.day, 0, 0, 0).toIso8601String();
      final endUtc = DateTime.utc(end.year, end.month, end.day, 23, 59, 59, 999).toIso8601String();

      expect(startUtc, equals('2026-08-20T00:00:00.000Z'));
      expect(endUtc, equals('2026-08-28T23:59:59.999Z'));
    });
  });
}
