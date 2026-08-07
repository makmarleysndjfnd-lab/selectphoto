import 'package:flutter/material.dart';
import '../servicos/servico_api.dart';
import '../widgets/led_button.dart';

class VisaoEstatisticasAdmin extends StatefulWidget {
  const VisaoEstatisticasAdmin({super.key});
  @override
  State<VisaoEstatisticasAdmin> createState() => _VisaoEstatisticasAdminState();
}

class _VisaoEstatisticasAdminState extends State<VisaoEstatisticasAdmin> {
  bool _loading = true;
  bool _loadingAi = false;
  String? _error;
  Map<String, dynamic>? _stats;
  Map<String, dynamic>? _reboloStats;
  List<dynamic> _aiInsights = [];
  String? _filterCity;
  String? _filterEvent;
  String? _filterPeriod; // 'all', '30d', '6m', '1y'

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      String? from;
      if (_filterPeriod == '30d') {
        from = DateTime.now().subtract(const Duration(days: 30)).toIso8601String();
      } else if (_filterPeriod == '6m') {
        from = DateTime.now().subtract(const Duration(days: 180)).toIso8601String();
      } else if (_filterPeriod == '1y') {
        from = DateTime.now().subtract(const Duration(days: 365)).toIso8601String();
      }
      final data = await ApiService().getStatsBooks(from: from, city: _filterCity, event: _filterEvent);
      final reboloData = await ApiService().getStatsRebolos();
      if (mounted) {
        setState(() {
          _stats = Map<String, dynamic>.from(data);
          _reboloStats = Map<String, dynamic>.from(reboloData);
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Future<void> _analyzeWithAi() async {
    if (_stats == null) return;
    setState(() => _loadingAi = true);
    try {
      final result = await ApiService().getStatsAiInsights(_stats!);
      final insights = result['insights'] as List? ?? [];
      setState(() { _aiInsights = insights; _loadingAi = false; });
    } catch (e) {
      setState(() => _loadingAi = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro na IA: $e'), backgroundColor: Colors.red));
      }
    }
  }

  static const _bg = Color(0xFF0D0D1A);
  static const _card = Color(0xFF1A1A2E);
  static const _accent = Color(0xFFCE93D8);
  static const _blue = Color(0xFF4FC3F7);
  static const _green = Color(0xFF66BB6A);
  static const _gold = Color(0xFFFFD54F);

  @override
  Widget build(BuildContext context) {
    return Container(
      color: _bg,
      child: Column(
        children: [
          _buildFilterBar(),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator(color: Color(0xFFCE93D8)))
                : _error != null
                    ? Center(child: Text('Erro: $_error', style: const TextStyle(color: Colors.redAccent)))
                    : _buildContent(),
          ),
        ],
      ),
    );
  }

  Widget _buildFilterBar() {
    final allCities = (_stats?['filtrosDisponiveis']?['cidades'] as List? ?? []).cast<String>();
    final allEvents = (_stats?['filtrosDisponiveis']?['eventos'] as List? ?? []).cast<String>();
    return Container(
      color: const Color(0xFF12122A),
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: [
            const Text('Periodo:', style: TextStyle(color: Colors.white54, fontSize: 11)),
            const SizedBox(width: 6),
            for (final p in [null, '30d', '6m', '1y'])
              Padding(
                padding: const EdgeInsets.only(right: 4),
                child: ChoiceChip(
                  label: Text(p ?? 'Tudo', style: TextStyle(fontSize: 11, color: _filterPeriod == p ? Colors.white : Colors.white60)),
                  selected: _filterPeriod == p,
                  selectedColor: _accent.withOpacity(0.3),
                  backgroundColor: Colors.white10,
                  side: BorderSide(color: _filterPeriod == p ? _accent : Colors.white12),
                  onSelected: (_) { setState(() { _filterPeriod = p; }); _load(); },
                ),
              ),
            if (allCities.isNotEmpty) ...[
              const SizedBox(width: 8),
              const Text('|', style: TextStyle(color: Colors.white24)),
              const SizedBox(width: 8),
              const Text('Cidade:', style: TextStyle(color: Colors.white54, fontSize: 11)),
              const SizedBox(width: 4),
              ChoiceChip(
                label: Text(_filterCity ?? 'Todas', style: const TextStyle(fontSize: 11, color: Colors.white70)),
                selected: _filterCity != null,
                selectedColor: _blue.withOpacity(0.2),
                backgroundColor: Colors.white10,
                side: BorderSide(color: _filterCity != null ? _blue : Colors.white12),
                onSelected: (_) => _showPickerDialog('Cidade', allCities, (v) { setState(() => _filterCity = v); _load(); }),
              ),
              if (_filterCity != null) ...[
                const SizedBox(width: 4),
                GestureDetector(onTap: () { setState(() => _filterCity = null); _load(); },
                  child: const Icon(Icons.close, color: Colors.white38, size: 16)),
              ],
            ],
            if (allEvents.isNotEmpty) ...[
              const SizedBox(width: 8),
              const Text('Evento:', style: TextStyle(color: Colors.white54, fontSize: 11)),
              const SizedBox(width: 4),
              ChoiceChip(
                label: Text(_filterEvent ?? 'Todos', style: const TextStyle(fontSize: 11, color: Colors.white70)),
                selected: _filterEvent != null,
                selectedColor: _green.withOpacity(0.2),
                backgroundColor: Colors.white10,
                side: BorderSide(color: _filterEvent != null ? _green : Colors.white12),
                onSelected: (_) => _showPickerDialog('Evento', allEvents, (v) { setState(() => _filterEvent = v); _load(); }),
              ),
              if (_filterEvent != null) ...[
                const SizedBox(width: 4),
                GestureDetector(onTap: () { setState(() => _filterEvent = null); _load(); },
                  child: const Icon(Icons.close, color: Colors.white38, size: 16)),
              ],
            ],
          ],
        ),
      ),
    );
  }

  void _showPickerDialog(String label, List<String> options, Function(String?) onSelect) {
    showDialog(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: _card,
        title: Text('Filtrar por $label', style: const TextStyle(color: Colors.white)),
        content: SizedBox(
          width: 280,
          child: ListView.builder(
            shrinkWrap: true,
            itemCount: options.length,
            itemBuilder: (_, i) => ListTile(
              title: Text(options[i], style: const TextStyle(color: Colors.white)),
              onTap: () { Navigator.pop(context); onSelect(options[i]); },
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildContent() {
    final s = _stats!;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _buildAiSection(),
        const SizedBox(height: 16),
        _buildKpiRow(s),
        const SizedBox(height: 16),
        _buildClientRanking(s),
        const SizedBox(height: 16),
        _buildCityRanking(s),
        const SizedBox(height: 16),
        _buildEventRanking(s),
        const SizedBox(height: 16),
        _buildHorarios(s),
        const SizedBox(height: 16),
        _buildSellerRanking(s),
        const SizedBox(height: 16),
        _buildPhotografosCard(s),
        const SizedBox(height: 16),
        _buildChildrenCard(s),
        const SizedBox(height: 16),
        _buildPaymentCard(s),
        const SizedBox(height: 24),
        _buildReboloBI(),
        const SizedBox(height: 32),
      ],
    );
  }

  // ── AI Section ─────────────────────────────────────────────
  Widget _buildAiSection() {
    return Container(
      decoration: BoxDecoration(
        gradient: const LinearGradient(colors: [Color(0xFF2D0060), Color(0xFF1A0040)], begin: Alignment.topLeft, end: Alignment.bottomRight),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: _accent.withOpacity(0.4)),
      ),
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Text('✨', style: TextStyle(fontSize: 22)),
              const SizedBox(width: 10),
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Inteligencia Artificial', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16)),
                    Text('OpenAI analisa seus dados e gera insights acionaveis', style: TextStyle(color: Colors.white54, fontSize: 11)),
                  ],
                ),
              ),
              LedButton(
                onPressed: _loadingAi ? null : _analyzeWithAi,
                style: LedButton.styleFrom(backgroundColor: _accent.withOpacity(0.8), padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10)),
                child: _loadingAi
                    ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : const Text('Analisar com IA', style: TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.bold)),
              ),
            ],
          ),
          if (_aiInsights.isNotEmpty) ...[
            const SizedBox(height: 14),
            const Divider(color: Colors.white12),
            const SizedBox(height: 8),
            ..._aiInsights.map((ins) => Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(ins['emoji'] ?? '💡', style: const TextStyle(fontSize: 18)),
                  const SizedBox(width: 10),
                  Expanded(child: Text(ins['insight'] ?? '', style: const TextStyle(color: Colors.white, fontSize: 13, height: 1.4))),
                ],
              ),
            )),
          ],
        ],
      ),
    );
  }

  // ── KPI Row ────────────────────────────────────────────────
  Widget _buildKpiRow(Map<String, dynamic> s) {
    final av = s['analiseValores'] ?? {};
    return Row(
      children: [
        _kpiCard('Faturamento', 'R\$ ${_fmt(av['faturamentoTotal'] ?? 0)}', Icons.attach_money_rounded, _green),
        const SizedBox(width: 10),
        _kpiCard('Ticket Medio', 'R\$ ${_fmt(av['ticketMedio'] ?? 0)}', Icons.price_change_rounded, _blue),
        const SizedBox(width: 10),
        _kpiCard('Total Vendas', '${av['totalVendas'] ?? 0}', Icons.receipt_rounded, _accent),
      ],
    );
  }

  Widget _kpiCard(String label, String value, IconData icon, Color color) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: color.withOpacity(0.1),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: color.withOpacity(0.3)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, color: color, size: 20),
            const SizedBox(height: 8),
            Text(value, style: TextStyle(color: color, fontSize: 16, fontWeight: FontWeight.bold)),
            const SizedBox(height: 2),
            Text(label, style: const TextStyle(color: Colors.white54, fontSize: 10)),
          ],
        ),
      ),
    );
  }

  // ── Client Ranking ─────────────────────────────────────────
  Widget _buildClientRanking(Map<String, dynamic> s) {
    final list = (s['rankingClientes'] as List? ?? []).take(10).toList();
    return _statsCard('Ranking de Clientes', Icons.emoji_events_rounded, _gold, children: [
      ...list.asMap().entries.map((e) {
        final i = e.key; final c = e.value;
        return _rankRow(i + 1, c['name'], 'R\$ ${_fmt(c['totalValue'])} · ${c['books']} books · ${c['city'] ?? ''} · desde ${c['since'] ?? '-'}', _gold);
      }),
    ]);
  }

  // ── City Ranking ───────────────────────────────────────────
  Widget _buildCityRanking(Map<String, dynamic> s) {
    final list = s['rankingCidades'] as List? ?? [];
    return _statsCard('Ranking por Cidade', Icons.location_city_rounded, _blue, children: [
      Table(
        columnWidths: const { 0: FlexColumnWidth(2), 1: FlexColumnWidth(1), 2: FlexColumnWidth(2), 3: FlexColumnWidth(1.5), 4: FlexColumnWidth(1.5) },
        children: [
          _tableHeader(['Cidade', 'Books', 'Faturamento', 'Ticket Med.', 'Conversao']),
          ...list.take(8).map((c) => _tableRow([c['city'] ?? '-', '${c['books']}', 'R\$ ${_fmt(c['faturamento'])}', 'R\$ ${_fmt(c['ticketMedio'])}', '${c['conversao']}%'])),
        ],
      ),
    ]);
  }

  // ── Event Ranking ──────────────────────────────────────────
  Widget _buildEventRanking(Map<String, dynamic> s) {
    final list = (s['rankingEventos'] as List? ?? []).take(8).toList();
    return _statsCard('Ranking de Eventos', Icons.celebration_rounded, const Color(0xFFFF8A65), children: [
      ...list.asMap().entries.map((e) {
        final i = e.key; final ev = e.value;
        return _rankRow(i + 1, ev['event'], 'R\$ ${_fmt(ev['faturamento'])} · ${ev['books']} books · Ticket: R\$ ${_fmt(ev['ticketMedio'])}', const Color(0xFFFF8A65));
      }),
    ]);
  }

  // ── Horarios ───────────────────────────────────────────────
  Widget _buildHorarios(Map<String, dynamic> s) {
    final h = s['analiseHorarios'] ?? {};
    final melhorDia = h['melhorDia'] ?? 'N/A';
    final melhorHora = h['melhorHora'] ?? 0;
    final porDia = (h['porDiaSemana'] as List? ?? []);
    final maxDia = porDia.isEmpty ? 1 : porDia.map((d) => d['count'] as int).reduce((a, b) => a > b ? a : b);
    return _statsCard('Analise de Horarios', Icons.access_time_rounded, const Color(0xFF4DB6AC), children: [
      Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: const Color(0xFF4DB6AC).withOpacity(0.1), borderRadius: BorderRadius.circular(10)),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceAround,
          children: [
            Column(children: [
              const Icon(Icons.calendar_today_rounded, color: Color(0xFF4DB6AC), size: 22),
              const SizedBox(height: 4),
              Text(melhorDia, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16)),
              const Text('Melhor Dia', style: TextStyle(color: Colors.white54, fontSize: 10)),
            ]),
            Column(children: [
              const Icon(Icons.schedule_rounded, color: Color(0xFF4DB6AC), size: 22),
              const SizedBox(height: 4),
              Text('${melhorHora}h', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16)),
              const Text('Melhor Horario', style: TextStyle(color: Colors.white54, fontSize: 10)),
            ]),
          ],
        ),
      ),
      const SizedBox(height: 12),
      const Text('Vendas por Dia da Semana', style: TextStyle(color: Colors.white54, fontSize: 11)),
      const SizedBox(height: 6),
      ...porDia.map((d) => Padding(
        padding: const EdgeInsets.only(bottom: 4),
        child: Row(children: [
          SizedBox(width: 32, child: Text(d['dia'], style: const TextStyle(color: Colors.white70, fontSize: 11))),
          const SizedBox(width: 8),
          Expanded(child: ClipRRect(borderRadius: BorderRadius.circular(4), child: LinearProgressIndicator(
            value: maxDia > 0 ? (d['count'] as int) / maxDia : 0,
            backgroundColor: Colors.white10, color: const Color(0xFF4DB6AC), minHeight: 8,
          ))),
          const SizedBox(width: 8),
          Text('${d['count']}', style: const TextStyle(color: Colors.white70, fontSize: 11)),
        ]),
      )),
    ]);
  }

  // ── Seller Ranking ─────────────────────────────────────────
  Widget _buildSellerRanking(Map<String, dynamic> s) {
    final list = (s['rankingVendedores'] as List? ?? []).take(10).toList();
    final maxFat = list.isEmpty ? 1.0 : (list.first['faturamento'] as num).toDouble();
    return _statsCard('Ranking de Vendedores', Icons.people_alt_rounded, const Color(0xFFAB47BC), children: [
      ...list.asMap().entries.map((e) {
        final i = e.key; final v = e.value;
        final pct = maxFat > 0 ? (v['faturamento'] as num).toDouble() / maxFat : 0.0;
        return Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Container(width: 22, height: 22, decoration: BoxDecoration(color: const Color(0xFFAB47BC).withOpacity(0.2), shape: BoxShape.circle),
                child: Center(child: Text('${i + 1}', style: const TextStyle(color: Color(0xFFAB47BC), fontSize: 11, fontWeight: FontWeight.bold)))),
              const SizedBox(width: 8),
              Expanded(child: Text(v['name'], style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w600))),
              Text('R\$ ${_fmt(v['faturamento'])}', style: const TextStyle(color: Color(0xFFAB47BC), fontSize: 12, fontWeight: FontWeight.bold)),
            ]),
            const SizedBox(height: 4),
            Row(children: [
              const SizedBox(width: 30),
              Expanded(child: ClipRRect(borderRadius: BorderRadius.circular(4), child: LinearProgressIndicator(
                value: pct.clamp(0.0, 1.0), backgroundColor: Colors.white10, color: const Color(0xFFAB47BC), minHeight: 6,
              ))),
              const SizedBox(width: 8),
              Text('${v['books']} books · ${v['conversao']}% conv. · TM: R\$ ${_fmt(v['ticketMedio'])}',
                  style: const TextStyle(color: Colors.white54, fontSize: 10)),
            ]),
          ]),
        );
      }),
    ]);
  }

  // ── Fotografos ─────────────────────────────────────────────
  Widget _buildPhotografosCard(Map<String, dynamic> s) {
    final list = (s['rankingFotografos'] as List? ?? []).take(8).toList();
    return _statsCard('Analise de Fotografos', Icons.camera_alt_rounded, const Color(0xFF26C6DA), children: [
      ...list.asMap().entries.map((e) {
        final i = e.key; final p = e.value;
        return _rankRow(i + 1, p['name'], '${p['booksVendidos']} vendidos · ${p['conversao']}% conversao · VM: R\$ ${_fmt(p['valorMedio'])}', const Color(0xFF26C6DA));
      }),
    ]);
  }

  // ── Children ───────────────────────────────────────────────
  Widget _buildChildrenCard(Map<String, dynamic> s) {
    final c = s['analiseChildrens'] ?? {};
    final idades = (c['idadeRanking'] as List? ?? []).take(8).toList();
    final nomes = (c['topNomes'] as List? ?? []).take(6).toList();
    final maxCount = idades.isEmpty ? 1 : (idades.first['count'] as int);
    return _statsCard('Analise de Criancas', Icons.child_care_rounded, const Color(0xFFEC407A), children: [
      if (c['faixaEtariaLucrativa'] != null)
        Container(
          padding: const EdgeInsets.all(10),
          margin: const EdgeInsets.only(bottom: 10),
          decoration: BoxDecoration(color: const Color(0xFFEC407A).withOpacity(0.12), borderRadius: BorderRadius.circular(10),
            border: Border.all(color: const Color(0xFFEC407A).withOpacity(0.3))),
          child: Row(children: [
            const Icon(Icons.star_rounded, color: Color(0xFFEC407A), size: 18),
            const SizedBox(width: 8),
            Text('Faixa Etaria Lucrativa: ${c['faixaEtariaLucrativa']['idade']} anos (${c['faixaEtariaLucrativa']['count']} vendas)',
                style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600)),
          ]),
        ),
      const Text('Vendas por Idade', style: TextStyle(color: Colors.white54, fontSize: 11)),
      const SizedBox(height: 6),
      ...idades.map((ag) => Padding(
        padding: const EdgeInsets.only(bottom: 4),
        child: Row(children: [
          SizedBox(width: 42, child: Text('${ag['idade']} anos', style: const TextStyle(color: Colors.white70, fontSize: 10))),
          const SizedBox(width: 4),
          Expanded(child: ClipRRect(borderRadius: BorderRadius.circular(4), child: LinearProgressIndicator(
            value: maxCount > 0 ? (ag['count'] as int) / maxCount : 0,
            backgroundColor: Colors.white10, color: const Color(0xFFEC407A), minHeight: 8,
          ))),
          const SizedBox(width: 8),
          Text('${ag['count']}', style: const TextStyle(color: Colors.white70, fontSize: 10)),
        ]),
      )),
      const SizedBox(height: 12),
      const Text('Nomes Mais Frequentes', style: TextStyle(color: Colors.white54, fontSize: 11)),
      const SizedBox(height: 6),
      Wrap(
        spacing: 6, runSpacing: 6,
        children: nomes.map((n) => Chip(
          label: Text('${n['nome']} (${n['count']})', style: const TextStyle(color: Colors.white, fontSize: 11)),
          backgroundColor: const Color(0xFFEC407A).withOpacity(0.18),
          side: BorderSide(color: const Color(0xFFEC407A).withOpacity(0.4)),
          padding: EdgeInsets.zero,
        )).toList(),
      ),
    ]);
  }

  // ── Payment ────────────────────────────────────────────────
  Widget _buildPaymentCard(Map<String, dynamic> s) {
    final list = s['formasPagamento'] as List? ?? [];
    const methodMap = { 'CASH': 'Dinheiro', 'PIX': 'Pix', 'CREDIT': 'Credito', 'DEBIT': 'Debito', 'BOLETO': 'Boleto' };
    final colors = [_green, _blue, _accent, _gold, const Color(0xFFFF8A65)];
    return _statsCard('Formas de Pagamento', Icons.payments_rounded, _green, children: [
      ...list.asMap().entries.map((e) {
        final i = e.key; final p = e.value;
        final color = colors[i % colors.length];
        final label = methodMap[p['method']] ?? p['method'];
        return Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: Row(children: [
            Container(width: 10, height: 10, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
            const SizedBox(width: 8),
            Expanded(child: Text(label, style: const TextStyle(color: Colors.white, fontSize: 12))),
            Text('${p['percentual']}%', style: TextStyle(color: color, fontSize: 13, fontWeight: FontWeight.bold)),
            const SizedBox(width: 8),
            Text('R\$ ${_fmt(p['value'])}', style: const TextStyle(color: Colors.white54, fontSize: 11)),
            const SizedBox(width: 8),
            Text('(${p['count']} vend.)', style: const TextStyle(color: Colors.white38, fontSize: 10)),
          ]),
        );
      }),
    ]);
  }

  // ── Rebolo BI ──────────────────────────────────────────────
  Widget _buildReboloBI() {
    if (_reboloStats == null) return const SizedBox();
    final r = _reboloStats!;
    final motivos = (r['motivosNaoVenda'] as List? ?? []).take(6).toList();
    final cidades = (r['cidadeRecuperacao'] as List? ?? []).take(6).toList();
    final vendedores = (r['rankingVendedoresRecuperacao'] as List? ?? []).take(5).toList();
    final antigos = (r['livrosAntigos'] as List? ?? []).take(5).toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Divider(color: Colors.white12, height: 32),
        const Row(children: [
          Text('♻️', style: TextStyle(fontSize: 22)),
          SizedBox(width: 8),
          Text('Business Intelligence — Rebolo', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 17)),
        ]),
        const SizedBox(height: 4),
        Text('Recuperacao: ${r['totalRebolosSold'] ?? 0} books revendidos · Tempo medio: ${r['tempoMedioRecompra'] ?? 0} dias ate recompra',
            style: const TextStyle(color: Colors.white54, fontSize: 12)),
        const SizedBox(height: 16),
        _statsCard('Motivos de Nao-Venda', Icons.report_problem_rounded, Colors.redAccent, children: [
          ...motivos.map((m) => Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Row(children: [
              const Icon(Icons.circle, color: Colors.redAccent, size: 8),
              const SizedBox(width: 8),
              Expanded(child: Text(m['reason'], style: const TextStyle(color: Colors.white, fontSize: 12))),
              Text('${m['count']}x', style: const TextStyle(color: Colors.redAccent, fontSize: 12, fontWeight: FontWeight.bold)),
            ]),
          )),
        ]),
        const SizedBox(height: 12),
        _statsCard('Recuperacao por Cidade', Icons.location_city_rounded, const Color(0xFF42A5F5), children: [
          ...cidades.map((c) => Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(child: Text(c['city'], style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600))),
                Text('${c['percentual']}%', style: const TextStyle(color: Color(0xFF42A5F5), fontSize: 13, fontWeight: FontWeight.bold)),
              ]),
              const SizedBox(height: 4),
              ClipRRect(borderRadius: BorderRadius.circular(4), child: LinearProgressIndicator(
                value: (c['percentual'] as num).toDouble() / 100,
                backgroundColor: Colors.white10, color: const Color(0xFF42A5F5), minHeight: 6,
              )),
              const SizedBox(height: 2),
              Text('${c['recuperados']} recuperados de ${c['total']} total', style: const TextStyle(color: Colors.white38, fontSize: 10)),
            ]),
          )),
        ]),
        const SizedBox(height: 12),
        _statsCard('Vendedores que Mais Recuperam', Icons.emoji_events_rounded, _gold, children: [
          ...vendedores.asMap().entries.map((e) {
            final i = e.key; final v = e.value;
            return _rankRow(i + 1, v['name'], '${v['recuperados']} books recuperados', _gold);
          }),
        ]),
        const SizedBox(height: 12),
        _statsCard('Books Mais Antigos no Estoque Rebolo', Icons.history_rounded, Colors.orange, children: [
          ...antigos.map((b) {
            final date = DateTime.tryParse(b['createdAt'] ?? '');
            final days = date != null ? DateTime.now().difference(date).inDays : 0;
            return Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(children: [
                Container(width: 6, height: 6, decoration: BoxDecoration(
                  color: days > 90 ? Colors.redAccent : days > 30 ? Colors.orange : Colors.green, shape: BoxShape.circle)),
                const SizedBox(width: 8),
                Expanded(child: Text('${b['sequenceNumber']} · ${b['name']}', style: const TextStyle(color: Colors.white, fontSize: 12))),
                Text('$days dias', style: TextStyle(color: days > 90 ? Colors.redAccent : Colors.orange, fontSize: 11, fontWeight: FontWeight.bold)),
              ]),
            );
          }),
        ]),
      ],
    );
  }

  // ── Helpers ────────────────────────────────────────────────
  Widget _statsCard(String title, IconData icon, Color color, {required List<Widget> children}) {
    return Container(
      margin: const EdgeInsets.only(bottom: 0),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: _card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: color.withOpacity(0.25)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Icon(icon, color: color, size: 20),
            const SizedBox(width: 8),
            Text(title, style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 14)),
          ]),
          const SizedBox(height: 12),
          const Divider(color: Colors.white12, height: 1),
          const SizedBox(height: 12),
          ...children,
        ],
      ),
    );
  }

  Widget _rankRow(int rank, String name, String sub, Color color) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(children: [
        Container(width: 24, height: 24, decoration: BoxDecoration(color: color.withOpacity(rank == 1 ? 0.3 : 0.1), shape: BoxShape.circle),
          child: Center(child: Text('$rank', style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.bold)))),
        const SizedBox(width: 10),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(name, style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w600), overflow: TextOverflow.ellipsis),
          Text(sub, style: const TextStyle(color: Colors.white54, fontSize: 11)),
        ])),
      ]),
    );
  }

  TableRow _tableHeader(List<String> cols) {
    return TableRow(
      decoration: BoxDecoration(color: Colors.white.withOpacity(0.05)),
      children: cols.map((c) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
        child: Text(c, style: const TextStyle(color: Color(0xFF90CAF9), fontSize: 10, fontWeight: FontWeight.bold)),
      )).toList(),
    );
  }

  TableRow _tableRow(List<String> cols) {
    return TableRow(
      decoration: BoxDecoration(border: Border(bottom: BorderSide(color: Colors.white.withOpacity(0.05)))),
      children: cols.map((c) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
        child: Text(c, style: const TextStyle(color: Colors.white, fontSize: 11)),
      )).toList(),
    );
  }

  String _fmt(dynamic val) {
    if (val == null) return '0';
    final d = (val as num).toDouble();
    if (d >= 1000000) return '${(d / 1000000).toStringAsFixed(1)}M';
    if (d >= 1000) return '${(d / 1000).toStringAsFixed(1)}k';
    return d.toStringAsFixed(0);
  }
}
