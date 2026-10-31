import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../servicos/servico_api.dart';

class PainelProprietarioSuporteContinuidade extends StatefulWidget {
  const PainelProprietarioSuporteContinuidade({super.key});

  @override
  State<PainelProprietarioSuporteContinuidade> createState() =>
      _PainelProprietarioSuporteContinuidadeState();
}

class _PainelProprietarioSuporteContinuidadeState
    extends State<PainelProprietarioSuporteContinuidade>
    with SingleTickerProviderStateMixin {
  final ApiService _api = ApiService();
  late TabController _tabController;

  bool _carregando = false;
  List<Map<String, dynamic>> _chamados = [];
  List<Map<String, dynamic>> _grants = [];
  Map<String, dynamic>? _metricasOperacionais;
  Map<String, dynamic>? _continuidadeStatus;
  List<Map<String, dynamic>> _alertasInternos = [];

  final DateFormat _dtFormat = DateFormat('dd/MM/yyyy HH:mm');

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 4, vsync: this);
    _carregarDados();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _carregarDados() async {
    setState(() => _carregando = true);
    try {
      final tickets = await _api.getOwnerSupportTickets();
      final grants = await _api.getOwnerSupportGrants();
      final metrics = await _api.getOwnerOperationalMetrics();
      final continuity = await _api.getOwnerContinuityStatus();
      final alerts = await _api.getOwnerInternalAlerts(acknowledged: false);

      if (mounted) {
        setState(() {
          _chamados = tickets;
          _grants = grants;
          _metricasOperacionais = metrics;
          _continuidadeStatus = continuity;
          _alertasInternos = alerts;
        });
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Erro ao carregar dados da Central de Suporte: $e'),
            backgroundColor: Colors.redAccent,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _carregando = false);
    }
  }

  // ── Detalhes do Chamado & Notas Internas ───────────────────────────────────

  void _abrirDetalhesChamado(String ticketId) async {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF0F172A),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => FutureBuilder<Map<String, dynamic>>(
        future: _api.getOwnerSupportTicketDetails(ticketId),
        builder: (context, snapshot) {
          if (!snapshot.hasData) {
            return const SizedBox(
              height: 300,
              child: Center(child: CircularProgressIndicator(color: Color(0xFF38BDF8))),
            );
          }

          final t = snapshot.data!;
          final messages = (t['messages'] as List?) ?? [];
          final msgCtrl = TextEditingController();
          bool notaInterna = false;
          String statusSelecionado = t['status'] ?? 'OPEN';

          return StatefulBuilder(
            builder: (ctx2, setSheetState) => DraggableScrollableSheet(
              initialChildSize: 0.85,
              maxChildSize: 0.95,
              minChildSize: 0.5,
              expand: false,
              builder: (_, scrollController) => Column(
                children: [
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: const BoxDecoration(
                      color: Color(0xFF1E293B),
                      borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                '#${t['ticketNumber'] ?? ''} — ${t['title'] ?? ''}',
                                style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                'Empresa: ${t['company']?['name'] ?? ''} | Prioridade: ${t['priority']}',
                                style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12),
                              ),
                            ],
                          ),
                        ),
                        DropdownButton<String>(
                          value: statusSelecionado,
                          dropdownColor: const Color(0xFF1E293B),
                          style: const TextStyle(color: Color(0xFF38BDF8), fontSize: 12, fontWeight: FontWeight.bold),
                          items: const [
                            DropdownMenuItem(value: 'OPEN', child: Text('ABERTO')),
                            DropdownMenuItem(value: 'WAITING_COMPANY', child: Text('AGUARDANDO CLIENTE')),
                            DropdownMenuItem(value: 'IN_PROGRESS', child: Text('EM ANDAMENTO')),
                            DropdownMenuItem(value: 'RESOLVED', child: Text('RESOLVIDO')),
                            DropdownMenuItem(value: 'CLOSED', child: Text('FECHADO')),
                          ],
                          onChanged: (val) async {
                            if (val == null) return;
                            try {
                              await _api.updateOwnerSupportTicketStatus(ticketId, status: val);
                              setSheetState(() => statusSelecionado = val);
                              _carregarDados();
                            } catch (e) {
                              ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro: $e')));
                            }
                          },
                        ),
                        IconButton(
                          icon: const Icon(Icons.close_rounded, color: Colors.white70),
                          onPressed: () => Navigator.of(ctx).pop(),
                        ),
                      ],
                    ),
                  ),
                  Expanded(
                    child: ListView(
                      controller: scrollController,
                      padding: const EdgeInsets.all(16),
                      children: [
                        Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: const Color(0xFF1E293B),
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text('Diagnóstico & Descrição:', style: TextStyle(color: Color(0xFF38BDF8), fontWeight: FontWeight.bold, fontSize: 12)),
                              const SizedBox(height: 4),
                              Text(t['description'] ?? '', style: const TextStyle(color: Colors.white, fontSize: 13)),
                              if (t['appVersion'] != null) ...[
                                const SizedBox(height: 6),
                                Text(
                                  'Versão App: ${t['appVersion']}+${t['buildNumber']} | Rede: ${t['connectivityStatus']} | Serviço: ${t['affectedService']}',
                                  style: const TextStyle(color: Color(0xFF64748B), fontSize: 11),
                                ),
                              ],
                            ],
                          ),
                        ),
                        const SizedBox(height: 16),
                        const Text('Mensagens & Notas Internas:', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 12, fontWeight: FontWeight.bold)),
                        const SizedBox(height: 8),
                        if (messages.isEmpty)
                          const Padding(
                            padding: EdgeInsets.all(16),
                            child: Text('Nenhuma mensagem registrada.', style: TextStyle(color: Colors.white54, fontSize: 12)),
                          )
                        else
                          ...messages.map((m) {
                            final isInternal = m['isInternalNote'] == true;
                            final isSupport = m['authorRole'] == 'SUPPORT' || m['authorRole'] == 'SUPER_ADMIN';

                            return Container(
                              margin: const EdgeInsets.only(bottom: 8),
                              padding: const EdgeInsets.all(12),
                              decoration: BoxDecoration(
                                color: isInternal
                                    ? const Color(0xFF451A03) // Âmbar escuro para notas internas
                                    : (isSupport ? const Color(0xFF1E3A5F) : const Color(0xFF0D9488)),
                                borderRadius: BorderRadius.circular(12),
                                border: isInternal ? Border.all(color: Colors.amberAccent.withOpacity(0.5)) : null,
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      if (isInternal) ...[
                                        const Icon(Icons.lock_rounded, color: Colors.amberAccent, size: 14),
                                        const SizedBox(width: 4),
                                        const Text(
                                          'NOTA TÉCNICA INTERNA (Invisível para o cliente)',
                                          style: TextStyle(color: Colors.amberAccent, fontWeight: FontWeight.bold, fontSize: 10),
                                        ),
                                      ] else
                                        Text(
                                          m['authorName'] ?? 'Usuário',
                                          style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 11),
                                        ),
                                      const Spacer(),
                                      if (m['createdAt'] != null)
                                        Text(
                                          DateFormat('dd/MM HH:mm').format(DateTime.parse(m['createdAt'])),
                                          style: const TextStyle(color: Colors.white70, fontSize: 10),
                                        ),
                                    ],
                                  ),
                                  const SizedBox(height: 4),
                                  Text(m['message'] ?? '', style: const TextStyle(color: Colors.white, fontSize: 13)),
                                ],
                              ),
                            );
                          }),
                      ],
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.all(12),
                    color: const Color(0xFF1E293B),
                    child: SafeArea(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Row(
                            children: [
                              Switch(
                                value: notaInterna,
                                activeColor: Colors.amberAccent,
                                onChanged: (val) => setSheetState(() => notaInterna = val),
                              ),
                              Text(
                                notaInterna ? 'Nota Técnica Interna (Sigilo Técnico)' : 'Resposta Pública (Empresa visualiza)',
                                style: TextStyle(
                                  color: notaInterna ? Colors.amberAccent : const Color(0xFF94A3B8),
                                  fontSize: 12,
                                  fontWeight: notaInterna ? FontWeight.bold : FontWeight.normal,
                                ),
                              ),
                            ],
                          ),
                          Row(
                            children: [
                              Expanded(
                                child: TextField(
                                  controller: msgCtrl,
                                  style: const TextStyle(color: Colors.white, fontSize: 13),
                                  decoration: InputDecoration(
                                    hintText: notaInterna ? 'Registrar nota técnica interna...' : 'Escrever resposta para a empresa...',
                                    hintStyle: const TextStyle(color: Color(0xFF64748B), fontSize: 12),
                                    filled: true,
                                    fillColor: const Color(0xFF0F172A),
                                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
                                  ),
                                ),
                              ),
                              const SizedBox(width: 8),
                              IconButton(
                                icon: Icon(Icons.send_rounded, color: notaInterna ? Colors.amberAccent : const Color(0xFF38BDF8)),
                                onPressed: () async {
                                  final txt = msgCtrl.text.trim();
                                  if (txt.isEmpty) return;
                                  try {
                                    await _api.addOwnerSupportTicketMessage(
                                      ticketId,
                                      txt,
                                      isInternalNote: notaInterna,
                                    );
                                    msgCtrl.clear();
                                    Navigator.of(ctx).pop();
                                    _abrirDetalhesChamado(ticketId);
                                  } catch (e) {
                                    ScaffoldMessenger.of(context).showSnackBar(
                                      SnackBar(content: Text('Erro ao enviar mensagem: $e'), backgroundColor: Colors.redAccent),
                                    );
                                  }
                                },
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  // ── Solicitar Concessão de Acesso Técnico ──────────────────────────────────

  void _abrirModalSolicitarAcesso() {
    final empresaIdCtrl = TextEditingController();
    final motivoCtrl = TextEditingController();
    String escopo = 'READ_ONLY';
    int duracao = 60;
    bool enviando = false;

    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setModalState) => AlertDialog(
          backgroundColor: const Color(0xFF1E293B),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          title: const Text('Solicitar Acesso Técnico', style: TextStyle(color: Colors.white, fontSize: 18)),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: empresaIdCtrl,
                  style: const TextStyle(color: Colors.white, fontSize: 13),
                  decoration: InputDecoration(
                    labelText: 'ID da Empresa *',
                    labelStyle: const TextStyle(color: Color(0xFF94A3B8)),
                    filled: true,
                    fillColor: const Color(0xFF0F172A),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  value: escopo,
                  dropdownColor: const Color(0xFF0F172A),
                  style: const TextStyle(color: Colors.white, fontSize: 13),
                  decoration: InputDecoration(
                    labelText: 'Escopo Permitido',
                    labelStyle: const TextStyle(color: Color(0xFF94A3B8)),
                    filled: true,
                    fillColor: const Color(0xFF0F172A),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                  items: const [
                    DropdownMenuItem(value: 'READ_ONLY', child: Text('READ_ONLY (Somente Consulta)')),
                    DropdownMenuItem(value: 'OPERATIONAL_SUPPORT', child: Text('OPERATIONAL_SUPPORT (Suporte)')),
                    DropdownMenuItem(value: 'INTEGRATION_DEBUG', child: Text('INTEGRATION_DEBUG (Depuração)')),
                  ],
                  onChanged: (val) => setModalState(() => escopo = val ?? 'READ_ONLY'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: motivoCtrl,
                  maxLines: 2,
                  style: const TextStyle(color: Colors.white, fontSize: 13),
                  decoration: InputDecoration(
                    labelText: 'Motivo Técnico Justificado *',
                    hintText: 'Mínimo 5 caracteres. Justifique a necessidade.',
                    hintStyle: const TextStyle(color: Color(0xFF64748B), fontSize: 11),
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
              onPressed: enviando ? null : () => Navigator.of(ctx).pop(),
              child: const Text('Cancelar', style: TextStyle(color: Color(0xFF94A3B8))),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF38BDF8), foregroundColor: const Color(0xFF0F172A)),
              onPressed: enviando
                  ? null
                  : () async {
                      if (empresaIdCtrl.text.trim().isEmpty || motivoCtrl.text.trim().length < 5) {
                        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Preencha os campos obrigatórios.')));
                        return;
                      }
                      setModalState(() => enviando = true);
                      try {
                        await _api.requestOwnerSupportGrant(
                          companyId: empresaIdCtrl.text.trim(),
                          scope: escopo,
                          reason: motivoCtrl.text.trim(),
                          durationMinutes: duracao,
                        );
                        Navigator.of(ctx).pop();
                        _carregarDados();
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('Solicitação enviada à empresa para aprovação.'), backgroundColor: Colors.green),
                        );
                      } catch (e) {
                        setModalState(() => enviando = false);
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(content: Text('Erro: $e'), backgroundColor: Colors.redAccent),
                        );
                      }
                    },
              child: const Text('Solicitar'),
            ),
          ],
        ),
      ),
    );
  }

  // ── Reivindicar & Iniciar Sessão de Suporte ────────────────────────────────

  Future<void> _iniciarSessaoSuporte(String grantId, String empresaNome, String escopo) async {
    try {
      final res = await _api.claimOwnerSupportSessionToken(grantId);
      final token = res['token'];
      if (token != null) {
        if (mounted) {
          showDialog(
            context: context,
            builder: (ctx) => AlertDialog(
              backgroundColor: const Color(0xFF1E293B),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
              title: Row(
                children: const [
                  Icon(Icons.check_circle_rounded, color: Colors.green),
                  SizedBox(width: 8),
                  Text('Sessão Autorizada', style: TextStyle(color: Colors.white)),
                ],
              ),
              content: Text(
                'Sessão de suporte ativa para $empresaNome.\nEscopo: $escopo.\n\nO token efêmero foi emitido e vinculado estritamente à empresa e escopo aprovados.',
                style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 13),
              ),
              actions: [
                ElevatedButton(
                  style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF38BDF8), foregroundColor: const Color(0xFF0F172A)),
                  onPressed: () => Navigator.of(ctx).pop(),
                  child: const Text('OK'),
                ),
              ],
            ),
          );
        }
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erro ao iniciar sessão: $e'), backgroundColor: Colors.redAccent),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0F172A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1E293B),
        title: const Text('Central de Suporte & Continuidade', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16)),
        bottom: TabBar(
          controller: _tabController,
          indicatorColor: const Color(0xFF38BDF8),
          labelColor: const Color(0xFF38BDF8),
          unselectedLabelColor: const Color(0xFF94A3B8),
          tabs: const [
            Tab(icon: Icon(Icons.confirmation_number_rounded, size: 20), text: 'Chamados'),
            Tab(icon: Icon(Icons.vpn_key_rounded, size: 20), text: 'Acesso Técnico'),
            Tab(icon: Icon(Icons.analytics_rounded, size: 20), text: 'Indicadores'),
            Tab(icon: Icon(Icons.shield_rounded, size: 20), text: 'Continuidade'),
          ],
        ),
      ),
      body: _carregando
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF38BDF8)))
          : TabBarView(
              controller: _tabController,
              children: [
                _buildTabChamados(),
                _buildTabAcessoTecnico(),
                _buildTabIndicadores(),
                _buildTabContinuidadeAlertas(),
              ],
            ),
      floatingActionButton: _tabController.index == 1
          ? FloatingActionButton.extended(
              backgroundColor: const Color(0xFF38BDF8),
              foregroundColor: const Color(0xFF0F172A),
              icon: const Icon(Icons.add_moderator_rounded),
              label: const Text('Solicitar Acesso', style: TextStyle(fontWeight: FontWeight.bold)),
              onPressed: _abrirModalSolicitarAcesso,
            )
          : null,
    );
  }

  Widget _buildTabChamados() {
    if (_chamados.isEmpty) {
      return const Center(child: Text('Nenhum chamado registrado.', style: TextStyle(color: Color(0xFF94A3B8))));
    }

    return RefreshIndicator(
      onRefresh: _carregarDados,
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: _chamados.length,
        itemBuilder: (ctx, i) {
          final c = _chamados[i];
          final isClosed = c['status'] == 'CLOSED' || c['status'] == 'RESOLVED';
          return Card(
            color: const Color(0xFF1E293B),
            margin: const EdgeInsets.only(bottom: 12),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            child: ListTile(
              onTap: () => _abrirDetalhesChamado(c['id']),
              title: Text(
                '#${c['ticketNumber'] ?? ''} — ${c['title'] ?? ''}',
                style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14),
              ),
              subtitle: Text(
                'Empresa: ${c['company']?['name'] ?? ''} | Aberto em: ${_dtFormat.format(DateTime.parse(c['createdAt']))}',
                style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 11),
              ),
              trailing: Chip(
                label: Text(c['status'] ?? '', style: TextStyle(color: isClosed ? Colors.green : const Color(0xFF38BDF8), fontSize: 10, fontWeight: FontWeight.bold)),
                backgroundColor: const Color(0xFF0F172A),
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildTabAcessoTecnico() {
    return RefreshIndicator(
      onRefresh: _carregarDados,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: const Color(0xFF1E3A5F),
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Text(
              'Acesso Temporário Autorizado: Ações financeiras gerais são proibidas em sessões de suporte. Somente sessões ativas aprovadas pela empresa podem ser iniciadas.',
              style: TextStyle(color: Colors.white, fontSize: 12),
            ),
          ),
          const SizedBox(height: 16),
          if (_grants.isEmpty)
            const Padding(
              padding: EdgeInsets.all(32),
              child: Center(child: Text('Nenhuma concessão de suporte registrada.', style: TextStyle(color: Color(0xFF94A3B8)))),
            )
          else
            ..._grants.map((g) {
              final isActive = g['status'] == 'ACTIVE';
              return Card(
                color: const Color(0xFF1E293B),
                margin: const EdgeInsets.only(bottom: 12),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(
                            g['company']?['name'] ?? 'Empresa',
                            style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14),
                          ),
                          Chip(
                            label: Text(g['status'] ?? '', style: TextStyle(color: isActive ? Colors.green : Colors.amberAccent, fontSize: 10, fontWeight: FontWeight.bold)),
                            backgroundColor: const Color(0xFF0F172A),
                          ),
                        ],
                      ),
                      const SizedBox(height: 6),
                      Text('Escopo: ${g['scope']}', style: const TextStyle(color: Color(0xFF38BDF8), fontSize: 12, fontWeight: FontWeight.bold)),
                      Text('Motivo: ${g['reason']}', style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12)),
                      Text('Expira em: ${g['expiresAt'] != null ? _dtFormat.format(DateTime.parse(g['expiresAt'])) : 'Aguardando aprovação'}', style: const TextStyle(color: Color(0xFF64748B), fontSize: 11)),
                      if (isActive) ...[
                        const SizedBox(height: 12),
                        Align(
                          alignment: Alignment.centerRight,
                          child: ElevatedButton.icon(
                            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF38BDF8), foregroundColor: const Color(0xFF0F172A)),
                            icon: const Icon(Icons.login_rounded, size: 16),
                            label: const Text('Reivindicar & Iniciar Sessão', style: TextStyle(fontWeight: FontWeight.bold)),
                            onPressed: () => _iniciarSessaoSuporte(g['id'], g['company']?['name'] ?? '', g['scope'] ?? 'READ_ONLY'),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              );
            }),
        ],
      ),
    );
  }

  Widget _buildTabIndicadores() {
    final m = _metricasOperacionais;
    if (m == null) return const Center(child: Text('Carregando métricas...', style: TextStyle(color: Color(0xFF94A3B8))));

    final fichas = m['fichas'] ?? {};
    final vendas = m['vendas'] ?? {};
    final sync = m['sincronizacaoEErros'] ?? {};
    final telemetria = m['pendenciasOfflineAparelhos'] ?? {};

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // Métricas de Vendas e Fichas
        Row(
          children: [
            Expanded(
              child: _buildMetricCard('Total Fichas', '${fichas['total'] ?? 0}', Icons.people_rounded, const Color(0xFF38BDF8)),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _buildMetricCard('Vendas', '${vendas['totalQuantidade'] ?? 0}', Icons.point_of_sale_rounded, Colors.green),
            ),
          ],
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: _buildMetricCard('Falhas Asaas', '${sync['falhasIntegracaoAsaas'] ?? 0}', Icons.sync_problem_rounded, Colors.redAccent),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _buildMetricCard('Alertas Internos', '${sync['alertasOperacionaisNaoReconhecidos'] ?? 0}', Icons.warning_rounded, Colors.amberAccent),
            ),
          ],
        ),
        const SizedBox(height: 16),

        // Telemetria de Aparelhos em Campo
        const Text('Telemetria Operacional de Aparelhos:', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14)),
        const SizedBox(height: 8),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: const Color(0xFF1E293B),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(
                    telemetria['status'] == 'TELEMETRIA_DISPONIVEL' ? Icons.sensors_rounded : Icons.sensors_off_rounded,
                    color: telemetria['status'] == 'TELEMETRIA_DISPONIVEL' ? Colors.green : Colors.amberAccent,
                  ),
                  const SizedBox(width: 8),
                  Text(
                    telemetria['status'] == 'TELEMETRIA_DISPONIVEL' ? 'Telemetria Ativa' : 'Sem telemetria do aparelho',
                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Text(telemetria['aviso'] ?? '', style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12)),
              if (telemetria['dataUltimaInformacao'] != null) ...[
                const SizedBox(height: 4),
                Text('Última comunicação: ${_dtFormat.format(DateTime.parse(telemetria['dataUltimaInformacao']))}', style: const TextStyle(color: Color(0xFF64748B), fontSize: 11)),
              ],
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildMetricCard(String title, String value, IconData icon, Color color) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF1E293B),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: color, size: 24),
          const SizedBox(height: 8),
          Text(value, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 20)),
          Text(title, style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 11)),
        ],
      ),
    );
  }

  Widget _buildTabContinuidadeAlertas() {
    final dr = _continuidadeStatus;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // Status de Continuidade / DR
        const Text('Continuidade & Disaster Recovery (DR):', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14)),
        const SizedBox(height: 8),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(color: const Color(0xFF1E293B), borderRadius: BorderRadius.circular(12)),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const Icon(Icons.storage_rounded, color: Color(0xFF38BDF8)),
                  const SizedBox(width: 8),
                  Text('Status: ${dr?['verifiedRestoreStatus'] ?? 'Nenhum'}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                ],
              ),
              const SizedBox(height: 8),
              Text('Ambiente: ${dr?['sanitizedSource'] ?? 'N/A'}', style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12)),
              Text('Tabelas conferidas: ${dr?['totalTables'] ?? 0} | Linhas: ${dr?['totalRows'] ?? 0}', style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12)),
              if (dr?['verifiedRestoreNotes'] != null) ...[
                const SizedBox(height: 4),
                Text('Notas: ${dr?['verifiedRestoreNotes']}', style: const TextStyle(color: Color(0xFF64748B), fontSize: 11)),
              ],
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(color: const Color(0xFF0F172A), borderRadius: BorderRadius.circular(8)),
                child: const Text(
                  'Segurança Operacional: Download global de dump e restauração web são bloqueados por política de segurança de dados.',
                  style: TextStyle(color: Colors.amberAccent, fontSize: 11),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 20),

        // Alertas Internos Operacionais
        const Text('Alertas Internos Pendentes de Reconhecimento:', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14)),
        const SizedBox(height: 8),
        if (_alertasInternos.isEmpty)
          const Padding(
            padding: EdgeInsets.all(16),
            child: Center(child: Text('Nenhum alerta interno pendente.', style: TextStyle(color: Color(0xFF94A3B8)))),
          )
        else
          ..._alertasInternos.map((a) {
            return Card(
              color: const Color(0xFF1E293B),
              margin: const EdgeInsets.only(bottom: 8),
              child: ListTile(
                leading: const Icon(Icons.warning_amber_rounded, color: Colors.amberAccent),
                title: Text(a['title'] ?? '', style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.bold)),
                subtitle: Text('Categoria: ${a['category']} | Gravidade: ${a['severity']}', style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 11)),
                trailing: TextButton(
                  child: const Text('Reconhecer', style: TextStyle(color: Color(0xFF38BDF8))),
                  onPressed: () async {
                    try {
                      await _api.acknowledgeOwnerInternalAlert(a['id']);
                      _carregarDados();
                    } catch (e) {
                      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro: $e')));
                    }
                  },
                ),
              ),
            );
          }),
      ],
    );
  }
}

