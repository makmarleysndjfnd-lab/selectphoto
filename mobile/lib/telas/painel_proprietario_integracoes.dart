import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../servicos/servico_api.dart';

class PainelProprietarioIntegracoes extends StatefulWidget {
  final Map<String, dynamic>? initialCompany;

  const PainelProprietarioIntegracoes({super.key, this.initialCompany});

  @override
  State<PainelProprietarioIntegracoes> createState() =>
      _PainelProprietarioIntegracoesState();
}

class _PainelProprietarioIntegracoesState
    extends State<PainelProprietarioIntegracoes>
    with SingleTickerProviderStateMixin {
  final ApiService _api = ApiService();
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

  Future<void> _inicializarDados() async {
    setState(() => _carregando = true);
    try {
      final empresas = await _api.getOwnerCompanies();
      final cats = await _api.getIntegrationCatalogs();
      final readiness = await _api.getAsaasLiveReadinessReport();

      setState(() {
        _empresas = empresas;
        _catalogos = cats;
        _liveReadinessReport = readiness;
        if (_empresaSelecionada == null && empresas.isNotEmpty) {
          _empresaSelecionada = empresas.first;
        }
      });

      if (_empresaSelecionada != null) {
        await _carregarIntegracoesEmpresa(_empresaSelecionada!['id']);
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
      if (mounted) {
        setState(() {
          _integracoes = list;
        });
      }
    } catch (e) {
      _mostrarErro('Erro ao carregar integrações da empresa: $e');
    }
  }

  Future<bool> _garantirStepUpAuth(String acaoDescricao) async {
    if (_temStepUpAtivo) return true;

    final senhaController = TextEditingController();
    final formKey = GlobalKey<FormState>();

    final result = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1E293B),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Row(
          children: const [
            Icon(Icons.security_rounded, color: Color(0xFF38BDF8)),
            SizedBox(width: 8),
            Text('Autenticação Reforçada',
                style: TextStyle(color: Colors.white, fontSize: 18)),
          ],
        ),
        content: Form(
          key: formKey,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Esta ação sensível ($acaoDescricao) exige confirmação com sua senha de proprietário para desbloqueio do Vault.',
                style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 13),
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: senhaController,
                obscureText: true,
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
                  final resp = await _api.ownerStepUpAuth(senhaController.text);
                  _stepUpToken = resp['token'];
                  _stepUpExpiresAt = DateTime.parse(resp['expiresAt']);
                  if (mounted) Navigator.pop(ctx, true);
                } catch (e) {
                  _mostrarErro('Falha na autenticação: $e');
                }
              }
            },
            child: const Text('Confirmar', style: TextStyle(color: Colors.white)),
          ),
        ],
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
      final String msg = res['message'] ?? (success ? 'Sucesso' : 'Falha');

      if (mounted) {
        showDialog(
          context: context,
          builder: (ctx) => AlertDialog(
            backgroundColor: const Color(0xFF1E293B),
            title: Row(
              children: [
                Icon(
                  success ? Icons.check_circle_rounded : Icons.error_rounded,
                  color: success ? const Color(0xFF10B981) : Colors.redAccent,
                ),
                const SizedBox(width: 8),
                Text(
                  success ? 'Conexão Estabelecida' : 'Falha no Teste',
                  style: const TextStyle(color: Colors.white, fontSize: 18),
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
                  'Provedor: ${integracao['provider']}',
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
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1E293B),
        title: const Text('Atualizar Chave Criptografada',
            style: TextStyle(color: Colors.white, fontSize: 18)),
        content: Form(
          key: formKey,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'A nova chave será criptografada no Vault (AES-256-GCM) antes de ser gravada. O valor nunca será exibido integralmente.',
                style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12),
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: chaveController,
                obscureText: true,
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
    );

    if (confirmou == true) {
      setState(() => _carregando = true);
      try {
        await _api.rotateIntegrationCredentials(
          integracao['id'],
          chaveController.text.trim(),
          reason: motivoController.text.trim(),
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
      await _api.updateIntegrationStatus(
        integracao['id'],
        novoStatus,
        reason: 'Alterado pelo proprietário no app',
        stepUpToken: _stepUpToken,
      );
      _mostrarSucesso('Status alterado para $novoStatus.');
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
      final bool homologated = report['readinessForLive']?['sandboxHomologated'] == true;
      if (homologated) {
        _mostrarSucesso('Homologação oficial externa no Asaas Sandbox aprovada com sucesso.');
      } else {
        _mostrarAlerta('Roteiro executado. Homologação oficial externa pendente de credenciais ou validação no portal.');
      }
    } catch (e) {
      _mostrarErro('Falha ao rodar homologação: $e');
    } finally {
      if (mounted) setState(() => _carregando = false);
    }
  }

  // ── Widgets de Construção Visual ──────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
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
                const Icon(Icons.shield_rounded, color: Color(0xFF10B981), size: 13),
                const SizedBox(width: 4),
                const Text(
                  'Asaas LIVE: DISABLED (Bloqueio Rigoroso)',
                  style: TextStyle(color: Color(0xFF10B981), fontSize: 11, fontWeight: FontWeight.bold),
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
                    setState(() => _empresaSelecionada = sel);
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
              child: Row(
                children: const [
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
    final integracao = _integracoes.firstWhere(
      (i) => i['category'] == categoryCode,
      orElse: () => {},
    );

    final bool configurada = integracao.isNotEmpty;
    final String status = configurada ? integracao['status'] ?? 'DISABLED' : 'DISABLED';
    final bool isAtivo = status == 'ACTIVE';

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      decoration: BoxDecoration(
        color: const Color(0xFF1E293B),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: isAtivo ? const Color(0xFF0284C7).withOpacity(0.5) : const Color(0xFF334155),
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
                _buildStatusBadge(status),
              ],
            ),
            const SizedBox(height: 10),
            Text(
              cat['description'] ?? '',
              style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12),
            ),
            const Divider(color: Color(0xFF334155), height: 24),
            if (configurada) ...[
              _buildMetaRow('Escopo:', integracao['scope'] ?? 'N/A'),
              _buildMetaRow('Chave no Cofre:', integracao['secretMasked'] ?? '••••••••'),
              _buildMetaRow('Origem do Segredo:', integracao['credentialSource'] ?? 'VAULT_ENCRYPTED'),
              _buildMetaRow('Versão:', 'v${integracao['version'] ?? 1}'),
              if (integracao['lastValidatedAt'] != null)
                _buildMetaRow(
                  'Última Validação:',
                  '${_dateFormat.format(DateTime.parse(integracao['lastValidatedAt']))} (${integracao['lastValidationStatus'] ?? 'PENDING'})',
                ),
              const SizedBox(height: 14),
              Row(
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
                  const SizedBox(width: 8),
                  OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                      foregroundColor: const Color(0xFFF59E0B),
                      side: const BorderSide(color: Color(0xFFF59E0B)),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                    ),
                    icon: const Icon(Icons.key_rounded, size: 16),
                    label: const Text('Rotacionar'),
                    onPressed: () => _rotacionarCredencial(integracao),
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
            ] else ...[
              Row(
                children: [
                  const Icon(Icons.info_outline, color: Color(0xFF94A3B8), size: 14),
                  const SizedBox(width: 6),
                  Text(
                    cat['defaultScope'] == 'PLATFORM_SHARED'
                        ? 'Serviço compartilhado ativo na plataforma'
                        : 'Configuração exclusiva pendente para esta empresa',
                    style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12),
                  ),
                ],
              ),
            ],
          ],
        ),
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
              style: const TextStyle(color: Color(0xFFE2E8F0), fontSize: 12, fontWeight: FontWeight.w500),
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
              Row(
                children: const [
                  Icon(Icons.science_rounded, color: Color(0xFF38BDF8)),
                  SizedBox(width: 8),
                  Text(
                    'Roteiro de Homologação Sandbox Oficial',
                    style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              const Text(
                'Executa o fluxo completo de teste isolado no Asaas Sandbox: Cliente Fictício → Cobrança PIX/Boleto → Simulação de Pagamento → Webhook Autenticado → Idempotência → Casos Adversos.',
                style: TextStyle(color: Color(0xFF94A3B8), fontSize: 12),
              ),
              const SizedBox(height: 14),
              ElevatedButton.icon(
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF0284C7),
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                ),
                icon: const Icon(Icons.play_arrow_rounded, color: Colors.white),
                label: const Text('Executar Roteiro Sandbox Agora',
                    style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                onPressed: _executarHomologacaoSandbox,
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
    final bool passed = report['overallStatus'] == 'PASSED';
    final String env = report['environment'] ?? 'SANDBOX';
    final bool isSimulation = env == 'SIMULATION_TEST';

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF1E293B),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: passed ? const Color(0xFF10B981) : Colors.redAccent,
          width: 1.5,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                passed ? Icons.check_circle_rounded : Icons.warning_rounded,
                color: passed ? const Color(0xFF10B981) : Colors.redAccent,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Resultado: [${report['overallStatus']}] — ${isSimulation ? 'SIMULAÇÃO LOCAL CONTROLADA' : 'EXECUÇÃO OFICIAL SANDBOX'}',
                  style: const TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.bold),
                ),
              ),
            ],
          ),
          if (isSimulation) ...[
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              decoration: BoxDecoration(
                color: const Color(0xFFF59E0B).withOpacity(0.15),
                borderRadius: BorderRadius.circular(6),
                border: Border.all(color: const Color(0xFFF59E0B).withOpacity(0.4)),
              ),
              child: const Text(
                'Nota de Integridade: Esta execução foi simulada em ambiente controlado local. Ela valida cenários internos, mas mantém sandboxHomologated: false até que credenciais oficiais sejam validadas diretamente contra o Asaas.',
                style: TextStyle(color: Color(0xFFFBBF24), fontSize: 11),
              ),
            ),
          ],
          const SizedBox(height: 12),
          ...steps.map((st) {
            final bool stepOk = st['status'] == 'SUCCESS';
            return Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    stepOk ? Icons.check_circle_outline : Icons.error_outline,
                    color: stepOk ? const Color(0xFF10B981) : Colors.redAccent,
                    size: 16,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Etapa ${st['step']}: ${st['name']}',
                          style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w600),
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
    final bool officialHomologated =
        _harnessReport != null && _harnessReport!['readinessForLive']?['sandboxHomologated'] == true;
    final bool wasSimulated =
        _harnessReport != null && _harnessReport!['environment'] == 'SIMULATION_TEST';

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF1E293B),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: const [
              Icon(Icons.checklist_rounded, color: Color(0xFFF59E0B)),
              SizedBox(width: 8),
              Text(
                'Checklist de Prontidão para Entrada Futura em LIVE',
                style: TextStyle(color: Colors.white, fontSize: 15, fontWeight: FontWeight.bold),
              ),
            ],
          ),
          const SizedBox(height: 12),
          _buildCheckItem('Homologação Externa Oficial no Asaas Sandbox', officialHomologated),
          if (wasSimulated && !officialHomologated)
            const Padding(
              padding: EdgeInsets.only(left: 24, bottom: 6),
              child: Text(
                '↳ Cenários simulados com sucesso. Homologação oficial no provedor pendente de credenciais.',
                style: TextStyle(color: Color(0xFFFBBF24), fontSize: 11, fontStyle: FontStyle.italic),
              ),
            ),
          _buildCheckItem('Armazenamento em Vault Criptografado (AES-256-GCM)', true),
          _buildCheckItem('Isolamento Multi-Tenant e Anti-Fallback', true),
          _buildCheckItem('Proteção contra SSRF e Bloqueio de IPs Privados', true),
          _buildCheckItem('Métricas de API sem PII e Orçamento Interno', true),
          _buildCheckItem('Autenticação Reforçada (Step-Up Auth)', true),
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
              children: const [
                Icon(Icons.lock_rounded, color: Color(0xFF10B981), size: 16),
                SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Modo LIVE permanece rigorosamente DISABLED. A ativação real dependerá de autorização explícita posterior.',
                    style: TextStyle(color: Color(0xFF10B981), fontSize: 11, fontWeight: FontWeight.bold),
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
