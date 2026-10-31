import 'dart:async';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../servicos/servico_api.dart';

/// Área de Atendimento Técnico com sessão isolada autorizada.
///
/// REGRAS ESTRITAS DE SEGURANÇA:
/// 1. O [supportToken] é mantido estritamente em memória volátil dentro do [ApiService.isolated].
/// 2. Nunca grava o token em logs, clipboard ou SharedPreferences.
/// 3. O fechamento ou revogação encerra imediatamente o contexto técnico.
/// 4. A sessão principal do proprietário é completamente preservada sem uso de privilégios globais.
class AreaAtendimentoTecnicoScreen extends StatefulWidget {
  final String supportToken;
  final String empresaNome;
  final String companyId;
  final String escopo;
  final String? expiresAtStr;

  const AreaAtendimentoTecnicoScreen({
    super.key,
    required this.supportToken,
    required this.empresaNome,
    required this.companyId,
    required this.escopo,
    this.expiresAtStr,
  });

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
  Map<String, dynamic>? _metricas;
  List<dynamic> _alertas = [];
  List<dynamic> _integracoes = [];

  Timer? _countdownTimer;
  Duration _tempoRestante = Duration.zero;

  @override
  void initState() {
    super.initState();
    // Instancia API isolada com o token efêmero de suporte
    _api = ApiService.isolated(token: widget.supportToken);

    final numTabs = widget.escopo == 'INTEGRATION_DEBUG' ? 4 : 3;
    _tabController = TabController(length: numTabs, vsync: this);

    _calcularTempoRestante();
    _countdownTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      if (mounted) _calcularTempoRestante();
    });

    _carregarDadosIniciais();
  }

  @override
  void dispose() {
    _countdownTimer?.cancel();
    _tabController.dispose();
    super.dispose();
  }

  void _calcularTempoRestante() {
    if (widget.expiresAtStr == null) return;
    try {
      final exp = DateTime.parse(widget.expiresAtStr!);
      final diff = exp.difference(DateTime.now());
      if (diff.isNegative) {
        _tempoRestante = Duration.zero;
        _encerrarPorExpiracao();
      } else {
        setState(() {
          _tempoRestante = diff;
        });
      }
    } catch (_) {}
  }

  void _encerrarPorExpiracao() {
    _countdownTimer?.cancel();
    if (!mounted) return;
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1E293B),
        title: Row(
          children: const [
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
    });

    try {
      // 1. Chamados da empresa
      try {
        final tickets = await _api.getOwnerSupportTickets(companyId: widget.companyId);
        _chamados = tickets;
      } catch (e) {
        if (_isSecurityRevocation(e)) return;
      }

      // 2. Telemetria e filas do aparelho
      try {
        final metrics = await _api.getOwnerOperationalMetrics(companyId: widget.companyId);
        _metricas = metrics;
      } catch (e) {
        if (_isSecurityRevocation(e)) return;
      }

      // 3. Alertas operacionais internos
      try {
        final alerts = await _api.getOwnerInternalAlerts(companyId: widget.companyId);
        _alertas = alerts;
      } catch (e) {
        if (_isSecurityRevocation(e)) return;
      }

      // 4. Se escopo for INTEGRATION_DEBUG, carrega integrações
      if (widget.escopo == 'INTEGRATION_DEBUG') {
        try {
          final integrations = await _api.getCompanyIntegrations(widget.companyId);
          _integracoes = integrations;
        } catch (e) {
          if (_isSecurityRevocation(e)) return;
        }
      }
    } catch (e) {
      if (_isSecurityRevocation(e)) return;
      _errorMessage = e.toString();
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  bool _isSecurityRevocation(dynamic error) {
    final str = error.toString().toUpperCase();
    if (str.contains('SUPPORT_GRANT_REVOKED') ||
        str.contains('SUPPORT_GRANT_EXPIRED') ||
        str.contains('401') ||
        str.contains('403')) {
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
          'Deseja fechar o atendimento técnico de ${widget.empresaNome}? O token de suporte será descartado da memória.',
          style: const TextStyle(color: Color(0xFF94A3B8)),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Cancelar', style: TextStyle(color: Colors.white60)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: Colors.redAccent),
            onPressed: () {
              Navigator.of(ctx).pop();
              Navigator.of(context).pop();
            },
            child: const Text('Encerrar', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isReadOnly = widget.escopo == 'READ_ONLY';

    return Scaffold(
      backgroundColor: const Color(0xFF0F172A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1E293B),
        elevation: 2,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.shield_rounded, color: Color(0xFF38BDF8), size: 16),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    'Atendimento: ${widget.empresaNome}',
                    style: const TextStyle(color: Colors.white, fontSize: 15, fontWeight: FontWeight.bold),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 2),
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: isReadOnly ? Colors.amber.withOpacity(0.2) : Colors.cyan.withOpacity(0.2),
                    borderRadius: BorderRadius.circular(4),
                    border: Border.all(color: isReadOnly ? Colors.amberAccent : Colors.cyanAccent, width: 0.5),
                  ),
                  child: Text(
                    widget.escopo,
                    style: TextStyle(
                      color: isReadOnly ? Colors.amberAccent : Colors.cyanAccent,
                      fontSize: 10,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                if (_tempoRestante > Duration.zero)
                  Text(
                    'Restam ${_tempoRestante.inHours}h ${_tempoRestante.inMinutes % 60}m',
                    style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 11),
                  )
                else
                  const Text('Prazo esgotado', style: TextStyle(color: Colors.redAccent, fontSize: 11)),
              ],
            ),
          ],
        ),
        actions: [
          TextButton.icon(
            icon: const Icon(Icons.exit_to_app_rounded, color: Colors.redAccent, size: 18),
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
            const Tab(icon: Icon(Icons.confirmation_number_outlined, size: 18), text: 'Chamados'),
            const Tab(icon: Icon(Icons.cloud_sync_outlined, size: 18), text: 'Filas/Sync'),
            const Tab(icon: Icon(Icons.notifications_active_outlined, size: 18), text: 'Alertas'),
            if (widget.escopo == 'INTEGRATION_DEBUG')
              const Tab(icon: Icon(Icons.hub_outlined, size: 18), text: 'Integrações'),
          ],
        ),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF38BDF8)))
          : TabBarView(
              controller: _tabController,
              children: [
                _buildTabChamados(isReadOnly),
                _buildTabTelemetria(),
                _buildTabAlertas(isReadOnly),
                if (widget.escopo == 'INTEGRATION_DEBUG') _buildTabIntegracoes(),
              ],
            ),
    );
  }

  Widget _buildTabChamados(bool isReadOnly) {
    if (_chamados.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.inbox_rounded, color: Color(0xFF64748B), size: 48),
            const SizedBox(height: 12),
            Text('Nenhum chamado aberto para ${widget.empresaNome}', style: const TextStyle(color: Color(0xFF94A3B8))),
          ],
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: _chamados.length,
      itemBuilder: (ctx, idx) {
        final t = _chamados[idx];
        return Card(
          color: const Color(0xFF1E293B),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          margin: const EdgeInsets.only(bottom: 12),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(
                      t['ticketNumber'] ?? 'TICKET',
                      style: const TextStyle(color: Color(0xFF38BDF8), fontWeight: FontWeight.bold),
                    ),
                    const Spacer(),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
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
    bool isInternal = false;

    await showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDlgState) => AlertDialog(
          backgroundColor: const Color(0xFF1E293B),
          title: const Text('Responder Chamado', style: TextStyle(color: Colors.white)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: textCtrl,
                maxLines: 3,
                style: const TextStyle(color: Colors.white),
                decoration: const InputDecoration(
                  hintText: 'Escreva a resposta técnica...',
                  hintStyle: TextStyle(color: Colors.white54),
                ),
              ),
              const SizedBox(height: 12),
              SwitchListTile(
                title: const Text('Nota Técnica Interna (Oculta da empresa)', style: TextStyle(color: Colors.amberAccent, fontSize: 12)),
                value: isInternal,
                onChanged: (val) => setDlgState(() => isInternal = val),
              ),
            ],
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
                  await _api.addOwnerSupportTicketMessage(ticketId, txt, isInternalNote: isInternal);
                  Navigator.of(ctx).pop();
                  _carregarDadosIniciais();
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Mensagem enviada com sucesso!'), backgroundColor: Colors.green),
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
      ),
    );
  }

  Widget _buildTabTelemetria() {
    final m = _metricas;
    if (m == null) {
      return const Center(child: Text('Nenhuma telemetria disponível.', style: TextStyle(color: Color(0xFF94A3B8))));
    }

    final telemetria = m['telemetriaDispositivos'] as List<dynamic>? ?? [];

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
              Text('Fichas Cadastradas: ${m['fichas']?['totalCadastradas'] ?? 0}', style: const TextStyle(color: Colors.white)),
              Text('Vendas Realizadas: ${m['vendas']?['totalRealizadas'] ?? 0}', style: const TextStyle(color: Colors.white)),
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
            final pending = d['pendingOfflineCount'] ?? 0;
            return Card(
              color: const Color(0xFF1E293B),
              margin: const EdgeInsets.only(bottom: 8),
              child: ListTile(
                leading: Icon(
                  Icons.phone_android_rounded,
                  color: pending > 0 ? Colors.orangeAccent : Colors.greenAccent,
                ),
                title: Text(
                  '${d['platform'] ?? 'ANDROID'} • App v${d['appVersion'] ?? '1.0'}+${d['buildNumber'] ?? ''}',
                  style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.bold),
                ),
                subtitle: Text(
                  'Pendências Offline: $pending | Conexão: ${d['connectivityStatus'] ?? 'UNKNOWN'}',
                  style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 11),
                ),
                trailing: Text(
                  d['lastReportedAt'] != null
                      ? DateFormat('HH:mm dd/MM').format(DateTime.parse(d['lastReportedAt']))
                      : '',
                  style: const TextStyle(color: Color(0xFF64748B), fontSize: 10),
                ),
              ),
            );
          }),
      ],
    );
  }

  Widget _buildTabAlertas(bool isReadOnly) {
    if (_alertas.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: const [
            Icon(Icons.check_circle_outline_rounded, color: Colors.greenAccent, size: 48),
            SizedBox(height: 12),
            Text('Nenhum alerta operacional pendente.', style: TextStyle(color: Color(0xFF94A3B8))),
          ],
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: _alertas.length,
      itemBuilder: (ctx, idx) {
        final a = _alertas[idx];
        final ack = a['acknowledged'] == true;

        return Card(
          color: const Color(0xFF1E293B),
          margin: const EdgeInsets.only(bottom: 8),
          child: ListTile(
            leading: Icon(
              Icons.warning_amber_rounded,
              color: ack ? Colors.white30 : Colors.orangeAccent,
            ),
            title: Text(
              a['title'] ?? '',
              style: TextStyle(
                color: ack ? Colors.white54 : Colors.white,
                fontWeight: FontWeight.bold,
                fontSize: 13,
              ),
            ),
            subtitle: Text(
              'Categoria: ${a['category']} • Severidade: ${a['severity']}',
              style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 11),
            ),
            trailing: ack
                ? const Text('Reconhecido', style: TextStyle(color: Colors.greenAccent, fontSize: 11))
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
      await _api.acknowledgeOwnerInternalAlert(alertId);
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
    if (_integracoes.isEmpty) {
      return const Center(child: Text('Nenhuma integração cadastrada.', style: TextStyle(color: Color(0xFF94A3B8))));
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
      final res = await _api.testIntegrationConnection(integrationId);
      final r = res['testResult'] ?? {};
      final ok = r['success'] == true;
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
              r['message'] ?? 'Teste finalizado.',
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
}

