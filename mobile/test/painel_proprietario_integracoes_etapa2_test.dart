import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/servicos/servico_api.dart';
import 'package:mobile/telas/painel_proprietario_integracoes.dart';

class FakeEtapa2ApiService extends ApiService {
  FakeEtapa2ApiService() : super.testInstance();

  bool homologationSafe = false;
  Map<String, dynamic>? lastCreatedPayload;
  String? lastStepUpHeader;
  Map<String, dynamic>? nextHarnessReport;
  int homologationCalls = 0;

  final List<Map<String, dynamic>> storedIntegrations = [];

  @override
  Future<List<Map<String, dynamic>>> getOwnerCompanies({String? status, String? search}) async {
    return [
      {
        'id': 'comp_test_1',
        'name': 'ETAPA2_TEST_ESTUDIO_MOBILE',
        'status': 'ACTIVE',
      },
    ];
  }

  @override
  Future<List<Map<String, dynamic>>> getIntegrationCatalogs() async {
    return [
      {
        'category': 'PAYMENT_GATEWAY',
        'label': 'Portal Bancário (Cobrança e Pix)',
        'description': 'Emissão de boletos e Pix com isolamento por empresa.',
        'supportedProviders': ['ASAAS'],
        'scopes': ['COMPANY_EXCLUSIVE', 'COMPANY_SUBACCOUNT'],
        'defaultScope': 'COMPANY_EXCLUSIVE',
        'defaultCostPayer': 'COMPANY',
      },
    ];
  }

  @override
  Future<List<Map<String, dynamic>>> getCompanyIntegrations(String companyId) async {
    return List<Map<String, dynamic>>.from(storedIntegrations);
  }

  @override
  Future<Map<String, dynamic>> getAsaasLiveReadinessReport({String? companyId}) async {
    return {
      'productionSafetyLocked': true,
      'summary': 'Modo LIVE permanece rigorosamente DISABLED.',
      'homologationTargetSafety': {
        'safe': homologationSafe,
        'reason': homologationSafe
            ? 'Ambiente local descartável autorizado.'
            : 'Servidor operacional protegido contra mutações de teste.',
      },
      'companySandboxSummary': {
        'status': storedIntegrations.isNotEmpty ? storedIntegrations.first['status'] : 'NOT_CONFIGURED',
        'hasApiKey': storedIntegrations.isNotEmpty,
        'hasWebhookToken': storedIntegrations.isNotEmpty,
        'webhookMasked': storedIntegrations.isNotEmpty ? 'whse••••••••5678' : null,
      },
    };
  }

  @override
  Future<Map<String, dynamic>> ownerStepUpAuth(String password, {String? reason}) async {
    return {
      'token': 'step_up_mobile_token_test_123',
      'expiresAt': DateTime.now().add(const Duration(minutes: 15)).toIso8601String(),
    };
  }

  @override
  Future<Map<String, dynamic>> createCompanyIntegration(
    Map<String, dynamic> data, {
    String? stepUpToken,
    String? passwordConfirmation,
  }) async {
    lastCreatedPayload = Map<String, dynamic>.from(data);
    lastStepUpHeader = stepUpToken;

    final created = <String, dynamic>{
      'id': 'int_created_1',
      'companyId': data['companyId'],
      'category': data['category'],
      'provider': data['provider'],
      'scope': data['scope'],
      'environment': data['environment'],
      'status': 'DISABLED', // Estado inicial não financeiro
      'costPayer': data['costPayer'],
      'accountName': data['accountName'],
      'credentialSource': data['credentialSource'],
      'secretMasked': r'$aac••••••••9999',
      'hasWebhookToken': data['plainWebhookToken'] != null,
      'webhookMasked': 'whse••••••••5678',
      'monthlyBudgetLimitCents': data['monthlyBudgetLimitCents'],
      'configMetadata': {
        'walletId': data['walletId'],
        'financialLiveAuthorized': false,
      },
      'version': 1,
    };
    storedIntegrations.add(created);
    return {'integration': created};
  }

  @override
  Future<Map<String, dynamic>> runAsaasSandboxHomologation({
    required String companyId,
    String? sandboxApiKey,
    String? webhookToken,
    bool? forceSimulation,
    String? stepUpToken,
  }) async {
    homologationCalls++;
    return nextHarnessReport ??
        {
          'environment': 'SANDBOX',
          'overallStatus': 'PENDING_PROVIDER_WEBHOOK',
          'readinessForLive': {'sandboxHomologated': false},
          'steps': [
            {
              'step': 4,
              'name': 'Aguardando Webhook Oficial do Asaas Sandbox',
              'status': 'PENDING',
              'details': 'Cobrança criada; aguardando entrega HTTP real.',
            },
          ],
        };
  }
}

void main() {
  group('Etapa 2 Mobile — Primeiro Cadastro, Limite Zero, Guarda Operacional e Estados Pendentes', () {
    testWidgets(
      '1. Primeiro cadastro completo envia credencial + webhook + walletId + limite zero (0) com Step-Up e oculta segredos',
      (tester) async {
        tester.view.physicalSize = const Size(1200, 2400);
        tester.view.devicePixelRatio = 1.0;
        addTearDown(tester.view.resetPhysicalSize);

        final fakeApi = FakeEtapa2ApiService();

        await tester.pumpWidget(
          MaterialApp(
            home: PainelProprietarioIntegracoes(apiService: fakeApi),
          ),
        );
        await tester.pumpAndSettle();

        expect(find.text('Configurar Primeira Integração'), findsOneWidget);

        await tester.tap(find.text('Configurar Primeira Integração'));
        await tester.pumpAndSettle();

        // Modal de Step-Up Auth
        expect(find.text('Autenticação Reforçada'), findsOneWidget);
        await tester.enterText(find.byType(TextFormField).first, 'SenhaProprietarioTeste!');
        await tester.tap(find.text('Confirmar'));
        await tester.pumpAndSettle();

        // Modal de Primeiro Cadastro Completo
        expect(find.textContaining('Cadastrar: Portal Bancário'), findsOneWidget);

        final fields = find.byType(TextFormField);
        // Ordem dos TextFormFields para PAYMENT_GATEWAY exclusivo:
        // 0: Identificação da Conta / Titular
        // 1: Chave de API / Segredo Principal (obscureText)
        // 2: Segredo do Webhook (obscureText)
        // 3: WalletId
        // 4: Limite Mensal de Orçamento
        expect(fields, findsNWidgets(5));

        final apiKeyEditable = tester.widget<EditableText>(
          find.descendant(of: fields.at(1), matching: find.byType(EditableText)),
        );
        final webhookEditable = tester.widget<EditableText>(
          find.descendant(of: fields.at(2), matching: find.byType(EditableText)),
        );
        expect(apiKeyEditable.obscureText, isTrue);
        expect(apiKeyEditable.enableSuggestions, isFalse);
        expect(apiKeyEditable.autocorrect, isFalse);
        expect(webhookEditable.obscureText, isTrue);
        expect(webhookEditable.enableSuggestions, isFalse);
        expect(webhookEditable.autocorrect, isFalse);

        await tester.enterText(fields.at(0), 'Conta Teste Asaas Sandbox');
        await tester.enterText(fields.at(1), r'$aact_test_secret_never_shown_9999');
        await tester.enterText(fields.at(2), 'whsec_test_webhook_secret_5678');
        await tester.enterText(fields.at(3), 'wal_sandbox_test_01');
        await tester.enterText(fields.at(4), '0');

        await tester.tap(find.text('Cadastrar no Vault'));
        await tester.pumpAndSettle();

        expect(fakeApi.lastStepUpHeader, equals('step_up_mobile_token_test_123'));
        expect(fakeApi.lastCreatedPayload, isNotNull);
        expect(fakeApi.lastCreatedPayload!['category'], equals('PAYMENT_GATEWAY'));
        expect(fakeApi.lastCreatedPayload!['provider'], equals('ASAAS'));
        expect(fakeApi.lastCreatedPayload!['environment'], equals('SANDBOX'));
        expect(fakeApi.lastCreatedPayload!['scope'], equals('COMPANY_EXCLUSIVE'));
        expect(fakeApi.lastCreatedPayload!['costPayer'], equals('COMPANY'));
        expect(fakeApi.lastCreatedPayload!['accountName'], equals('Conta Teste Asaas Sandbox'));
        expect(fakeApi.lastCreatedPayload!['plainSecret'], equals(r'$aact_test_secret_never_shown_9999'));
        expect(fakeApi.lastCreatedPayload!['plainWebhookToken'], equals('whsec_test_webhook_secret_5678'));
        expect(fakeApi.lastCreatedPayload!['walletId'], equals('wal_sandbox_test_01'));
        expect(fakeApi.lastCreatedPayload!['monthlyBudgetLimitCents'], equals(0));

        // Estado inicial não financeiro (DESATIVADO), limite zero preservado na UI e segredos mascarados
        expect(find.text('DESATIVADO'), findsOneWidget);
        expect(find.text(r'R$ 0,00 (Consumo Bloqueado)'), findsOneWidget);
        expect(find.text(r'$aac••••••••9999'), findsOneWidget);
        expect(find.text('whse••••••••5678'), findsOneWidget);
        expect(find.text(r'$aact_test_secret_never_shown_9999'), findsNothing);
        expect(find.text('whsec_test_webhook_secret_5678'), findsNothing);
        // Permite cadastrar o outro ambiente (PRODUCTION) separadamente
        expect(find.text('Cadastrar Ambiente PRODUCTION'), findsOneWidget);
      },
    );

    testWidgets(
      '2. Servidor operacional oculta mutação de homologação e permite apenas consulta somente leitura',
      (tester) async {
        tester.view.physicalSize = const Size(1200, 2400);
        tester.view.devicePixelRatio = 1.0;
        addTearDown(tester.view.resetPhysicalSize);

        final fakeApi = FakeEtapa2ApiService()..homologationSafe = false;

        await tester.pumpWidget(
          MaterialApp(
            home: PainelProprietarioIntegracoes(apiService: fakeApi),
          ),
        );
        await tester.pumpAndSettle();

        // Navega para a aba de Homologação
        await tester.tap(find.byType(Tab).at(1));
        await tester.pumpAndSettle();

        expect(find.text('Consultar Situação e Prontidão'), findsOneWidget);
        expect(find.text('Executar Roteiro Sandbox (Homologação)'), findsNothing);
        expect(fakeApi.homologationCalls, equals(0));
      },
    );

    testWidgets(
      '3. Ambiente de homologação autorizado exibe PENDING_PROVIDER_WEBHOOK sem aprovação oficial indevida',
      (tester) async {
        tester.view.physicalSize = const Size(1200, 2400);
        tester.view.devicePixelRatio = 1.0;
        addTearDown(tester.view.resetPhysicalSize);

        final fakeApi = FakeEtapa2ApiService()..homologationSafe = true;

        await tester.pumpWidget(
          MaterialApp(
            home: PainelProprietarioIntegracoes(apiService: fakeApi),
          ),
        );
        await tester.pumpAndSettle();

        await tester.tap(find.byType(Tab).at(1));
        await tester.pumpAndSettle();

        expect(find.text('Executar Roteiro Sandbox (Homologação)'), findsOneWidget);
        await tester.tap(find.text('Executar Roteiro Sandbox (Homologação)'));
        await tester.pumpAndSettle();

        // Step-Up
        await tester.enterText(find.byType(TextFormField).first, 'SenhaProprietarioTeste!');
        await tester.tap(find.text('Confirmar'));
        await tester.pumpAndSettle();

        expect(fakeApi.homologationCalls, equals(1));
        expect(find.textContaining('PENDING_PROVIDER_WEBHOOK'), findsOneWidget);
        expect(find.textContaining('Aguardando Webhook do Provedor'), findsOneWidget);
      },
    );
  });
}

