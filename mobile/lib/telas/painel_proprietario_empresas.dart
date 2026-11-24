import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../servicos/servico_api.dart';
import 'painel_proprietario_integracoes.dart';
import 'painel_proprietario_faturamento.dart';
import 'painel_proprietario_suporte.dart';
import 'painel_admin.dart';
import 'tela_config_busca_eventos_ia.dart';
import 'tela_login.dart';

class PainelProprietarioEmpresas extends StatefulWidget {
  const PainelProprietarioEmpresas({super.key});

  @override
  State<PainelProprietarioEmpresas> createState() => _PainelProprietarioEmpresasState();
}

class _PainelProprietarioEmpresasState extends State<PainelProprietarioEmpresas>
    with SingleTickerProviderStateMixin {
  final ApiService _api = ApiService();
  late TabController _tabController;

  bool _carregando = false;
  String? _stepUpToken;
  DateTime? _stepUpExpiresAt;

  List<Map<String, dynamic>> _empresas = [];
  List<Map<String, dynamic>> _logsAuditoria = [];
  Map<String, dynamic>? _perfilProprietario;

  String _filtroClassificacao = 'OPERATIONAL'; // 'OPERATIONAL', 'TEST_DEMO', 'ALL'
  String _filtroStatus = 'ALL';
  bool _ocultarTestesAuditoria = true;
  final TextEditingController _buscaController = TextEditingController();

  final DateFormat _dateFormat = DateFormat('dd/MM/yyyy');
  final DateFormat _dateTimeFormat = DateFormat('dd/MM/yyyy HH:mm');

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
    _tabController.addListener(() {
      if (mounted) setState(() {});
    });
    _carregarDados();
  }

  @override
  void dispose() {
    _tabController.dispose();
    _buscaController.dispose();
    super.dispose();
  }

  bool get _temStepUpAtivo =>
      _stepUpToken != null &&
      _stepUpExpiresAt != null &&
      _stepUpExpiresAt!.isAfter(DateTime.now());

  Future<void> _carregarDados() async {
    setState(() => _carregando = true);
    try {
      final perfil = await _api.getOwnerProfile();
      final empresas = await _api.getOwnerCompanies(
        status: _filtroStatus,
        search: _buscaController.text,
        classification: _filtroClassificacao,
      );
      final logs = await _api.getOwnerAuditLogs(
        limit: 50,
        excludeTestExamples: _ocultarTestesAuditoria,
      );

      setState(() {
        _perfilProprietario = perfil;
        _empresas = empresas;
        _logsAuditoria = logs;
      });
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Erro ao carregar dados: $e'),
            backgroundColor: Colors.redAccent,
          ),
        );
      }
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
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1E293B),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Row(
          children: const [
            Icon(Icons.security_rounded, color: Color(0xFF38BDF8)),
            SizedBox(width: 8),
            Expanded(
              child: Text('Autenticação Reforçada', style: TextStyle(color: Colors.white, fontSize: 18)),
            ),
          ],
        ),
        content: Form(
          key: formKey,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Esta ação sensível ($acaoDescricao) exige confirmação com sua senha mestre de proprietário.',
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
                    (val == null || val.isEmpty) ? 'Informe sua senha' : null,
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancelar', style: TextStyle(color: Color(0xFF94A3B8))),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFF38BDF8),
              foregroundColor: const Color(0xFF0F172A),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            ),
            onPressed: () async {
              if (formKey.currentState?.validate() ?? false) {
                try {
                  final resp = await _api.ownerStepUpAuth(
                    senhaController.text.trim(),
                    reason: acaoDescricao,
                  );
                  _stepUpToken = resp['stepUpToken'];
                  if (resp['expiresAt'] != null) {
                    _stepUpExpiresAt = DateTime.parse(resp['expiresAt']);
                  }
                  if (mounted) Navigator.of(ctx).pop(true);
                } catch (err) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text('Falha na reautenticação: $err'), backgroundColor: Colors.redAccent),
                  );
                }
              }
            },
            child: const Text('Confirmar Senha'),
          ),
        ],
      ),
    );

    return result ?? false;
  }

  // ── Logout Seguro e Desconexão de Sessão do Proprietário ─────────────────

  Future<void> _confirmarESair() async {
    final confirmar = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1E293B),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Row(
          children: const [
            Icon(Icons.logout_rounded, color: Colors.redAccent),
            SizedBox(width: 8),
            Expanded(
              child: Text('Sair da Conta', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
            ),
          ],
        ),
        content: const Text(
          'Deseja realmente sair da Central do Proprietário?\n\nAs credenciais de acesso desta sessão serão removidas com segurança deste dispositivo.\n\n(O banco offline e as fichas locais são preservados integralmente).',
          style: TextStyle(color: Color(0xFF94A3B8), fontSize: 13),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancelar', style: TextStyle(color: Color(0xFF94A3B8))),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: Colors.redAccent, foregroundColor: Colors.white),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Sair da Conta'),
          ),
        ],
      ),
    );

    if (confirmar != true || !mounted) return;

    // 1. Tentar revogar sessão reforçada no servidor (com fail-safe se offline)
    if (_stepUpToken != null) {
      try {
        await _api.ownerRevokeStepUp(stepUpToken: _stepUpToken);
      } catch (e) {
        debugPrint('Aviso: falha de rede ao revogar step-up no backend: $e');
      }
    }

    // 2. Limpar token em memória no cliente
    _api.clearToken();

    // 3. Limpar chaves da sessão persistida em SharedPreferences
    // NOTA DE SEGURANÇA: Não executar prefs.clear() para preservar banco offline e fichas
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove('jwt_token');
      await prefs.remove('user_role');
      await prefs.remove('user_id');
      await prefs.remove('user_name');
      await prefs.remove('company_id');
      await prefs.remove('company_name');
      await prefs.remove('owner_session');
    } catch (e) {
      debugPrint('Aviso ao remover credenciais locais: $e');
    }

    // 4. Voltar ao Login removendo todas as telas da pilha
    if (mounted) {
      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute(builder: (_) => const LoginScreen()),
        (route) => false,
      );
    }
  }

  // ── Modal de Configuração de Taxa da Plataforma ───────────────────────────

  void _abrirModalConfigurarTaxa(Map<String, dynamic> empresa) async {
    final authed = await _garantirStepUpAuth('Configuração de Taxa Lumora para ${empresa['name']}');
    if (!authed || !mounted) return;

    final taxaController = TextEditingController(
      text: empresa['currentRate'] != null
          ? (empresa['currentRate']['ratePercentage'] as num).toString()
          : '2.50',
    );
    final motivoController = TextEditingController();
    DateTime dataInicio = DateTime.now();

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          backgroundColor: const Color(0xFF1E293B),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          title: Text(
            'Remuneração Lumora — ${empresa['name']}',
            style: const TextStyle(color: Colors.white, fontSize: 18),
          ),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'A remuneração da plataforma é um percentual configurável por empresa com vigência e histórico contratual. 2,5% é apenas um exemplo de referência. Zero significa gratuidade contratada.',
                  style: TextStyle(color: Color(0xFF94A3B8), fontSize: 12),
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: taxaController,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold),
                  decoration: InputDecoration(
                    labelText: 'Percentual da Taxa Lumora (%)',
                    labelStyle: const TextStyle(color: Color(0xFF94A3B8)),
                    suffixText: '%',
                    suffixStyle: const TextStyle(color: Color(0xFF38BDF8), fontWeight: FontWeight.bold),
                    filled: true,
                    fillColor: const Color(0xFF0F172A),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                ),
                const SizedBox(height: 12),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Início da Vigência', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 13)),
                  subtitle: Text(
                    _dateFormat.format(dataInicio),
                    style: const TextStyle(color: Colors.white, fontSize: 15, fontWeight: FontWeight.w600),
                  ),
                  trailing: IconButton(
                    icon: const Icon(Icons.calendar_month_rounded, color: Color(0xFF38BDF8)),
                    onPressed: () async {
                      final picked = await showDatePicker(
                        context: context,
                        initialDate: dataInicio,
                        firstDate: DateTime(2020),
                        lastDate: DateTime(2035),
                      );
                      if (picked != null) {
                        setDialogState(() => dataInicio = picked);
                      }
                    },
                  ),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: motivoController,
                  maxLines: 2,
                  style: const TextStyle(color: Colors.white, fontSize: 13),
                  decoration: InputDecoration(
                    labelText: 'Justificativa Contratual *',
                    labelStyle: const TextStyle(color: Color(0xFF94A3B8)),
                    hintText: 'Ex: Contrato de prestação de serviços renovado com reajuste',
                    hintStyle: const TextStyle(color: Color(0xFF64748B), fontSize: 12),
                    filled: true,
                    fillColor: const Color(0xFF0F172A),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                ),
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: const Color(0xFF0F172A),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: const Color(0xFF334155)),
                  ),
                  child: const Text(
                    '⚠️ A alteração não retroage nem altera comissões de 20%/25% ou 10% dos vendedores.',
                    style: TextStyle(color: Color(0xFFFBBF24), fontSize: 11),
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
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF38BDF8),
                foregroundColor: const Color(0xFF0F172A),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
              ),
              onPressed: () async {
                final taxa = double.tryParse(taxaController.text.replaceAll(',', '.'));
                if (taxa == null || taxa < 0 || taxa > 100) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Taxa deve ser um valor numérico entre 0 e 100%')),
                  );
                  return;
                }
                if (motivoController.text.trim().length < 5) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Justificativa deve conter no mínimo 5 caracteres')),
                  );
                  return;
                }

                try {
                  await _api.setOwnerCompanyRate(
                    empresa['id'],
                    ratePercentage: taxa,
                    effectiveFrom: dataInicio,
                    reason: motivoController.text.trim(),
                    stepUpToken: _stepUpToken,
                  );
                  Navigator.of(ctx).pop();
                  _carregarDados();
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text('Taxa contratual de $taxa% gravada com sucesso para ${empresa['name']}!'),
                      backgroundColor: Colors.green,
                    ),
                  );
                } catch (e) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text('Erro ao gravar taxa: $e'), backgroundColor: Colors.redAccent),
                  );
                }
              },
              child: const Text('Gravar Contrato'),
            ),
          ],
        ),
      ),
    );
  }

  // ── Acesso de Suporte Auditado como Admin da Empresa ──────────────────────

  Future<void> _acessarComoAdminSuporte(Map<String, dynamic> empresa) async {
    final compId = empresa['id']?.toString() ?? '';
    if (compId.isEmpty) return;
    final compName = (empresa['tradeName']?.toString().trim().isNotEmpty == true)
        ? empresa['tradeName'].toString()
        : (empresa['name'] ?? 'Empresa').toString();

    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF160D24),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(color: const Color(0xFFA855F7).withOpacity(0.5)),
        ),
        title: const Row(
          children: [
            Icon(Icons.support_agent_rounded, color: Color(0xFFA855F7)),
            SizedBox(width: 8),
            Expanded(
              child: Text(
                'Acessar como Admin (Suporte)',
                style: TextStyle(color: Colors.white, fontSize: 16),
              ),
            ),
          ],
        ),
        content: Text(
          'Você entrará em modo suporte auditado na empresa "$compName" sem desconectar o administrador real.\n\nUma barra superior fixa permitirá voltar ao SuperAdmin a qualquer momento.',
          style: const TextStyle(color: Color(0xFFCBD5E1), fontSize: 13),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancelar', style: TextStyle(color: Color(0xFF94A3B8))),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFFA855F7),
              foregroundColor: Colors.white,
            ),
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Entrar como Suporte'),
          ),
        ],
      ),
    );

    if (confirm != true || !mounted) return;

    setState(() => _carregando = true);
    try {
      final res = await _api.startSuperAdminSupportLogin(
        compId,
        reason: 'Acesso técnico de suporte via SuperAdmin',
      );
      final supportToken = res['token']?.toString() ?? '';
      if (supportToken.isEmpty) {
        throw Exception('Token de suporte não retornado pelo servidor.');
      }

      final prefs = await SharedPreferences.getInstance();
      final prevToken = prefs.getString('jwt_token');
      final prevRole = prefs.getString('user_role');
      final prevUserId = prefs.getString('user_id');
      final prevUserName = prefs.getString('user_name');
      final prevCompanyId = prefs.getString('company_id');
      final prevCompanyName = prefs.getString('company_name');
      final prevOwnerSession = prefs.getString('owner_session');

      if (prevToken != null) {
        await prefs.setString('support_restore_token', prevToken);
      }
      if (prevRole != null) {
        await prefs.setString('support_restore_role', prevRole);
      }
      if (prevUserId != null) {
        await prefs.setString('support_restore_user_id', prevUserId);
      }
      if (prevUserName != null) {
        await prefs.setString('support_restore_user_name', prevUserName);
      }
      if (prevCompanyId != null) {
        await prefs.setString('support_restore_company_id', prevCompanyId);
      }
      if (prevCompanyName != null) {
        await prefs.setString('support_restore_company_name', prevCompanyName);
      }
      if (prevOwnerSession != null) {
        await prefs.setString('support_restore_owner_session', prevOwnerSession);
      }

      await prefs.setString('jwt_token', supportToken);
      await prefs.setString('user_role', 'ADMIN');
      await prefs.setString('user_name', '${prevUserName ?? 'SuperAdmin'} (Suporte)');
      await prefs.setString('company_id', compId);
      await prefs.setString('company_name', compName);
      await prefs.setBool('support_mode_active', true);
      await prefs.setString('support_mode_company_name', compName);

      _api.setToken(supportToken);
      _api.setCompanyDisplayName(compName);

      if (!mounted) return;
      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute(builder: (_) => const AdminDashboard()),
        (route) => false,
      );
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Falha ao iniciar modo suporte: $e'),
            backgroundColor: Colors.redAccent,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _carregando = false);
    }
  }

  // ── Modal de Suspensão / Reativação ───────────────────────────────────────

  void _abrirModalStatus(Map<String, dynamic> empresa) async {
    final currentCommercial =
        (empresa['commercialStatus'] ?? (empresa['status'] == 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE')).toString();
    final isSuspenso = currentCommercial == 'SUSPENDED' || empresa['status'] == 'SUSPENDED';
    String selectedStatus = isSuspenso ? 'ACTIVE' : 'SUSPENDED';

    final authed = await _garantirStepUpAuth('Governança Comercial de ${empresa['name']}');
    if (!authed || !mounted) return;

    final motivoController = TextEditingController(
      text: empresa['commercialStatusReason']?.toString() ?? '',
    );

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          backgroundColor: const Color(0xFF160D24),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
            side: BorderSide(color: const Color(0xFFA855F7).withOpacity(0.4)),
          ),
          title: Text(
            'Governança Comercial — ${empresa['name']}',
            style: const TextStyle(color: Colors.white, fontSize: 17),
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              DropdownButtonFormField<String>(
                value: selectedStatus,
                dropdownColor: const Color(0xFF160D24),
                style: const TextStyle(color: Colors.white, fontSize: 13),
                decoration: InputDecoration(
                  labelText: 'Situação Comercial',
                  labelStyle: const TextStyle(color: Color(0xFFD8B4FE)),
                  filled: true,
                  fillColor: const Color(0xFF0D0714),
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                ),
                items: const [
                  DropdownMenuItem(value: 'ACTIVE', child: Text('Ativa (Operação Normal)')),
                  DropdownMenuItem(value: 'WARNING', child: Text('Em Aviso (Banner no Admin)')),
                  DropdownMenuItem(value: 'SUSPENDED', child: Text('Suspensa (Bloqueia Login e App)')),
                ],
                onChanged: (val) {
                  if (val != null) setDialogState(() => selectedStatus = val);
                },
              ),
              const SizedBox(height: 14),
              TextField(
                controller: motivoController,
                maxLines: 2,
                style: const TextStyle(color: Colors.white, fontSize: 13),
                decoration: InputDecoration(
                  labelText: 'Motivo / Justificativa *',
                  labelStyle: const TextStyle(color: Color(0xFF94A3B8)),
                  hintText: 'Ex: Pendência financeira ou acordo regularizado',
                  hintStyle: const TextStyle(color: Color(0xFF64748B), fontSize: 12),
                  filled: true,
                  fillColor: const Color(0xFF0D0714),
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('Cancelar', style: TextStyle(color: Color(0xFF94A3B8))),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: selectedStatus == 'ACTIVE'
                    ? Colors.green
                    : selectedStatus == 'WARNING'
                        ? const Color(0xFFF59E0B)
                        : const Color(0xFFEF4444),
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
              ),
              onPressed: () async {
                if (motivoController.text.trim().length < 5) {
                  ScaffoldMessenger.of(this.context).showSnackBar(
                    const SnackBar(content: Text('Informe uma justificativa válida com no mínimo 5 caracteres')),
                  );
                  return;
                }

                try {
                  await _api.setOwnerCompanyStatus(
                    empresa['id'],
                    status: selectedStatus,
                    reason: motivoController.text.trim(),
                    stepUpToken: _stepUpToken,
                  );
                  if (ctx.mounted) Navigator.of(ctx).pop();
                  _carregarDados();
                  if (mounted) {
                    ScaffoldMessenger.of(this.context).showSnackBar(
                      SnackBar(
                        content: Text('Situação de ${empresa['name']} atualizada para $selectedStatus.'),
                        backgroundColor: Colors.green,
                      ),
                    );
                  }
                } catch (e) {
                  if (mounted) {
                    ScaffoldMessenger.of(this.context).showSnackBar(
                      SnackBar(content: Text('Erro ao atualizar status: $e'), backgroundColor: Colors.redAccent),
                    );
                  }
                }
              },
              child: const Text('Salvar Status'),
            ),
          ],
        ),
      ),
    );
  }

  // ── Modal de Detalhes da Empresa ──────────────────────────────────────────

  void _abrirDetalhesEmpresa(String empresaId) async {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF0F172A),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => FutureBuilder<Map<String, dynamic>>(
        future: _api.getOwnerCompanyDetails(empresaId),
        builder: (context, snapshot) {
          if (!snapshot.hasData) {
            return const SizedBox(
              height: 300,
              child: Center(child: CircularProgressIndicator(color: Color(0xFF38BDF8))),
            );
          }

          final c = snapshot.data!;
          final rates = (c['rateHistory'] as List?) ?? [];
          final usersByRole = (c['usersByRole'] as Map<String, dynamic>?) ?? {};

          return DraggableScrollableSheet(
            initialChildSize: 0.85,
            maxChildSize: 0.95,
            minChildSize: 0.5,
            expand: false,
            builder: (_, scrollController) => ListView(
              controller: scrollController,
              padding: const EdgeInsets.all(20),
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            (c['tradeName']?.toString().trim().isNotEmpty == true)
                                ? c['tradeName'].toString()
                                : (c['name'] ?? '').toString(),
                            style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold),
                          ),
                          if (c['tradeName']?.toString().trim().isNotEmpty == true && c['name'] != null)
                            Text('Identificação: ${c['name']}', style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12)),
                          if (c['legalName'] != null)
                            Text(c['legalName'], style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 13)),
                        ],
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.edit_rounded, color: Color(0xFFD8B4FE)),
                      tooltip: 'Editar Nome / Dados',
                      onPressed: () {
                        Navigator.of(ctx).pop();
                        _abrirModalEditarEmpresa(c);
                      },
                    ),
                    IconButton(
                      icon: const Icon(Icons.close_rounded, color: Colors.white70),
                      onPressed: () => Navigator.of(ctx).pop(),
                    ),
                  ],
                ),
                const SizedBox(height: 16),

                // Cartão de Contato Administrativo
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: const Color(0xFF1E293B),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: const Color(0xFF334155)),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Contato Administrativo', style: TextStyle(color: Color(0xFF38BDF8), fontSize: 13, fontWeight: FontWeight.bold)),
                      const SizedBox(height: 6),
                      Text('Responsável: ${c['adminContactName'] ?? "Não informado"}', style: const TextStyle(color: Colors.white, fontSize: 13)),
                      Text('E-mail: ${c['adminContactEmail'] ?? "Não informado"}', style: const TextStyle(color: Colors.white, fontSize: 13)),
                      Text('Telefone: ${c['adminContactPhone'] ?? "Não informado"}', style: const TextStyle(color: Colors.white, fontSize: 13)),
                      if (c['cnpj'] != null) Text('CNPJ: ${c['cnpj']}', style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12)),
                    ],
                  ),
                ),
                const SizedBox(height: 16),

                // Distribuição de Usuários
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: const Color(0xFF1E293B),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: const Color(0xFF334155)),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Usuários Ativos (${c['userCount'] ?? 0})', style: const TextStyle(color: Color(0xFF38BDF8), fontSize: 13, fontWeight: FontWeight.bold)),
                      const SizedBox(height: 8),
                      Wrap(
                        spacing: 8,
                        runSpacing: 6,
                        children: usersByRole.entries.map((e) => Chip(
                          backgroundColor: const Color(0xFF0F172A),
                          side: const BorderSide(color: Color(0xFF334155)),
                          label: Text('${e.key}: ${e.value}', style: const TextStyle(color: Colors.white, fontSize: 11)),
                        )).toList(),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),

                // Histórico de Vigências de Taxa
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Expanded(
                      child: Text('Histórico de Vigências da Taxa Lumora', style: TextStyle(color: Colors.white, fontSize: 15, fontWeight: FontWeight.bold)),
                    ),
                    TextButton.icon(
                      icon: const Icon(Icons.edit_note_rounded, size: 18, color: Color(0xFF38BDF8)),
                      label: const Text('Nova Vigência', style: TextStyle(color: Color(0xFF38BDF8), fontSize: 12)),
                      onPressed: () {
                        Navigator.of(ctx).pop();
                        _abrirModalConfigurarTaxa(c);
                      },
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                if (rates.isEmpty)
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(color: const Color(0xFF1E293B), borderRadius: BorderRadius.circular(12)),
                    child: const Text('Nenhuma taxa configurada para este contrato.', style: TextStyle(color: Color(0xFFFBBF24), fontSize: 13)),
                  )
                else
                  ...rates.map((r) => Container(
                    margin: const EdgeInsets.only(bottom: 8),
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: const Color(0xFF1E293B),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(
                        color: r['effectiveTo'] == null ? const Color(0xFF38BDF8).withOpacity(0.5) : const Color(0xFF334155),
                      ),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text(
                              'Versão ${r['version']} — ${r['ratePercentage']}%',
                              style: const TextStyle(color: Color(0xFF38BDF8), fontWeight: FontWeight.bold, fontSize: 14),
                            ),
                            if (r['effectiveTo'] == null)
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                decoration: BoxDecoration(color: Colors.green.withOpacity(0.2), borderRadius: BorderRadius.circular(6)),
                                child: const Text('Vigente Hoje', style: TextStyle(color: Colors.greenAccent, fontSize: 10, fontWeight: FontWeight.bold)),
                              ),
                          ],
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Início: ${_dateFormat.format(DateTime.parse(r['effectiveFrom']))} ${r['effectiveTo'] != null ? "• Término: ${_dateFormat.format(DateTime.parse(r['effectiveTo']))}" : "• Em aberto"}',
                          style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 11),
                        ),
                        if (r['reason'] != null)
                          Text('Motivo: ${r['reason']}', style: const TextStyle(color: Colors.white70, fontSize: 12)),
                        if (r['createdByName'] != null)
                          Text('Autor: ${r['createdByName']}', style: const TextStyle(color: Color(0xFF64748B), fontSize: 11)),
                      ],
                    ),
                  )),
              ],
            ),
          );
        },
      ),
    );
  }

  // ── Modal de Cadastro de Empresa ──────────────────────────────────────────

  void _abrirModalNovaEmpresa() async {
    final authed = await _garantirStepUpAuth('Cadastro de nova empresa contratante');
    if (!authed || !mounted) return;

    final nomeController = TextEditingController();
    final cnpjController = TextEditingController();
    final razaoController = TextEditingController();
    final fantasiaController = TextEditingController();
    final contatoNomeController = TextEditingController();
    final contatoEmailController = TextEditingController();
    final contatoTelefoneController = TextEditingController();
    final taxaInicialController = TextEditingController(text: '2.50');
    final justificativaController = TextEditingController(text: 'Contrato de adesão inicial');
    String selectedCommercialStatus = 'ACTIVE';

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (dialogCtx, setDialogState) => AlertDialog(
          backgroundColor: const Color(0xFF160D24),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          title: const Text('Nova Empresa Contratante', style: TextStyle(color: Colors.white, fontSize: 18)),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: nomeController,
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(labelText: 'Nome de Identificação *', labelStyle: TextStyle(color: Color(0xFF94A3B8))),
                ),
                TextField(
                  controller: fantasiaController,
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(
                    labelText: 'Nome Comercial / Fantasia (White-label)',
                    hintText: 'Ex: Hyper Fotos, Moura Select Fotos',
                    hintStyle: TextStyle(color: Color(0xFF64748B), fontSize: 12),
                    labelStyle: TextStyle(color: Color(0xFFA855F7)),
                  ),
                ),
                TextField(
                  controller: razaoController,
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(labelText: 'Razão Social', labelStyle: TextStyle(color: Color(0xFF94A3B8))),
                ),
                TextField(
                  controller: cnpjController,
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(labelText: 'CNPJ', labelStyle: TextStyle(color: Color(0xFF94A3B8))),
                ),
                TextField(
                  controller: contatoNomeController,
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(labelText: 'Contato Administrativo', labelStyle: TextStyle(color: Color(0xFF94A3B8))),
                ),
                TextField(
                  controller: contatoEmailController,
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(labelText: 'E-mail do Contato', labelStyle: TextStyle(color: Color(0xFF94A3B8))),
                ),
                TextField(
                  controller: contatoTelefoneController,
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(labelText: 'Telefone / WhatsApp', labelStyle: TextStyle(color: Color(0xFF94A3B8))),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: taxaInicialController,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(
                    labelText: 'Taxa Lumora Caixa Real (%)',
                    labelStyle: TextStyle(color: Color(0xFFA855F7)),
                    suffixText: '%',
                  ),
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  value: selectedCommercialStatus,
                  dropdownColor: const Color(0xFF160D24),
                  style: const TextStyle(color: Colors.white, fontSize: 13),
                  decoration: const InputDecoration(
                    labelText: 'Status Comercial',
                    labelStyle: TextStyle(color: Color(0xFFD8B4FE)),
                  ),
                  items: const [
                    DropdownMenuItem(value: 'ACTIVE', child: Text('Ativa')),
                    DropdownMenuItem(value: 'WARNING', child: Text('Em Aviso (Banner no Admin)')),
                    DropdownMenuItem(value: 'SUSPENDED', child: Text('Suspensa (Bloqueio Total)')),
                  ],
                  onChanged: (v) {
                    if (v != null) setDialogState(() => selectedCommercialStatus = v);
                  },
                ),
                TextField(
                  controller: justificativaController,
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(labelText: 'Justificativa Contratual / Aviso', labelStyle: TextStyle(color: Color(0xFF94A3B8))),
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
              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFA855F7), foregroundColor: Colors.white),
              onPressed: () async {
                if (nomeController.text.trim().isEmpty) {
                  ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Nome é obrigatório')));
                  return;
                }

                try {
                  final taxa = double.tryParse(taxaInicialController.text.replaceAll(',', '.')) ?? 2.5;
                  await _api.createOwnerCompany({
                    'name': nomeController.text.trim(),
                    'tradeName': fantasiaController.text.trim(),
                    'legalName': razaoController.text.trim(),
                    'cnpj': cnpjController.text.trim(),
                    'adminContactName': contatoNomeController.text.trim(),
                    'adminContactEmail': contatoEmailController.text.trim(),
                    'adminContactPhone': contatoTelefoneController.text.trim(),
                    'initialRatePercentage': taxa,
                    'platformFeePercent': taxa,
                    'commercialStatus': selectedCommercialStatus,
                    'commercialStatusReason': justificativaController.text.trim(),
                    'initialRateReason': justificativaController.text.trim(),
                  }, stepUpToken: _stepUpToken);

                  if (ctx.mounted) Navigator.of(ctx).pop();
                  _carregarDados();
                  if (mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Empresa cadastrada com sucesso!'), backgroundColor: Colors.green),
                    );
                  }
                } catch (e) {
                  if (mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro: $e'), backgroundColor: Colors.redAccent));
                  }
                }
              },
              child: const Text('Cadastrar'),
            ),
          ],
        ),
      ),
    );
  }

  // ── Modal de Edição Cadastral e Nome Comercial (White-label) ─────────────

  void _abrirModalEditarEmpresa(Map<String, dynamic> empresa) async {
    final authed = await _garantirStepUpAuth('Edição cadastral e nome comercial da empresa ${empresa['name']}');
    if (!authed || !mounted) return;

    final nomeController = TextEditingController(text: empresa['name']?.toString() ?? '');
    final fantasiaController = TextEditingController(text: empresa['tradeName']?.toString() ?? '');
    final razaoController = TextEditingController(text: empresa['legalName']?.toString() ?? '');
    final cnpjController = TextEditingController(text: empresa['cnpj']?.toString() ?? '');
    final contatoNomeController = TextEditingController(text: empresa['adminContactName']?.toString() ?? '');
    final contatoEmailController = TextEditingController(text: empresa['adminContactEmail']?.toString() ?? '');
    final contatoTelefoneController = TextEditingController(text: empresa['adminContactPhone']?.toString() ?? '');
    final initialFee = empresa['platformFeePercent'] ?? empresa['currentRate']?['ratePercentage'] ?? 2.50;
    final taxaController = TextEditingController(text: initialFee.toString());
    String selectedCommercialStatus =
        (empresa['commercialStatus'] ?? (empresa['status'] == 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE')).toString();
    if (!['ACTIVE', 'WARNING', 'SUSPENDED'].contains(selectedCommercialStatus)) {
      selectedCommercialStatus = 'ACTIVE';
    }
    final motivoComercialController =
        TextEditingController(text: empresa['commercialStatusReason']?.toString() ?? '');

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (dialogCtx, setDialogState) => AlertDialog(
          backgroundColor: const Color(0xFF160D24),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          title: Text('Editar Empresa — ${empresa['tradeName'] ?? empresa['name'] ?? ''}',
              style: const TextStyle(color: Colors.white, fontSize: 17)),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: nomeController,
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(
                      labelText: 'Nome de Identificação *',
                      labelStyle: TextStyle(color: Color(0xFF94A3B8))),
                ),
                TextField(
                  controller: fantasiaController,
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(
                    labelText: 'Nome Comercial / White-label',
                    hintText: 'Ex: Hyper Fotos, Moura Select Fotos',
                    hintStyle: TextStyle(color: Color(0xFF64748B), fontSize: 12),
                    labelStyle: TextStyle(color: Color(0xFFA855F7)),
                  ),
                ),
                TextField(
                  controller: razaoController,
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(
                      labelText: 'Razão Social',
                      labelStyle: TextStyle(color: Color(0xFF94A3B8))),
                ),
                TextField(
                  controller: cnpjController,
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(
                      labelText: 'CNPJ',
                      labelStyle: TextStyle(color: Color(0xFF94A3B8))),
                ),
                TextField(
                  controller: contatoNomeController,
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(
                      labelText: 'Contato Administrativo',
                      labelStyle: TextStyle(color: Color(0xFF94A3B8))),
                ),
                TextField(
                  controller: contatoEmailController,
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(
                      labelText: 'E-mail do Contato',
                      labelStyle: TextStyle(color: Color(0xFF94A3B8))),
                ),
                TextField(
                  controller: contatoTelefoneController,
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(
                      labelText: 'Telefone / WhatsApp',
                      labelStyle: TextStyle(color: Color(0xFF94A3B8))),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: taxaController,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(
                    labelText: 'Taxa Lumora Caixa Real (%)',
                    labelStyle: TextStyle(color: Color(0xFFA855F7)),
                    suffixText: '%',
                  ),
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  value: selectedCommercialStatus,
                  dropdownColor: const Color(0xFF160D24),
                  style: const TextStyle(color: Colors.white, fontSize: 13),
                  decoration: const InputDecoration(
                    labelText: 'Status Comercial',
                    labelStyle: TextStyle(color: Color(0xFFD8B4FE)),
                  ),
                  items: const [
                    DropdownMenuItem(value: 'ACTIVE', child: Text('Ativa')),
                    DropdownMenuItem(value: 'WARNING', child: Text('Em Aviso (Banner)')),
                    DropdownMenuItem(value: 'SUSPENDED', child: Text('Suspensa (Bloqueio Total)')),
                  ],
                  onChanged: (v) {
                    if (v != null) setDialogState(() => selectedCommercialStatus = v);
                  },
                ),
                TextField(
                  controller: motivoComercialController,
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(
                      labelText: 'Motivo / Observação Comercial',
                      labelStyle: TextStyle(color: Color(0xFF94A3B8))),
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
              style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFFA855F7),
                  foregroundColor: Colors.white),
              onPressed: () async {
                if (nomeController.text.trim().isEmpty) {
                  ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Nome é obrigatório')));
                  return;
                }
                final parsedFee = double.tryParse(taxaController.text.replaceAll(',', '.'));
                try {
                  await _api.updateOwnerCompany(
                    empresa['id'].toString(),
                    {
                      'name': nomeController.text.trim(),
                      'tradeName': fantasiaController.text.trim(),
                      'legalName': razaoController.text.trim(),
                      'cnpj': cnpjController.text.trim(),
                      'adminContactName': contatoNomeController.text.trim(),
                      'adminContactEmail': contatoEmailController.text.trim(),
                      'adminContactPhone': contatoTelefoneController.text.trim(),
                      if (parsedFee != null) 'platformFeePercent': parsedFee,
                      'commercialStatus': selectedCommercialStatus,
                      'commercialStatusReason': motivoComercialController.text.trim(),
                    },
                    stepUpToken: _stepUpToken,
                  );
                if (ctx.mounted) Navigator.of(ctx).pop();
                _carregarDados();
                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text('Dados comerciais da empresa atualizados com sucesso!'),
                      backgroundColor: Colors.green,
                    ),
                  );
                }
              } catch (e) {
                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text('Erro ao atualizar: $e'), backgroundColor: Colors.redAccent),
                  );
                }
              }
            },
            child: const Text('Salvar Alterações'),
          ),
        ],
      ),
    ),
    );
  }

  // ── Build Principal ───────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0D0714),
      appBar: AppBar(
        backgroundColor: const Color(0xFF160D24),
        elevation: 0,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'SuperAdmin • Empresas & Governança',
              style: TextStyle(color: Colors.white, fontSize: 17, fontWeight: FontWeight.bold),
            ),
            Text(
              _temStepUpAtivo
                  ? '🔒 Sessão Reforçada Ativa (${_stepUpExpiresAt!.difference(DateTime.now()).inMinutes}m)'
                  : '🔓 Ações sensíveis exigem senha',
              style: TextStyle(
                color: _temStepUpAtivo ? const Color(0xFFA855F7) : const Color(0xFF94A3B8),
                fontSize: 11,
              ),
            ),
          ],
        ),
        actions: [
          if (_temStepUpAtivo)
            IconButton(
              icon: const Icon(Icons.lock_open_rounded, color: Color(0xFF38BDF8)),
              tooltip: 'Revogar Sessão Reforçada (10m)',
              onPressed: () async {
                await _api.ownerRevokeStepUp(stepUpToken: _stepUpToken);
                setState(() {
                  _stepUpToken = null;
                  _stepUpExpiresAt = null;
                });
                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Sessão reforçada revogada com sucesso.')),
                  );
                }
              },
            ),
          IconButton(
            icon: const Icon(Icons.refresh_rounded, color: Colors.white70),
            tooltip: 'Atualizar',
            onPressed: _carregarDados,
          ),
          Padding(
            padding: const EdgeInsets.only(right: 8.0),
            child: TextButton.icon(
              onPressed: _confirmarESair,
              style: TextButton.styleFrom(
                foregroundColor: Colors.redAccent,
                padding: const EdgeInsets.symmetric(horizontal: 8),
              ),
              icon: const Icon(Icons.logout_rounded, color: Colors.redAccent, size: 18),
              label: const Text(
                'Sair',
                style: TextStyle(color: Colors.redAccent, fontWeight: FontWeight.bold, fontSize: 13),
              ),
            ),
          ),
        ],
        bottom: TabBar(
          controller: _tabController,
          indicatorColor: const Color(0xFFA855F7),
          labelColor: const Color(0xFFD8B4FE),
          unselectedLabelColor: const Color(0xFF94A3B8),
          tabs: const [
            Tab(icon: Icon(Icons.corporate_fare_rounded, size: 20), text: 'Empresas'),
            Tab(icon: Icon(Icons.history_edu_rounded, size: 20), text: 'Auditoria'),
            Tab(icon: Icon(Icons.verified_user_rounded, size: 20), text: 'Capacidades'),
          ],
        ),
      ),
      body: _carregando
          ? const Center(child: CircularProgressIndicator(color: Color(0xFFA855F7)))
          : Column(
              children: [
                _buildQuickNavBar(),
                Expanded(
                  child: TabBarView(
                    controller: _tabController,
                    children: [
                      _buildTabEmpresas(),
                      _buildTabAuditoria(),
                      _buildTabCapacidades(),
                    ],
                  ),
                ),
              ],
            ),
      floatingActionButton: _tabController.index == 0
          ? FloatingActionButton.extended(
              backgroundColor: const Color(0xFFA855F7),
              foregroundColor: Colors.white,
              icon: const Icon(Icons.add_business_rounded),
              label: const Text('Nova Empresa', style: TextStyle(fontWeight: FontWeight.bold)),
              onPressed: _abrirModalNovaEmpresa,
            )
          : null,
    );
  }

  Widget _buildQuickNavBar() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: const BoxDecoration(
        color: Color(0xFF1E293B),
        border: Border(bottom: BorderSide(color: Color(0xFF334155), width: 1)),
      ),
      child: Row(
        children: [
          Expanded(
            child: _buildQuickNavButton(
              icon: Icons.receipt_long_rounded,
              label: 'Faturamento',
              color: const Color(0xFF38BDF8),
              onTap: () {
                Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (_) => const PainelProprietarioFaturamentoAuditoriaCustos(),
                  ),
                );
              },
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: _buildQuickNavButton(
              icon: Icons.hub_rounded,
              label: 'APIs',
              color: const Color(0xFF34D399),
              onTap: () {
                Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (_) => const PainelProprietarioIntegracoes(),
                  ),
                );
              },
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: _buildQuickNavButton(
              icon: Icons.support_agent_rounded,
              label: 'Suporte',
              color: const Color(0xFFA78BFA),
              onTap: () {
                Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (_) => const PainelProprietarioSuporteContinuidade(),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildQuickNavButton({
    required IconData icon,
    required String label,
    required Color color,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
        decoration: BoxDecoration(
          color: color.withOpacity(0.12),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: color.withOpacity(0.35)),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 16, color: color),
            const SizedBox(width: 4),
            Flexible(
              child: Text(
                label,
                style: TextStyle(
                  color: color,
                  fontWeight: FontWeight.bold,
                  fontSize: 12,
                ),
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ── Tab 1: Empresas ───────────────────────────────────────────────────────

  Widget _buildTabEmpresas() {
    return RefreshIndicator(
      onRefresh: _carregarDados,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Barra de Busca
          TextField(
            controller: _buscaController,
            style: const TextStyle(color: Colors.white),
            decoration: InputDecoration(
              hintText: 'Buscar por nome, razão social ou CNPJ...',
              hintStyle: const TextStyle(color: Color(0xFF64748B), fontSize: 13),
              prefixIcon: const Icon(Icons.search_rounded, color: Color(0xFF94A3B8)),
              suffixIcon: _buscaController.text.isNotEmpty
                  ? IconButton(
                      icon: const Icon(Icons.clear_rounded, color: Color(0xFF94A3B8)),
                      onPressed: () {
                        _buscaController.clear();
                        _carregarDados();
                      },
                    )
                  : null,
              filled: true,
              fillColor: const Color(0xFF1E293B),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
            ),
            onSubmitted: (_) => _carregarDados(),
          ),
          const SizedBox(height: 12),

          // Chips de Filtro
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                _buildClassificationChip('Operacionais', 'OPERATIONAL'),
                const SizedBox(width: 8),
                _buildClassificationChip('Testes / Demo', 'TEST_DEMO'),
                const SizedBox(width: 8),
                _buildClassificationChip('Todas as Empresas', 'ALL'),
                const SizedBox(width: 16),
                Container(height: 24, width: 1, color: const Color(0xFF334155)),
                const SizedBox(width: 16),
                _buildFilterChip('Todas as Situações', 'ALL'),
                const SizedBox(width: 8),
                _buildFilterChip('Ativas', 'ACTIVE'),
                const SizedBox(width: 8),
                _buildFilterChip('Suspensas', 'SUSPENDED'),
              ],
            ),
          ),
          const SizedBox(height: 16),

          if (_empresas.isEmpty)
            Container(
              padding: const EdgeInsets.all(32),
              alignment: Alignment.center,
              child: const Text('Nenhuma empresa encontrada com os filtros atuais.', style: TextStyle(color: Color(0xFF94A3B8))),
            )
          else
            ..._empresas.map((empresa) => _buildEmpresaCard(empresa)),
        ],
      ),
    );
  }

  Widget _buildClassificationChip(String label, String value) {
    final isSelected = _filtroClassificacao == value;
    return ChoiceChip(
      label: Text(label),
      selected: isSelected,
      selectedColor: const Color(0xFF34D399),
      backgroundColor: const Color(0xFF1E293B),
      labelStyle: TextStyle(
        color: isSelected ? const Color(0xFF0F172A) : const Color(0xFF94A3B8),
        fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
        fontSize: 12,
      ),
      onSelected: (_) {
        setState(() => _filtroClassificacao = value);
        _carregarDados();
      },
    );
  }

  Widget _buildFilterChip(String label, String value) {
    final isSelected = _filtroStatus == value;
    return ChoiceChip(
      label: Text(label),
      selected: isSelected,
      selectedColor: const Color(0xFF38BDF8),
      backgroundColor: const Color(0xFF1E293B),
      labelStyle: TextStyle(
        color: isSelected ? const Color(0xFF0F172A) : const Color(0xFF94A3B8),
        fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
        fontSize: 12,
      ),
      onSelected: (_) {
        setState(() => _filtroStatus = value);
        _carregarDados();
      },
    );
  }

  Widget _buildSemaphoreBadge({
    required String label,
    required bool configured,
    String? status,
  }) {
    final normalized = (status ?? '').toUpperCase();
    final Color color;
    final IconData icon;
    if (!configured || normalized == 'NOT_CONFIGURED') {
      color = const Color(0xFF64748B);
      icon = Icons.circle_outlined;
    } else if (normalized == 'ERROR' || normalized == 'FAILED') {
      color = const Color(0xFFEF4444);
      icon = Icons.error_outline_rounded;
    } else if (normalized == 'CONNECTED' || normalized == 'ACTIVE') {
      color = const Color(0xFF10B981);
      icon = Icons.check_circle_rounded;
    } else {
      color = const Color(0xFFF59E0B);
      icon = Icons.schedule_rounded;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: color.withOpacity(0.14),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: color.withOpacity(0.45)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 11, color: color),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(
              color: color,
              fontSize: 10,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildEmpresaCard(Map<String, dynamic> empresa) {
    final commercialStatus =
        (empresa['commercialStatus'] ?? (empresa['status'] == 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE')).toString();
    final isSuspensa = commercialStatus == 'SUSPENDED' || empresa['status'] == 'SUSPENDED';
    final isWarning = !isSuspensa && commercialStatus == 'WARNING';
    final currentRate = empresa['currentRate'];
    final feePercent = empresa['platformFeePercent'] ?? currentRate?['ratePercentage'] ?? 2.50;
    final isRateConfigured = empresa['isRateConfigured'] == true || empresa['platformFeePercent'] != null;
    final isTestDemo = empresa['isTestExample'] == true || empresa['classification'] == 'TEST_DEMO';
    final integrationsSummary = empresa['integrationsSummary'] is Map
        ? Map<String, dynamic>.from(empresa['integrationsSummary'] as Map)
        : <String, dynamic>{};
    final asaasSummary = integrationsSummary['asaas'] is Map
        ? Map<String, dynamic>.from(integrationsSummary['asaas'] as Map)
        : <String, dynamic>{};
    final geminiSummary = integrationsSummary['gemini'] is Map
        ? Map<String, dynamic>.from(integrationsSummary['gemini'] as Map)
        : <String, dynamic>{};
    final pixConfigured =
        integrationsSummary['pixConfigured'] == true || empresa['pixConfigured'] == true;
    final asaasConfigured = asaasSummary['configured'] == true;
    final asaasEnv = (asaasSummary['environment'] ?? 'SANDBOX').toString();
    final asaasStatus = asaasSummary['connectionStatus']?.toString();
    final geminiConfigured = geminiSummary['configured'] == true;
    final geminiStatus = geminiSummary['connectionStatus']?.toString();

    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      decoration: BoxDecoration(
        color: const Color(0xFF160D24),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: isSuspensa
              ? const Color(0xFFEF4444).withOpacity(0.55)
              : isWarning
                  ? const Color(0xFFF59E0B).withOpacity(0.55)
                  : const Color(0xFFA855F7).withOpacity(0.35),
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        (empresa['tradeName']?.toString().trim().isNotEmpty == true)
                            ? empresa['tradeName'].toString()
                            : (empresa['name'] ?? '').toString(),
                        style: const TextStyle(color: Colors.white, fontSize: 17, fontWeight: FontWeight.bold),
                      ),
                      if (empresa['tradeName']?.toString().trim().isNotEmpty == true &&
                          empresa['name'] != null &&
                          empresa['tradeName'] != empresa['name'])
                        Text(
                          'Identificação: ${empresa['name']}',
                          style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 11),
                        ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (isTestDemo) ...[
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
                        decoration: BoxDecoration(
                          color: const Color(0xFFF59E0B).withOpacity(0.15),
                          borderRadius: BorderRadius.circular(6),
                          border: Border.all(color: const Color(0xFFF59E0B)),
                        ),
                        child: const Text(
                          'TESTE / DEMO',
                          style: TextStyle(
                            color: Color(0xFFFBBF24),
                            fontSize: 9,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                      const SizedBox(width: 6),
                    ],
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: isSuspensa
                            ? const Color(0xFFEF4444).withOpacity(0.15)
                            : isWarning
                                ? const Color(0xFFF59E0B).withOpacity(0.15)
                                : Colors.green.withOpacity(0.15),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(
                          color: isSuspensa
                              ? const Color(0xFFEF4444)
                              : isWarning
                                  ? const Color(0xFFF59E0B)
                                  : Colors.green,
                        ),
                      ),
                      child: Text(
                        isSuspensa
                            ? 'SUSPENSA'
                            : isWarning
                                ? 'EM AVISO'
                                : 'ATIVA',
                        style: TextStyle(
                          color: isSuspensa
                              ? const Color(0xFFEF4444)
                              : isWarning
                                  ? const Color(0xFFFBBF24)
                                  : Colors.greenAccent,
                          fontSize: 10,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
            if (empresa['legalName'] != null)
              Text(empresa['legalName'], style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12)),
            if (isWarning &&
                empresa['commercialStatusReason']?.toString().trim().isNotEmpty == true)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  'Aviso: ${empresa['commercialStatusReason']}',
                  style: const TextStyle(color: Color(0xFFFBBF24), fontSize: 11),
                ),
              ),
            const SizedBox(height: 10),

            // Semáforo Visual de APIs & Taxa
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                _buildSemaphoreBadge(
                  label: asaasConfigured
                      ? (asaasEnv == 'PRODUCTION' ? 'Asaas Prod' : 'Asaas Sandbox')
                      : 'Asaas Off',
                  configured: asaasConfigured,
                  status: asaasStatus,
                ),
                _buildSemaphoreBadge(
                  label: asaasConfigured ? 'Serasa' : 'Serasa Off',
                  configured: asaasConfigured,
                  status: asaasStatus,
                ),
                _buildSemaphoreBadge(
                  label: geminiConfigured ? 'Gemini Própria' : 'Gemini Off',
                  configured: geminiConfigured,
                  status: geminiStatus,
                ),
                _buildSemaphoreBadge(
                  label: pixConfigured ? 'Pix Empresa' : 'Pix Off',
                  configured: pixConfigured,
                  status: pixConfigured ? 'ACTIVE' : 'NOT_CONFIGURED',
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
                  decoration: BoxDecoration(
                    color: const Color(0xFFA855F7).withOpacity(0.18),
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(color: const Color(0xFFA855F7).withOpacity(0.55)),
                  ),
                  child: Text(
                    'Taxa: ${(feePercent as num).toStringAsFixed(2)}%',
                    style: const TextStyle(
                      color: Color(0xFFD8B4FE),
                      fontSize: 10,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),

            // Informações Contratuais e Contato
            Row(
              children: [
                const Icon(Icons.person_outline_rounded, size: 14, color: Color(0xFF94A3B8)),
                const SizedBox(width: 4),
                Expanded(
                  child: Text(
                    empresa['adminContactName'] ?? 'Contato não cadastrado',
                    style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12),
                  ),
                ),
                const Icon(Icons.people_alt_rounded, size: 14, color: Color(0xFF94A3B8)),
                const SizedBox(width: 4),
                Text('${empresa['userCount'] ?? 0} usuários', style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12)),
              ],
            ),
            const SizedBox(height: 12),

            // Card da Taxa Lumora
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0xFF0D0714),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(
                  color: isRateConfigured ? const Color(0xFFA855F7).withOpacity(0.4) : const Color(0xFFFBBF24).withOpacity(0.35),
                ),
              ),
              child: Row(
                children: [
                  Icon(
                    isRateConfigured ? Icons.receipt_long_rounded : Icons.warning_amber_rounded,
                    color: isRateConfigured ? const Color(0xFFA855F7) : const Color(0xFFFBBF24),
                    size: 24,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          isRateConfigured
                              ? 'Remuneração Lumora Caixa Real: ${(feePercent as num).toStringAsFixed(2)}%'
                              : 'Contrato não configurado',
                          style: TextStyle(
                            color: isRateConfigured ? Colors.white : const Color(0xFFFBBF24),
                            fontWeight: FontWeight.bold,
                            fontSize: 13,
                          ),
                        ),
                        if (isRateConfigured && currentRate?['effectiveFrom'] != null)
                          Text(
                            'Vigência: a partir de ${_dateFormat.format(DateTime.parse(currentRate['effectiveFrom']))}',
                            style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 11),
                          )
                        else if (isRateConfigured)
                          const Text(
                            'Incidência apenas sobre valores efetivamente pagos (regime de caixa real).',
                            style: TextStyle(color: Color(0xFF94A3B8), fontSize: 11),
                          )
                        else
                          const Text('Sem cobrança ativa até configuração contratual.', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 11)),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),

            // Ações do Card com Quebra Responsiva (Wrap)
            Wrap(
              spacing: 8,
              runSpacing: 8,
              alignment: WrapAlignment.end,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                ElevatedButton.icon(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFFA855F7),
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  ),
                  icon: const Icon(Icons.support_agent_rounded, size: 15),
                  label: const Text('Acessar como Admin (Suporte)', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold)),
                  onPressed: () => _acessarComoAdminSuporte(empresa),
                ),
                TextButton.icon(
                  icon: const Icon(Icons.info_outline_rounded, size: 16),
                  label: const Text('Detalhes & Vigências', style: TextStyle(fontSize: 12)),
                  onPressed: () => _abrirDetalhesEmpresa(empresa['id']),
                ),
                OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(
                    side: const BorderSide(color: Color(0xFFA855F7)),
                    foregroundColor: const Color(0xFFD8B4FE),
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  ),
                  icon: const Icon(Icons.edit_rounded, size: 16),
                  label: const Text('Editar & Taxa', style: TextStyle(fontSize: 12)),
                  onPressed: () => _abrirModalEditarEmpresa(empresa),
                ),
                OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(
                    side: const BorderSide(color: Color(0xFF38BDF8)),
                    foregroundColor: const Color(0xFF38BDF8),
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  ),
                  icon: const Icon(Icons.percent_rounded, size: 16),
                  label: const Text('Ajustar Taxa', style: TextStyle(fontSize: 12)),
                  onPressed: () => _abrirModalConfigurarTaxa(empresa),
                ),
                OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(
                    side: const BorderSide(color: Color(0xFF34D399)),
                    foregroundColor: const Color(0xFF34D399),
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  ),
                  icon: const Icon(Icons.hub_rounded, size: 16),
                  label: const Text('APIs', style: TextStyle(fontSize: 12)),
                  onPressed: () {
                    Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => PainelProprietarioIntegracoes(initialCompany: empresa),
                      ),
                    );
                  },
                ),
                OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(
                    side: const BorderSide(color: Color(0xFFA855F7)),
                    foregroundColor: const Color(0xFFD8B4FE),
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  ),
                  icon: const Icon(Icons.manage_search_rounded, size: 16),
                  label: const Text('Busca IA', style: TextStyle(fontSize: 12)),
                  onPressed: () {
                    final compId = empresa['id']?.toString();
                    if (compId == null || compId.isEmpty) return;
                    Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => TelaConfigBuscaEventosIa(
                          companyId: compId,
                          companyName: (empresa['tradeName'] ?? empresa['name'] ?? '').toString(),
                          apiService: _api,
                        ),
                      ),
                    );
                  },
                ),
                IconButton(
                  icon: Icon(
                    isSuspensa ? Icons.play_arrow_rounded : Icons.gavel_rounded,
                    color: isSuspensa
                        ? Colors.greenAccent
                        : isWarning
                            ? const Color(0xFFFBBF24)
                            : const Color(0xFFF87171),
                  ),
                  tooltip: 'Alterar Governança (Ativa / Aviso / Suspensa)',
                  onPressed: () => _abrirModalStatus(empresa),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  // ── Tab 2: Auditoria ──────────────────────────────────────────────────────

  Widget _buildTabAuditoria() {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        const Text(
          'Trilha de Auditoria Contratual Sanitizada',
          style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 4),
        const Text(
          'Registro imutável de alterações contratuais, criação de empresas, ajustes de taxa e suspensões.',
          style: TextStyle(color: Color(0xFF94A3B8), fontSize: 12),
        ),
        const SizedBox(height: 12),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
          decoration: BoxDecoration(
            color: const Color(0xFF1E293B),
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: const Color(0xFF334155)),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Expanded(
                child: Text(
                  'Ocultar eventos de testes/fictícios',
                  style: TextStyle(color: Color(0xFF94A3B8), fontSize: 13),
                ),
              ),
              Switch(
                value: _ocultarTestesAuditoria,
                activeColor: const Color(0xFF38BDF8),
                onChanged: (val) {
                  setState(() => _ocultarTestesAuditoria = val);
                  _carregarDados();
                },
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        if (_logsAuditoria.isEmpty)
          const Center(child: Text('Nenhum log registrado até o momento.', style: TextStyle(color: Color(0xFF94A3B8))))
        else
          ..._logsAuditoria.map((log) {
            final isTestEvent = log['isTestExample'] == true;

            return Container(
              margin: const EdgeInsets.only(bottom: 10),
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: const Color(0xFF1E293B),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: isTestEvent
                      ? const Color(0xFFF59E0B).withOpacity(0.35)
                      : const Color(0xFF334155),
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
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                            decoration: BoxDecoration(
                              color: const Color(0xFF38BDF8).withOpacity(0.15),
                              borderRadius: BorderRadius.circular(6),
                            ),
                            child: Text(
                              log['action'] ?? '',
                              style: const TextStyle(color: Color(0xFF38BDF8), fontWeight: FontWeight.bold, fontSize: 11),
                            ),
                          ),
                          if (isTestEvent) ...[
                            const SizedBox(width: 6),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                              decoration: BoxDecoration(
                                color: const Color(0xFFF59E0B).withOpacity(0.15),
                                borderRadius: BorderRadius.circular(4),
                                border: Border.all(color: const Color(0xFFF59E0B).withOpacity(0.5)),
                              ),
                              child: const Text(
                                'TESTE',
                                style: TextStyle(color: Color(0xFFFBBF24), fontSize: 9, fontWeight: FontWeight.bold),
                              ),
                            ),
                          ],
                        ],
                      ),
                      Text(
                        log['createdAt'] != null ? _dateTimeFormat.format(DateTime.parse(log['createdAt'])) : '',
                        style: const TextStyle(color: Color(0xFF64748B), fontSize: 11),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text('Empresa: ${log['companyName'] ?? "Plataforma"}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 13)),
                  Text('Autor: ${log['authorName'] ?? ""}', style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12)),
                  if (log['reason'] != null)
                    Text('Motivo: ${log['reason']}', style: const TextStyle(color: Colors.white70, fontSize: 12)),
                ],
              ),
            );
          }),
      ],
    );
  }

  // ── Tab 3: Capacidades ────────────────────────────────────────────────────

  Widget _buildTabCapacidades() {
    final caps = (_perfilProprietario?['capabilities'] as List?) ?? [];

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        const Text(
          'Capacidades do Operador na Central',
          style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 4),
        const Text(
          'Acesso granular segregado por responsabilidade na plataforma Lumora.',
          style: TextStyle(color: Color(0xFF94A3B8), fontSize: 12),
        ),
        const SizedBox(height: 16),

        _buildCapabilityCard(
          title: 'Gestão de Contratos e Empresas',
          code: 'CONTRACT_MANAGEMENT',
          desc: 'Cadastro de empresas, configuração de taxas do Lumora com vigência e suspensão auditável.',
          isGranted: caps.contains('CONTRACT_MANAGEMENT'),
        ),
        _buildCapabilityCard(
          title: 'Financeiro da Plataforma',
          code: 'PLATFORM_FINANCE',
          desc: 'Consulta de faturamento, apuração da remuneração e demonstrativos agregados (Bloco 3).',
          isGranted: caps.contains('PLATFORM_FINANCE'),
        ),
        _buildCapabilityCard(
          title: 'Configuração de Integrações & APIs',
          code: 'INTEGRATION_CONFIG',
          desc: 'Gestão de credenciais, provedores de IA, mensageria e catálogos (Bloco 2).',
          isGranted: caps.contains('INTEGRATION_CONFIG'),
        ),
        _buildCapabilityCard(
          title: 'Suporte Técnico e Diagnóstico',
          code: 'TECHNICAL_SUPPORT',
          desc: 'Atendimento a chamados, logs sanitizados e status operacional (Bloco 4).',
          isGranted: caps.contains('TECHNICAL_SUPPORT'),
        ),
      ],
    );
  }

  Widget _buildCapabilityCard({
    required String title,
    required String code,
    required String desc,
    required bool isGranted,
  }) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF1E293B),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: isGranted ? const Color(0xFF38BDF8).withOpacity(0.4) : const Color(0xFF334155),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            isGranted ? Icons.check_circle_rounded : Icons.cancel_outlined,
            color: isGranted ? const Color(0xFF38BDF8) : const Color(0xFF64748B),
            size: 24,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Expanded(
                      child: Text(title, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14)),
                    ),
                    const SizedBox(width: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: isGranted ? Colors.green.withOpacity(0.2) : Colors.grey.withOpacity(0.2),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(
                        isGranted ? 'CONCEDIDO' : 'NÃO ATRIBUÍDO',
                        style: TextStyle(color: isGranted ? Colors.greenAccent : Colors.grey, fontSize: 10, fontWeight: FontWeight.bold),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(desc, style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
