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
      final empresas = await _api.getOwnerCompanies();
      final cats = await _api.getIntegrationCatalogs();
      final selected = _empresaSelecionada ??
          (empresas.isNotEmpty ? empresas.first : null);
      final readiness = await _api.getAsaasLiveReadinessReport(
        companyId: selected?['id']?.toString(),
      );

      setState(() {
        _empresas = empresas;
        _catalogos = cats;
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
      final list = await _api.getCompanyIntegrations(companyId);
      final readiness = await _api.getAsaasLiveReadinessReport(companyId: companyId);
      if (mounted) {
        setState(() {
          _integracoes = list;
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
                    _stepUpToken = resp['token'];
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
      text: '${_empresaSelecionada!['name']} - $provedorSelecionado',
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
                          'Empresa: ${_empresaSelecionada!['name']}',
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
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
          'companyId': _empresaSelecionada!['id'],
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
        if (_empresaSelecionada != null) {
          await _carregarIntegracoesEmpresa(_empresaSelecionada!['id']);
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
                  return DropdownMenuItem<String>(
                    value: e['id'],
                    child: Text(e['name'] ?? 'Sem Nome'),
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
        ..._catalogos.map((cat) => _buildCategoriaCard(cat)),
      ],
    );
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
                if (!configurada) _buildStatusBadge('DISABLED'),
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
              const Spacer(),
              _buildStatusBadge(status),
            ],
          ),
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
          const SizedBox(height: 12),
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
