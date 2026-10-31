import 'dart:async';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../servicos/servico_api.dart';

class AreaAtendimentoTecnicoScreen extends StatefulWidget {
  final String supportToken;
  final String companyName;
  final String companyId;
  final String escopo;
  final DateTime expiresAt;

  AreaAtendimentoTecnicoScreen({
    Key? key,
    required this.supportToken,
    String? companyName,
    String? empresaNome,
    required this.companyId,
    required this.escopo,
    DateTime? expiresAt,
    String? expiresAtStr,
  })  : companyName = companyName ?? empresaNome ?? 'Empresa Atendida',
        expiresAt = expiresAt ??
            (expiresAtStr != null
                ? DateTime.tryParse(expiresAtStr) ?? DateTime.now().add(const Duration(hours: 1))
                : DateTime.now().add(const Duration(hours: 1))),
        super(key: key);

  @override
  State<AreaAtendimentoTecnicoScreen> createState() => _AreaAtendimentoTecnicoScreenState();
}

class _AreaAtendimentoTecnicoScreenState extends State<AreaAtendimentoTecnicoScreen>
    with SingleTickerProviderStateMixin {
  late final ApiService _api;
  late final TabController _tabController;

  bool _isLoading = false;
  String? _errorMessage;

  List<dynamic> _chamados = [];
  String? _chamadosError;

  Map<String, dynamic>? _metricas;
  String? _metricasError;

  List<dynamic> _alertas = [];
  String? _alertasError;

  List<dynamic> _integracoes = [];
  String? _integracoesError;

  Timer? _countdownTimer;
  Duration _tempoRestante = Duration.zero;

  @override
  void initState() {
    super.initState();
    // Instância isolada exclusiva com token efêmero em RAM
    _api = ApiService.isolated(token: widget.supportToken);

    final tabCount = widget.escopo == 'INTEGRATION_DEBUG' ? 4 : 3;
    _tabController = TabController(length: tabCount, vsync: this);

    _atualizarTempoRestante();
    _countdownTimer = Timer.periodic(const Duration(seconds: 1), (_) => _atualizarTempoRestante());

    _carregarDadosIniciais();
  }

  @override
  void dispose() {
    _countdownTimer?.cancel();
    _tabController.dispose();
    super.dispose();
  }

  void _atualizarTempoRestante() {
    final now = DateTime.now();
    if (now.isAfter(widget.expiresAt)) {
      _countdownTimer?.cancel();
      if (mounted) {
        setState(() {
          _tempoRestante = Duration.zero;
        });
        _exibirDialogoExpirado();
      }
    } else {
      if (mounted) {
        setState(() {
          _tempoRestante = widget.expiresAt.difference(now);
        });
      }
    }
  }

  void _exibirDialogoExpirado() {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1E293B),
        title: const Row(
          children: [
            Icon(Icons.timer_off_rounded, color: Colors.orangeAccent),
            SizedBox(width: 8),
            Text('Sessão Expirada', style: TextStyle(color: Colors.white)),
          ],
        ),
        content: const Text(
          'O prazo da concessão de suporte autorizada expirou. O contexto técnico foi finalizado.',
          style: TextStyle(color: Color(0xFF94A3B8)),
        ),
        actions: [
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF38BDF8), foregroundColor: const Color(0xFF0F172A)),
            onPressed: () {
              Navigator.of(ctx).pop();
              Navigator.of(context).pop();
            },
            child: const Text('OK'),
          ),
        ],
      ),
    );
  }

  Future<void> _carregarDadosIniciais() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
      _chamadosError = null;
      _metricasError = null;
      _alertasError = null;
      _integracoesError = null;
    });

    try {
      // 1. Chamados da empresa
      try {
        final tickets = await _api.getTechnicalSessionTickets();
        _chamados = tickets;
      } catch (e) {
        if (_isSecurityRevocation(e)) return;
        _chamadosError = _formatUserFriendlyError(e);
      }

      // 2. Telemetria e filas do aparelho
      try {
        final metrics = await _api.getTechnicalSessionMetrics();
        _metricas = metrics;
      } catch (e) {
        if (_isSecurityRevocation(e)) return;
        _metricasError = _formatUserFriendlyError(e);
      }

      // 3. Alertas operacionais internos
      try {
        final alerts = await _api.getTechnicalSessionAlerts();
        _alertas = alerts;
      } catch (e) {
        if (_isSecurityRevocation(e)) return;
        _alertasError = _formatUserFriendlyError(e);
      }

      // 4. Se escopo for INTEGRATION_DEBUG, carrega integrações
      if (widget.escopo == 'INTEGRATION_DEBUG') {
        try {
          final integrations = await _api.getTechnicalSessionIntegrations();
          _integracoes = integrations;
        } catch (e) {
          if (_isSecurityRevocation(e)) return;
          _integracoesError = _formatUserFriendlyError(e);
        }
      }
    } catch (e) {
      if (_isSecurityRevocation(e)) return;
      _errorMessage = _formatUserFriendlyError(e);
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  String _formatUserFriendlyError(dynamic error) {
    if (error is ApiException) {
      if (error.isScopeForbidden) {
        return 'Ação restrita: o escopo desta sessão (${widget.escopo}) não permite acessar este recurso.';
      }
      return error.message;
    }
    return error.toString();
  }

  bool _isSecurityRevocation(dynamic error) {
    if (error is ApiException && error.isRevocationOrExpiration) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Sessão técnica encerrada ou revogada: ${error.message}'),
            backgroundColor: Colors.redAccent,
          ),
        );
        Navigator.of(context).pop();
      }
      return true;
    }
    final str = error.toString().toUpperCase();
    if (str.contains('SUPPORT_GRANT_REVOKED') ||
        str.contains('SUPPORT_GRANT_EXPIRED') ||
        str.contains('SUPPORT_SESSION_EXPIRED') ||
        str.contains('401')) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Acesso encerrado ou revogado pelo servidor: $error'),
            backgroundColor: Colors.redAccent,
          ),
        );
        Navigator.of(context).pop();
      }
      return true;
    }
    return false;
  }

  void _confirmarEncerramento() {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1E293B),
        title: const Text('Encerrar Sessão Técnica?', style: TextStyle(color: Colors.white)),
        content: Text(
          'Deseja sair da sessão técnica da empresa "${widget.companyName}"?\nO token efêmero será descartado da memória.',
          style: const TextStyle(color: Color(0xFF94A3B8)),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Cancelar', style: TextStyle(color: Colors.white60)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: Colors.redAccent, foregroundColor: Colors.white),
            onPressed: () {
              _api.clearToken();
              Navigator.of(ctx).pop();
              Navigator.of(context).pop();
            },
            child: const Text('Encerrar'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final minutes = _tempoRestante.inMinutes;
    final seconds = _tempoRestante.inSeconds % 60;
    final timerFormatted = '${minutes.toString().padLeft(2, '0')}:${seconds.toString().padLeft(2, '0')}';

    return Scaffold(
      backgroundColor: const Color(0xFF0F172A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1E293B),
        elevation: 0,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.shield_rounded, color: Color(0xFF38BDF8), size: 18),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    widget.companyName,
                    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Colors.white),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 2),
            Row(
              children: [
                _buildEscopoBadge(widget.escopo),
                const SizedBox(width: 8),
                Text(
                  'Expira em: $timerFormatted',
                  style: TextStyle(
                    fontSize: 11,
                    color: _tempoRestante.inMinutes < 5 ? Colors.redAccent : const Color(0xFF38BDF8),
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded, color: Colors.white70),
            tooltip: 'Atualizar Dados',
            onPressed: _carregarDadosIniciais,
          ),
          TextButton.icon(
            icon: const Icon(Icons.exit_to_app_rounded, color: Colors.redAccent, size: 16),
            label: const Text('Encerrar', style: TextStyle(color: Colors.redAccent, fontWeight: FontWeight.bold)),
            onPressed: _confirmarEncerramento,
          ),
        ],
        bottom: TabBar(
          controller: _tabController,
          indicatorColor: const Color(0xFF38BDF8),
          labelColor: const Color(0xFF38BDF8),
          unselectedLabelColor: const Color(0xFF94A3B8),
          tabs: [
            const Tab(icon: Icon(Icons.confirmation_number_rounded), text: 'Chamados'),
            const Tab(icon: Icon(Icons.sync_problem_rounded), text: 'Filas / Sync'),
            const Tab(icon: Icon(Icons.warning_amber_rounded), text: 'Alertas'),
            if (widget.escopo == 'INTEGRATION_DEBUG')
              const Tab(icon: Icon(Icons.hub_rounded), text: 'Integrações'),
          ],
        ),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF38BDF8)))
          : TabBarView(
              controller: _tabController,
              children: [
                _buildTabChamados(),
                _buildTabTelemetria(),
                _buildTabAlertas(),
                if (widget.escopo == 'INTEGRATION_DEBUG') _buildTabIntegracoes(),
              ],
            ),
    );
  }

  Widget _buildEscopoBadge(String escopo) {
    Color bg = Colors.blue.withOpacity(0.2);
    Color txt = Colors.blueAccent;
    if (escopo == 'READ_ONLY') {
      bg = Colors.amber.withOpacity(0.2);
      txt = Colors.amberAccent;
    } else if (escopo == 'INTEGRATION_DEBUG') {
      bg = Colors.purple.withOpacity(0.2);
      txt = Colors.purpleAccent;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(4)),
      child: Text(escopo, style: TextStyle(color: txt, fontSize: 10, fontWeight: FontWeight.bold)),
    );
  }

  Widget _buildTabChamados() {
    if (_chamadosError != null) {
      return _buildErrorStateCard('Falha ao carregar chamados', _chamadosError!);
    }

    if (_chamados.isEmpty) {
      return const Center(child: Text('Nenhum chamado aberto para esta empresa.', style: TextStyle(color: Color(0xFF94A3B8))));
    }

    final isReadOnly = widget.escopo == 'READ_ONLY';

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: _chamados.length,
      itemBuilder: (ctx, idx) {
        final t = _chamados[idx];
        return Card(
          color: const Color(0xFF1E293B),
          margin: const EdgeInsets.only(bottom: 12),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      t['ticketNumber'] ?? '#---',
                      style: const TextStyle(color: Color(0xFF38BDF8), fontWeight: FontWeight.bold, fontSize: 12),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: t['status'] == 'OPEN' ? Colors.blue.withOpacity(0.2) : Colors.green.withOpacity(0.2),
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: Text(
                        t['status'] ?? 'OPEN',
                        style: TextStyle(
                          color: t['status'] == 'OPEN' ? Colors.blueAccent : Colors.greenAccent,
                          fontSize: 11,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Text(t['title'] ?? '', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14)),
                const SizedBox(height: 4),
                Text(t['description'] ?? '', style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12)),
                const SizedBox(height: 12),
                if (isReadOnly)
                  const Text('Modo Somente Leitura — Resposta desabilitada', style: TextStyle(color: Colors.amberAccent, fontSize: 11))
                else
                  Align(
                    alignment: Alignment.centerRight,
                    child: OutlinedButton.icon(
                      icon: const Icon(Icons.reply_rounded, size: 14),
                      label: const Text('Responder Chamado'),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: const Color(0xFF38BDF8),
                        side: const BorderSide(color: Color(0xFF38BDF8)),
                      ),
                      onPressed: () => _abrirDialogoResposta(t['id']),
                    ),
                  ),
              ],
            ),
          ),
        );
      },
    );
  }

  Future<void> _abrirDialogoResposta(String ticketId) async {
    final textCtrl = TextEditingController();

    await showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1E293B),
        title: const Text('Responder Chamado', style: TextStyle(color: Colors.white)),
        content: TextField(
          controller: textCtrl,
          maxLines: 3,
          style: const TextStyle(color: Colors.white),
          decoration: const InputDecoration(
            hintText: 'Escreva a resposta técnica...',
            hintStyle: TextStyle(color: Colors.white54),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Cancelar', style: TextStyle(color: Colors.white60)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF38BDF8), foregroundColor: const Color(0xFF0F172A)),
            onPressed: () async {
              final txt = textCtrl.text.trim();
              if (txt.isEmpty) return;
              try {
                await _api.addTechnicalSessionTicketMessage(ticketId, txt);
                Navigator.of(ctx).pop();
                _carregarDadosIniciais();
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Mensagem técnica enviada com sucesso!'), backgroundColor: Colors.green),
                );
              } catch (err) {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(content: Text('Erro ao enviar mensagem: $err'), backgroundColor: Colors.redAccent),
                );
              }
            },
            child: const Text('Enviar'),
          ),
        ],
      ),
    );
  }

  Widget _buildTabTelemetria() {
    if (_metricasError != null) {
      return _buildErrorStateCard('Falha ao carregar telemetria', _metricasError!);
    }

    final m = _metricas;
    if (m == null) {
      return const Center(child: Text('Nenhuma telemetria disponível.', style: TextStyle(color: Color(0xFF94A3B8))));
    }

    final telemetria = (m['telemetriaDispositivos'] as List<dynamic>?) ??
        (m['pendenciasOfflineAparelhos']?['amostraAparelhos'] as List<dynamic>? ?? []);

    final totalFichas = m['fichas']?['totalCadastradas'] ?? m['fichas']?['total'] ?? 0;
    final totalVendas = m['vendas']?['totalRealizadas'] ?? m['vendas']?['totalQuantidade'] ?? 0;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
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
              const Text('Resumo da Operação em Campo:', style: TextStyle(color: Color(0xFF38BDF8), fontWeight: FontWeight.bold)),
              const SizedBox(height: 8),
              Text('Fichas Cadastradas: $totalFichas', style: const TextStyle(color: Colors.white)),
              Text('Vendas Realizadas: $totalVendas', style: const TextStyle(color: Colors.white)),
              Text('Dispositivos Reportados: ${telemetria.length}', style: const TextStyle(color: Colors.white)),
            ],
          ),
        ),
        const SizedBox(height: 16),
        const Text('Aparelhos e Filas Offline em Campo:', style: TextStyle(color: Color(0xFF94A3B8), fontWeight: FontWeight.bold, fontSize: 13)),
        const SizedBox(height: 8),
        if (telemetria.isEmpty)
          const Padding(
            padding: EdgeInsets.all(16),
            child: Text('Nenhum aparelho reportou telemetria recentemente.', style: TextStyle(color: Colors.white54, fontSize: 12)),
          )
        else
          ...telemetria.map((d) {
            final pending = d['pendingOfflineCount'] ?? d['pendencias'] ?? 0;
            final platform = d['platform'] ?? d['plataforma'] ?? 'ANDROID';
            final appVersion = d['appVersion'] ?? d['versaoApp'] ?? '1.0';
            final buildNum = d['buildNumber'] != null ? '+${d['buildNumber']}' : '';
            final conn = d['connectivityStatus'] ?? d['conectividade'] ?? 'OFFLINE';
            final dateRaw = d['lastReportedAt'] ?? d['ultimaComunicacao'];

            return Card(
              color: const Color(0xFF1E293B),
              margin: const EdgeInsets.only(bottom: 8),
              child: ListTile(
                leading: Icon(
                  Icons.phone_android_rounded,
                  color: pending > 0 ? Colors.orangeAccent : Colors.greenAccent,
                ),
                title: Text(
                  '$platform • App v$appVersion$buildNum',
                  style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.bold),
                ),
                subtitle: Text(
                  'Pendências Offline: $pending | Conexão: $conn',
                  style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 11),
                ),
                trailing: Text(
                  dateRaw != null
                      ? DateFormat('HH:mm dd/MM').format(DateTime.tryParse(dateRaw) ?? DateTime.now())
                      : '',
                  style: const TextStyle(color: Color(0xFF64748B), fontSize: 10),
                ),
              ),
            );
          }),
      ],
    );
  }

  Widget _buildTabAlertas() {
    if (_alertasError != null) {
      return _buildErrorStateCard('Falha ao carregar alertas', _alertasError!);
    }

    if (_alertas.isEmpty) {
      return const Center(child: Text('Nenhum alerta operacional pendente.', style: TextStyle(color: Color(0xFF94A3B8))));
    }

    final isReadOnly = widget.escopo == 'READ_ONLY';

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: _alertas.length,
      itemBuilder: (ctx, idx) {
        final a = _alertas[idx];
        final isAck = a['acknowledged'] == true;
        return Card(
          color: const Color(0xFF1E293B),
          margin: const EdgeInsets.only(bottom: 12),
          child: ListTile(
            leading: Icon(
              a['severity'] == 'CRITICAL' ? Icons.error_rounded : Icons.warning_amber_rounded,
              color: a['severity'] == 'CRITICAL' ? Colors.redAccent : Colors.amberAccent,
            ),
            title: Text(a['title'] ?? '', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13)),
            subtitle: Text(
              'Categoria: ${a['category']} • Status: ${isAck ? 'Reconhecido' : 'Pendente'}',
              style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 11),
            ),
            trailing: isAck
                ? const Icon(Icons.check_circle_rounded, color: Colors.greenAccent, size: 18)
                : (isReadOnly
                    ? null
                    : OutlinedButton(
                        style: OutlinedButton.styleFrom(
                          foregroundColor: const Color(0xFF38BDF8),
                          side: const BorderSide(color: Color(0xFF38BDF8)),
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        ),
                        onPressed: () => _reconhecerAlerta(a['id']),
                        child: const Text('Reconhecer', style: TextStyle(fontSize: 11)),
                      )),
          ),
        );
      },
    );
  }

  Future<void> _reconhecerAlerta(String alertId) async {
    try {
      await _api.acknowledgeTechnicalSessionAlert(alertId);
      _carregarDadosIniciais();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Alerta reconhecido com sucesso!'), backgroundColor: Colors.green),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Falha ao reconhecer alerta: $e'), backgroundColor: Colors.redAccent),
        );
      }
    }
  }

  Widget _buildTabIntegracoes() {
    if (_integracoesError != null) {
      return _buildErrorStateCard('Falha ao carregar integrações', _integracoesError!);
    }

    if (_integracoes.isEmpty) {
      return const Center(child: Text('Nenhuma integração cadastrada para esta empresa.', style: TextStyle(color: Color(0xFF94A3B8))));
    }

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: _integracoes.length,
      itemBuilder: (ctx, idx) {
        final it = _integracoes[idx];
        return Card(
          color: const Color(0xFF1E293B),
          margin: const EdgeInsets.only(bottom: 12),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(it['provider'] ?? '', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14)),
                      const SizedBox(height: 4),
                      Text('Categoria: ${it['category']} • Status: ${it['status']}', style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 11)),
                      if (it['lastValidationStatus'] != null)
                        Text(
                          'Último Teste: ${it['lastValidationStatus']}',
                          style: TextStyle(
                            color: it['lastValidationStatus'] == 'SUCCESS' ? Colors.greenAccent : Colors.redAccent,
                            fontSize: 11,
                          ),
                        ),
                    ],
                  ),
                ),
                ElevatedButton.icon(
                  icon: const Icon(Icons.network_check_rounded, size: 14),
                  label: const Text('Testar Ping'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF38BDF8),
                    foregroundColor: const Color(0xFF0F172A),
                  ),
                  onPressed: () => _testarConexaoIntegracao(it['id']),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Future<void> _testarConexaoIntegracao(String integrationId) async {
    try {
      final res = await _api.testTechnicalSessionIntegration(integrationId);
      final r = (res['testResult'] is Map) ? res['testResult'] : res;
      final ok = r['success'] == true;
      final msg = r['message'] ?? 'Teste finalizado.';

      if (mounted) {
        showDialog(
          context: context,
          builder: (ctx) => AlertDialog(
            backgroundColor: const Color(0xFF1E293B),
            title: Row(
              children: [
                Icon(ok ? Icons.check_circle_rounded : Icons.error_rounded, color: ok ? Colors.greenAccent : Colors.redAccent),
                const SizedBox(width: 8),
                Text(ok ? 'Conexão OK' : 'Falha na Conexão', style: const TextStyle(color: Colors.white)),
              ],
            ),
            content: Text(
              msg,
              style: const TextStyle(color: Color(0xFF94A3B8)),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(ctx).pop(),
                child: const Text('OK', style: TextStyle(color: Color(0xFF38BDF8))),
              ),
            ],
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erro no teste: $e'), backgroundColor: Colors.redAccent),
        );
      }
    }
  }

  Widget _buildErrorStateCard(String title, String message) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: const Color(0xFF1E293B),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: Colors.redAccent.withOpacity(0.4)),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.error_outline_rounded, color: Colors.redAccent, size: 36),
              const SizedBox(height: 12),
              Text(title, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14)),
              const SizedBox(height: 8),
              Text(message, textAlign: TextAlign.center, style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12)),
              const SizedBox(height: 16),
              ElevatedButton.icon(
                icon: const Icon(Icons.refresh_rounded, size: 16),
                label: const Text('Tentar Novamente'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF38BDF8),
                  foregroundColor: const Color(0xFF0F172A),
                ),
                onPressed: _carregarDadosIniciais,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
