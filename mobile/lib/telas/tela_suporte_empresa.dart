import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../servicos/servico_api.dart';
import '../config/app_config.dart';

class TelaSuporteEmpresa extends StatefulWidget {
  const TelaSuporteEmpresa({super.key});

  @override
  State<TelaSuporteEmpresa> createState() => _TelaSuporteEmpresaState();
}

class _TelaSuporteEmpresaState extends State<TelaSuporteEmpresa>
    with SingleTickerProviderStateMixin {
  final ApiService _api = ApiService();
  late TabController _tabController;

  bool _carregando = false;
  List<Map<String, dynamic>> _chamados = [];
  List<Map<String, dynamic>> _grants = [];

  final DateFormat _dtFormat = DateFormat('dd/MM/yyyy HH:mm');

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
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
      final tickets = await _api.getSupportTickets();
      final grants = await _api.getPendingSupportGrants();
      if (mounted) {
        setState(() {
          _chamados = tickets;
          _grants = grants;
        });
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Erro ao carregar dados de suporte: $e'),
            backgroundColor: Colors.redAccent,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _carregando = false);
    }
  }

  // ── Modal de Abertura de Chamado ──────────────────────────────────────────

  void _abrirModalNovoChamado() {
    final tituloCtrl = TextEditingController();
    final descCtrl = TextEditingController();
    String categoria = 'SYNC';
    String prioridade = 'MEDIUM';
    bool enviando = false;

    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setModalState) => AlertDialog(
          backgroundColor: const Color(0xFF1E293B),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          title: Row(
            children: const [
              Icon(Icons.support_agent_rounded, color: Color(0xFF38BDF8)),
              SizedBox(width: 8),
              Text('Novo Chamado de Suporte', style: TextStyle(color: Colors.white, fontSize: 18)),
            ],
          ),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Diagnóstico mínimo do aparelho será anexado automaticamente (versão, conectividade e serviço).',
                  style: TextStyle(color: Color(0xFF94A3B8), fontSize: 12),
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: tituloCtrl,
                  style: const TextStyle(color: Colors.white, fontSize: 13),
                  decoration: InputDecoration(
                    labelText: 'Título do Problema *',
                    labelStyle: const TextStyle(color: Color(0xFF94A3B8)),
                    filled: true,
                    fillColor: const Color(0xFF0F172A),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  value: categoria,
                  dropdownColor: const Color(0xFF0F172A),
                  style: const TextStyle(color: Colors.white, fontSize: 13),
                  decoration: InputDecoration(
                    labelText: 'Categoria',
                    labelStyle: const TextStyle(color: Color(0xFF94A3B8)),
                    filled: true,
                    fillColor: const Color(0xFF0F172A),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                  items: const [
                    DropdownMenuItem(value: 'SYNC', child: Text('Sincronização & Fila Offline')),
                    DropdownMenuItem(value: 'SALES', child: Text('Vendas & Pagamentos')),
                    DropdownMenuItem(value: 'APP', child: Text('Aplicativo & Travamentos')),
                    DropdownMenuItem(value: 'FINANCE', child: Text('Financeiro / Repasses')),
                    DropdownMenuItem(value: 'OTHER', child: Text('Outro')),
                  ],
                  onChanged: (val) => setModalState(() => categoria = val ?? 'SYNC'),
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  value: prioridade,
                  dropdownColor: const Color(0xFF0F172A),
                  style: const TextStyle(color: Colors.white, fontSize: 13),
                  decoration: InputDecoration(
                    labelText: 'Prioridade',
                    labelStyle: const TextStyle(color: Color(0xFF94A3B8)),
                    filled: true,
                    fillColor: const Color(0xFF0F172A),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                  items: const [
                    DropdownMenuItem(value: 'LOW', child: Text('Baixa')),
                    DropdownMenuItem(value: 'MEDIUM', child: Text('Média')),
                    DropdownMenuItem(value: 'HIGH', child: Text('Alta (Impacta Vendas)')),
                    DropdownMenuItem(value: 'URGENT', child: Text('Urgente (Parada Total)')),
                  ],
                  onChanged: (val) => setModalState(() => prioridade = val ?? 'MEDIUM'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: descCtrl,
                  maxLines: 3,
                  style: const TextStyle(color: Colors.white, fontSize: 13),
                  decoration: InputDecoration(
                    labelText: 'Descrição Detalhada *',
                    hintText: 'Descreva o que ocorreu. Não insira senhas ou dados bancários.',
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
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF38BDF8),
                foregroundColor: const Color(0xFF0F172A),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
              ),
              onPressed: enviando
                  ? null
                  : () async {
                      if (tituloCtrl.text.trim().length < 4 || descCtrl.text.trim().length < 5) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('Preencha título e descrição com detalhes suficientes.')),
                        );
                        return;
                      }

                      setModalState(() => enviando = true);
                      try {
                        await _api.createSupportTicket({
                          'title': tituloCtrl.text.trim(),
                          'description': descCtrl.text.trim(),
                          'category': categoria,
                          'priority': prioridade,
                          'appVersion': AppConfig.appVersion,
                          'buildNumber': AppConfig.buildNumber,
                          'affectedService': categoria,
                          'connectivityStatus': 'CONNECTED',
                        });
                        Navigator.of(ctx).pop();
                        _carregarDados();
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('Chamado aberto com sucesso!'), backgroundColor: Colors.green),
                        );
                      } catch (e) {
                        setModalState(() => enviando = false);
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(content: Text('Erro ao criar chamado: $e'), backgroundColor: Colors.redAccent),
                        );
                      }
                    },
              child: enviando
                  ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Text('Enviar Chamado', style: TextStyle(fontWeight: FontWeight.bold)),
            ),
          ],
        ),
      ),
    );
  }

  // ── Detalhes do Chamado ───────────────────────────────────────────────────

  void _abrirDetalhesChamado(String ticketId) async {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF0F172A),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => FutureBuilder<Map<String, dynamic>>(
        future: _api.getSupportTicketDetails(ticketId),
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
                                'Status: ${t['status']} | Prioridade: ${t['priority']}',
                                style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12),
                              ),
                            ],
                          ),
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
                              const Text('Descrição Original:', style: TextStyle(color: Color(0xFF38BDF8), fontWeight: FontWeight.bold, fontSize: 12)),
                              const SizedBox(height: 4),
                              Text(t['description'] ?? '', style: const TextStyle(color: Colors.white, fontSize: 13)),
                            ],
                          ),
                        ),
                        const SizedBox(height: 16),
                        const Text('Mensagens & Histórico:', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 12, fontWeight: FontWeight.bold)),
                        const SizedBox(height: 8),
                        if (messages.isEmpty)
                          const Padding(
                            padding: EdgeInsets.all(16),
                            child: Text('Nenhuma resposta registrada ainda.', style: TextStyle(color: Colors.white54, fontSize: 12)),
                          )
                        else
                          ...messages.map((m) {
                            final isSupport = m['authorRole'] == 'SUPPORT' || m['authorRole'] == 'SUPER_ADMIN';
                            return Align(
                              alignment: isSupport ? Alignment.centerLeft : Alignment.centerRight,
                              child: Container(
                                margin: const EdgeInsets.only(bottom: 8),
                                padding: const EdgeInsets.all(12),
                                constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.8),
                                decoration: BoxDecoration(
                                  color: isSupport ? const Color(0xFF1E3A5F) : const Color(0xFF0D9488),
                                  borderRadius: BorderRadius.circular(12),
                                ),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Row(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        Text(
                                          m['authorName'] ?? (isSupport ? 'Suporte Lumora' : 'Você'),
                                          style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 11),
                                        ),
                                        const SizedBox(width: 8),
                                        if (m['createdAt'] != null)
                                          Text(
                                            DateFormat('HH:mm').format(DateTime.parse(m['createdAt'])),
                                            style: const TextStyle(color: Colors.white70, fontSize: 10),
                                          ),
                                      ],
                                    ),
                                    const SizedBox(height: 4),
                                    Text(m['message'] ?? '', style: const TextStyle(color: Colors.white, fontSize: 13)),
                                  ],
                                ),
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
                      child: Row(
                        children: [
                          Expanded(
                            child: TextField(
                              controller: msgCtrl,
                              style: const TextStyle(color: Colors.white, fontSize: 13),
                              decoration: InputDecoration(
                                hintText: 'Escreva uma resposta...',
                                hintStyle: const TextStyle(color: Color(0xFF64748B), fontSize: 12),
                                filled: true,
                                fillColor: const Color(0xFF0F172A),
                                border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          IconButton(
                            icon: const Icon(Icons.send_rounded, color: Color(0xFF38BDF8)),
                            onPressed: () async {
                              final txt = msgCtrl.text.trim();
                              if (txt.isEmpty) return;
                              try {
                                await _api.addSupportTicketMessage(ticketId, txt);
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

  // ── Aprovação / Revogação de Acesso Técnico ────────────────────────────────

  Future<void> _aprovarAcesso(String grantId, String tecnicoNome, String escopo) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1E293B),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text('Autorizar Acesso Técnico?', style: TextStyle(color: Colors.white)),
        content: Text(
          'Você está autorizando o técnico $tecnicoNome com escopo $escopo.\n\nO acesso expira automaticamente e você pode revogá-lo a qualquer momento com efeito imediato.',
          style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 13),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Cancelar', style: TextStyle(color: Color(0xFF94A3B8)))),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: Colors.green, foregroundColor: Colors.white),
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Confirmar Autorização'),
          ),
        ],
      ),
    );

    if (confirm != true) return;

    try {
      await _api.approveSupportGrant(grantId);
      _carregarDados();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Acesso técnico autorizado com sucesso!'), backgroundColor: Colors.green),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erro ao autorizar suporte: $e'), backgroundColor: Colors.redAccent),
        );
      }
    }
  }

  Future<void> _revogarAcesso(String grantId) async {
    try {
      await _api.revokeSupportGrant(grantId, reason: 'Revogado pelo gestor da empresa.');
      _carregarDados();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Acesso de suporte revogado imediatamente!'), backgroundColor: Colors.orange),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erro ao revogar suporte: $e'), backgroundColor: Colors.redAccent),
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
        title: const Text('Central de Suporte Lumora', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 17)),
        bottom: TabBar(
          controller: _tabController,
          indicatorColor: const Color(0xFF38BDF8),
          labelColor: const Color(0xFF38BDF8),
          unselectedLabelColor: const Color(0xFF94A3B8),
          tabs: const [
            Tab(icon: Icon(Icons.confirmation_number_rounded, size: 20), text: 'Chamados'),
            Tab(icon: Icon(Icons.vpn_key_rounded, size: 20), text: 'Acesso Técnico'),
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
              ],
            ),
      floatingActionButton: _tabController.index == 0
          ? FloatingActionButton.extended(
              backgroundColor: const Color(0xFF38BDF8),
              foregroundColor: const Color(0xFF0F172A),
              icon: const Icon(Icons.add_rounded),
              label: const Text('Novo Chamado', style: TextStyle(fontWeight: FontWeight.bold)),
              onPressed: _abrirModalNovoChamado,
            )
          : null,
    );
  }

  Widget _buildTabChamados() {
    if (_chamados.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: const [
              Icon(Icons.mark_chat_read_rounded, color: Color(0xFF64748B), size: 48),
              SizedBox(height: 12),
              Text('Nenhum chamado aberto no momento.', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 14)),
              SizedBox(height: 4),
              Text('Precisa de ajuda? Clique no botão abaixo para abrir um chamado.', style: TextStyle(color: Color(0xFF64748B), fontSize: 12), textAlign: TextAlign.center),
            ],
          ),
        ),
      );
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
                'Status: ${c['status']} | Aberto em: ${_dtFormat.format(DateTime.parse(c['createdAt']))}',
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
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: const [
                Icon(Icons.shield_rounded, color: Color(0xFF38BDF8), size: 24),
                SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'Controle de Autorização de Suporte: O técnico da plataforma só acessa dados da sua empresa mediante sua autorização formal. Você pode revogar o acesso a qualquer instante.',
                    style: TextStyle(color: Colors.white, fontSize: 12),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          if (_grants.isEmpty)
            const Padding(
              padding: EdgeInsets.all(32),
              child: Center(
                child: Text('Nenhuma solicitação de acesso pendente.', style: TextStyle(color: Color(0xFF94A3B8))),
              ),
            )
          else
            ..._grants.map((g) {
              final isRequested = g['status'] == 'REQUESTED';
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
                            'Técnico: ${g['requestedByName'] ?? 'Equipe Lumora'}',
                            style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14),
                          ),
                          Chip(
                            label: Text(g['status'] ?? '', style: TextStyle(color: isActive ? Colors.green : Colors.amberAccent, fontSize: 10, fontWeight: FontWeight.bold)),
                            backgroundColor: const Color(0xFF0F172A),
                          ),
                        ],
                      ),
                      const SizedBox(height: 6),
                      Text('Escopo solicitado: ${g['scope']}', style: const TextStyle(color: Color(0xFF38BDF8), fontSize: 12, fontWeight: FontWeight.bold)),
                      const SizedBox(height: 4),
                      Text('Motivo: ${g['reason']}', style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12)),
                      Text('Duração: ${g['durationMinutes']} minutos', style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12)),
                      const SizedBox(height: 12),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.end,
                        children: [
                          if (isRequested)
                            ElevatedButton(
                              style: ElevatedButton.styleFrom(backgroundColor: Colors.green, foregroundColor: Colors.white),
                              onPressed: () => _aprovarAcesso(g['id'], g['requestedByName'] ?? 'Técnico', g['scope'] ?? 'READ_ONLY'),
                              child: const Text('Aprovar Acesso'),
                            ),
                          if (isActive || isRequested) ...[
                            const SizedBox(width: 8),
                            OutlinedButton(
                              style: OutlinedButton.styleFrom(foregroundColor: Colors.redAccent, side: const BorderSide(color: Colors.redAccent)),
                              onPressed: () => _revogarAcesso(g['id']),
                              child: const Text('Revogar'),
                            ),
                          ],
                        ],
                      ),
                    ],
                  ),
                ),
              );
            }),
        ],
      ),
    );
  }
}

