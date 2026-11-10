import 'package:flutter/material.dart';
import '../servicos/servico_api.dart';

class TelaIntegracoesEmpresa extends StatefulWidget {
  const TelaIntegracoesEmpresa({super.key});

  @override
  State<TelaIntegracoesEmpresa> createState() => _TelaIntegracoesEmpresaState();
}

class _TelaIntegracoesEmpresaState extends State<TelaIntegracoesEmpresa> {
  final ApiService _api = ApiService();

  bool _isLoading = true;
  String? _errorMessage;

  List<dynamic> _integrations = [];
  List<dynamic> _catalog = [];
  List<dynamic> _sharedServices = [];
  Map<String, dynamic>? _overview;
  Map<String, dynamic>? _unlinkedUsage;
  String? _period;
  bool _globalLiveGateLocked = true;

  @override
  void initState() {
    super.initState();
    _loadIntegrations();
  }

  Future<void> _loadIntegrations() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final res = await _api.getMyCompanyIntegrations();
      if (mounted) {
        setState(() {
          _integrations = (res['integrations'] as List<dynamic>?) ?? [];
          _catalog = (res['catalog'] as List<dynamic>?) ?? [];
          _sharedServices = (res['sharedServices'] as List<dynamic>?) ?? [];
          _overview = res['overview'] as Map<String, dynamic>?;
          _unlinkedUsage = res['unlinkedUsage'] as Map<String, dynamic>?;
          _period = res['period']?.toString();
          _globalLiveGateLocked = res['globalLiveGateLocked'] == true;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _errorMessage = e.toString().replaceFirst('Exception: ', '');
          _isLoading = false;
        });
      }
    }
  }

  Future<void> _testIntegration(String id) async {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Row(
          children: [
            SizedBox(
              width: 18,
              height: 18,
              child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
            ),
            SizedBox(width: 12),
            Text('Testando conexão com o provedor...'),
          ],
        ),
        duration: Duration(seconds: 4),
      ),
    );

    try {
      final res = await _api.testCompanyIntegration(id);
      if (!mounted) return;
      ScaffoldMessenger.of(context).hideCurrentSnackBar();

      final success = res['success'] == true;
      final msg = res['message'] ?? (success ? 'Conexão validada com sucesso!' : 'Falha na validação.');

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(msg),
          backgroundColor: success ? const Color(0xFF10B981) : Colors.redAccent,
        ),
      );
      _loadIntegrations();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).hideCurrentSnackBar();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Erro ao testar: ${e.toString().replaceFirst('Exception: ', '')}'),
          backgroundColor: Colors.redAccent,
        ),
      );
    }
  }

  Future<void> _deleteIntegration(String id, String providerName) async {
    final passwordController = TextEditingController();
    bool obscurePassword = true;

    final confirmPassword = await showDialog<String>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          backgroundColor: const Color(0xFF1A1A2E),
          title: const Text('Remover Credencial', style: TextStyle(color: Colors.white)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Deseja remover as credenciais do provedor $providerName da sua empresa?\n\n'
                'Serviços que dependem desta chave ficarão temporariamente desativados.\n\n'
                'Por segurança, digite a sua senha de administrador para confirmar a remoção:',
                style: const TextStyle(color: Colors.white70, fontSize: 13),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: passwordController,
                obscureText: obscurePassword,
                style: const TextStyle(color: Colors.white),
                decoration: InputDecoration(
                  labelText: 'Senha de Administrador',
                  labelStyle: const TextStyle(color: Colors.white60),
                  prefixIcon: const Icon(Icons.lock_outline, color: Colors.white54),
                  suffixIcon: IconButton(
                    icon: Icon(
                      obscurePassword ? Icons.visibility_off : Icons.visibility,
                      color: Colors.white54,
                    ),
                    onPressed: () => setDialogState(() => obscurePassword = !obscurePassword),
                  ),
                  filled: true,
                  fillColor: const Color(0xFF0F1923),
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, null),
              child: const Text('Cancelar', style: TextStyle(color: Colors.white60)),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: Colors.redAccent),
              onPressed: () {
                final pwd = passwordController.text.trim();
                if (pwd.isEmpty) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text('Por favor, digite sua senha de confirmação.'),
                      backgroundColor: Colors.orangeAccent,
                    ),
                  );
                  return;
                }
                Navigator.pop(ctx, pwd);
              },
              child: const Text('Confirmar Remoção', style: TextStyle(color: Colors.white)),
            ),
          ],
        ),
      ),
    );

    if (confirmPassword == null || confirmPassword.isEmpty) return;

    try {
      await _api.deleteCompanyIntegration(id, passwordConfirmation: confirmPassword);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Integração removida com sucesso.'),
          backgroundColor: Color(0xFF10B981),
        ),
      );
      _loadIntegrations();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Erro ao remover: ${e.toString().replaceFirst('Exception: ', '')}'),
          backgroundColor: Colors.redAccent,
        ),
      );
    }
  }

  void _showConfigureModal({Map<String, dynamic>? existingIntegration}) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF0F1923),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => _ModalConfigurarIntegracao(
        existing: existingIntegration,
        catalog: _catalog,
        onSaved: () {
          Navigator.pop(ctx);
          _loadIntegrations();
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0F1923),
      appBar: AppBar(
        title: const Text(
          'Integrações da Minha Empresa',
          style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
        ),
        backgroundColor: const Color(0xFF0D1B2A),
        iconTheme: const IconThemeData(color: Colors.white),
        elevation: 0,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            tooltip: 'Recarregar',
            onPressed: _loadIntegrations,
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF00E5FF)))
          : _errorMessage != null
              ? _buildErrorView()
              : RefreshIndicator(
                  color: const Color(0xFF00E5FF),
                  backgroundColor: const Color(0xFF1A2634),
                  onRefresh: _loadIntegrations,
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      // Banner de Segurança e Isolamento
                      Container(
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: const Color(0xFF142436),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: const Color(0xFF00E5FF).withOpacity(0.3)),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Row(
                              children: [
                                Icon(Icons.lock_rounded, color: Color(0xFF00E5FF), size: 20),
                                SizedBox(width: 8),
                                Text(
                                  'Cofre Exclusivo da Empresa',
                                  style: TextStyle(
                                    color: Color(0xFF00E5FF),
                                    fontSize: 14,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 6),
                            const Text(
                              'Suas chaves são cifradas com AES-256 no servidor e isoladas por empresa. '
                              'Nenhum outro cliente ou administrador externo tem acesso às suas credenciais.',
                              style: TextStyle(color: Colors.white70, fontSize: 11, height: 1.35),
                            ),
                            if (_globalLiveGateLocked) ...[
                              const SizedBox(height: 8),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                decoration: BoxDecoration(
                                  color: Colors.amber.withOpacity(0.15),
                                  borderRadius: BorderRadius.circular(6),
                                  border: Border.all(color: Colors.amber.withOpacity(0.4)),
                                ),
                                child: const Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Icon(Icons.shield_rounded, color: Colors.amber, size: 14),
                                    SizedBox(width: 6),
                                    Text(
                                      'Trava Global LIVE Ativa: faturamento bancário real bloqueado nesta rodada.',
                                      style: TextStyle(color: Colors.amber, fontSize: 10, fontWeight: FontWeight.w600),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ],
                        ),
                      ),
                      const SizedBox(height: 20),

                      // Card com Visão Geral de Consumo da Empresa
                      _buildOverviewCard(),

                      // Registros antigos sem vínculo seguro (se houver)
                      if (_unlinkedUsage != null && _unlinkedUsage!['hasUnlinkedRecords'] == true)
                        _buildUnlinkedUsageCard(_unlinkedUsage!),

                      // Botão de Nova Configuração
                      ElevatedButton.icon(
                        icon: const Icon(Icons.add_rounded, size: 18),
                        label: const Text(
                          'Cadastrar ou Atualizar Credencial',
                          style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                        ),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xFF00E5FF),
                          foregroundColor: const Color(0xFF0F1923),
                          padding: const EdgeInsets.symmetric(vertical: 12),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                        ),
                        onPressed: () => _showConfigureModal(),
                      ),
                      const SizedBox(height: 20),

                      const Text(
                        'Minhas Credenciais Cadastradas',
                        style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold),
                      ),
                      const SizedBox(height: 10),

                      if (_integrations.isEmpty)
                        Container(
                          padding: const EdgeInsets.all(24),
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            color: const Color(0xFF1A2634),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: const Column(
                            children: [
                              Icon(Icons.key_off_rounded, color: Colors.white24, size: 40),
                              SizedBox(height: 10),
                              Text(
                                'Nenhuma credencial cadastrada pela sua empresa ainda.',
                                style: TextStyle(color: Colors.white70, fontSize: 13),
                              ),
                              SizedBox(height: 4),
                              Text(
                                'Cadastre sua chave do Gemini para pesquisa de eventos ou Asaas para cobranças.',
                                textAlign: TextAlign.center,
                                style: TextStyle(color: Colors.white38, fontSize: 11),
                              ),
                            ],
                          ),
                        )
                      else
                        ..._integrations.map((item) => _buildIntegrationCard(item)),

                      const SizedBox(height: 24),
                      const Text(
                        'Serviços Compartilhados da Plataforma',
                        style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold),
                      ),
                      const SizedBox(height: 10),

                      ..._sharedServices.map((svc) => _buildSharedServiceCard(svc)),
                    ],
                  ),
                ),
    );
  }

  Widget _buildOverviewCard() {
    final totalUnits = _overview?['totalUnitsUsed'] ?? 0;
    final totalSpentFormatted = _overview?['totalSpentFormatted'] ?? r'R$ 0,00';
    final activeCount = _overview?['activeIntegrationsCount'] ?? 0;
    final periodStr = _period ?? 'Mês Atual';

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF16222F),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFF00E5FF).withOpacity(0.25)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Row(
                children: [
                  Icon(Icons.insights_rounded, color: Color(0xFF00E5FF), size: 18),
                  SizedBox(width: 8),
                  Text(
                    'Consumo de APIs da Empresa',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 14,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ],
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: const Color(0xFF00E5FF).withOpacity(0.15),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  periodStr,
                  style: const TextStyle(
                    color: Color(0xFF00E5FF),
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
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: Colors.black26,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Total Requisições', style: TextStyle(color: Colors.white54, fontSize: 10)),
                      const SizedBox(height: 2),
                      Text(
                        '$totalUnits un.',
                        style: const TextStyle(color: Colors.white, fontSize: 15, fontWeight: FontWeight.bold),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: Colors.black26,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Gasto Acumulado', style: TextStyle(color: Colors.white54, fontSize: 10)),
                      const SizedBox(height: 2),
                      Text(
                        totalSpentFormatted,
                        style: const TextStyle(color: Color(0xFF10B981), fontSize: 15, fontWeight: FontWeight.bold),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: Colors.black26,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Serviços Ativos', style: TextStyle(color: Colors.white54, fontSize: 10)),
                      const SizedBox(height: 2),
                      Text(
                        '$activeCount',
                        style: const TextStyle(color: Color(0xFF90CAF9), fontSize: 15, fontWeight: FontWeight.bold),
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
        color: const Color(0xFF111A24),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.white12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  const Icon(Icons.bar_chart_rounded, color: Color(0xFF00E5FF), size: 14),
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
                  style: TextStyle(color: Colors.white38, fontSize: 10),
                ),
            ],
          ),
          const SizedBox(height: 6),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              value: hasUnitsLimit || hasBudget ? clampedFraction : 0.05,
              backgroundColor: Colors.white12,
              valueColor: AlwaysStoppedAnimation<Color>(hasUnitsLimit || hasBudget ? barColor : const Color(0xFF00E5FF)),
              minHeight: 6,
            ),
          ),
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Usado: $unitsUsed un. (Ext: $externalUnitsUsed)',
                style: const TextStyle(color: Colors.white70, fontSize: 11),
              ),
              Text(
                'Limite: $unitsLimitLabel',
                style: const TextStyle(color: Colors.white70, fontSize: 11),
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
                      'Franquia: $usedIncludedUnits un. • Saldo: $remainingIncludedUnits un.',
                      style: const TextStyle(color: Color(0xFF80D8FF), fontSize: 10, fontWeight: FontWeight.w600),
                    ),
                    Text(
                      'Cache: $cachedUnitsUsed un.',
                      style: const TextStyle(color: Colors.white54, fontSize: 10),
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
                        style: const TextStyle(color: Colors.white70, fontSize: 10),
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
                  style: const TextStyle(color: Colors.white70, fontSize: 11),
                ),
              ],
            ),
          ],
          if (!hasMeasurement) ...[
            const SizedBox(height: 4),
            const Text(
              'Consumo ainda não medido',
              style: TextStyle(color: Colors.white38, fontSize: 10, fontStyle: FontStyle.italic),
            ),
          ],
          const SizedBox(height: 6),
          const Divider(color: Colors.white10, height: 8),
          const SizedBox(height: 4),
          // Distinção entre Limite Lumora e Cota do Provedor
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(Icons.tune_rounded, color: Colors.white38, size: 12),
              const SizedBox(width: 4),
              Expanded(
                child: Text(
                  'Limite Lumora: $lumoraLimitLabel',
                  style: const TextStyle(color: Colors.white54, fontSize: 10),
                ),
              ),
            ],
          ),
          const SizedBox(height: 2),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(Icons.cloud_queue_rounded, color: Colors.white38, size: 12),
              const SizedBox(width: 4),
              Expanded(
                child: Text(
                  'Cota Provedor: $providerQuotaLabel',
                  style: const TextStyle(color: Colors.white54, fontSize: 10),
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

  Widget _buildTariffCard(Map<String, dynamic>? tariff) {
    final hasTariff = tariff != null && tariff['hasConfirmedTariff'] == true;

    if (!hasTariff) {
      final missingReason = tariff?['missingPriceReason']?.toString();
      return Container(
        margin: const EdgeInsets.only(top: 8),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(
          color: const Color(0xFF141F2B),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: Colors.white10),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.sell_outlined, color: Colors.amber, size: 14),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    tariff?['statusLabel'] ?? 'Tarifa ainda não informada',
                    style: const TextStyle(
                      color: Colors.amber,
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ],
            ),
            if (missingReason != null) ...[
              const SizedBox(height: 4),
              Text(
                missingReason,
                style: const TextStyle(color: Colors.white54, fontSize: 10),
              ),
            ],
          ],
        ),
      );
    }

    final includedUnitsLabel = tariff['includedUnitsLabel'] ?? 'Sem franquia incluída';
    final monthlyFeeLabel = tariff['monthlyFeeLabel'] ?? 'Isento de mensalidade';
    final overagePriceLabel = tariff['overagePriceLabel'] ?? 'Sem custo de excedente';
    final currency = tariff['currency'] ?? 'BRL';
    final costPayerLabel = tariff['costPayerLabel'] ?? 'Empresa';
    final pricingSourceLabel = tariff['pricingSourceLabel'] ?? 'Contrato';
    final effectivePeriodLabel = tariff['effectivePeriodLabel'] ?? 'Vigência ativa';
    final conversionNotice = tariff['conversionNotice']?.toString();

    return Container(
      margin: const EdgeInsets.only(top: 8),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: const Color(0xFF131D2A),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: const Color(0xFF00E5FF).withOpacity(0.2)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Row(
                children: [
                  Icon(Icons.receipt_long_rounded, color: Color(0xFF00E5FF), size: 14),
                  SizedBox(width: 4),
                  Text(
                    'Tarifa do Plano',
                    style: TextStyle(
                      color: Color(0xFF00E5FF),
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ],
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                decoration: BoxDecoration(
                  color: const Color(0xFF00E5FF).withOpacity(0.12),
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Text(
                  currency,
                  style: const TextStyle(
                    color: Color(0xFF00E5FF),
                    fontSize: 9,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Franquia: $includedUnitsLabel',
                style: const TextStyle(color: Colors.white70, fontSize: 11),
              ),
              Text(
                'Mensalidade: $monthlyFeeLabel',
                style: const TextStyle(color: Colors.white70, fontSize: 11),
              ),
            ],
          ),
          const SizedBox(height: 3),
          Text(
            'Excedente: $overagePriceLabel',
            style: const TextStyle(color: Color(0xFFCE93D8), fontSize: 11, fontWeight: FontWeight.w500),
          ),
          if (conversionNotice != null) ...[
            const SizedBox(height: 4),
            Row(
              children: [
                const Icon(Icons.warning_amber_rounded, color: Colors.amberAccent, size: 12),
                const SizedBox(width: 4),
                Expanded(
                  child: Text(
                    conversionNotice,
                    style: const TextStyle(color: Colors.amberAccent, fontSize: 10),
                  ),
                ),
              ],
            ),
          ],
          const SizedBox(height: 4),
          const Divider(color: Colors.white10, height: 6),
          const SizedBox(height: 2),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Pagador: $costPayerLabel • Fonte: $pricingSourceLabel',
                style: const TextStyle(color: Colors.white38, fontSize: 9),
              ),
              Text(
                effectivePeriodLabel,
                style: const TextStyle(color: Colors.white38, fontSize: 9),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildUnlinkedUsageCard(Map<String, dynamic> unlinked) {
    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFF231C1A),
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

  Widget _buildIntegrationCard(Map<String, dynamic> item) {
    final id = item['id']?.toString() ?? '';
    final category = item['category']?.toString() ?? '';
    final provider = item['provider']?.toString() ?? '';
    final env = item['environment']?.toString() ?? 'PRODUCTION';
    final costPayerLabel = item['costPayerLabel']?.toString() ?? (item['costPayer'] == 'COMPANY' ? 'Empresa' : 'Plataforma');
    final secretMasked = item['secretMasked']?.toString() ?? '••••••••';
    final hasWebhook = item['hasWebhookToken'] == true;
    final webhookMasked = item['webhookMasked']?.toString();

    final serviceStatusLevel = item['serviceStatusLevel']?.toString() ??
        (item['lastValidationStatus'] == 'SUCCESS' ? 'TESTED' : 'CONFIGURED');
    final serviceStatusLabel = item['serviceStatusLabel']?.toString() ??
        (serviceStatusLevel == 'OPERATIONAL' ? 'Operação comprovada' : (serviceStatusLevel == 'TESTED' ? 'Conexão testada' : 'Configuração cadastrada'));
    final serviceStatusDesc = item['serviceStatusDescription']?.toString() ?? '';

    final consumption = item['consumption'] as Map<String, dynamic>?;

    String catLabel = category;
    if (category == 'AI_RESEARCH') catLabel = 'Pesquisa de Eventos (IA)';
    if (category == 'PAYMENT_GATEWAY') catLabel = 'Gateway de Pagamentos';
    if (category == 'MESSAGING') catLabel = 'Mensagens WhatsApp';

    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF1A2634),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.white12),
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
                    category == 'AI_RESEARCH'
                        ? Icons.auto_awesome_rounded
                        : (category == 'PAYMENT_GATEWAY' ? Icons.account_balance_rounded : Icons.message_rounded),
                    color: const Color(0xFF00E5FF),
                    size: 18,
                  ),
                  const SizedBox(width: 8),
                  Text(
                    provider,
                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 15),
                  ),
                ],
              ),
              Row(
                children: [
                  // Badge Pagador
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    margin: const EdgeInsets.only(right: 6),
                    decoration: BoxDecoration(
                      color: Colors.purple.withOpacity(0.2),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Text(
                      costPayerLabel.toUpperCase(),
                      style: const TextStyle(color: Color(0xFFD8B4FE), fontSize: 9, fontWeight: FontWeight.bold),
                    ),
                  ),
                  // Badge Ambiente
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: env == 'PRODUCTION'
                          ? const Color(0xFF10B981).withOpacity(0.2)
                          : Colors.amber.withOpacity(0.2),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(
                      env,
                      style: TextStyle(
                        color: env == 'PRODUCTION' ? const Color(0xFF10B981) : Colors.amber,
                        fontSize: 10,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(catLabel, style: const TextStyle(color: Colors.white70, fontSize: 12)),
          const SizedBox(height: 8),

          // Badge e Situação Real do Serviço
          Row(
            children: [
              _buildRealServiceStatusBadge(serviceStatusLevel, serviceStatusLabel),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  serviceStatusDesc,
                  style: const TextStyle(color: Colors.white60, fontSize: 11),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),

          // Informações de credencial
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(
              color: Colors.black26,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('Chave / API Key:', style: TextStyle(color: Colors.white38, fontSize: 11)),
                    Text(
                      secretMasked,
                      style: const TextStyle(color: Colors.white, fontFamily: 'monospace', fontSize: 11),
                    ),
                  ],
                ),
                if (hasWebhook) ...[
                  const SizedBox(height: 4),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('Webhook Token:', style: TextStyle(color: Colors.white38, fontSize: 11)),
                      Text(
                        webhookMasked ?? 'Configurado',
                        style: const TextStyle(color: Color(0xFF90CAF9), fontFamily: 'monospace', fontSize: 11),
                      ),
                    ],
                  ),
                ],
              ],
            ),
          ),

          // Barra de Consumo e Limites
          if (consumption != null) _buildConsumptionProgressBar(consumption),
          _buildTariffCard(item['tariff']),

          const Divider(color: Colors.white10, height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              TextButton.icon(
                icon: const Icon(Icons.bolt_rounded, size: 16, color: Color(0xFF00E5FF)),
                label: const Text('Testar', style: TextStyle(color: Color(0xFF00E5FF), fontSize: 12)),
                onPressed: () => _testIntegration(id),
              ),
              const SizedBox(width: 8),
              TextButton.icon(
                icon: const Icon(Icons.edit_rounded, size: 16, color: Colors.white70),
                label: const Text('Alterar / Limites', style: TextStyle(color: Colors.white70, fontSize: 12)),
                onPressed: () => _showConfigureModal(existingIntegration: item),
              ),
              const SizedBox(width: 8),
              TextButton.icon(
                icon: const Icon(Icons.delete_outline_rounded, size: 16, color: Colors.redAccent),
                label: const Text('Remover', style: TextStyle(color: Colors.redAccent, fontSize: 12)),
                onPressed: () => _deleteIntegration(id, provider),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildSharedServiceCard(Map<String, dynamic> svc) {
    final label = svc['label']?.toString() ?? 'Serviço';
    final notes = svc['notes']?.toString() ?? '';
    final serviceStatusLevel = svc['serviceStatusLevel']?.toString() ?? 'OPERATIONAL';
    final serviceStatusLabel = svc['serviceStatusLabel']?.toString() ?? 'Disponível (Compartilhado)';
    final consumption = svc['consumption'] as Map<String, dynamic>?;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF141E28),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.white10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(Icons.hub_rounded, color: Color(0xFF90CAF9), size: 20),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(label, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13)),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                            color: Colors.blue.withOpacity(0.2),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: const Text('PLATAFORMA', style: TextStyle(color: Color(0xFF90CAF9), fontSize: 9, fontWeight: FontWeight.bold)),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(notes, style: const TextStyle(color: Colors.white54, fontSize: 11)),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              _buildRealServiceStatusBadge(serviceStatusLevel, serviceStatusLabel),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  svc['serviceStatusDescription']?.toString() ?? 'Serviço compartilhado ativo na plataforma.',
                  style: const TextStyle(color: Colors.white60, fontSize: 11),
                ),
              ),
            ],
          ),
          if (consumption != null) _buildConsumptionProgressBar(consumption),
          _buildTariffCard(svc['tariff']),
        ],
      ),
    );
  }

  Widget _buildErrorView() {
    final isForbidden = _errorMessage != null &&
        (_errorMessage!.contains('403') ||
            _errorMessage!.toLowerCase().contains('restrito') ||
            _errorMessage!.toLowerCase().contains('administrador'));

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              isForbidden ? Icons.lock_person_rounded : Icons.error_outline_rounded,
              color: isForbidden ? const Color(0xFFA855F7) : Colors.redAccent,
              size: 56,
            ),
            const SizedBox(height: 16),
            Text(
              isForbidden ? 'Acesso Restrito ao Administrador' : 'Erro ao Carregar',
              style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 10),
            Text(
              isForbidden
                  ? 'A visualização e gestão de integrações e chaves de API da empresa é exclusiva para administradores autorizados. Vendedores e operadores não possuem permissão de acesso.'
                  : (_errorMessage ?? 'Erro ao carregar integrações.'),
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white70, fontSize: 14, height: 1.4),
            ),
            const SizedBox(height: 24),
            if (isForbidden)
              ElevatedButton.icon(
                onPressed: () => Navigator.pop(context),
                icon: const Icon(Icons.arrow_back_rounded, size: 18),
                label: const Text('Voltar ao Início'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFFA855F7),
                  foregroundColor: Colors.white,
                ),
              )
            else
              ElevatedButton(
                onPressed: _loadIntegrations,
                style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF00E5FF)),
                child: const Text('Tentar Novamente', style: TextStyle(color: Color(0xFF0F1923))),
              ),
          ],
        ),
      ),
    );
  }
}

class _ModalConfigurarIntegracao extends StatefulWidget {
  final Map<String, dynamic>? existing;
  final List<dynamic> catalog;
  final VoidCallback onSaved;

  const _ModalConfigurarIntegracao({
    this.existing,
    required this.catalog,
    required this.onSaved,
  });

  @override
  State<_ModalConfigurarIntegracao> createState() => _ModalConfigurarIntegracaoState();
}

class _ModalConfigurarIntegracaoState extends State<_ModalConfigurarIntegracao> {
  final ApiService _api = ApiService();

  late String _selectedCategory;
  late String _selectedProvider;
  late String _selectedEnv;

  final TextEditingController _secretCtrl = TextEditingController();
  final TextEditingController _webhookCtrl = TextEditingController();
  final TextEditingController _accountCtrl = TextEditingController();
  final TextEditingController _passwordCtrl = TextEditingController();
  final TextEditingController _unitsLimitCtrl = TextEditingController();
  final TextEditingController _budgetLimitCtrl = TextEditingController();

  bool _obscureSecret = true;
  bool _obscureWebhook = true;
  bool _isSubmitting = false;
  String? _modalError;

  @override
  void initState() {
    super.initState();
    if (widget.existing != null) {
      _selectedCategory = widget.existing!['category'] ?? 'AI_RESEARCH';
      _selectedProvider = widget.existing!['provider'] ?? 'GEMINI';
      _selectedEnv = widget.existing!['environment'] ?? 'PRODUCTION';
      _accountCtrl.text = widget.existing!['accountName'] ?? '';
      final existingUnits = widget.existing!['monthlyUnitsLimit'];
      if (existingUnits != null) {
        _unitsLimitCtrl.text = existingUnits.toString();
      }
      final existingBudget = widget.existing!['monthlyBudgetLimitCents'];
      if (existingBudget != null) {
        _budgetLimitCtrl.text = (existingBudget / 100).toStringAsFixed(2);
      }
    } else {
      _selectedCategory = 'AI_RESEARCH';
      _selectedProvider = 'GEMINI';
      _selectedEnv = 'PRODUCTION';
    }
  }

  @override
  void dispose() {
    _secretCtrl.dispose();
    _webhookCtrl.dispose();
    _accountCtrl.dispose();
    _passwordCtrl.dispose();
    _unitsLimitCtrl.dispose();
    _budgetLimitCtrl.dispose();
    super.dispose();
  }

  void _onCategoryChanged(String? val) {
    if (val == null) return;
    setState(() {
      _selectedCategory = val;
      if (val == 'AI_RESEARCH') {
        _selectedProvider = 'GEMINI';
        _selectedEnv = 'PRODUCTION';
      } else if (val == 'PAYMENT_GATEWAY') {
        _selectedProvider = 'ASAAS';
        _selectedEnv = 'SANDBOX';
      } else if (val == 'MESSAGING') {
        _selectedProvider = 'META_WHATSAPP';
        _selectedEnv = 'PRODUCTION';
      }
    });
  }

  Future<void> _submit() async {
    final secret = _secretCtrl.text.trim();
    if (widget.existing == null && secret.isEmpty) {
      setState(() => _modalError = 'Informe a chave / segredo da API.');
      return;
    }

    final pwd = _passwordCtrl.text.trim();
    if (pwd.isEmpty) {
      setState(() => _modalError = 'Informe sua senha de administrador para confirmar a operação.');
      return;
    }

    setState(() {
      _isSubmitting = true;
      _modalError = null;
    });

    try {
      final payload = <String, dynamic>{
        'category': _selectedCategory,
        'provider': _selectedProvider,
        'environment': _selectedEnv,
        'passwordConfirmation': pwd,
        if (secret.isNotEmpty) 'secret': secret,
        if (_selectedCategory == 'PAYMENT_GATEWAY' && _webhookCtrl.text.trim().isNotEmpty)
          'webhookToken': _webhookCtrl.text.trim(),
        if (_accountCtrl.text.trim().isNotEmpty)
          'accountName': _accountCtrl.text.trim(),
      };

      if (_unitsLimitCtrl.text.trim().isNotEmpty) {
        payload['monthlyUnitsLimit'] = int.tryParse(_unitsLimitCtrl.text.trim());
      } else if (widget.existing != null) {
        payload['monthlyUnitsLimit'] = null;
      }

      if (_budgetLimitCtrl.text.trim().isNotEmpty) {
        final bVal = double.tryParse(_budgetLimitCtrl.text.trim().replaceAll(',', '.'));
        if (bVal != null) {
          payload['monthlyBudgetLimitCents'] = (bVal * 100).round();
        }
      } else if (widget.existing != null) {
        payload['monthlyBudgetLimitCents'] = null;
      }

      await _api.saveCompanyIntegration(payload);
      if (mounted) {
        widget.onSaved();
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _modalError = e.toString().replaceFirst('Exception: ', '');
          _isSubmitting = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final isAsaas = _selectedCategory == 'PAYMENT_GATEWAY';

    return DraggableScrollableSheet(
      initialChildSize: 0.85,
      maxChildSize: 0.95,
      minChildSize: 0.5,
      expand: false,
      builder: (_, scrollCtrl) {
        return SingleChildScrollView(
          controller: scrollCtrl,
          padding: EdgeInsets.only(
            left: 20,
            right: 20,
            top: 16,
            bottom: MediaQuery.of(context).viewInsets.bottom + 24,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: Colors.white24,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Text(
                widget.existing != null ? 'Atualizar Credencial' : 'Cadastrar Nova Credencial',
                style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 6),
              const Text(
                'Insira as credenciais da sua empresa. Os dados são cifrados no cofre e nunca são exportados.',
                style: TextStyle(color: Colors.white54, fontSize: 12),
              ),
              const SizedBox(height: 16),

              if (_modalError != null) ...[
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: Colors.redAccent.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: Colors.redAccent.withOpacity(0.4)),
                  ),
                  child: Text(_modalError!, style: const TextStyle(color: Colors.redAccent, fontSize: 12)),
                ),
                const SizedBox(height: 14),
              ],

              // Categoria
              DropdownButtonFormField<String>(
                value: _selectedCategory,
                dropdownColor: const Color(0xFF160D24),
                style: const TextStyle(color: Colors.white, fontSize: 13),
                decoration: const InputDecoration(
                  labelText: 'Tipo de Integração',
                  labelStyle: TextStyle(color: Colors.white70),
                  enabledBorder: OutlineInputBorder(borderSide: BorderSide(color: Colors.white24)),
                  focusedBorder: OutlineInputBorder(borderSide: BorderSide(color: Color(0xFF00E5FF))),
                ),
                items: const [
                  DropdownMenuItem(value: 'AI_RESEARCH', child: Text('Pesquisa de Eventos por IA (Gemini)')),
                  DropdownMenuItem(value: 'PAYMENT_GATEWAY', child: Text('Cobranças e Boletos (Asaas)')),
                  DropdownMenuItem(value: 'MESSAGING', child: Text('WhatsApp Corporativo (Meta)')),
                ],
                onChanged: _onCategoryChanged,
              ),
              const SizedBox(height: 14),

              // Ambiente (se Asaas)
              if (isAsaas) ...[
                DropdownButtonFormField<String>(
                  value: _selectedEnv,
                  dropdownColor: const Color(0xFF160D24),
                  style: const TextStyle(color: Colors.white, fontSize: 13),
                  decoration: const InputDecoration(
                    labelText: 'Ambiente Asaas',
                    labelStyle: TextStyle(color: Colors.white70),
                    enabledBorder: OutlineInputBorder(borderSide: BorderSide(color: Colors.white24)),
                    focusedBorder: OutlineInputBorder(borderSide: BorderSide(color: Color(0xFF00E5FF))),
                  ),
                  items: const [
                    DropdownMenuItem(value: 'SANDBOX', child: Text('SANDBOX (Homologação / Testes)')),
                    DropdownMenuItem(value: 'PRODUCTION', child: Text('PRODUÇÃO (Ambiente Real)')),
                  ],
                  onChanged: (val) {
                    if (val != null) setState(() => _selectedEnv = val);
                  },
                ),
                const SizedBox(height: 14),
              ],

              // Segredo / API Key
              TextFormField(
                controller: _secretCtrl,
                obscureText: _obscureSecret,
                style: const TextStyle(color: Colors.white, fontSize: 13),
                decoration: InputDecoration(
                  labelText: isAsaas
                      ? (_selectedEnv == 'SANDBOX' ? 'API Key Asaas (Sandbox)' : 'API Key Asaas (Produção)')
                      : 'Chave de API / Segredo',
                  labelStyle: const TextStyle(color: Colors.white70),
                  enabledBorder: const OutlineInputBorder(borderSide: BorderSide(color: Colors.white24)),
                  focusedBorder: const OutlineInputBorder(borderSide: BorderSide(color: Color(0xFF00E5FF))),
                  suffixIcon: IconButton(
                    icon: Icon(_obscureSecret ? Icons.visibility_off : Icons.visibility, color: Colors.white54),
                    onPressed: () => setState(() => _obscureSecret = !_obscureSecret),
                  ),
                ),
              ),
              const SizedBox(height: 14),

              // Webhook (apenas Asaas)
              if (isAsaas) ...[
                TextFormField(
                  controller: _webhookCtrl,
                  obscureText: _obscureWebhook,
                  style: const TextStyle(color: Colors.white, fontSize: 13),
                  decoration: InputDecoration(
                    labelText: 'Token de Webhook (asaas-access-token)',
                    labelStyle: const TextStyle(color: Colors.white70),
                    enabledBorder: const OutlineInputBorder(borderSide: BorderSide(color: Colors.white24)),
                    focusedBorder: const OutlineInputBorder(borderSide: BorderSide(color: Color(0xFF00E5FF))),
                    suffixIcon: IconButton(
                      icon: Icon(_obscureWebhook ? Icons.visibility_off : Icons.visibility, color: Colors.white54),
                      onPressed: () => setState(() => _obscureWebhook = !_obscureWebhook),
                    ),
                  ),
                ),
                const SizedBox(height: 14),
              ],

              // Identificação da conta (opcional)
              TextFormField(
                controller: _accountCtrl,
                style: const TextStyle(color: Colors.white, fontSize: 13),
                decoration: const InputDecoration(
                  labelText: 'Titular / Identificação da Conta (Opcional)',
                  labelStyle: TextStyle(color: Colors.white70),
                  enabledBorder: OutlineInputBorder(borderSide: BorderSide(color: Colors.white24)),
                  focusedBorder: OutlineInputBorder(borderSide: BorderSide(color: Color(0xFF00E5FF))),
                ),
              ),
              const SizedBox(height: 14),

              // Limite de Requisições Mensais (Lumora)
              TextFormField(
                controller: _unitsLimitCtrl,
                keyboardType: TextInputType.number,
                style: const TextStyle(color: Colors.white, fontSize: 13),
                decoration: const InputDecoration(
                  labelText: 'Limite Mensal de Requisições (Lumora)',
                  hintText: 'Ex: 1000 (deixe em branco para ilimitado)',
                  hintStyle: TextStyle(color: Colors.white24, fontSize: 12),
                  labelStyle: TextStyle(color: Colors.white70),
                  enabledBorder: OutlineInputBorder(borderSide: BorderSide(color: Colors.white24)),
                  focusedBorder: OutlineInputBorder(borderSide: BorderSide(color: Color(0xFF00E5FF))),
                ),
              ),
              const SizedBox(height: 14),

              // Teto de Orçamento Mensal em R$ (Lumora)
              TextFormField(
                controller: _budgetLimitCtrl,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                style: const TextStyle(color: Colors.white, fontSize: 13),
                decoration: const InputDecoration(
                  labelText: 'Teto Mensal de Gastos em R\$ (Lumora)',
                  hintText: 'Ex: 50.00 (deixe em branco para ilimitado)',
                  hintStyle: TextStyle(color: Colors.white24, fontSize: 12),
                  labelStyle: TextStyle(color: Colors.white70),
                  enabledBorder: OutlineInputBorder(borderSide: BorderSide(color: Colors.white24)),
                  focusedBorder: OutlineInputBorder(borderSide: BorderSide(color: Color(0xFF00E5FF))),
                ),
              ),
              const SizedBox(height: 14),

              // Senha de confirmação (step-up)
              TextFormField(
                controller: _passwordCtrl,
                obscureText: true,
                style: const TextStyle(color: Colors.white, fontSize: 13),
                decoration: const InputDecoration(
                  labelText: 'Sua Senha de Administrador (Confirmação)',
                  labelStyle: TextStyle(color: Colors.white70),
                  enabledBorder: OutlineInputBorder(borderSide: BorderSide(color: Colors.white24)),
                  focusedBorder: OutlineInputBorder(borderSide: BorderSide(color: Color(0xFF00E5FF))),
                ),
              ),
              const SizedBox(height: 20),

              // Botão Salvar
              ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF00E5FF),
                  foregroundColor: const Color(0xFF0F1923),
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                ),
                onPressed: _isSubmitting ? null : _submit,
                child: _isSubmitting
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFF0F1923)),
                      )
                    : const Text(
                        'Gravar Credencial no Cofre',
                        style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                      ),
              ),
            ],
          ),
        );
      },
    );
  }
}
