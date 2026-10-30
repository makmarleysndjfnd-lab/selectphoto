import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:mobile/telas/painel_proprietario_faturamento.dart';
import 'package:mobile/telas/tela_demonstrativo_empresa_lumora.dart';

void main() {
  setUpAll(() async {
    await initializeDateFormatting('pt_BR', null);
  });

  group('Etapa 3 Mobile — Faturamento Variável, Custos, Auditoria Mascarada e Autoatendimento B2B', () {
    testWidgets(
      '1. Painel do Proprietário renderiza Demonstrativos (NOT_CONFIGURED vs Fechados), Custos & Margem, Auditoria Mascarada e Revisões sem acusação',
      (tester) async {
        tester.view.physicalSize = const Size(1280, 2400);
        tester.view.devicePixelRatio = 1.0;
        addTearDown(tester.view.resetPhysicalSize);

        await tester.pumpWidget(
          MaterialApp(
            home: PainelProprietarioFaturamentoAuditoriaCustos(
              initialCompetence: '2026-10',
              loadStatementsOverride: (comp) async => {
                'competence': comp,
                'totals': {
                  'eligibleSalesBaseCents': 20000000,
                  'grossPlatformFeeCents': 550000,
                  'adjustmentsCents': -2500,
                  'netDueCents': 547500,
                  'paidAmountCents': 250000,
                  'remainingBalanceCents': 297500,
                },
                'statements': [
                  {
                    'id': 'st_comp_a',
                    'company': {'id': 'comp_a', 'name': 'Estúdio Alpha (2,5%)'},
                    'status': 'PAID',
                    'eligibleSalesCount': 10,
                    'eligibleSalesBaseCents': 10000000,
                    'grossPlatformFeeCents': 250000,
                    'adjustmentsCents': 0,
                    'netDueCents': 250000,
                    'paidAmountCents': 250000,
                    'remainingBalanceCents': 0,
                  },
                  {
                    'id': 'st_comp_b',
                    'company': {'id': 'comp_b', 'name': 'Estúdio Beta (3,0%)'},
                    'status': 'CLOSED',
                    'eligibleSalesCount': 8,
                    'eligibleSalesBaseCents': 10000000,
                    'grossPlatformFeeCents': 300000,
                    'adjustmentsCents': -2500,
                    'netDueCents': 297500,
                    'paidAmountCents': 0,
                    'remainingBalanceCents': 297500,
                  },
                ],
                'unclosedCompaniesPreview': [
                  {
                    'companyId': 'comp_sem_taxa',
                    'company': {'id': 'comp_sem_taxa', 'name': 'Estúdio Sem Contrato'},
                    'contractStatus': 'NOT_CONFIGURED',
                    'canClose': false,
                    'eligibleSalesCount': 3,
                    'netDueCents': 0,
                  },
                ],
              },
              loadCostsOverride: (comp) async => {
                'competence': comp,
                'revenues': {
                  'totalContractedRevenueCents': 547500,
                  'statementReceivedRevenueCents': 250000,
                },
                'platformCosts': {
                  'measuredBrlCents': 15000,
                  'manualVerifiedBrlCents': 42000,
                  'estimatedBrlCents': 8000,
                },
                'margins': {
                  'realMarginCents': 193000,
                  'estimatedMarginCents': 482500,
                },
                'separationGuarantee': {
                  'supersededTelemetryRecordsCount': 4,
                  'clientCompanyOperationalCostsExcluded': true,
                },
                'entries': [
                  {
                    'id': 'cost_1',
                    'provider': 'RENDER',
                    'category': 'INFRASTRUCTURE',
                    'measurementType': 'MANUAL',
                    'amountBrlCents': 42000,
                    'sourceDocument': 'INV-RENDER-2026-10',
                    'costPayer': 'PLATFORM',
                    'allocationRule': 'PROPORTIONAL_ELIGIBLE_SALES',
                  },
                ],
              },
              loadAuditOverride: (_) async => {
                'events': [
                  {
                    'id': 'aud_1',
                    'category': 'BUYER_PHONE',
                    'action': 'BUYER_PHONE_UPDATED',
                    'entityReference': 'FICHA-1042',
                    'company': {'name': 'Estúdio Alpha (2,5%)'},
                    'authorName': 'Gerente Alpha',
                    'reason': 'Atualização cadastral solicitada pelo responsável',
                    'previousValues': {'phone': '(11) *****-1111 [ref:aa11bb22]'},
                    'newValues': {
                      'phone': '(11) *****-9876 [ref:cc33dd44]',
                      'cpf': '***.***.***-09',
                    },
                  },
                ],
              },
              loadAlertsOverride: () async => {
                'alerts': [
                  {
                    'id': 'al_1',
                    'alertType': 'ELEVATED_DISCOUNT_REVIEW',
                    'status': 'PENDING_REVIEW',
                    'summary': 'Desconto acima da referência comercial encaminhado para conferência.',
                    'entityReference': 'FICHA-1088',
                    'company': {'name': 'Estúdio Beta (3,0%)'},
                  },
                ],
              },
            ),
          ),
        );

        await tester.pumpAndSettle();

        // Aba 1: Demonstrativos
        expect(find.textContaining('Liquidação B2B Externa'), findsOneWidget);
        expect(find.text('Estúdio Alpha (2,5%)'), findsOneWidget);
        expect(find.text('Estúdio Beta (3,0%)'), findsOneWidget);
        expect(find.text('Estúdio Sem Contrato'), findsOneWidget);
        expect(
          find.textContaining('Não configurado (NOT_CONFIGURED) — sem cobrança automática'),
          findsOneWidget,
        );

        // Aba 2: Custos & Margem
        await tester.tap(find.text('Custos & Margem'));
        await tester.pumpAndSettle();
        expect(
          find.text('Receita Contratada vs Recebida & Margem Lumora'),
          findsOneWidget,
        );
        expect(find.textContaining('RENDER • INFRASTRUCTURE (MANUAL)'), findsOneWidget);
        expect(find.textContaining('INV-RENDER-2026-10'), findsOneWidget);
        expect(find.textContaining('4 telemetria(s) substituída(s)'), findsOneWidget);

        // Aba 3: Auditoria Mascarada
        await tester.tap(find.text('Auditoria'));
        await tester.pumpAndSettle();
        expect(find.textContaining('PII mascarada por padrão'), findsOneWidget);
        expect(find.textContaining('(11) *****-9876 [ref:cc33dd44]'), findsOneWidget);
        expect(find.textContaining('***.***.***-09'), findsOneWidget);
        expect(find.textContaining('11999999876'), findsNothing);

        // Aba 4: Revisões Administrativas (sem acusação automática de fraude)
        await tester.tap(find.text('Revisões'));
        await tester.pumpAndSettle();
        expect(
          find.textContaining('sem acusação automática de fraude e sem bloquear vendas'),
          findsOneWidget,
        );
        expect(find.textContaining('ELEVATED_DISCOUNT_REVIEW'), findsOneWidget);
      },
    );

    testWidgets(
      '2. TelaDemonstrativoEmpresaLumora exibe vigências múltiplas, incidência zero em parcelas, separação 20%/25%/10% e nenhum botão de checkout/PII',
      (tester) async {
        tester.view.physicalSize = const Size(1080, 2400);
        tester.view.devicePixelRatio = 1.0;
        addTearDown(tester.view.resetPhysicalSize);

        await tester.pumpWidget(
          MaterialApp(
            home: TelaDemonstrativoEmpresaLumora(
              initialCompetence: '2026-10',
              loadOverride: (comp) async => {
                'selectedCompetenceDetail': {
                  'isClosed': true,
                  'statement': {
                    'competence': comp,
                    'status': 'PARTIALLY_PAID',
                    'contractStatus': 'CONFIGURED',
                    'isGratuitousZero': false,
                    'eligibleSalesCount': 2,
                    'eligibleSalesBaseCents': 200000,
                    'grossPlatformFeeCents': 5500,
                    'adjustmentsCents': 0,
                    'netDueCents': 5500,
                    'paidAmountCents': 2000,
                    'remainingBalanceCents': 3500,
                    'vigenciaBreakdown': [
                      {
                        'version': 1,
                        'ratePercentage': '2.000',
                        'salesCount': 1,
                        'baseCents': 100000,
                        'feeCents': 2000,
                      },
                      {
                        'version': 2,
                        'ratePercentage': '3.500',
                        'salesCount': 1,
                        'baseCents': 100000,
                        'feeCents': 3500,
                      },
                    ],
                    'financialSeparation': {
                      'companyConfirmedSalesCents': 200000,
                      'companyCreditReceivedPrincipalCents': 80000,
                      'lumoraFeeOnCreditInstallmentsCents': 0,
                      'sellerInitialCommissions20Or25Cents': 40000,
                      'sellerInstallmentCommissions10Cents': 8000,
                    },
                    'items': [
                      {
                        'saleReference': '00512',
                        'city': 'Goiânia',
                        'saleDate': '2026-10-05T14:00:00.000Z',
                        'paymentModality': 'PIX',
                        'rateVersion': 1,
                        'ratePercentageFormatted': '2.000%',
                        'saleBaseCents': 100000,
                        'calculatedFeeCents': 2000,
                      },
                      {
                        'saleReference': '00589',
                        'city': 'Anápolis',
                        'saleDate': '2026-10-20T16:30:00.000Z',
                        'paymentModality': 'CREDIARIO',
                        'rateVersion': 2,
                        'ratePercentageFormatted': '3.500%',
                        'saleBaseCents': 100000,
                        'calculatedFeeCents': 3500,
                      },
                    ],
                  },
                },
                'closedHistory': [],
              },
            ),
          ),
        );

        await tester.pumpAndSettle();

        expect(
          find.textContaining('liquidação contratual ocorre exclusivamente fora do aplicativo'),
          findsOneWidget,
        );
        expect(find.textContaining('FECHADO (PARTIALLY_PAID)'), findsOneWidget);
        expect(find.textContaining('Versão v1 • 2.000% (1 venda(s))'), findsOneWidget);
        expect(find.textContaining('Versão v2 • 3.500% (1 venda(s))'), findsOneWidget);
        expect(find.text('Incidência Lumora sobre Parcelas Recebidas'), findsOneWidget);
        expect(find.text('Comissões Vendedores (20%/25% Entrada/À Vista)'), findsOneWidget);
        expect(find.text('Comissões Vendedores (10% Principal Parcelas)'), findsOneWidget);
        expect(find.textContaining('00512'), findsOneWidget);
        expect(find.textContaining('00589'), findsOneWidget);

        // Garante ausência de botões de checkout in-app ou dados pessoais
        expect(find.textContaining('Pagar Agora'), findsNothing);
        expect(find.textContaining('Gerar Boleto'), findsNothing);
        expect(find.textContaining('Checkout'), findsNothing);
      },
    );
  });
}
