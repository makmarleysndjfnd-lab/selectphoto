import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';
import '../provedores/provedor_configuracoes.dart';
import '../servicos/servico_api.dart';
import '../widgets/led_button.dart';
import 'tela_busca_manual.dart';
import 'tela_config_busca_eventos_ia.dart';
import 'tela_meus_prospectos.dart';

class StateProspectsView extends StatefulWidget {
  const StateProspectsView({super.key});

  @override
  State<StateProspectsView> createState() => _StateProspectsViewState();
}

class _StateProspectsViewState extends State<StateProspectsView>
    with SingleTickerProviderStateMixin {
  static const Color _bg = Color(0xFF0D0714);
  static const Color _cardBg = Color(0xFF160D24);
  static const Color _accent = Color(0xFFA855F7);
  static const Color _accentSoft = Color(0xFFD8B4FE);
  static const Color _green = Color(0xFF10B981);

  late TabController _tabController;
  final List<String> _states = ['GO', 'MT', 'MS', 'MG', 'RO'];
  final Map<String, List<dynamic>> _stateData = {};
  final Map<String, Map<String, dynamic>> _stateMeta = {};
  final Map<String, bool> _isLoading = {};
  final Map<String, String?> _errors = {};

  String _durationFilter = 'ALL'; // 'ALL', 'IDEAL', 'LONG', 'SHORT'
  bool _canConfigureSearch = false;

  Widget _buildFilterChip(String value, String label) {
    final bool isSelected = _durationFilter == value;
    return ChoiceChip(
      label: Text(
        label,
        style: TextStyle(
          color: isSelected ? Colors.white : Colors.white70,
          fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
          fontSize: 12,
        ),
      ),
      selected: isSelected,
      selectedColor: _accent,
      backgroundColor: _cardBg,
      onSelected: (bool selected) {
        if (selected) {
          setState(() {
            _durationFilter = value;
          });
        }
      },
    );
  }

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: _states.length, vsync: this);
    _tabController.addListener(() {
      if (!_tabController.indexIsChanging) {
        _loadDataForState(_states[_tabController.index]);
      }
    });
    _loadDataForState(_states[0]);
    _checkRole();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _checkRole() async {
    final prefs = await SharedPreferences.getInstance();
    final role = (prefs.getString('user_role') ?? '').toUpperCase();
    if (mounted) {
      setState(() {
        _canConfigureSearch =
            role == 'ADMIN' || role == 'COMPANY_ADMIN' || role == 'SUPER_ADMIN';
      });
    }
  }

  Future<void> _loadDataForState(String state, {bool force = false}) async {
    if (!force &&
        _stateData.containsKey(state) &&
        _stateData[state]!.isNotEmpty) {
      return;
    }

    setState(() {
      _isLoading[state] = true;
      _errors[state] = null;
    });

    try {
      final api = Provider.of<ApiService>(context, listen: false);
      final data = await api.fetchStateRadar(state, force: force);
      if (!mounted) return;
      setState(() {
        final rawList = data['events'];
        _stateData[state] = rawList is List
            ? rawList
                .whereType<Map>()
                .map((e) => Map<String, dynamic>.from(e))
                .toList()
            : <dynamic>[];
        _stateMeta[state] = {
          'cached': data['cached'] == true,
          'source': data['source']?.toString() ?? '',
          'fetchedAt': (data['fetchedAt'] ?? data['updatedAt'])?.toString(),
          'searchMeta': data['searchMeta'] is Map
              ? Map<String, dynamic>.from(data['searchMeta'] as Map)
              : null,
        };
        _isLoading[state] = false;
      });
    } catch (e) {
      if (!mounted) return;
      final clean = e.toString().replaceFirst('Exception: ', '').trim();
      setState(() {
        _errors[state] =
            clean.isNotEmpty ? clean : 'Falha ao consultar o Radar Estadual.';
        _isLoading[state] = false;
      });
    }
  }

  String _cleanField(dynamic raw, {String fallback = 'N/D'}) {
    if (raw == null) return fallback;
    final s = raw
        .toString()
        .replaceAll(RegExp(r'[\u00A0\u202F]'), ' ')
        .trim();
    if (s.isEmpty) return fallback;
    final lower = s.toLowerCase();
    if (lower == 'n/a' ||
        lower == 'na' ||
        lower == 'null' ||
        lower == 'undefined' ||
        lower == '-' ||
        lower == 'não informado') {
      return fallback;
    }
    return s;
  }

  int? _parseConfirmedPopulation(dynamic raw) {
    final cleaned = _cleanField(raw, fallback: '');
    if (cleaned.isEmpty || cleaned == 'N/D') return null;

    final lower = cleaned.toLowerCase();
    if (lower.contains('milh')) {
      final numMatch = RegExp(r'(\d+(?:[.,]\d+)?)').firstMatch(lower);
      if (numMatch != null) {
        final v = double.tryParse(numMatch.group(1)!.replaceAll(',', '.'));
        if (v != null && v > 0) return (v * 1000000).round();
      }
    }

    final digitsOnly = cleaned.replaceAll(RegExp(r'[^\d]'), '');
    if (digitsOnly.isEmpty) return null;
    final parsed = int.tryParse(digitsOnly);
    if (parsed == null || parsed < 500) return null;
    return parsed;
  }

  String _resolveEventUrl(Map<dynamic, dynamic> evt) {
    for (final candidate in [evt['sourceUrl'], evt['website']]) {
      final str = candidate?.toString().trim() ?? '';
      if (str.startsWith('http://') || str.startsWith('https://')) {
        return str;
      }
    }
    final sources = evt['sources'];
    if (sources is List) {
      for (final item in sources) {
        final str = item?.toString().trim() ?? '';
        if (str.startsWith('http://') || str.startsWith('https://')) {
          return str;
        }
      }
    }
    return '';
  }

  String _formatFetchedAt(String? isoStr) {
    if (isoStr == null || isoStr.trim().isEmpty) return '';
    final parsed = DateTime.tryParse(isoStr.trim());
    if (parsed == null) return '';
    return DateFormat('dd/MM HH:mm').format(parsed.toLocal());
  }

  int _computeDuration(Map<dynamic, dynamic> evt) {
    try {
      final sRaw = evt['startDate']?.toString().trim() ?? '';
      final eRaw = evt['endDate']?.toString().trim() ?? '';
      if (sRaw.isNotEmpty && eRaw.isNotEmpty) {
        final s = DateTime.tryParse(sRaw.split('T').first);
        final e = DateTime.tryParse(eRaw.split('T').first);
        if (s != null && e != null) {
          final diff = e.difference(s).inDays + 1;
          return diff >= 1 ? diff : 1;
        }
      }
    } catch (_) {}
    final rawDays = evt['durationDays'];
    if (rawDays != null) {
      final parsed = int.tryParse(rawDays.toString());
      if (parsed != null && parsed >= 1) return parsed;
    }
    return 1;
  }

  Future<void> _addProspect(Map<String, dynamic> event, String state) async {
    final TextEditingController obsController = TextEditingController();

    final result = await showDialog<bool>(
      context: context,
      builder: (context) {
        return AlertDialog(
          backgroundColor: _cardBg,
          title: const Text('Adicionar Prospecto',
              style: TextStyle(color: Colors.white)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                'Deseja adicionar "${event['name']}" aos Meus Prospectos?',
                style: const TextStyle(color: Colors.white70),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: obsController,
                style: const TextStyle(color: Colors.white),
                decoration: InputDecoration(
                  labelText: 'Observações (Opcional)',
                  labelStyle: const TextStyle(color: Colors.white54),
                  filled: true,
                  fillColor: Colors.white10,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(8),
                    borderSide: BorderSide.none,
                  ),
                ),
                maxLines: 2,
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancelar',
                  style: TextStyle(color: Colors.white54)),
            ),
            LedButton(
              onPressed: () => Navigator.pop(context, true),
              style: LedButton.styleFrom(backgroundColor: _accent),
              child: const Text('Adicionar',
                  style: TextStyle(color: Colors.white)),
            ),
          ],
        );
      },
    );

    if (result == true) {
      if (!mounted) return;
      try {
        final api = Provider.of<ApiService>(context, listen: false);
        final audienceVal = _cleanField(
          event['estimatedAudience'] ?? event['audience'],
          fallback: '',
        );
        await api.saveProspect({
          'name': event['name'],
          'city': event['city'],
          'startDate': event['startDate'],
          'endDate': event['endDate'],
          'durationDays': event['durationDays'],
          'score': event['score']?.toString() ?? 'HIGH',
          'category': event['category'] ?? 'OTHER',
          'audience': audienceVal.isNotEmpty ? audienceVal : null,
          'ticketPrice': _cleanField(event['ticketPrice'], fallback: ''),
          'organizerContact':
              _cleanField(event['organizerContact'], fallback: ''),
          'socialMedia': _cleanField(
            event['socialMedia'],
            fallback: event['sourcePlatform'] != null
                ? 'Fonte: ${event['sourcePlatform']}'
                : '',
          ),
          'notes': _cleanField(
            event['notes'],
            fallback:
                'Pop: ${_cleanField(event['population'])} | Renda: ${_cleanField(event['perCapitaIncome'] ?? event['income'])} | PIB: ${_cleanField(event['gdp'])}',
          ),
          'observations': obsController.text,
          'isProspect': true,
          'cityAge': _cleanField(event['cityAge']),
          'cityIncome':
              _cleanField(event['perCapitaIncome'] ?? event['income']),
          'cityPerCapita':
              _cleanField(event['perCapitaIncome'] ?? event['income']),
          'cityEconomy': _cleanField(event['gdp']),
        });

        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Prospecto adicionado com sucesso!'),
              backgroundColor: Colors.green,
            ),
          );
          setState(() {
            _stateData[state]?.removeWhere(
              (e) => e['name'] == event['name'] && e['city'] == event['city'],
            );
          });
        }
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Erro: $e'), backgroundColor: Colors.red),
          );
        }
      }
    }
  }

  void _openManualSearch() {
    Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => const ManualSearchScreen()),
    );
  }

  void _openMyProspects() {
    Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => const MyProspectsScreen()),
    );
  }

  void _openSearchConfig() {
    Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => const TelaConfigBuscaEventosIa()),
    );
  }

  String _formatIncome(String? incomeRaw) {
    final cleaned = _cleanField(incomeRaw);
    if (cleaned == 'N/D') return 'N/D';
    String text = cleaned;
    text = text.replaceAll('(Potencial de Crédito:', 'PotC:');
    text = text.replaceAll('Altíssimo', 'alti');
    text = text.replaceAll('Alto', 'alto');
    text = text.replaceAll('Médio', 'med');
    text = text.replaceAll('Baixo', 'baixo');
    text = text.replaceAll('💳', '');
    text = text.replaceAll(')', '');
    return text.replaceAll('Renda Per Capita:', '').trim();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      color: _bg,
      child: Column(
        children: [
          Container(
            color: _cardBg,
            child: Row(
              children: [
                Expanded(
                  child: TabBar(
                    controller: _tabController,
                    isScrollable: true,
                    indicatorColor: _accent,
                    labelColor: _accentSoft,
                    unselectedLabelColor: Colors.white54,
                    tabs: _states.map((s) => Tab(text: s)).toList(),
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.search, color: Colors.white70),
                  tooltip: 'Busca Manual',
                  onPressed: _openManualSearch,
                ),
                IconButton(
                  icon: const Icon(Icons.list_alt, color: Colors.white70),
                  tooltip: 'Meus Prospectos',
                  onPressed: _openMyProspects,
                ),
                if (_canConfigureSearch)
                  IconButton(
                    icon: const Icon(Icons.settings_rounded, color: _accentSoft),
                    tooltip: 'Configurar Busca IA',
                    onPressed: _openSearchConfig,
                  ),
                const SizedBox(width: 8),
              ],
            ),
          ),
          Expanded(
            child: TabBarView(
              controller: _tabController,
              children: _states.map((state) {
                if (_isLoading[state] == true) {
                  return const Center(
                    child: Padding(
                      padding:
                          EdgeInsets.symmetric(horizontal: 20, vertical: 40),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          CircularProgressIndicator(
                              color: _accent, strokeWidth: 3),
                          SizedBox(height: 24),
                          Text(
                            'Pesquisando eventos confirmados e fontes verificáveis no estado... Aguarde!',
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              color: _accentSoft,
                              fontSize: 15,
                              fontWeight: FontWeight.w500,
                              fontStyle: FontStyle.italic,
                            ),
                          ),
                        ],
                      ),
                    ),
                  );
                }
                if (_errors[state] != null) {
                  return Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.error_outline,
                            color: Colors.redAccent, size: 48),
                        const SizedBox(height: 16),
                        Text(
                          'Erro ao carregar $state',
                          style: const TextStyle(
                              color: Colors.white, fontSize: 18),
                        ),
                        const SizedBox(height: 8),
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 32),
                          child: Text(
                            _errors[state]!,
                            textAlign: TextAlign.center,
                            style: const TextStyle(color: Colors.white54),
                          ),
                        ),
                        const SizedBox(height: 16),
                        LedButton(
                          onPressed: () =>
                              _loadDataForState(state, force: true),
                          style:
                              LedButton.styleFrom(backgroundColor: _accent),
                          child: const Text(
                            'Tentar Novamente',
                            style: TextStyle(color: Colors.white),
                          ),
                        ),
                      ],
                    ),
                  );
                }

                final rawEvents = _stateData[state] ?? [];
                final meta = _stateMeta[state];
                final bool isCached = meta?['cached'] == true;
                final String fetchedStr =
                    _formatFetchedAt(meta?['fetchedAt']?.toString());

                final events = rawEvents.where((raw) {
                  if (raw is! Map) return false;
                  final duration = _computeDuration(raw);
                  if (_durationFilter == 'IDEAL') {
                    return duration >= 6 && duration <= 30;
                  }
                  if (_durationFilter == 'LONG') return duration > 30;
                  if (_durationFilter == 'SHORT') return duration < 6;
                  return true;
                }).toList();

                return Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Padding(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 16, vertical: 12),
                      child: Wrap(
                        alignment: WrapAlignment.spaceBetween,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        spacing: 10,
                        runSpacing: 8,
                        children: [
                          Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Container(
                                width: 10,
                                height: 10,
                                decoration: const BoxDecoration(
                                  color: _accent,
                                  shape: BoxShape.circle,
                                ),
                              ),
                              const SizedBox(width: 8),
                              Text(
                                'Resultados para $state (${events.length})',
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 17,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                              if (meta != null) ...[
                                const SizedBox(width: 8),
                                Container(
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: 8, vertical: 3),
                                  decoration: BoxDecoration(
                                    color: isCached
                                        ? _accent.withOpacity(0.18)
                                        : _green.withOpacity(0.18),
                                    borderRadius: BorderRadius.circular(8),
                                    border: Border.all(
                                      color: isCached
                                          ? _accentSoft.withOpacity(0.5)
                                          : _green.withOpacity(0.6),
                                    ),
                                  ),
                                  child: Text(
                                    isCached
                                        ? 'Cache${fetchedStr.isNotEmpty ? ' · $fetchedStr' : ''}'
                                        : 'Ao vivo${fetchedStr.isNotEmpty ? ' · $fetchedStr' : ''}',
                                    style: TextStyle(
                                      color: isCached ? _accentSoft : _green,
                                      fontSize: 11,
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                ),
                              ],
                            ],
                          ),
                          LedButton.icon(
                            onPressed: () =>
                                _loadDataForState(state, force: true),
                            icon: const Icon(Icons.refresh_rounded,
                                size: 18, color: Colors.white),
                            label: const Text(
                              'Atualizar agora',
                              style: TextStyle(
                                  color: Colors.white,
                                  fontWeight: FontWeight.w600),
                            ),
                            style: LedButton.styleFrom(
                              backgroundColor: _green,
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 14, vertical: 10),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(10),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 16, vertical: 4),
                      child: SingleChildScrollView(
                        scrollDirection: Axis.horizontal,
                        child: Row(
                          children: [
                            const Text(
                              'Filtro Duração: ',
                              style: TextStyle(
                                color: Colors.white70,
                                fontSize: 12,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            const SizedBox(width: 6),
                            _buildFilterChip(
                                'ALL', 'Todos (${rawEvents.length})'),
                            const SizedBox(width: 6),
                            _buildFilterChip('IDEAL', '🟢 6-30 dias (Ideal)'),
                            const SizedBox(width: 6),
                            _buildFilterChip('LONG', '🔵 +30 dias'),
                            const SizedBox(width: 6),
                            _buildFilterChip('SHORT', '🟡 1-5 dias'),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 6),
                    if (events.isEmpty)
                      const Expanded(
                        child: Center(
                          child: Text(
                            'Nenhum evento confirmado corresponde ao filtro selecionado.',
                            style:
                                TextStyle(color: Colors.white54, fontSize: 15),
                          ),
                        ),
                      )
                    else
                      Expanded(
                        child: Padding(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 16, vertical: 6),
                          child: Container(
                            decoration: BoxDecoration(
                              color: _cardBg,
                              borderRadius: BorderRadius.circular(16),
                              border:
                                  Border.all(color: _accent.withOpacity(0.25)),
                            ),
                            child: ClipRRect(
                              borderRadius: BorderRadius.circular(16),
                              child: SingleChildScrollView(
                                scrollDirection: Axis.horizontal,
                                child: SingleChildScrollView(
                                  child: Theme(
                                    data: Theme.of(context).copyWith(
                                      dividerColor: Colors.white12,
                                    ),
                                    child: DataTable(
                                      headingRowColor: WidgetStateProperty.all(
                                          const Color(0xFF1F1133)),
                                      headingTextStyle: const TextStyle(
                                        color: _accentSoft,
                                        fontWeight: FontWeight.bold,
                                        fontSize: 13,
                                      ),
                                      dataTextStyle: const TextStyle(
                                        color: Colors.white,
                                        fontSize: 13,
                                      ),
                                      columnSpacing: 22,
                                      horizontalMargin: 16,
                                      columns: const [
                                        DataColumn(label: Text('Cidade')),
                                        DataColumn(label: Text('Evento')),
                                        DataColumn(label: Text('Data')),
                                        DataColumn(label: Text('Duração')),
                                        DataColumn(label: Text('Público Est.')),
                                        DataColumn(label: Text('ROI Est.')),
                                        DataColumn(label: Text('População')),
                                        DataColumn(
                                            label: Text('Infantil IBGE')),
                                        DataColumn(
                                            label: Text('Renda Per Capita')),
                                        DataColumn(label: Text('PIB')),
                                        DataColumn(label: Text('Nota')),
                                        DataColumn(label: Text('Ação')),
                                      ],
                                      rows: events.map<DataRow>((rawEvt) {
                                        final evt = Map<String, dynamic>.from(
                                            rawEvt as Map);
                                        final rawInc = evt['perCapitaIncome']
                                                ?.toString() ??
                                            evt['income']?.toString();
                                        final incStr = _formatIncome(rawInc);
                                        final score = evt['score']
                                                ?.toString()
                                                .toUpperCase() ??
                                            'HIGH';

                                        final settings =
                                            Provider.of<SettingsProvider>(
                                                context,
                                                listen: false);
                                        final int durationDays =
                                            _computeDuration(evt);
                                        final double estRevenue = durationDays *
                                            settings.defaultFichasPerDay *
                                            settings.defaultTicket;
                                        final double estCost = (durationDays *
                                                settings.defaultFichasPerDay *
                                                settings.productCost) +
                                            (durationDays *
                                                2 *
                                                settings
                                                    .hotelCostPerPersonDay) +
                                            (durationDays *
                                                2 *
                                                settings.foodCostPerPersonDay) +
                                            (150 * settings.fuelCostPerKm) +
                                            1000.0;
                                        final double estProfit =
                                            estRevenue - estCost;
                                        final currencyFmt =
                                            NumberFormat.compactSimpleCurrency(
                                                locale: 'pt_BR');
                                        final estProfitStr =
                                            currencyFmt.format(estProfit);

                                        // População real sem fallback artificial hardcoded
                                        final int? popInt =
                                            _parseConfirmedPopulation(
                                                evt['population']);
                                        final int? childPop = popInt != null
                                            ? (popInt * 0.225).round()
                                            : null;
                                        final bool isHighChildDensity =
                                            childPop != null &&
                                                childPop >= 12000;
                                        final String popDisplay = popInt != null
                                            ? NumberFormat.decimalPattern(
                                                    'pt_BR')
                                                .format(popInt)
                                            : 'N/D';

                                        final String sourcePlatform =
                                            _cleanField(evt['sourcePlatform'],
                                                fallback: '');
                                        final String resolvedUrl =
                                            _resolveEventUrl(evt);
                                        final bool isVerified =
                                            evt['verificationStatus']
                                                    ?.toString()
                                                    .toUpperCase() ==
                                                'VERIFIED_SOURCE';
                                        final String audienceStr = _cleanField(
                                          evt['estimatedAudience'] ??
                                              evt['audience'],
                                        );

                                        Color scoreColor = _green;
                                        Color scoreBg =
                                            _green.withOpacity(0.15);
                                        if (score == 'MEDIUM' ||
                                            score == 'MÉDIO') {
                                          scoreColor = const Color(0xFFFFB74D);
                                          scoreBg = const Color(0xFFFFB74D)
                                              .withOpacity(0.15);
                                        } else if (score == 'LOW' ||
                                            score == 'BAIXO') {
                                          scoreColor = const Color(0xFFFF5252);
                                          scoreBg = const Color(0xFFFF5252)
                                              .withOpacity(0.15);
                                        }

                                        final String startRaw =
                                            evt['startDate']?.toString() ?? '';
                                        final String endRaw =
                                            evt['endDate']?.toString() ?? '';
                                        String dateRangeDisplay = startRaw;
                                        if (startRaw.isNotEmpty) {
                                          final sParts =
                                              startRaw.split('T')[0].split('-');
                                          final sFmt = sParts.length == 3
                                              ? '${sParts[2]}/${sParts[1]}/${sParts[0].substring(2)}'
                                              : startRaw;
                                          if (endRaw.isNotEmpty &&
                                              endRaw.split('T')[0] !=
                                                  startRaw.split('T')[0]) {
                                            final eParts =
                                                endRaw.split('T')[0].split('-');
                                            final eFmt = eParts.length == 3
                                                ? '${eParts[2]}/${eParts[1]}/${eParts[0].substring(2)}'
                                                : endRaw;
                                            dateRangeDisplay = '$sFmt a $eFmt';
                                          } else {
                                            dateRangeDisplay = sFmt;
                                          }
                                        }

                                        return DataRow(
                                          cells: [
                                            DataCell(
                                              Text(
                                                _cleanField(evt['city'],
                                                    fallback: state),
                                                style: const TextStyle(
                                                    fontWeight:
                                                        FontWeight.w600),
                                              ),
                                            ),
                                            DataCell(
                                              Column(
                                                mainAxisAlignment:
                                                    MainAxisAlignment.center,
                                                crossAxisAlignment:
                                                    CrossAxisAlignment.start,
                                                children: [
                                                  Text(
                                                    _cleanField(evt['name'],
                                                        fallback: 'Evento'),
                                                    style: const TextStyle(
                                                      fontWeight:
                                                          FontWeight.w600,
                                                      color: Colors.white,
                                                    ),
                                                  ),
                                                  const SizedBox(height: 3),
                                                  Row(
                                                    mainAxisSize:
                                                        MainAxisSize.min,
                                                    children: [
                                                      Container(
                                                        padding:
                                                            const EdgeInsets
                                                                .symmetric(
                                                          horizontal: 5,
                                                          vertical: 2,
                                                        ),
                                                        decoration:
                                                            BoxDecoration(
                                                          color: isVerified
                                                              ? _green
                                                                  .withOpacity(
                                                                      0.18)
                                                              : Colors.amber
                                                                  .withOpacity(
                                                                      0.14),
                                                          borderRadius:
                                                              BorderRadius
                                                                  .circular(4),
                                                          border: Border.all(
                                                            color: isVerified
                                                                ? _green
                                                                : Colors
                                                                    .amberAccent
                                                                    .withOpacity(
                                                                        0.5),
                                                          ),
                                                        ),
                                                        child: Text(
                                                          isVerified
                                                              ? '✓ Verificado'
                                                              : 'Estimado',
                                                          style: TextStyle(
                                                            color: isVerified
                                                                ? _green
                                                                : Colors
                                                                    .amberAccent,
                                                            fontSize: 9,
                                                            fontWeight:
                                                                FontWeight.bold,
                                                          ),
                                                        ),
                                                      ),
                                                      const SizedBox(width: 4),
                                                      if (sourcePlatform
                                                          .isNotEmpty) ...[
                                                        Container(
                                                          padding:
                                                              const EdgeInsets
                                                                  .symmetric(
                                                            horizontal: 5,
                                                            vertical: 2,
                                                          ),
                                                          decoration:
                                                              BoxDecoration(
                                                            color: Colors
                                                                .cyanAccent
                                                                .withOpacity(
                                                                    0.14),
                                                            borderRadius:
                                                                BorderRadius
                                                                    .circular(
                                                                        4),
                                                            border: Border.all(
                                                              color: Colors
                                                                  .cyanAccent
                                                                  .withOpacity(
                                                                      0.5),
                                                            ),
                                                          ),
                                                          child: Text(
                                                            '📍 $sourcePlatform',
                                                            style:
                                                                const TextStyle(
                                                              color: Colors
                                                                  .cyanAccent,
                                                              fontSize: 9,
                                                              fontWeight:
                                                                  FontWeight
                                                                      .bold,
                                                            ),
                                                          ),
                                                        ),
                                                        const SizedBox(
                                                            width: 4),
                                                      ],
                                                      InkWell(
                                                        onTap: () async {
                                                          Uri? url;
                                                          if (resolvedUrl
                                                              .isNotEmpty) {
                                                            url = Uri.tryParse(
                                                                resolvedUrl);
                                                          }
                                                          if (url == null) {
                                                            final query = Uri
                                                                .encodeComponent(
                                                                    '${evt['name'] ?? ''} ${evt['city'] ?? ''} programação data oficial');
                                                            url = Uri.parse(
                                                                'https://www.google.com/search?q=$query');
                                                          }
                                                          if (await canLaunchUrl(
                                                              url)) {
                                                            await launchUrl(
                                                              url,
                                                              mode: LaunchMode
                                                                  .externalApplication,
                                                            );
                                                          }
                                                        },
                                                        child: Container(
                                                          padding:
                                                              const EdgeInsets
                                                                  .symmetric(
                                                            horizontal: 6,
                                                            vertical: 2,
                                                          ),
                                                          decoration:
                                                              BoxDecoration(
                                                            color: _accent
                                                                .withOpacity(
                                                                    0.18),
                                                            borderRadius:
                                                                BorderRadius
                                                                    .circular(
                                                                        4),
                                                            border: Border.all(
                                                              color: _accent
                                                                  .withOpacity(
                                                                      0.45),
                                                            ),
                                                          ),
                                                          child: Row(
                                                            mainAxisSize:
                                                                MainAxisSize
                                                                    .min,
                                                            children: [
                                                              Icon(
                                                                resolvedUrl
                                                                        .isNotEmpty
                                                                    ? Icons
                                                                        .open_in_new_rounded
                                                                    : Icons
                                                                        .search,
                                                                size: 11,
                                                                color:
                                                                    _accentSoft,
                                                              ),
                                                              const SizedBox(
                                                                  width: 3),
                                                              Text(
                                                                resolvedUrl
                                                                        .isNotEmpty
                                                                    ? 'Abrir Fonte'
                                                                    : 'Buscar',
                                                                style:
                                                                    const TextStyle(
                                                                  color:
                                                                      _accentSoft,
                                                                  fontSize: 10,
                                                                  fontWeight:
                                                                      FontWeight
                                                                          .bold,
                                                                ),
                                                              ),
                                                            ],
                                                          ),
                                                        ),
                                                      ),
                                                    ],
                                                  ),
                                                ],
                                              ),
                                            ),
                                            DataCell(
                                              Text(
                                                dateRangeDisplay,
                                                style: const TextStyle(
                                                    color: Colors.white70),
                                              ),
                                            ),
                                            DataCell(
                                              Text(
                                                durationDays == 1
                                                    ? '1 dia'
                                                    : '$durationDays dias',
                                                style: TextStyle(
                                                  color: durationDays == 1
                                                      ? Colors.amberAccent
                                                      : (durationDays >= 6 &&
                                                              durationDays <= 30
                                                          ? _green
                                                          : Colors.white70),
                                                  fontWeight: FontWeight.bold,
                                                ),
                                              ),
                                            ),
                                            DataCell(
                                              Text(
                                                audienceStr,
                                                style: const TextStyle(
                                                    color: Colors.white70),
                                              ),
                                            ),
                                            DataCell(
                                              Container(
                                                padding:
                                                    const EdgeInsets.symmetric(
                                                  horizontal: 8,
                                                  vertical: 3,
                                                ),
                                                decoration: BoxDecoration(
                                                  color: estProfit >= 0
                                                      ? _green.withOpacity(0.15)
                                                      : Colors.redAccent
                                                          .withOpacity(0.15),
                                                  borderRadius:
                                                      BorderRadius.circular(8),
                                                  border: Border.all(
                                                    color: estProfit >= 0
                                                        ? _green
                                                            .withOpacity(0.4)
                                                        : Colors.redAccent
                                                            .withOpacity(0.4),
                                                  ),
                                                ),
                                                child: Text(
                                                  estProfitStr,
                                                  style: TextStyle(
                                                    color: estProfit >= 0
                                                        ? _green
                                                        : Colors.redAccent,
                                                    fontWeight: FontWeight.bold,
                                                    fontSize: 11,
                                                  ),
                                                ),
                                              ),
                                            ),
                                            DataCell(
                                              Text(
                                                popDisplay,
                                                style: TextStyle(
                                                  color: popInt != null
                                                      ? Colors.white
                                                      : Colors.white38,
                                                ),
                                              ),
                                            ),
                                            DataCell(
                                              childPop == null
                                                  ? const Text(
                                                      'N/D',
                                                      style: TextStyle(
                                                          color:
                                                              Colors.white38),
                                                    )
                                                  : Row(
                                                      mainAxisSize:
                                                          MainAxisSize.min,
                                                      children: [
                                                        Text(
                                                          '👶 ${NumberFormat.compact(locale: 'pt_BR').format(childPop)}',
                                                          style:
                                                              const TextStyle(
                                                            color:
                                                                Colors.white70,
                                                          ),
                                                        ),
                                                        if (isHighChildDensity) ...[
                                                          const SizedBox(
                                                              width: 4),
                                                          Container(
                                                            padding:
                                                                const EdgeInsets
                                                                    .symmetric(
                                                              horizontal: 5,
                                                              vertical: 2,
                                                            ),
                                                            decoration:
                                                                BoxDecoration(
                                                              color: Colors
                                                                  .amberAccent
                                                                  .withOpacity(
                                                                      0.15),
                                                              borderRadius:
                                                                BorderRadius
                                                                    .circular(
                                                                        6),
                                                              border:
                                                                  Border.all(
                                                                color: Colors
                                                                    .amberAccent
                                                                    .withOpacity(
                                                                        0.5),
                                                              ),
                                                            ),
                                                            child: const Text(
                                                              '✨ Alta Conc.',
                                                              style: TextStyle(
                                                                color: Colors
                                                                    .amberAccent,
                                                                fontSize: 9,
                                                                fontWeight:
                                                                    FontWeight
                                                                        .bold,
                                                              ),
                                                            ),
                                                          ),
                                                        ],
                                                      ],
                                                    ),
                                            ),
                                            DataCell(
                                              Text(
                                                incStr,
                                                style: TextStyle(
                                                  color: incStr != 'N/D'
                                                      ? Colors.white
                                                      : Colors.white38,
                                                ),
                                              ),
                                            ),
                                            DataCell(
                                              Text(
                                                _cleanField(evt['gdp']),
                                                style: TextStyle(
                                                  color:
                                                      _cleanField(evt['gdp']) !=
                                                              'N/D'
                                                          ? Colors.white
                                                          : Colors.white38,
                                                ),
                                              ),
                                            ),
                                            DataCell(
                                              Container(
                                                padding:
                                                    const EdgeInsets.symmetric(
                                                  horizontal: 10,
                                                  vertical: 4,
                                                ),
                                                decoration: BoxDecoration(
                                                  color: scoreBg,
                                                  borderRadius:
                                                      BorderRadius.circular(12),
                                                  border: Border.all(
                                                    color: scoreColor
                                                        .withOpacity(0.35),
                                                  ),
                                                ),
                                                child: Text(
                                                  score,
                                                  style: TextStyle(
                                                    color: scoreColor,
                                                    fontWeight: FontWeight.bold,
                                                    fontSize: 11,
                                                    letterSpacing: 0.5,
                                                  ),
                                                ),
                                              ),
                                            ),
                                            DataCell(
                                              IconButton(
                                                onPressed: () =>
                                                    _addProspect(evt, state),
                                                tooltip: 'Adicionar Prospecto',
                                                icon: Container(
                                                  padding:
                                                      const EdgeInsets.all(6),
                                                  decoration:
                                                      const BoxDecoration(
                                                    color: _accent,
                                                    shape: BoxShape.circle,
                                                  ),
                                                  child: const Icon(
                                                    Icons.add_rounded,
                                                    size: 16,
                                                    color: Colors.white,
                                                  ),
                                                ),
                                              ),
                                            ),
                                          ],
                                        );
                                      }).toList(),
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                  ],
                );
              }).toList(),
            ),
          ),
        ],
      ),
    );
  }
}
