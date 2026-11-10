import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../servicos/servico_api.dart';

class PainelProprietarioIntegracoes extends StatefulWidget {
  final Map<String, dynamic>? initialCompany;
  final ApiService? apiService;

  const PainelProprietarioIntegracoes({
    super.key,
    this.initialCompany,
    this.apiService,
  });

  @override
  State<PainelProprietarioIntegracoes> createState() =>
      _PainelProprietarioIntegracoesState();
}

class _PainelProprietarioIntegracoesState
    extends State<PainelProprietarioIntegracoes>
    with SingleTickerProviderStateMixin {
  late final ApiService _api = widget.apiService ?? ApiService();
  late TabController _tabController;

  bool _carregando = false;
  String? _stepUpToken;
  DateTime? _stepUpExpiresAt;

  List<Map<String, dynamic>> _empresas = [];
  Map<String, dynamic>? _empresaSelecionada;

  List<Map<String, dynamic>> _integracoes = [];
  List<Map<String, dynamic>> _catalogos = [];
  List<Map<String, dynamic>> _companySharedServices = [];
  Map<String, dynamic>? _platformOverview;
  Map<String, dynamic>? _companyOverview;
  Map<String, dynamic>? _companyUnlinkedUsage;
  String? _period;
  Map<String, dynamic>? _harnessReport;
  Map<String, dynamic>? _liveReadinessReport;

  final DateFormat _dateFormat = DateFormat('dd/MM/yyyy HH:mm');

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    if (widget.initialCompany != null) {
      _empresaSelecionada = widget.initialCompany;
    }
    _inicializarDados();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  bool get _temStepUpAtivo =>
      _stepUpToken != null &&
      _stepUpExpiresAt != null &&
      _stepUpExpiresAt!.isAfter(DateTime.now());

  bool get _ambienteAutorizadoParaHomologacao =>
      _liveReadinessReport?['homologationTargetSafety']?['safe'] == true;

  Future<void> _inicializarDados() async {
    setState(() => _carregando = true);
    try {
      final empresas = await _api.getOwnerCompanies(classification: 'OPERATIONAL');
      final cats = await _api.getIntegrationCatalogs();
      Map<String, dynamic>? platformOverview;
      try {
        platformOverview = await _api.getPlatformIntegrationsOverview();
      } catch (_) {}

      Map<String, dynamic>? selected = _empresaSelecionada;
      if (selected == null && empresas.isNotEmpty) {
        selected = empresas.firstWhere(
          (e) => e['name'] == 'Select Photo Default' || e['classification'] == 'OPERATIONAL',
          orElse: () => empresas.first,
        );
      }
      final readiness = await _api.getAsaasLiveReadinessReport(
        companyId: selected?['id']?.toString(),
      );

      setState(() {
        _empresas = empresas;
        _catalogos = cats;
        _platformOverview = platformOverview;
        _empresaSelecionada = selected;
        _liveReadinessReport = readiness;
      });

      if (selected != null) {
        await _carregarIntegracoesEmpresa(selected['id']);
      }
    } catch (e) {
      _mostrarErro('Erro ao inicializar dados: $e');
    } finally {
      if (mounted) setState(() => _carregando = false);
    }
  }

  Future<void> _carregarIntegracoesEmpresa(String companyId) async {
    try {
      final payload = await _api.getCompanyIntegrationsPayload(companyId);
      final list = (payload['integrations'] as List? ?? []).map((e) => Map<String, dynamic>.from(e)).toList();
      final shared = (payload['sharedServices'] as List? ?? []).map((e) => Map<String, dynamic>.from(e)).toList();
      final overview = payload['overview'] as Map<String, dynamic>?;
      final unlinked = payload['unlinkedUsage'] as Map<String, dynamic>?;
      final period = payload['period']?.toString();
      final readiness = await _api.getAsaasLiveReadinessReport(companyId: companyId);

      if (mounted) {
        setState(() {
          _integracoes = list;
          _companySharedServices = shared;
          _companyOverview = overview;
          _companyUnlinkedUsage = unlinked;
          _period = period;
          _liveReadinessReport = readiness;
        });
      }
    } catch (e) {
      _mostrarErro('Erro ao carregar integrações da empresa: $e');
    }
  }

  Future<void> _consultarSituacaoProntidao() async {
    setState(() => _carregando = true);
    try {
      final readiness = await _api.getAsaasLiveReadinessReport(
        companyId: _empresaSelecionada?['id']?.toString(),
      );
      if (mounted) {
        setState(() {
          _liveReadinessReport = readiness;
        });
      }
      final safety = readiness['homologationTargetSafety'] as Map?;
      if (safety != null && safety['safe'] != true) {
        _mostrarAlerta(
          'Situação Consultada: Servidor operacional protegido contra escritas de teste. Execute mutações de homologação apenas no ambiente isolado de homologação.',
        );
      } else {
        _mostrarSucesso('Situação de prontidão e homologação atualizada.');
      }
    } catch (e) {
      _mostrarErro('Erro ao consultar prontidão: $e');
    } finally {
      if (mounted) setState(() => _carregando = false);
    }
  }

  Future<bool> _garantirStepUpAuth(String acaoDescricao) async {
    if (_temStepUpAtivo) return true;

    final senhaController = TextEditingController();
    final formKey = GlobalKey<FormState>();

    final result = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => _ControllerDisposer(
        controllers: [senhaController],
        child: AlertDialog(
          backgroundColor: const Color(0xFF1E293B),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          title: const Row(
            children: [
              Icon(Icons.security_rounded, color: Color(0xFF38BDF8)),
              SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Autenticação Reforçada',
                  style: TextStyle(color: Colors.white, fontSize: 18),
                ),
              ),
            ],
          ),
          content: SingleChildScrollView(
            child: Form(
              key: formKey,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Esta ação sensível ($acaoDescricao) exige confirmação com sua senha de proprietário para desbloqueio temporário do Vault.',
                    style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 13),
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: senhaController,
                    obscureText: true,
                    enableSuggestions: false,
                    autocorrect: false,
                    style: const TextStyle(color: Colors.white),
                    decoration: InputDecoration(
                      labelText: 'Sua Senha',
                      labelStyle: const TextStyle(color: Color(0xFF94A3B8)),
                      filled: true,
                      fillColor: const Color(0xFF0F172A),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                    validator: (val) =>
                        val == null || val.isEmpty ? 'Informe sua senha' : null,
                  ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancelar', style: TextStyle(color: Color(0xFF94A3B8))),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF0284C7),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
              ),
              onPressed: () async {
                if (formKey.currentState?.validate() ?? false) {
                  try {
                    final pwd = senhaController.text;
                    final resp = await _api.ownerStepUpAuth(pwd);
                    senhaController.clear();
                    _stepUpToken = (resp['stepUpToken'] ?? resp['token']) as String?;
                    _stepUpExpiresAt = DateTime.parse(resp['expiresAt']);
                    if (ctx.mounted) Navigator.pop(ctx, true);
                  } catch (e) {
                    _mostrarErro('Falha na autenticação: $e');
                  }
                }
              },
              child: const Text('Confirmar', style: TextStyle(color: Colors.white)),
            ),
          ],
        ),
      ),
    );

    return result ?? false;
  }

  void _mostrarErro(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), backgroundColor: Colors.redAccent),
    );
  }

  void _mostrarSucesso(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), backgroundColor: const Color(0xFF10B981)),
    );
  }

  void _mostrarAlerta(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), backgroundColor: const Color(0xFFF59E0B)),
    );
  }

  // ── Ações de Integração ─────────────────────────────────────────────────────

  Future<void> _testarConexao(Map<String, dynamic> integracao) async {
    setState(() => _carregando = true);
    try {
      final res = await _api.testIntegrationConnection(integracao['id']);
      final bool success = res['success'] == true;
      final int latency = res['latencyMs'] ?? 0;
      final String msg = res['message'] ?? (success ? 'Sucesso' : 'Pendência na validação');

      if (mounted) {
        showDialog(
          context: context,
          builder: (ctx) => AlertDialog(
            backgroundColor: const Color(0xFF1E293B),
            title: Row(
              children: [
                Icon(
                  success ? Icons.check_circle_rounded : Icons.warning_amber_rounded,
                  color: success ? const Color(0xFF10B981) : const Color(0xFFF59E0B),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    success ? 'Credencial Validada' : 'Validação Não Concluída',
                    style: const TextStyle(color: Colors.white, fontSize: 17),
                  ),
                ),
              ],
            ),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(msg, style: const TextStyle(color: Colors.white, fontSize: 14)),
                const SizedBox(height: 12),
                Text(
                  'Tempo de Resposta: ${latency}ms',
                  style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12),
                ),
                Text(
                  'Provedor: ${integracao['provider']} (${integracao['environment'] ?? 'PRODUCTION'})',
                  style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12),
                ),
              ],
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: const Text('OK', style: TextStyle(color: Color(0xFF38BDF8))),
              ),
            ],
          ),
        );
      }
      if (_empresaSelecionada != null) {
        await _carregarIntegracoesEmpresa(_empresaSelecionada!['id']);
      }
    } catch (e) {
      _mostrarErro('Erro ao testar conexão: $e');
    } finally {
      if (mounted) setState(() => _carregando = false);
    }
  }

  Future<void> _rotacionarCredencial(Map<String, dynamic> integracao) async {
    final autorizado = await _garantirStepUpAuth('Salvar/Rotacionar Chave Criptografada');
    if (!autorizado) return;

    final chaveController = TextEditingController();
    final motivoController = TextEditingController(text: 'Atualização periódica');
    final formKey = GlobalKey<FormState>();

    if (!mounted) return;

    final confirmou = await showDialog<bool>(
      context: context,
      builder: (ctx) => _ControllerDisposer(
        controllers: [chaveController, motivoController],
        child: AlertDialog(
          backgroundColor: const Color(0xFF1E293B),
          title: const Text(
            'Atualizar Chave Criptografada',
            style: TextStyle(color: Colors.white, fontSize: 18),
          ),
          content: SingleChildScrollView(
            child: Form(
              key: formKey,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'A nova chave é enviada apenas por canal HTTPS seguro e criptografada no Vault (AES-256-GCM). Nunca é recuperada integralmente nem salva no aparelho.',
                    style: TextStyle(color: Color(0xFF94A3B8), fontSize: 12),
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: chaveController,
                    obscureText: true,
                    enableSuggestions: false,
                    autocorrect: false,
                    style: const TextStyle(color: Colors.white),
                    decoration: InputDecoration(
                      labelText: 'Nova Chave / Token Secreto',
                      labelStyle: const TextStyle(color: Color(0xFF94A3B8)),
                      filled: true,
                      fillColor: const Color(0xFF0F172A),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                    validator: (val) => val == null || val.trim().length < 8
                        ? 'Chave inválida ou muito curta'
                        : null,
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: motivoController,
                    style: const TextStyle(color: Colors.white),
                    decoration: InputDecoration(
                      labelText: 'Motivo da Rotação',
                      labelStyle: const TextStyle(color: Color(0xFF94A3B8)),
                      filled: true,
                      fillColor: const Color(0xFF0F172A),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                  ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancelar', style: TextStyle(color: Color(0xFF94A3B8))),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF0284C7)),
              onPressed: () {
                if (formKey.currentState?.validate() ?? false) {
                  Navigator.pop(ctx, true);
                }
              },
              child: const Text('Criptografar e Salvar', style: TextStyle(color: Colors.white)),
            ),
          ],
        ),
      ),
    );

    if (confirmou == true) {
      final novaChave = chaveController.text.trim();
      final motivo = motivoController.text.trim();
      chaveController.clear();
      setState(() => _carregando = true);
      try {
        await _api.rotateIntegrationCredentials(
          integracao['id'],
          novaChave,
          reason: motivo,
          stepUpToken: _stepUpToken,
        );
        _mostrarSucesso('Credencial rotacionada com sucesso no Vault.');
        if (_empresaSelecionada != null) {
          await _carregarIntegracoesEmpresa(_empresaSelecionada!['id']);
        }
      } catch (e) {
        _mostrarErro('Falha ao rotacionar credencial: $e');
      } finally {
        if (mounted) setState(() => _carregando = false);
      }
    }
  }

  Future<void> _alterarStatus(Map<String, dynamic> integracao, String novoStatus) async {
    final autorizado = await _garantirStepUpAuth('Alterar Status da Integração');
    if (!autorizado) return;

    setState(() => _carregando = true);
    try {
      final resp = await _api.updateIntegrationStatus(
        integracao['id'],
        novoStatus,
        reason: 'Alterado pelo proprietário no app',
        stepUpToken: _stepUpToken,
      );
      final msg = resp['message']?.toString() ?? 'Status alterado para $novoStatus.';
      if (integracao['category'] == 'PAYMENT_GATEWAY' &&
          integracao['environment'] == 'PRODUCTION' &&
          novoStatus == 'ACTIVE') {
        _mostrarAlerta(msg);
      } else {
        _mostrarSucesso(msg);
      }
      if (_empresaSelecionada != null) {
        await _carregarIntegracoesEmpresa(_empresaSelecionada!['id']);
      }
    } catch (e) {
      _mostrarErro('Erro ao alterar status: $e');
    } finally {
      if (mounted) setState(() => _carregando = false);
    }
  }

  Future<void> _executarHomologacaoSandbox() async {
    if (_empresaSelecionada == null) {
      _mostrarErro('Selecione uma empresa antes de executar o roteiro.');
      return;
    }

    if (!_ambienteAutorizadoParaHomologacao) {
      await _consultarSituacaoProntidao();
      return;
    }

    final authed = await _garantirStepUpAuth('executar roteiro de homologação Sandbox');
    if (!authed) return;

    setState(() => _carregando = true);
    try {
      final report = await _api.runAsaasSandboxHomologation(
        companyId: _empresaSelecionada!['id'],
        forceSimulation: false,
        stepUpToken: _stepUpToken,
      );
      setState(() {
        _harnessReport = report;
      });

      final String overallStatus = report['overallStatus'] ?? '';
      final bool homologated = report['readinessForLive']?['sandboxHomologated'] == true;

      if (overallStatus.startsWith('BLOCKED_')) {
        final reason =
            report['steps']?[0]?['details'] ?? 'Execução bloqueada pela guarda de segurança.';
        _mostrarAlerta('Instrução ($overallStatus): $reason');
      } else if (overallStatus == 'PENDING_PROVIDER_WEBHOOK') {
        _mostrarAlerta(
          'Aguardando Provedor: Cobrança Sandbox emitida; aguardando entrega e persistência do webhook oficial do Asaas Sandbox.',
        );
      } else if (homologated) {
        _mostrarSucesso(
          'Homologação oficial no Asaas Sandbox aprovada com evidências de retorno e baixa.',
        );
      } else {
        _mostrarAlerta(
          'Roteiro concluído sem aprovação externa. Verifique os detalhes das etapas abaixo.',
        );
      }
    } catch (e) {
      _mostrarErro('Falha ao rodar homologação: $e');
    } finally {
      if (mounted) setState(() => _carregando = false);
    }
  }

  Future<void> _cadastrarPrimeiraIntegracao(
    Map<String, dynamic> cat, {
    String? initialEnvironment,
  }) async {
    if (_empresaSelecionada == null) {
      _mostrarErro('Selecione uma empresa primeiro.');
      return;
    }

    final targetCompany = _empresaSelecionada!;
    final String targetCompanyId = targetCompany['id'];
    final String targetCompanyName = targetCompany['name'] ?? 'Empresa';

    final authed = await _garantirStepUpAuth('Cadastrar Nova Integração');
    if (!authed) return;

    final String category = cat['category'];
    final List supportedProviders = cat['supportedProviders'] ?? [];
    final List supportedScopes = cat['scopes'] ?? ['COMPANY_EXCLUSIVE'];

    String provedorSelecionado =
        supportedProviders.isNotEmpty ? supportedProviders.first.toString() : 'ASAAS';
    String escopoSelecionado =
        cat['defaultScope']?.toString() ??
        (supportedScopes.isNotEmpty ? supportedScopes.first.toString() : 'COMPANY_EXCLUSIVE');
    String ambienteSelecionado =
        initialEnvironment ?? (category == 'PAYMENT_GATEWAY' ? 'SANDBOX' : 'PRODUCTION');
    String pagadorCusto = cat['defaultCostPayer']?.toString() ?? 'COMPANY';

    final titularidadeController = TextEditingController(
      text: '$targetCompanyName - $provedorSelecionado',
    );
    final chaveController = TextEditingController();
    final webhookTokenController = TextEditingController();
    final walletIdController = TextEditingController();
    final limiteOrcamentoController = TextEditingController();
    bool allowSharedPool = escopoSelecionado == 'PLATFORM_SHARED';

    final formKey = GlobalKey<FormState>();

    if (!mounted) return;

    final confirmou = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => _ControllerDisposer(
        controllers: [
          titularidadeController,
          chaveController,
          webhookTokenController,
          walletIdController,
          limiteOrcamentoController,
        ],
        child: StatefulBuilder(
          builder: (context, setModalState) => AlertDialog(
          backgroundColor: const Color(0xFF1E293B),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          title: Row(
            children: [
              _getCategoryIcon(category),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Cadastrar: ${cat['label'] ?? category}',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ],
          ),
          content: SingleChildScrollView(
            child: Form(
              key: formKey,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: const Color(0xFF0F172A),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: const Color(0xFF334155)),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Empresa-Alvo: $targetCompanyName',
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          'Ambiente: $ambienteSelecionado',
                          style: TextStyle(
                            color: ambienteSelecionado == 'PRODUCTION' ? const Color(0xFFF87171) : const Color(0xFF38BDF8),
                            fontSize: 12,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                        const SizedBox(height: 4),
                        const Text(
                          'Segredos são gravados apenas por canal seguro com AES-256-GCM no Vault, mascarados na consulta e separados dos metadados comuns. Portais bancários iniciam DESATIVADOS (estado não financeiro).',
                          style: TextStyle(color: Color(0xFF94A3B8), fontSize: 11),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 14),
                  DropdownButtonFormField<String>(
                    value: provedorSelecionado,
                    dropdownColor: const Color(0xFF1E293B),
                    style: const TextStyle(color: Colors.white),
                    decoration: InputDecoration(
                      labelText: 'Provedor',
                      labelStyle: const TextStyle(color: Color(0xFF94A3B8)),
                      filled: true,
                      fillColor: const Color(0xFF0F172A),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                    items: supportedProviders.map<DropdownMenuItem<String>>((p) {
                      return DropdownMenuItem(value: p.toString(), child: Text(p.toString()));
                    }).toList(),
                    onChanged: (val) {
                      if (val != null) setModalState(() => provedorSelecionado = val);
                    },
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    value: ambienteSelecionado,
                    dropdownColor: const Color(0xFF1E293B),
                    style: const TextStyle(color: Colors.white),
                    decoration: InputDecoration(
                      labelText: 'Ambiente',
                      labelStyle: const TextStyle(color: Color(0xFF94A3B8)),
                      filled: true,
                      fillColor: const Color(0xFF0F172A),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                    items: const [
                      DropdownMenuItem(
                        value: 'SANDBOX',
                        child: Text('SANDBOX (Homologação / Testes)'),
                      ),
                      DropdownMenuItem(
                        value: 'PRODUCTION',
                        child: Text('PRODUCTION (Produção — LIVE Bloqueado)'),
                      ),
                    ],
                    onChanged: (val) {
                      if (val != null) setModalState(() => ambienteSelecionado = val);
                    },
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    value: escopoSelecionado,
                    dropdownColor: const Color(0xFF1E293B),
                    style: const TextStyle(color: Colors.white),
                    decoration: InputDecoration(
                      labelText: 'Escopo de Uso',
                      labelStyle: const TextStyle(color: Color(0xFF94A3B8)),
                      filled: true,
                      fillColor: const Color(0xFF0F172A),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                    items: supportedScopes.map<DropdownMenuItem<String>>((s) {
                      return DropdownMenuItem(value: s.toString(), child: Text(s.toString()));
                    }).toList(),
                    onChanged: (val) {
                      if (val != null) {
                        setModalState(() {
                          escopoSelecionado = val;
                          if (val != 'PLATFORM_SHARED') allowSharedPool = false;
                        });
                      }
                    },
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    value: pagadorCusto,
                    dropdownColor: const Color(0xFF1E293B),
                    style: const TextStyle(color: Colors.white),
                    decoration: InputDecoration(
                      labelText: 'Titularidade Financeira / Custo',
                      labelStyle: const TextStyle(color: Color(0xFF94A3B8)),
                      filled: true,
                      fillColor: const Color(0xFF0F172A),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                    items: const [
                      DropdownMenuItem(
                        value: 'COMPANY',
                        child: Text('COMPANY (Custo da Empresa)'),
                      ),
                      DropdownMenuItem(
                        value: 'PLATFORM',
                        child: Text('PLATFORM (Custo da Plataforma)'),
                      ),
                    ],
                    onChanged: (val) {
                      if (val != null) setModalState(() => pagadorCusto = val);
                    },
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: titularidadeController,
                    style: const TextStyle(color: Colors.white),
                    decoration: InputDecoration(
                      labelText: 'Identificação da Conta / Titular',
                      labelStyle: const TextStyle(color: Color(0xFF94A3B8)),
                      filled: true,
                      fillColor: const Color(0xFF0F172A),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                    validator: (val) {
                      if ((escopoSelecionado == 'COMPANY_EXCLUSIVE' ||
                              escopoSelecionado == 'EXCLUSIVE_OWN_KEY') &&
                          (val == null || val.trim().isEmpty)) {
                        return 'Informe a identificação da conta vinculada';
                      }
                      return null;
                    },
                  ),
                  const SizedBox(height: 12),
                  if (escopoSelecionado != 'PLATFORM_SHARED') ...[
                    TextFormField(
                      controller: chaveController,
                      obscureText: true,
                      enableSuggestions: false,
                      autocorrect: false,
                      style: const TextStyle(color: Colors.white),
                      decoration: InputDecoration(
                        labelText: 'Chave de API / Segredo Principal',
                        labelStyle: const TextStyle(color: Color(0xFF94A3B8)),
                        filled: true,
                        fillColor: const Color(0xFF0F172A),
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                      ),
                      validator: (val) => val == null || val.trim().length < 4
                          ? 'Credencial obrigatória para escopo exclusivo'
                          : null,
                    ),
                    const SizedBox(height: 12),
                  ],
                  if (category == 'PAYMENT_GATEWAY') ...[
                    TextFormField(
                      controller: webhookTokenController,
                      obscureText: true,
                      enableSuggestions: false,
                      autocorrect: false,
                      style: const TextStyle(color: Colors.white),
                      decoration: InputDecoration(
                        labelText: 'Segredo do Webhook (asaas-access-token)',
                        labelStyle: const TextStyle(color: Color(0xFF94A3B8)),
                        filled: true,
                        fillColor: const Color(0xFF0F172A),
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                        helperText: 'Guardado criptografado no Vault e mascarado na leitura',
                        helperStyle: const TextStyle(color: Color(0xFF64748B), fontSize: 10),
                      ),
                      validator: (val) => val == null || val.trim().length < 4
                          ? 'Segredo de webhook obrigatório para Asaas'
                          : null,
                    ),
                    const SizedBox(height: 12),
                    TextFormField(
                      controller: walletIdController,
                      style: const TextStyle(color: Colors.white),
                      decoration: InputDecoration(
                        labelText: 'Identificação da Carteira (WalletId - Opcional)',
                        labelStyle: const TextStyle(color: Color(0xFF94A3B8)),
                        filled: true,
                        fillColor: const Color(0xFF0F172A),
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                      ),
                    ),
                    const SizedBox(height: 12),
                  ],
                  if (category == 'AI_RESEARCH' && escopoSelecionado == 'PLATFORM_SHARED') ...[
                    SwitchListTile(
                      contentPadding: EdgeInsets.zero,
                      title: const Text(
                        'Contratar Pool Compartilhado da Plataforma',
                        style: TextStyle(color: Colors.white, fontSize: 13),
                      ),
                      subtitle: const Text(
                        'Exige contratação explícita e estado ATIVO',
                        style: TextStyle(color: Color(0xFF94A3B8), fontSize: 11),
                      ),
                      value: allowSharedPool,
                      activeColor: const Color(0xFF10B981),
                      onChanged: (val) => setModalState(() => allowSharedPool = val),
                    ),
                    const SizedBox(height: 12),
                  ],
                  TextFormField(
                    controller: limiteOrcamentoController,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    style: const TextStyle(color: Colors.white),
                    decoration: InputDecoration(
                      labelText: r'Limite Mensal de Orçamento (R$ - Opcional)',
                      labelStyle: const TextStyle(color: Color(0xFF94A3B8)),
                      hintText: r'Ex: 0 para bloquear consumo, vazio para ilimitado',
                      hintStyle: const TextStyle(color: Color(0xFF475569)),
                      filled: true,
                      fillColor: const Color(0xFF0F172A),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                    validator: (val) {
                      if (val != null && val.trim().isNotEmpty) {
                        final parsed = double.tryParse(val.trim().replaceAll(',', '.'));
                        if (parsed == null || parsed < 0) {
                          return 'Informe um valor maior ou igual a zero';
                        }
                      }
                      return null;
                    },
                  ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancelar', style: TextStyle(color: Color(0xFF94A3B8))),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF0284C7)),
              onPressed: () {
                if (formKey.currentState?.validate() ?? false) {
                  Navigator.pop(ctx, true);
                }
              },
              child: const Text('Cadastrar no Vault', style: TextStyle(color: Colors.white)),
            ),
          ],
        ),
        ),
      ),
    );

    if (confirmou == true) {
      final rawBudget = limiteOrcamentoController.text.trim();
      final plainSecretVal = chaveController.text.trim();
      final plainWebhookVal = webhookTokenController.text.trim();
      final walletVal = walletIdController.text.trim();
      final titularVal = titularidadeController.text.trim();
      chaveController.clear();
      webhookTokenController.clear();

      setState(() => _carregando = true);
      try {
        int? budgetCents;
        if (rawBudget.isNotEmpty) {
          final parsed = double.parse(rawBudget.replaceAll(',', '.'));
          budgetCents = (parsed * 100).round();
        }

        final hasPlainSecret = plainSecretVal.isNotEmpty;
        final data = <String, dynamic>{
          'companyId': targetCompanyId,
          'category': category,
          'provider': provedorSelecionado,
          'scope': escopoSelecionado,
          'environment': ambienteSelecionado,
          'costPayer': pagadorCusto,
          'accountName': titularVal,
          'credentialSource': hasPlainSecret ? 'VAULT_ENCRYPTED' : 'NONE',
          if (hasPlainSecret) 'plainSecret': plainSecretVal,
          if (plainWebhookVal.isNotEmpty) 'plainWebhookToken': plainWebhookVal,
          if (walletVal.isNotEmpty) 'walletId': walletVal,
          if (category == 'AI_RESEARCH') 'allowSharedPool': allowSharedPool,
          if (budgetCents != null) 'monthlyBudgetLimitCents': budgetCents,
        };

        await _api.createCompanyIntegration(
          data,
          stepUpToken: _stepUpToken,
        );

        _mostrarSucesso(
          category == 'PAYMENT_GATEWAY'
              ? 'Integração bancária cadastrada em estado DESATIVADO (não financeiro) aguardando validação.'
              : 'Integração cadastrada com sucesso na Central.',
        );
        if (_empresaSelecionada?['id'] == targetCompanyId) {
          await _carregarIntegracoesEmpresa(targetCompanyId);
        }
      } catch (e) {
        _mostrarErro('Falha ao cadastrar integração: $e');
      } finally {
        if (mounted) setState(() => _carregando = false);
      }
    }
  }

  Future<void> _editarParametros(Map<String, dynamic> integracao) async {
    final authed = await _garantirStepUpAuth('Editar Parâmetros da Integração');
    if (!authed) return;

    final titularidadeController = TextEditingController(text: integracao['accountName'] ?? '');
    final webhookTokenController = TextEditingController();
    final walletIdController = TextEditingController(
      text: (integracao['configMetadata'] as Map?)?['walletId'] ?? '',
    );
    final currentBudgetCents = integracao['monthlyBudgetLimitCents'];
    final limiteOrcamentoController = TextEditingController(
      text: currentBudgetCents != null ? (currentBudgetCents / 100).toStringAsFixed(2) : '',
    );
    String pagadorCusto = integracao['costPayer']?.toString() ?? 'COMPANY';
    bool allowSharedPool = (integracao['configMetadata'] as Map?)?['allowSharedPool'] == true;

    final formKey = GlobalKey<FormState>();

    if (!mounted) return;

    final confirmou = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => _ControllerDisposer(
        controllers: [
          titularidadeController,
          webhookTokenController,
          walletIdController,
          limiteOrcamentoController,
        ],
        child: StatefulBuilder(
          builder: (context, setModalState) => AlertDialog(
          backgroundColor: const Color(0xFF1E293B),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          title: Text(
            'Editar Parâmetros: ${integracao['provider']} (${integracao['environment'] ?? 'PRODUCTION'})',
            style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold),
          ),
          content: SingleChildScrollView(
            child: Form(
              key: formKey,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  TextFormField(
                    controller: titularidadeController,
                    style: const TextStyle(color: Colors.white),
                    decoration: InputDecoration(
                      labelText: 'Identificação da Conta / Titular',
                      labelStyle: const TextStyle(color: Color(0xFF94A3B8)),
                      filled: true,
                      fillColor: const Color(0xFF0F172A),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    value: pagadorCusto,
                    dropdownColor: const Color(0xFF1E293B),
                    style: const TextStyle(color: Colors.white),
                    decoration: InputDecoration(
                      labelText: 'Titularidade Financeira / Custo',
                      labelStyle: const TextStyle(color: Color(0xFF94A3B8)),
                      filled: true,
                      fillColor: const Color(0xFF0F172A),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                    items: const [
                      DropdownMenuItem(value: 'COMPANY', child: Text('COMPANY (Empresa)')),
                      DropdownMenuItem(value: 'PLATFORM', child: Text('PLATFORM (Plataforma)')),
                    ],
                    onChanged: (val) {
                      if (val != null) setModalState(() => pagadorCusto = val);
                    },
                  ),
                  const SizedBox(height: 12),
                  if (integracao['category'] == 'PAYMENT_GATEWAY') ...[
                    TextFormField(
                      controller: webhookTokenController,
                      obscureText: true,
                      enableSuggestions: false,
                      autocorrect: false,
                      style: const TextStyle(color: Colors.white),
                      decoration: InputDecoration(
                        labelText: 'Rotacionar Segredo do Webhook (Opcional)',
                        labelStyle: const TextStyle(color: Color(0xFF94A3B8)),
                        hintText: integracao['webhookMasked'] ?? '••••••••',
                        hintStyle: const TextStyle(color: Color(0xFF64748B)),
                        filled: true,
                        fillColor: const Color(0xFF0F172A),
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                        helperText: 'Deixe em branco para preservar o segredo atual no Vault',
                        helperStyle: const TextStyle(color: Color(0xFF64748B), fontSize: 10),
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextFormField(
                      controller: walletIdController,
                      style: const TextStyle(color: Colors.white),
                      decoration: InputDecoration(
                        labelText: 'ID da Carteira (WalletId)',
                        labelStyle: const TextStyle(color: Color(0xFF94A3B8)),
                        filled: true,
                        fillColor: const Color(0xFF0F172A),
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                      ),
                    ),
                    const SizedBox(height: 12),
                  ],
                  if (integracao['category'] == 'AI_RESEARCH') ...[
                    SwitchListTile(
                      contentPadding: EdgeInsets.zero,
                      title: const Text(
                        'Pool Compartilhado Contratado',
                        style: TextStyle(color: Colors.white, fontSize: 13),
                      ),
                      value: allowSharedPool,
                      activeColor: const Color(0xFF10B981),
                      onChanged: (val) => setModalState(() => allowSharedPool = val),
                    ),
                    const SizedBox(height: 12),
                  ],
                  TextFormField(
                    controller: limiteOrcamentoController,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    style: const TextStyle(color: Colors.white),
                    decoration: InputDecoration(
                      labelText: r'Limite Mensal de Orçamento (R$)',
                      labelStyle: const TextStyle(color: Color(0xFF94A3B8)),
                      hintText: r'Ex: 0 para bloqueio total, vazio para ilimitado',
                      hintStyle: const TextStyle(color: Color(0xFF475569)),
                      filled: true,
                      fillColor: const Color(0xFF0F172A),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                    validator: (val) {
                      if (val != null && val.trim().isNotEmpty) {
                        final parsed = double.tryParse(val.trim().replaceAll(',', '.'));
                        if (parsed == null || parsed < 0) {
                          return 'Informe um valor maior ou igual a zero';
                        }
                      }
                      return null;
                    },
                  ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancelar', style: TextStyle(color: Color(0xFF94A3B8))),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF0284C7)),
              onPressed: () {
                if (formKey.currentState?.validate() ?? false) {
                  Navigator.pop(ctx, true);
                }
              },
              child: const Text('Salvar com Auditoria', style: TextStyle(color: Colors.white)),
            ),
          ],
        ),
        ),
      ),
    );

    if (confirmou == true) {
      final titularVal = titularidadeController.text.trim();
      final rawBudget = limiteOrcamentoController.text.trim();
      final plainWebhookVal = webhookTokenController.text.trim();
      final walletVal = walletIdController.text.trim();
      webhookTokenController.clear();

      setState(() => _carregando = true);
      try {
        final data = <String, dynamic>{
          'accountName': titularVal,
          'costPayer': pagadorCusto,
        };

        if (rawBudget.isNotEmpty) {
          final parsed = double.parse(rawBudget.replaceAll(',', '.'));
          data['monthlyBudgetLimitCents'] = (parsed * 100).round();
        } else {
          data['monthlyBudgetLimitCents'] = null;
        }

        if (plainWebhookVal.isNotEmpty) {
          data['plainWebhookToken'] = plainWebhookVal;
        }
        if (integracao['category'] == 'PAYMENT_GATEWAY') {
          data['walletId'] = walletVal;
        }
        if (integracao['category'] == 'AI_RESEARCH') {
          data['allowSharedPool'] = allowSharedPool;
        }

        await _api.updateIntegrationMetadata(
          integracao['id'],
          data,
          stepUpToken: _stepUpToken,
        );

        _mostrarSucesso('Parâmetros atualizados e auditados com sucesso.');
        if (_empresaSelecionada != null) {
          await _carregarIntegracoesEmpresa(_empresaSelecionada!['id']);
        }
      } catch (e) {
        _mostrarErro('Falha ao atualizar parâmetros: $e');
      } finally {
        if (mounted) setState(() => _carregando = false);
      }
    }
  }

  // ── Widgets de Construção Visual ──────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final bool liveLocked = _liveReadinessReport?['productionSafetyLocked'] ?? true;
    return Scaffold(
      backgroundColor: const Color(0xFF0F172A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1E293B),
        elevation: 0,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Central de Integrações e APIs',
              style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold),
            ),
            Row(
              children: [
                Icon(
                  liveLocked ? Icons.shield_rounded : Icons.warning_amber_rounded,
                  color: liveLocked ? const Color(0xFF10B981) : const Color(0xFFF59E0B),
                  size: 13,
                ),
                const SizedBox(width: 4),
                Text(
                  liveLocked
                      ? 'Asaas LIVE: BLOQUEADO (Guarda Ativa)'
                      : 'Asaas LIVE: Habilitação Detectada',
                  style: TextStyle(
                    color: liveLocked ? const Color(0xFF10B981) : const Color(0xFFF59E0B),
                    fontSize: 11,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
          ],
        ),
        bottom: TabBar(
          controller: _tabController,
          indicatorColor: const Color(0xFF38BDF8),
          tabs: const [
            Tab(icon: Icon(Icons.hub_rounded), text: 'Catálogo & Chaves'),
            Tab(icon: Icon(Icons.fact_check_rounded), text: 'Homologação Sandbox'),
          ],
        ),
      ),
      body: _carregando
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF38BDF8)))
          : Column(
              children: [
                _buildEmpresaHeader(),
                Expanded(
                  child: TabBarView(
                    controller: _tabController,
                    children: [
                      _buildCatalogoTab(),
                      _buildHomologacaoTab(),
                    ],
                  ),
                ),
              ],
            ),
    );
  }

  Widget _buildEmpresaHeader() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      color: const Color(0xFF1E293B).withOpacity(0.6),
      child: Row(
        children: [
          const Icon(Icons.business_rounded, color: Color(0xFF94A3B8), size: 20),
          const SizedBox(width: 8),
          const Text('Empresa: ', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 13)),
          Expanded(
            child: DropdownButtonHideUnderline(
              child: DropdownButton<String>(
                value: _empresaSelecionada?['id'],
                dropdownColor: const Color(0xFF1E293B),
                style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
                items: _empresas.map((e) {
                  final isTest = e['isTestExample'] == true || e['classification'] == 'TEST_DEMO';
                  return DropdownMenuItem<String>(
                    value: e['id'],
                    child: Text(
                      isTest ? '${e['name']} [TESTE]' : (e['name'] ?? 'Sem Nome'),
                      overflow: TextOverflow.ellipsis,
                    ),
                  );
                }).toList(),
                onChanged: (id) {
                  if (id != null) {
                    final sel = _empresas.firstWhere((e) => e['id'] == id);
                    setState(() {
                      _empresaSelecionada = sel;
                      _harnessReport = null;
                    });
                    _carregarIntegracoesEmpresa(id);
                  }
                },
              ),
            ),
          ),
          if (_temStepUpAtivo)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: const Color(0xFF10B981).withOpacity(0.2),
                borderRadius: BorderRadius.circular(6),
                border: Border.all(color: const Color(0xFF10B981), width: 1),
              ),
              child: const Row(
                children: [
                  Icon(Icons.lock_open_rounded, color: Color(0xFF10B981), size: 12),
                  SizedBox(width: 4),
                  Text('Step-Up Ativo', style: TextStyle(color: Color(0xFF10B981), fontSize: 10)),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildCatalogoTab() {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _buildPlatformOverviewCard(),
        _buildCompanyConsumptionSummary(),
        if (_companyUnlinkedUsage != null && _companyUnlinkedUsage!['hasUnlinkedRecords'] == true)
          _buildUnlinkedUsageCard(_companyUnlinkedUsage!),
        ..._catalogos.map((cat) => _buildCategoriaCard(cat)),
      ],
    );
  }

  Widget _buildCompanyConsumptionSummary() {
    if (_companyOverview == null) return const SizedBox.shrink();
    final units = _companyOverview!['totalUnitsUsed'] ?? 0;
    final spent = _companyOverview!['totalSpentFormatted'] ?? r'R$ 0,00';
    final active = _companyOverview!['activeIntegrationsCount'] ?? 0;
    final compName = _empresaSelecionada?['name'] ?? 'Empresa';

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFF1E293B),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: const Color(0xFF0284C7).withOpacity(0.4)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Consumo de $compName',
                  style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.bold),
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                Text(
                  'Requisições no mês: $units un. • Gastos: $spent',
                  style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 11),
                ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: const Color(0xFF0284C7).withOpacity(0.2),
              borderRadius: BorderRadius.circular(6),
            ),
            child: Text(
              '$active Ativas',
              style: const TextStyle(color: Color(0xFF38BDF8), fontSize: 10, fontWeight: FontWeight.bold),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPlatformOverviewCard() {
    final totalComp = _platformOverview?['totalCompanies'] ?? _empresas.length;
    final totalUnits = _platformOverview?['totalUnitsUsedThisMonth'] ?? 0;
    final totalSpentFormatted = _platformOverview?['totalSpentFormatted'] ?? r'R$ 0,00';
    final periodStr = _platformOverview?['period'] ?? _period ?? 'Mês Atual';

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF0F172A),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFF38BDF8).withOpacity(0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Row(
                children: [
                  Icon(Icons.public_rounded, color: Color(0xFF38BDF8), size: 18),
                  SizedBox(width: 8),
                  Text(
                    'Visão Geral das APIs (Plataforma)',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 13,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ],
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: const Color(0xFF38BDF8).withOpacity(0.15),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  periodStr,
                  style: const TextStyle(
                    color: Color(0xFF38BDF8),
                    fontSize: 10,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: const Color(0xFF1E293B),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Empresas', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 10)),
                      const SizedBox(height: 2),
                      Text(
                        '$totalComp',
                        style: const TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.bold),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: const Color(0xFF1E293B),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Requisições Mês', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 10)),
                      const SizedBox(height: 2),
                      Text(
                        '$totalUnits un.',
                        style: const TextStyle(color: Color(0xFF38BDF8), fontSize: 14, fontWeight: FontWeight.bold),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: const Color(0xFF1E293B),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Gasto Total', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 10)),
                      const SizedBox(height: 2),
                      Text(
                        totalSpentFormatted,
                        style: const TextStyle(color: Color(0xFF10B981), fontSize: 14, fontWeight: FontWeight.bold),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildRealServiceStatusBadge(String level, String label) {
    Color bg;
    Color fg;
    IconData icon;

    switch (level) {
      case 'OPERATIONAL':
        bg = const Color(0xFF10B981).withOpacity(0.2);
        fg = const Color(0xFF10B981);
        icon = Icons.verified_rounded;
        break;
      case 'TESTED':
        bg = const Color(0xFF38BDF8).withOpacity(0.2);
        fg = const Color(0xFF38BDF8);
        icon = Icons.check_circle_outline_rounded;
        break;
      case 'CONFIGURED':
        bg = Colors.amber.withOpacity(0.2);
        fg = Colors.amber;
        icon = Icons.vpn_key_rounded;
        break;
      case 'FAILED':
        bg = Colors.redAccent.withOpacity(0.2);
        fg = Colors.redAccent;
        icon = Icons.error_outline_rounded;
        break;
      case 'DISABLED':
      default:
        bg = Colors.white12;
        fg = Colors.white60;
        icon = Icons.pause_circle_outline_rounded;
        break;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: fg.withOpacity(0.4)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: fg, size: 12),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(color: fg, fontSize: 10, fontWeight: FontWeight.bold),
          ),
        ],
      ),
    );
  }

  Widget _buildConsumptionProgressBar(Map<String, dynamic> consumption) {
    final unitsUsed = consumption['unitsUsed'] ?? 0;
    final externalUnitsUsed = consumption['externalUnitsUsed'] ?? unitsUsed;
    final cachedUnitsUsed = consumption['cachedUnitsUsed'] ?? 0;
    final usedIncludedUnits = consumption['usedIncludedUnits'] ?? 0;
    final remainingIncludedUnits = consumption['remainingIncludedUnits'] ?? 0;
    final overageUnits = consumption['overageUnits'] ?? 0;
    final overageUnitsUsed = consumption['overageUnitsUsed'] ?? overageUnits;
    final overageAuthorizedLabel = consumption['overageAuthorizedLabel']?.toString() ?? 'Não autorizado';
    final overageCostStatusLabel = consumption['overageCostStatusLabel']?.toString() ?? 'Custo ainda não pode ser calculado';

    final unitsPercent = consumption['unitsPercent'];
    final unitsLimitLabel = consumption['unitsLimitLabel'] ?? 'Sem limite configurado';
    final hasUnitsLimit = consumption['hasUnitsLimit'] == true;

    final costSpentCents = consumption['costSpentCents'] ?? 0;
    final costSpentFormatted = consumption['costSpentFormatted']?.toString() ??
        'R\$ ${(costSpentCents / 100).toStringAsFixed(2).replaceAll('.', ',')}';
    final budgetLabel = consumption['budgetLabel'] ?? 'Sem limite configurado';
    final hasBudget = consumption['hasBudget'] == true;
    final costPercent = consumption['costPercent'];
    final isEstimated = consumption['isEstimatedCost'] == true;

    final lumoraLimitLabel = consumption['lumoraLimitLabel'] ?? 'Sem limite configurado';
    final providerQuotaLabel = consumption['providerQuotaLabel'] ?? 'Não informada';
    final missingNotice = consumption['missingNotice']?.toString();
    final hasMeasurement = consumption['hasMeasurement'] == true && (unitsUsed > 0 || costSpentCents > 0);

    final double? fillPercent = unitsPercent != null
        ? (unitsPercent as num).toDouble()
        : (costPercent != null ? (costPercent as num).toDouble() : null);

    final double clampedFraction = fillPercent != null ? (fillPercent / 100.0).clamp(0.0, 1.0) : 0.0;

    Color barColor = const Color(0xFF10B981);
    if (fillPercent != null && fillPercent >= 90) {
      barColor = Colors.redAccent;
    } else if (fillPercent != null && fillPercent >= 70) {
      barColor = Colors.amber;
    }

    return Container(
      margin: const EdgeInsets.only(top: 10),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: const Color(0xFF0F172A),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: const Color(0xFF334155)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  const Icon(Icons.bar_chart_rounded, color: Color(0xFF38BDF8), size: 14),
                  const SizedBox(width: 4),
                  Text(
                    'Consumo (${consumption['period'] ?? 'Mês Atual'})',
                    style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold),
                  ),
                ],
              ),
              if (fillPercent != null)
                Text(
                  '${fillPercent.toStringAsFixed(0)}%',
                  style: TextStyle(color: barColor, fontSize: 11, fontWeight: FontWeight.bold),
                )
              else
                const Text(
                  'Sem limite fixado',
                  style: TextStyle(color: Color(0xFF94A3B8), fontSize: 10),
                ),
            ],
          ),
          const SizedBox(height: 6),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              value: hasUnitsLimit || hasBudget ? clampedFraction : 0.05,
              backgroundColor: Colors.white12,
              valueColor: AlwaysStoppedAnimation<Color>(hasUnitsLimit || hasBudget ? barColor : const Color(0xFF38BDF8)),
              minHeight: 6,
            ),
          ),
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Usado: $unitsUsed un. (Ext: $externalUnitsUsed)',
                style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 11),
              ),
              Text(
                'Limite: $unitsLimitLabel',
                style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 11),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: Colors.white.withOpacity(0.04),
              borderRadius: BorderRadius.circular(6),
              border: Border.all(color: Colors.white10),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      'Franquia: $usedIncludedUnits un. usada(s) • Saldo: $remainingIncludedUnits un.',
                      style: const TextStyle(color: Color(0xFF38BDF8), fontSize: 10, fontWeight: FontWeight.w600),
                    ),
                    Text(
                      'Cache: $cachedUnitsUsed un.',
                      style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 10),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Row(
                  children: [
                    const Icon(Icons.monetization_on_outlined, color: Colors.amberAccent, size: 12),
                    const SizedBox(width: 4),
                    Expanded(
                      child: Text(
                        'Excedente: $overageUnitsUsed un. usado(s) • Autorizado: $overageAuthorizedLabel • Custo: $overageCostStatusLabel',
                        style: const TextStyle(color: Color(0xFFCBD5E1), fontSize: 10),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          if (hasBudget || costSpentCents > 0) ...[
            const SizedBox(height: 4),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    Text(
                      'Gasto: $costSpentFormatted',
                      style: const TextStyle(color: Color(0xFF10B981), fontSize: 11, fontWeight: FontWeight.bold),
                    ),
                    const SizedBox(width: 4),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                      decoration: BoxDecoration(
                        color: isEstimated ? Colors.amber.withOpacity(0.15) : Colors.blue.withOpacity(0.15),
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: Text(
                        isEstimated ? 'Estimado' : 'Medido',
                        style: TextStyle(
                          color: isEstimated ? Colors.amber : const Color(0xFF90CAF9),
                          fontSize: 9,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  ],
                ),
                Text(
                  'Orçamento: $budgetLabel',
                  style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 11),
                ),
              ],
            ),
          ],
          if (!hasMeasurement) ...[
            const SizedBox(height: 4),
            const Text(
              'Consumo ainda não medido',
              style: TextStyle(color: Color(0xFF94A3B8), fontSize: 10, fontStyle: FontStyle.italic),
            ),
          ],
          const SizedBox(height: 6),
          const Divider(color: Color(0xFF334155), height: 8),
          const SizedBox(height: 4),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(Icons.tune_rounded, color: Color(0xFF94A3B8), size: 12),
              const SizedBox(width: 4),
              Expanded(
                child: Text(
                  'Limite Lumora: $lumoraLimitLabel',
                  style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 10),
                ),
              ),
            ],
          ),
          const SizedBox(height: 2),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(Icons.cloud_queue_rounded, color: Color(0xFF94A3B8), size: 12),
              const SizedBox(width: 4),
              Expanded(
                child: Text(
                  'Cota Provedor: $providerQuotaLabel',
                  style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 10),
                ),
              ),
            ],
          ),
          if (missingNotice != null) ...[
            const SizedBox(height: 6),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
              decoration: BoxDecoration(
                color: Colors.amber.withOpacity(0.1),
                borderRadius: BorderRadius.circular(4),
              ),
              child: Row(
                children: [
                  const Icon(Icons.info_outline_rounded, color: Colors.amber, size: 12),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Text(
                      missingNotice,
                      style: const TextStyle(color: Colors.amber, fontSize: 10),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildTariffCard(
    Map<String, dynamic>? tariff, {
    VoidCallback? onConfigureTariff,
    VoidCallback? onViewHistory,
  }) {
    final hasTariff = tariff != null && tariff['hasConfirmedTariff'] == true;

    return Container(
      margin: const EdgeInsets.only(top: 8),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: const Color(0xFF131D2A),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: hasTariff
              ? const Color(0xFF38BDF8).withOpacity(0.3)
              : Colors.amber.withOpacity(0.3),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  Icon(
                    hasTariff ? Icons.receipt_long_rounded : Icons.sell_outlined,
                    color: hasTariff ? const Color(0xFF38BDF8) : Colors.amber,
                    size: 14,
                  ),
                  const SizedBox(width: 4),
                  Text(
                    hasTariff ? 'Tarifa do Plano' : 'Tarifa do Plano',
                    style: TextStyle(
                      color: hasTariff ? const Color(0xFF38BDF8) : Colors.amber,
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ],
              ),
              Row(
                children: [
                  if (onViewHistory != null)
                    InkWell(
                      onTap: onViewHistory,
                      child: const Padding(
                        padding: EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                        child: Text(
                          'Histórico',
                          style: TextStyle(color: Color(0xFF94A3B8), fontSize: 10, decoration: TextDecoration.underline),
                        ),
                      ),
                    ),
                  if (onConfigureTariff != null) ...[
                    const SizedBox(width: 6),
                    InkWell(
                      onTap: onConfigureTariff,
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: const Color(0xFF38BDF8).withOpacity(0.15),
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: const Text(
                          'Definir Tarifa',
                          style: TextStyle(color: Color(0xFF38BDF8), fontSize: 10, fontWeight: FontWeight.bold),
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ],
          ),
          const SizedBox(height: 6),
          if (!hasTariff) ...[
            Text(
              tariff?['statusLabel'] ?? 'Tarifa ainda não informada',
              style: const TextStyle(color: Colors.amber, fontSize: 11, fontWeight: FontWeight.w600),
            ),
            if (tariff?['missingPriceReason'] != null) ...[
              const SizedBox(height: 2),
              Text(
                tariff!['missingPriceReason'].toString(),
                style: const TextStyle(color: Colors.white54, fontSize: 10),
              ),
            ] else ...[
              const SizedBox(height: 2),
              Text(
                tariff?['notes'] ?? 'Clique em "Definir Tarifa" para registrar a tabela negociada.',
                style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 10),
              ),
            ],
          ] else ...[
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'Franquia: ${tariff['includedUnitsLabel'] ?? 'Sem franquia'}',
                  style: const TextStyle(color: Colors.white70, fontSize: 11),
                ),
                Text(
                  'Mensalidade: ${tariff['monthlyFeeLabel'] ?? 'Isento'}',
                  style: const TextStyle(color: Colors.white70, fontSize: 11),
                ),
              ],
            ),
            const SizedBox(height: 3),
            Text(
              'Excedente: ${tariff['overagePriceLabel'] ?? 'Sem custo'}',
              style: const TextStyle(color: Color(0xFF38BDF8), fontSize: 11, fontWeight: FontWeight.w500),
            ),
            if (tariff['conversionNotice'] != null) ...[
              const SizedBox(height: 4),
              Row(
                children: [
                  const Icon(Icons.warning_amber_rounded, color: Colors.amberAccent, size: 12),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Text(
                      tariff['conversionNotice'].toString(),
                      style: const TextStyle(color: Colors.amberAccent, fontSize: 10),
                    ),
                  ),
                ],
              ),
            ],
            const SizedBox(height: 4),
            const Divider(color: Color(0xFF334155), height: 6),
            const SizedBox(height: 2),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'Pagador: ${tariff['costPayerLabel'] ?? 'Empresa'} • Fonte: ${tariff['pricingSourceLabel'] ?? 'Contrato'}',
                  style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 9),
                ),
                Text(
                  tariff['effectivePeriodLabel'] ?? 'Vigente',
                  style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 9),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildUnlinkedUsageCard(Map<String, dynamic> unlinked) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFF241818),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: Colors.amber.withOpacity(0.35)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.history_toggle_off_rounded, color: Colors.amber, size: 16),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  unlinked['label'] ?? 'Registros antigos sem vínculo seguro',
                  style: const TextStyle(
                    color: Colors.amber,
                    fontWeight: FontWeight.bold,
                    fontSize: 12,
                  ),
                ),
              ),
              Text(
                '${unlinked['recordsCount']} registros',
                style: const TextStyle(color: Colors.white60, fontSize: 11),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            unlinked['description'] ?? '',
            style: const TextStyle(color: Colors.white54, fontSize: 11),
          ),
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Consumo: ${unlinked['unitsUsed']} un.',
                style: const TextStyle(color: Colors.white70, fontSize: 11),
              ),
              Text(
                'Total: ${unlinked['totalSpentFormatted']}',
                style: const TextStyle(color: Colors.white70, fontSize: 11, fontWeight: FontWeight.bold),
              ),
            ],
          ),
        ],
      ),
    );
  }

  void _openTariffConfigDialog(Map<String, dynamic> integracao) async {
    final companyId = _empresaSelecionada?['id']?.toString();
    if (companyId == null) return;

    final existingTariff = integracao['tariff'];
    final includedUnitsCtrl = TextEditingController(
      text: existingTariff?['hasConfirmedTariff'] == true
          ? '${existingTariff['includedUnits'] ?? 0}'
          : '0',
    );
    final monthlyFeeCtrl = TextEditingController(
      text: existingTariff?['hasConfirmedTariff'] == true && existingTariff['monthlyFeeCents'] != null
          ? (existingTariff['monthlyFeeCents'] / 100.0).toStringAsFixed(2)
          : '0.00',
    );
    final overageUnitPriceCtrl = TextEditingController(
      text: existingTariff?['hasConfirmedTariff'] == true && existingTariff['overageUnitPriceCents'] != null
          ? (existingTariff['overageUnitPriceCents'] / 100.0).toStringAsFixed(2)
          : '0.00',
    );
    final overageUnitTypeCtrl = TextEditingController(
      text: existingTariff?['overageUnitType']?.toString() ?? 'transação',
    );
    final notesCtrl = TextEditingController(
      text: existingTariff?['notes']?.toString() ?? '',
    );
    String costPayer = existingTariff?['costPayer']?.toString() ?? 'COMPANY';
    String pricingSource = existingTariff?['pricingSource']?.toString() ?? 'CONTRATO_CUSTOMIZADO';
    String currency = existingTariff?['currency']?.toString() ?? 'BRL';

    await showDialog(
      context: context,
      builder: (ctx) {
        return StatefulBuilder(
          builder: (context, setDialogState) {
            return AlertDialog(
              backgroundColor: const Color(0xFF1E293B),
              title: Row(
                children: [
                  const Icon(Icons.receipt_long_rounded, color: Color(0xFF38BDF8), size: 20),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Definir Tarifa: ${integracao['provider']} (${integracao['environment'] ?? 'PRODUCTION'})',
                      style: const TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.bold),
                    ),
                  ),
                ],
              ),
              content: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Ao confirmar uma nova tarifa, a vigência anterior é encerrada e o histórico fica preservado.',
                      style: TextStyle(color: Color(0xFF94A3B8), fontSize: 11),
                    ),
                    const SizedBox(height: 14),
                    TextField(
                      controller: includedUnitsCtrl,
                      keyboardType: TextInputType.number,
                      style: const TextStyle(color: Colors.white, fontSize: 13),
                      decoration: const InputDecoration(
                        labelText: 'Franquia Inclusa (unidades/mês)',
                        labelStyle: TextStyle(color: Color(0xFF94A3B8), fontSize: 12),
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 10),
                    TextField(
                      controller: monthlyFeeCtrl,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      style: const TextStyle(color: Colors.white, fontSize: 13),
                      decoration: const InputDecoration(
                        labelText: 'Mensalidade Fixa (R\$)',
                        labelStyle: TextStyle(color: Color(0xFF94A3B8), fontSize: 12),
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 10),
                    Row(
                      children: [
                        Expanded(
                          flex: 3,
                          child: TextField(
                            controller: overageUnitPriceCtrl,
                            keyboardType: const TextInputType.numberWithOptions(decimal: true),
                            style: const TextStyle(color: Colors.white, fontSize: 13),
                            decoration: const InputDecoration(
                              labelText: 'Preço Excedente (R\$)',
                              labelStyle: TextStyle(color: Color(0xFF94A3B8), fontSize: 12),
                              border: OutlineInputBorder(),
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          flex: 3,
                          child: TextField(
                            controller: overageUnitTypeCtrl,
                            style: const TextStyle(color: Colors.white, fontSize: 13),
                            decoration: const InputDecoration(
                              labelText: 'Unidade (ex: transação)',
                              labelStyle: TextStyle(color: Color(0xFF94A3B8), fontSize: 12),
                              border: OutlineInputBorder(),
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    DropdownButtonFormField<String>(
                      value: costPayer,
                      dropdownColor: const Color(0xFF1E293B),
                      style: const TextStyle(color: Colors.white, fontSize: 13),
                      decoration: const InputDecoration(
                        labelText: 'Pagador do Custo',
                        labelStyle: TextStyle(color: Color(0xFF94A3B8), fontSize: 12),
                        border: OutlineInputBorder(),
                      ),
                      items: const [
                        DropdownMenuItem(value: 'COMPANY', child: Text('Empresa')),
                        DropdownMenuItem(value: 'PLATFORM', child: Text('Plataforma Lumora')),
                      ],
                      onChanged: (val) {
                        if (val != null) setDialogState(() => costPayer = val);
                      },
                    ),
                    const SizedBox(height: 10),
                    DropdownButtonFormField<String>(
                      value: pricingSource,
                      dropdownColor: const Color(0xFF1E293B),
                      style: const TextStyle(color: Colors.white, fontSize: 13),
                      decoration: const InputDecoration(
                        labelText: 'Fonte do Preço',
                        labelStyle: TextStyle(color: Color(0xFF94A3B8), fontSize: 12),
                        border: OutlineInputBorder(),
                      ),
                      items: const [
                        DropdownMenuItem(value: 'CONTRATO_CUSTOMIZADO', child: Text('Contrato Customizado')),
                        DropdownMenuItem(value: 'TABELA_OFICIAL', child: Text('Tabela Oficial do Provedor')),
                        DropdownMenuItem(value: 'MANUAL', child: Text('Negociação Manual')),
                      ],
                      onChanged: (val) {
                        if (val != null) setDialogState(() => pricingSource = val);
                      },
                    ),
                    const SizedBox(height: 10),
                    TextField(
                      controller: notesCtrl,
                      style: const TextStyle(color: Colors.white, fontSize: 13),
                      decoration: const InputDecoration(
                        labelText: 'Observações / Motivo',
                        labelStyle: TextStyle(color: Color(0xFF94A3B8), fontSize: 12),
                        border: OutlineInputBorder(),
                      ),
                    ),
                  ],
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.of(ctx).pop(),
                  child: const Text('Cancelar', style: TextStyle(color: Color(0xFF94A3B8))),
                ),
                ElevatedButton(
                  style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF38BDF8), foregroundColor: Colors.black),
                  onPressed: () async {
                    Navigator.of(ctx).pop();
                    try {
                      setState(() => _carregando = true);
                      await _api.confirmCompanyTariff({
                        'companyId': companyId,
                        'category': integracao['category'],
                        'provider': integracao['provider'],
                        'environment': integracao['environment'] ?? 'PRODUCTION',
                        'companyIntegrationId': integracao['id'],
                        'includedUnits': int.tryParse(includedUnitsCtrl.text.trim()) ?? 0,
                        'monthlyFeeCents': ((double.tryParse(monthlyFeeCtrl.text.replaceAll(',', '.').trim()) ?? 0) * 100).round(),
                        'overageUnitPriceCents': ((double.tryParse(overageUnitPriceCtrl.text.replaceAll(',', '.').trim()) ?? 0) * 100).round(),
                        'overageUnitType': overageUnitTypeCtrl.text.trim().isEmpty ? 'REQUEST' : overageUnitTypeCtrl.text.trim(),
                        'currency': currency,
                        'costPayer': costPayer,
                        'pricingSource': pricingSource,
                        'notes': notesCtrl.text.trim().isEmpty ? null : notesCtrl.text.trim(),
                      });
                      await _carregarIntegracoesEmpresa(companyId);
                      _mostrarSucesso('Tarifa confirmada com sucesso!');
                    } catch (e) {
                      _mostrarErro('Erro ao registrar tarifa: $e');
                    } finally {
                      if (mounted) setState(() => _carregando = false);
                    }
                  },
                  child: const Text('Salvar Tarifa'),
                ),
              ],
            );
          },
        );
      },
    );
  }

  void _openTariffHistoryDialog(Map<String, dynamic> integracao) async {
    final companyId = _empresaSelecionada?['id']?.toString();
    if (companyId == null) return;

    try {
      setState(() => _carregando = true);
      final allTariffs = await _api.getCompanyTariffs(companyId);
      final filtered = allTariffs.where((t) {
        return t['category'] == integracao['category'] &&
            t['provider'] == integracao['provider'];
      }).toList();

      if (!mounted) return;
      setState(() => _carregando = false);

      await showDialog(
        context: context,
        builder: (ctx) {
          return AlertDialog(
            backgroundColor: const Color(0xFF1E293B),
            title: Row(
              children: [
                const Icon(Icons.history_rounded, color: Color(0xFF38BDF8), size: 20),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Histórico de Tarifas: ${integracao['provider']}',
                    style: const TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.bold),
                  ),
                ),
              ],
            ),
            content: SizedBox(
              width: 450,
              child: filtered.isEmpty
                  ? const Padding(
                      padding: EdgeInsets.all(16),
                      child: Text(
                        'Nenhuma tarifa registrada anteriormente.',
                        style: TextStyle(color: Color(0xFF94A3B8), fontSize: 12),
                      ),
                    )
                  : ListView.separated(
                      shrinkWrap: true,
                      itemCount: filtered.length,
                      separatorBuilder: (_, __) => const Divider(color: Color(0xFF334155), height: 16),
                      itemBuilder: (context, idx) {
                        final t = filtered[idx];
                        final bool isCurrent = t['effectiveTo'] == null;
                        final included = t['includedUnits'] ?? 0;
                        final monthlyFee = ((t['monthlyFeeCents'] ?? 0) / 100.0).toStringAsFixed(2);
                        final overage = ((t['overageUnitPriceCents'] ?? 0) / 100.0).toStringAsFixed(2);
                        final unitType = t['overageUnitType'] ?? 'un.';
                        final effectiveFrom = t['effectiveFrom'] != null ? t['effectiveFrom'].toString().split('T').first : '-';
                        final effectiveTo = t['effectiveTo'] != null ? t['effectiveTo'].toString().split('T').first : 'Vigente';

                        return Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text(
                                  '$effectiveFrom até $effectiveTo',
                                  style: TextStyle(
                                    color: isCurrent ? const Color(0xFF10B981) : const Color(0xFF94A3B8),
                                    fontSize: 12,
                                    fontWeight: isCurrent ? FontWeight.bold : FontWeight.normal,
                                  ),
                                ),
                                if (isCurrent)
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                    decoration: BoxDecoration(
                                      color: const Color(0xFF10B981).withOpacity(0.2),
                                      borderRadius: BorderRadius.circular(4),
                                    ),
                                    child: const Text('VIGENTE', style: TextStyle(color: Color(0xFF10B981), fontSize: 9, fontWeight: FontWeight.bold)),
                                  ),
                              ],
                            ),
                            const SizedBox(height: 4),
                            Text(
                              'Franquia: $included un. • Mensalidade: R\$ $monthlyFee',
                              style: const TextStyle(color: Colors.white70, fontSize: 11),
                            ),
                            Text(
                              'Excedente: R\$ $overage / $unitType • Pagador: ${t['costPayer'] ?? 'COMPANY'}',
                              style: const TextStyle(color: Color(0xFF38BDF8), fontSize: 11),
                            ),
                            if (t['notes'] != null && t['notes'].toString().isNotEmpty)
                              Padding(
                                padding: const EdgeInsets.only(top: 2),
                                child: Text('Obs: ${t['notes']}', style: const TextStyle(color: Colors.white38, fontSize: 10, fontStyle: FontStyle.italic)),
                              ),
                          ],
                        );
                      },
                    ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(ctx).pop(),
                child: const Text('Fechar', style: TextStyle(color: Color(0xFF38BDF8))),
              ),
            ],
          );
        },
      );
    } catch (e) {
      _mostrarErro('Erro ao carregar histórico: $e');
    } finally {
      if (mounted) setState(() => _carregando = false);
    }
  }

  Widget _buildCategoriaCard(Map<String, dynamic> cat) {
    final String categoryCode = cat['category'];
    final listaCategoria =
        _integracoes.where((i) => i['category'] == categoryCode).toList();
    final bool configurada = listaCategoria.isNotEmpty;
    final bool hasAnyActive = listaCategoria.any((i) => i['status'] == 'ACTIVE');

    String? missingEnv;
    if (categoryCode == 'PAYMENT_GATEWAY' && listaCategoria.length == 1) {
      final existingEnv = listaCategoria.first['environment']?.toString() ?? 'PRODUCTION';
      missingEnv = existingEnv == 'SANDBOX' ? 'PRODUCTION' : 'SANDBOX';
    }

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      decoration: BoxDecoration(
        color: const Color(0xFF1E293B),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: hasAnyActive
              ? const Color(0xFF0284C7).withOpacity(0.5)
              : const Color(0xFF334155),
          width: 1.2,
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                _getCategoryIcon(categoryCode),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        cat['label'] ?? categoryCode,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 15,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      Text(
                        'Provedores: ${(cat['supportedProviders'] as List).join(', ')}',
                        style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 11),
                      ),
                    ],
                  ),
                ),
                if (!configurada)
                  _buildStatusBadge(
                    (cat['defaultScope'] == 'PLATFORM_SHARED' || categoryCode == 'GEO_LOCATION')
                        ? 'SHARED_AVAILABLE'
                        : 'NOT_CONFIGURED',
                  ),
              ],
            ),
            const SizedBox(height: 10),
            Text(
              cat['description'] ?? '',
              style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12),
            ),
            const Divider(color: Color(0xFF334155), height: 24),
            if (configurada) ...[
              ...listaCategoria.map((integracao) => _buildIntegracaoItemBlock(integracao)),
              if (missingEnv != null) ...[
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(
                    foregroundColor: const Color(0xFF38BDF8),
                    side: const BorderSide(color: Color(0xFF38BDF8)),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                  ),
                  icon: const Icon(Icons.add_circle_outline_rounded, size: 16),
                  label: Text('Cadastrar Ambiente $missingEnv'),
                  onPressed: () =>
                      _cadastrarPrimeiraIntegracao(cat, initialEnvironment: missingEnv),
                ),
              ],
            ] else if (categoryCode == 'GEO_LOCATION') ...[
              Builder(
                builder: (context) {
                  final sharedSvc = _companySharedServices.isNotEmpty ? _companySharedServices.first : null;
                  final consumption = sharedSvc?['consumption'] as Map<String, dynamic>?;
                  final statusLevel = sharedSvc?['serviceStatusLevel']?.toString() ?? 'OPERATIONAL';
                  final statusLabel = sharedSvc?['serviceStatusLabel']?.toString() ?? 'Disponível (Compartilhado)';

                  return Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: const Color(0xFF0F172A),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: const Color(0xFF38BDF8).withOpacity(0.35)),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            const Icon(Icons.check_circle_outline_rounded, color: Color(0xFF38BDF8), size: 20),
                            const SizedBox(width: 8),
                            const Expanded(
                              child: Text(
                                'Serviço compartilhado ativo: O ViaCEP está habilitado de fábrica na plataforma e não exige cadastro ou chaves individuais para consulta de endereços.',
                                style: TextStyle(color: Color(0xFFE2E8F0), fontSize: 12),
                              ),
                            ),
                            const SizedBox(width: 8),
                            _buildRealServiceStatusBadge(statusLevel, statusLabel),
                          ],
                        ),
                        if (consumption != null) ...[
                          const SizedBox(height: 8),
                          _buildConsumptionProgressBar(consumption),
                        ],
                        if (sharedSvc?['tariff'] != null) ...[
                          const SizedBox(height: 8),
                          _buildTariffCard(sharedSvc?['tariff']),
                        ],
                      ],
                    ),
                  );
                },
              ),
            ] else ...[
              Row(
                children: [
                  const Icon(Icons.info_outline, color: Color(0xFF94A3B8), size: 14),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      cat['defaultScope'] == 'PLATFORM_SHARED'
                          ? 'Serviço compartilhado disponível na plataforma'
                          : 'Primeiro cadastro pendente para esta empresa',
                      style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              ElevatedButton.icon(
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF0284C7),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                ),
                icon: const Icon(Icons.add_rounded, size: 16, color: Colors.white),
                label: const Text(
                  'Configurar Primeira Integração',
                  style: TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w600),
                ),
                onPressed: () => _cadastrarPrimeiraIntegracao(cat),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildIntegracaoItemBlock(Map<String, dynamic> integracao) {
    final String status = integracao['status'] ?? 'DISABLED';
    final bool isAtivo = status == 'ACTIVE';
    final int? budgetCents = integracao['monthlyBudgetLimitCents'] is int
        ? integracao['monthlyBudgetLimitCents'] as int
        : (integracao['monthlyBudgetLimitCents'] != null
            ? int.tryParse(integracao['monthlyBudgetLimitCents'].toString())
            : null);

    final serviceStatusLevel = integracao['serviceStatusLevel']?.toString() ??
        (integracao['lastValidationStatus'] == 'SUCCESS' ? 'TESTED' : (isAtivo ? 'CONFIGURED' : 'DISABLED'));
    final serviceStatusLabel = integracao['serviceStatusLabel']?.toString() ??
        (serviceStatusLevel == 'OPERATIONAL'
            ? 'Operação comprovada'
            : (serviceStatusLevel == 'TESTED'
                ? 'Conexão testada'
                : (serviceStatusLevel == 'CONFIGURED' ? 'Configuração cadastrada' : 'Desativado')));
    final serviceStatusDesc = integracao['serviceStatusDescription']?.toString() ?? '';
    final consumption = integracao['consumption'] as Map<String, dynamic>?;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFF0F172A).withOpacity(0.6),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: const Color(0xFF334155)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(
                '${integracao['provider']} • ${integracao['environment'] ?? 'PRODUCTION'}',
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 13,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: Colors.purple.withOpacity(0.2),
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Text(
                  (integracao['costPayer'] ?? 'COMPANY') == 'COMPANY' ? 'EMPRESA' : 'PLATAFORMA',
                  style: const TextStyle(color: Color(0xFFD8B4FE), fontSize: 9, fontWeight: FontWeight.bold),
                ),
              ),
              const Spacer(),
              _buildRealServiceStatusBadge(serviceStatusLevel, serviceStatusLabel),
              const SizedBox(width: 6),
              _buildStatusBadge(status),
            ],
          ),
          if (serviceStatusDesc.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(
              serviceStatusDesc,
              style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 11),
            ),
          ],
          const SizedBox(height: 8),
          _buildMetaRow('Escopo:', integracao['scope'] ?? 'N/A'),
          _buildMetaRow('Titularidade Custo:', integracao['costPayer'] ?? 'COMPANY'),
          if (integracao['accountName'] != null &&
              integracao['accountName'].toString().isNotEmpty)
            _buildMetaRow('Conta Vinculada:', integracao['accountName']),
          _buildMetaRow('Chave no Vault:', integracao['secretMasked'] ?? 'Não cadastrada'),
          if (integracao['category'] == 'PAYMENT_GATEWAY')
            _buildMetaRow(
              'Segredo Webhook:',
              integracao['webhookMasked'] ?? 'Não configurado',
            ),
          _buildMetaRow(
            'Limite Mensal:',
            budgetCents == null
                ? 'Ilimitado'
                : budgetCents == 0
                    ? r'R$ 0,00 (Consumo Bloqueado)'
                    : 'R\$ ${(budgetCents / 100).toStringAsFixed(2)}',
          ),
          _buildMetaRow('Origem do Segredo:', integracao['credentialSource'] ?? 'VAULT_ENCRYPTED'),
          _buildMetaRow('Versão:', 'v${integracao['version'] ?? 1}'),
          if (integracao['lastValidatedAt'] != null)
            _buildMetaRow(
              'Última Validação:',
              '${_dateFormat.format(DateTime.parse(integracao['lastValidatedAt']))} (${integracao['lastValidationStatus'] ?? 'PENDING'})',
            ),
          const SizedBox(height: 6),

          if (consumption != null) ...[
            _buildConsumptionProgressBar(consumption),
            const SizedBox(height: 8),
          ],
          _buildTariffCard(
            integracao['tariff'],
            onConfigureTariff: () => _openTariffConfigDialog(integracao),
            onViewHistory: () => _openTariffHistoryDialog(integracao),
          ),
          const SizedBox(height: 8),

          // Explicações de prontidão real por provedor
          if (integracao['provider'] == 'GROK')
            Container(
              margin: const EdgeInsets.only(top: 4, bottom: 8),
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: const Color(0xFFF59E0B).withOpacity(0.12),
                borderRadius: BorderRadius.circular(6),
                border: Border.all(color: const Color(0xFFF59E0B).withOpacity(0.4)),
              ),
              child: const Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(Icons.warning_amber_rounded, color: Color(0xFFFBBF24), size: 16),
                  SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      'Pendente de Implementação (501): O radar de eventos ainda retorna 501 para Grok. A chave pode ser salva, mas não há suporte operacional ativo no app.',
                      style: TextStyle(color: Color(0xFFFBBF24), fontSize: 11),
                    ),
                  ),
                ],
              ),
            )
          else if (integracao['provider'] == 'GEMINI')
            Container(
              margin: const EdgeInsets.only(top: 4, bottom: 8),
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: const Color(0xFF10B981).withOpacity(0.12),
                borderRadius: BorderRadius.circular(6),
                border: Border.all(color: const Color(0xFF10B981).withOpacity(0.4)),
              ),
              child: const Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(Icons.check_circle_outline_rounded, color: Color(0xFF34D399), size: 16),
                  SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      'Em uso operacional: A chave do cofre é resolvida pelo backend para buscas reais e radar de eventos (/api/events/search-city).',
                      style: TextStyle(color: Color(0xFF34D399), fontSize: 11),
                    ),
                  ),
                ],
              ),
            )
          else if (integracao['provider'] == 'WHATSAPP' || integracao['category'] == 'MESSAGING')
            Container(
              margin: const EdgeInsets.only(top: 4, bottom: 8),
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: const Color(0xFF38BDF8).withOpacity(0.12),
                borderRadius: BorderRadius.circular(6),
                border: Border.all(color: const Color(0xFF38BDF8).withOpacity(0.4)),
              ),
              child: const Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(Icons.info_outline, color: Color(0xFF38BDF8), size: 16),
                  SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      'Validação técnica: O teste valida o token junto à Meta, porém ainda não há fluxo de disparos automáticos de mensagens conectado ao app.',
                      style: TextStyle(color: Color(0xFF38BDF8), fontSize: 11),
                    ),
                  ),
                ],
              ),
            )
          else if (integracao['provider'] == 'ASAAS' || integracao['category'] == 'PAYMENT_GATEWAY')
            Container(
              margin: const EdgeInsets.only(top: 4, bottom: 8),
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: integracao['environment'] == 'PRODUCTION'
                    ? const Color(0xFFEF4444).withOpacity(0.12)
                    : const Color(0xFF14B8A6).withOpacity(0.12),
                borderRadius: BorderRadius.circular(6),
                border: Border.all(
                  color: integracao['environment'] == 'PRODUCTION'
                      ? const Color(0xFFEF4444).withOpacity(0.4)
                      : const Color(0xFF14B8A6).withOpacity(0.4),
                ),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    integracao['environment'] == 'PRODUCTION'
                        ? Icons.shield_rounded
                        : Icons.science_rounded,
                    color: integracao['environment'] == 'PRODUCTION'
                        ? const Color(0xFFF87171)
                        : const Color(0xFF2DD4BF),
                    size: 16,
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      integracao['environment'] == 'PRODUCTION'
                          ? 'Trava de Segurança LIVE Ativa: O servidor operacional bloqueia transações bancárias reais automáticas. Salvar a chave não expõe clientes a cobranças indevidas.'
                          : 'Ambiente Sandbox: Destinado a homologação de parcelas e testes de integração com a API do Asaas sem movimentação de dinheiro real.',
                      style: TextStyle(
                        color: integracao['environment'] == 'PRODUCTION'
                            ? const Color(0xFFF87171)
                            : const Color(0xFF2DD4BF),
                        fontSize: 11,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          const SizedBox(height: 6),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              OutlinedButton.icon(
                style: OutlinedButton.styleFrom(
                  foregroundColor: const Color(0xFF38BDF8),
                  side: const BorderSide(color: Color(0xFF38BDF8)),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                ),
                icon: const Icon(Icons.bolt_rounded, size: 16),
                label: const Text('Testar Conexão'),
                onPressed: () => _testarConexao(integracao),
              ),
              OutlinedButton.icon(
                style: OutlinedButton.styleFrom(
                  foregroundColor: const Color(0xFFF59E0B),
                  side: const BorderSide(color: Color(0xFFF59E0B)),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                ),
                icon: const Icon(Icons.key_rounded, size: 16),
                label: const Text('Rotacionar Chave'),
                onPressed: () => _rotacionarCredencial(integracao),
              ),
              OutlinedButton.icon(
                style: OutlinedButton.styleFrom(
                  foregroundColor: const Color(0xFFA78BFA),
                  side: const BorderSide(color: Color(0xFFA78BFA)),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                ),
                icon: const Icon(Icons.tune_rounded, size: 16),
                label: const Text('Editar Parâmetros'),
                onPressed: () => _editarParametros(integracao),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Text(
                integracao['category'] == 'PAYMENT_GATEWAY' &&
                        integracao['environment'] == 'PRODUCTION'
                    ? 'Status na Central (LIVE segue bloqueado):'
                    : 'Habilitado na Central:',
                style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12),
              ),
              const Spacer(),
              Switch(
                value: isAtivo,
                activeColor: const Color(0xFF10B981),
                onChanged: (val) {
                  _alterarStatus(integracao, val ? 'ACTIVE' : 'DISABLED');
                },
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildMetaRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        children: [
          Text(label, style: const TextStyle(color: Color(0xFF64748B), fontSize: 12)),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(
                color: Color(0xFFE2E8F0),
                fontSize: 12,
                fontWeight: FontWeight.w500,
              ),
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStatusBadge(String status) {
    Color bg;
    Color fg;
    String label = status;

    switch (status) {
      case 'ACTIVE':
        bg = const Color(0xFF10B981).withOpacity(0.2);
        fg = const Color(0xFF10B981);
        label = 'ATIVO';
        break;
      case 'TESTING':
        bg = const Color(0xFF38BDF8).withOpacity(0.2);
        fg = const Color(0xFF38BDF8);
        label = 'EM TESTE';
        break;
      case 'REVOKED':
        bg = Colors.redAccent.withOpacity(0.2);
        fg = Colors.redAccent;
        label = 'REVOGADO';
        break;
      case 'SHARED_AVAILABLE':
        bg = const Color(0xFF38BDF8).withOpacity(0.2);
        fg = const Color(0xFF38BDF8);
        label = 'COMPARTILHADO ATIVO';
        break;
      case 'NOT_CONFIGURED':
        bg = const Color(0xFF64748B).withOpacity(0.2);
        fg = const Color(0xFF94A3B8);
        label = 'SEM CADASTRO';
        break;
      default:
        bg = const Color(0xFF64748B).withOpacity(0.2);
        fg = const Color(0xFF94A3B8);
        label = 'DESATIVADO';
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(label, style: TextStyle(color: fg, fontSize: 11, fontWeight: FontWeight.bold)),
    );
  }

  Widget _getCategoryIcon(String cat) {
    switch (cat) {
      case 'AI_RESEARCH':
        return const Icon(Icons.psychology_rounded, color: Color(0xFF818CF8), size: 26);
      case 'PAYMENT_GATEWAY':
        return const Icon(Icons.account_balance_rounded, color: Color(0xFF38BDF8), size: 26);
      case 'MESSAGING':
        return const Icon(Icons.chat_rounded, color: Color(0xFF34D399), size: 26);
      case 'GEO_LOCATION':
        return const Icon(Icons.map_rounded, color: Color(0xFFFBBF24), size: 26);
      default:
        return const Icon(Icons.extension_rounded, color: Color(0xFF94A3B8), size: 26);
    }
  }

  // ── Tab 2: Homologação Asaas Sandbox ───────────────────────────────────────

  Widget _buildHomologacaoTab() {
    final homologSafety = _liveReadinessReport?['homologationTargetSafety'] as Map?;
    final bool homologAllowedHere = homologSafety?['safe'] == true;
    final String guardReason = homologSafety?['reason']?.toString() ??
        'Este aplicativo está conectado ao servidor operacional. Mutações de homologação são executadas apenas no ambiente isolado de homologação.';
    final sbSummary = _liveReadinessReport?['companySandboxSummary'] as Map?;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: const Color(0xFF1E293B),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: const Color(0xFF38BDF8).withOpacity(0.4)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Row(
                children: [
                  Icon(Icons.science_rounded, color: Color(0xFF38BDF8)),
                  SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Situação e Homologação Asaas Sandbox',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 16,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              const Text(
                'Jornada oficial: Cliente Fictício → Cobrança Vinculada → Pagamento no Sandbox → Webhook Real em /api/credit/webhooks/asaas → Amortização/Comissão → Replay HTTP, Concorrência e Reinício.',
                style: TextStyle(color: Color(0xFF94A3B8), fontSize: 12),
              ),
              if (sbSummary != null) ...[
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: const Color(0xFF0F172A),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: const Color(0xFF334155)),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _buildMetaRow('Cadastro Sandbox:', sbSummary['status']?.toString() ?? 'NOT_CONFIGURED'),
                      _buildMetaRow(
                        'Chave Sandbox:',
                        sbSummary['hasApiKey'] == true ? 'Configurada no Vault' : 'Pendente',
                      ),
                      _buildMetaRow(
                        'Segredo Webhook:',
                        sbSummary['hasWebhookToken'] == true
                            ? (sbSummary['webhookMasked']?.toString() ?? 'Configurado')
                            : 'Pendente',
                      ),
                    ],
                  ),
                ),
              ],
              if (!homologAllowedHere) ...[
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: const Color(0xFFF59E0B).withOpacity(0.15),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: const Color(0xFFF59E0B).withOpacity(0.45)),
                  ),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Icon(Icons.shield_outlined, color: Color(0xFFFBBF24), size: 18),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          '$guardReason\nPara rodar escritas de homologação, utilize o ambiente/CLI de homologação isolado.',
                          style: const TextStyle(color: Color(0xFFFBBF24), fontSize: 11),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
              const SizedBox(height: 14),
              Wrap(
                spacing: 10,
                runSpacing: 10,
                children: [
                  ElevatedButton.icon(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF0284C7),
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                    icon: const Icon(Icons.manage_search_rounded, color: Colors.white),
                    label: const Text(
                      'Consultar Situação e Prontidão',
                      style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
                    ),
                    onPressed: _consultarSituacaoProntidao,
                  ),
                  if (homologAllowedHere)
                    ElevatedButton.icon(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF0F766E),
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                      ),
                      icon: const Icon(Icons.play_arrow_rounded, color: Colors.white),
                      label: const Text(
                        'Executar Roteiro Sandbox (Homologação)',
                        style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
                      ),
                      onPressed: _executarHomologacaoSandbox,
                    ),
                ],
              ),
            ],
          ),
        ),
        if (_harnessReport != null) ...[
          const SizedBox(height: 16),
          _buildReportCard(_harnessReport!),
        ],
        const SizedBox(height: 16),
        _buildReadinessCard(),
      ],
    );
  }

  Widget _buildReportCard(Map<String, dynamic> report) {
    final steps = (report['steps'] as List? ?? []);
    final String overall = report['overallStatus'] ?? '';
    final String env = report['environment'] ?? 'SANDBOX';
    final bool isSimulation = env == 'SIMULATION_TEST';
    final bool officialHomologated = report['readinessForLive']?['sandboxHomologated'] == true;
    final bool isBlocked = overall.startsWith('BLOCKED_');
    final bool isPending = overall == 'PENDING_PROVIDER_WEBHOOK';

    Color themeColor = Colors.redAccent;
    IconData statusIcon = Icons.warning_rounded;

    if (overall == 'PASSED' && officialHomologated && !isSimulation) {
      themeColor = const Color(0xFF10B981);
      statusIcon = Icons.check_circle_rounded;
    } else if (isBlocked || isPending || (overall == 'PASSED' && isSimulation)) {
      themeColor = const Color(0xFFF59E0B);
      statusIcon = isPending ? Icons.hourglass_top_rounded : Icons.pending_actions_rounded;
    }

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF1E293B),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: themeColor, width: 1.5),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(statusIcon, color: themeColor),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Estado: [$overall] — ${isSimulation ? 'SIMULAÇÃO LOCAL (Não Homologa)' : 'EXECUÇÃO SANDBOX OFICIAL'}',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 14,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ],
          ),
          if (isBlocked) ...[
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
              decoration: BoxDecoration(
                color: const Color(0xFFF59E0B).withOpacity(0.15),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: const Color(0xFFF59E0B).withOpacity(0.4)),
              ),
              child: Row(
                children: [
                  const Icon(Icons.info_outline_rounded, color: Color(0xFFFBBF24), size: 18),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Pendência / Instrução: ${report['steps']?[0]?['details'] ?? 'Configure as credenciais ou utilize o ambiente de homologação autorizado.'}',
                      style: const TextStyle(color: Color(0xFFFBBF24), fontSize: 11),
                    ),
                  ),
                ],
              ),
            ),
          ] else if (isPending) ...[
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
              decoration: BoxDecoration(
                color: const Color(0xFF38BDF8).withOpacity(0.15),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: const Color(0xFF38BDF8).withOpacity(0.4)),
              ),
              child: const Row(
                children: [
                  Icon(Icons.hourglass_top_rounded, color: Color(0xFF38BDF8), size: 18),
                  SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Aguardando Webhook do Provedor: A cobrança foi emitida no Asaas Sandbox, mas a homologação oficial permanece pendente até a recepção, vínculo e baixa persistida do webhook real.',
                      style: TextStyle(color: Color(0xFF38BDF8), fontSize: 11),
                    ),
                  ),
                ],
              ),
            ),
          ] else if (isSimulation) ...[
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              decoration: BoxDecoration(
                color: const Color(0xFFF59E0B).withOpacity(0.15),
                borderRadius: BorderRadius.circular(6),
                border: Border.all(color: const Color(0xFFF59E0B).withOpacity(0.4)),
              ),
              child: const Text(
                'Identificação de Simulação: Valida a esteira interna isolada, mas NUNCA concede homologação externa (sandboxHomologated: false).',
                style: TextStyle(color: Color(0xFFFBBF24), fontSize: 11),
              ),
            ),
          ],
          const SizedBox(height: 12),
          ...steps.map((st) {
            final String stStatus = st['status']?.toString() ?? 'FAILED';
            IconData icon = Icons.error_outline;
            Color iconColor = Colors.redAccent;
            if (stStatus == 'SUCCESS') {
              icon = Icons.check_circle_outline;
              iconColor = const Color(0xFF10B981);
            } else if (stStatus == 'PENDING') {
              icon = Icons.hourglass_top_rounded;
              iconColor = const Color(0xFF38BDF8);
            } else if (stStatus == 'BLOCKED' || stStatus == 'SKIPPED') {
              icon = Icons.info_outline_rounded;
              iconColor = const Color(0xFFF59E0B);
            }

            return Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(icon, color: iconColor, size: 16),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Etapa ${st['step']}: ${st['name']}',
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        Text(
                          st['details'] ?? '',
                          style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 11),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            );
          }),
        ],
      ),
    );
  }

  Widget _buildReadinessCard() {
    final sbSummary = _liveReadinessReport?['companySandboxSummary'] as Map?;
    final bool hasOfficialWebhookEvidence = sbSummary?['lastOfficialWebhookEvidence'] != null;
    final bool officialHomologated = hasOfficialWebhookEvidence ||
        (_harnessReport != null &&
            _harnessReport!['readinessForLive']?['sandboxHomologated'] == true);
    final bool wasSimulated =
        _harnessReport != null && _harnessReport!['environment'] == 'SIMULATION_TEST';
    final bool safetyLocked = _liveReadinessReport?['productionSafetyLocked'] ?? true;
    final String safetySummary = _liveReadinessReport?['summary']?.toString() ??
        'Modo LIVE permanece rigorosamente DISABLED. A ativação dependerá de autorização explícita posterior.';

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF1E293B),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.checklist_rounded, color: Color(0xFFF59E0B)),
              SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Checklist de Prontidão para Entrada Futura em LIVE',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 15,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          _buildCheckItem('Homologação Externa Oficial no Asaas Sandbox', officialHomologated),
          if (wasSimulated && !officialHomologated)
            const Padding(
              padding: EdgeInsets.only(left: 24, bottom: 6),
              child: Text(
                '↳ Simulação local executada; homologação externa depende de retorno real do Asaas Sandbox.',
                style: TextStyle(
                  color: Color(0xFFFBBF24),
                  fontSize: 11,
                  fontStyle: FontStyle.italic,
                ),
              ),
            ),
          _buildCheckItem('Armazenamento em Vault Criptografado (AES-256-GCM)', true),
          _buildCheckItem('Isolamento Multi-Tenant e Zero Fallback Silencioso', true),
          _buildCheckItem('Guarda Dinâmica de Produção LIVE (Safety Lock)', safetyLocked),
          _buildCheckItem('Proteção do Banco Operacional contra Escritas de Teste', true),
          _buildCheckItem('Autenticação Reforçada (Step-Up Auth) e Auditoria', true),
          _buildCheckItem('Aprovação Cadastral no Portal Asaas (Proprietário)', false),
          _buildCheckItem('Definição Contratual: Contas Próprias vs Subcontas', false),
          _buildCheckItem('WhatsApp Business Oficial Onboarding (Proprietário)', false),
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: const Color(0xFF0F172A),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Row(
              children: [
                Icon(
                  safetyLocked ? Icons.lock_rounded : Icons.lock_open_rounded,
                  color: safetyLocked ? const Color(0xFF10B981) : const Color(0xFFF59E0B),
                  size: 16,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    safetySummary,
                    style: TextStyle(
                      color: safetyLocked ? const Color(0xFF10B981) : const Color(0xFFF59E0B),
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCheckItem(String label, bool ok) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        children: [
          Icon(
            ok ? Icons.check_circle_rounded : Icons.pending_actions_rounded,
            color: ok ? const Color(0xFF10B981) : const Color(0xFFF59E0B),
            size: 16,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              label,
              style: TextStyle(
                color: ok ? Colors.white : const Color(0xFF94A3B8),
                fontSize: 12,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ControllerDisposer extends StatefulWidget {
  final List<TextEditingController> controllers;
  final Widget child;

  const _ControllerDisposer({
    required this.controllers,
    required this.child,
  });

  @override
  State<_ControllerDisposer> createState() => _ControllerDisposerState();
}

class _ControllerDisposerState extends State<_ControllerDisposer> {
  @override
  void dispose() {
    for (final c in widget.controllers) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
