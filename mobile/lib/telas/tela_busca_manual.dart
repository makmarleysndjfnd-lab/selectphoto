import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';
import '../servicos/servico_api.dart';
import '../widgets/led_button.dart';
import '../widgets/led_card.dart';
import 'tela_config_busca_eventos_ia.dart';

class ManualSearchScreen extends StatefulWidget {
  const ManualSearchScreen({super.key});

  @override
  State<ManualSearchScreen> createState() => _ManualSearchScreenState();
}

class _ManualSearchScreenState extends State<ManualSearchScreen> {
  static const Color _bg = Color(0xFF0D0714);
  static const Color _cardBg = Color(0xFF160D24);
  static const Color _accent = Color(0xFFA855F7);
  static const Color _accentSoft = Color(0xFFD8B4FE);
  static const Color _green = Color(0xFF10B981);

  final TextEditingController _searchController = TextEditingController();

  bool _isSearching = false;
  Map<String, dynamic>? _cityInfo;
  List<dynamic> _searchResults = [];
  bool _isCachedResult = false;
  String? _fetchedAt;
  Map<String, dynamic>? _searchMeta;
  String? _error;

  List<String> _ibgeCities = [];
  bool _isLoadingCities = true;

  String _selectedDurationFilter = 'ALL'; // 'ALL', '6_30', 'OVER_30', 'SHORT'
  bool _canConfigureSearch = false;

  int _computeEventDuration(Map<dynamic, dynamic> evt) {
    try {
      final sRaw = evt['startDate']?.toString() ?? '';
      final eRaw = evt['endDate']?.toString() ?? '';
      if (sRaw.isNotEmpty && eRaw.isNotEmpty) {
        final s = DateTime.parse(sRaw.split('T')[0]);
        final e = DateTime.parse(eRaw.split('T')[0]);
        final diff = e.difference(s).inDays + 1;
        return diff >= 1 ? diff : 1;
      }
    } catch (_) {}
    final rawDays = evt['durationDays'];
    if (rawDays != null) {
      final parsed = int.tryParse(rawDays.toString());
      if (parsed != null && parsed >= 1) return parsed;
    }
    return 1;
  }

  List<dynamic> get _filteredEvents {
    if (_selectedDurationFilter == 'ALL') return _searchResults;
    return _searchResults.where((raw) {
      if (raw is! Map) return false;
      final days = _computeEventDuration(raw);
      if (_selectedDurationFilter == '6_30') return days >= 6 && days <= 30;
      if (_selectedDurationFilter == 'OVER_30') return days > 30;
      if (_selectedDurationFilter == 'SHORT') return days < 6;
      return true;
    }).toList();
  }

  @override
  void initState() {
    super.initState();
    _loadIbgeCities();
    _checkCache();
    _checkRole();
  }

  @override
  void dispose() {
    _searchController.dispose();
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

  void _checkCache() {
    final api = Provider.of<ApiService>(context, listen: false);
    final cache = api.cachedSearches;
    if (cache.isNotEmpty) {
      final latest = cache.first;
      final data = latest['data'] is Map
          ? Map<String, dynamic>.from(latest['data'] as Map)
          : <String, dynamic>{};
      setState(() {
        _searchController.text = latest['originalCity']?.toString() ?? '';
        _cityInfo = data['cityInfo'] is Map
            ? Map<String, dynamic>.from(data['cityInfo'] as Map)
            : null;
        _searchResults = (data['events'] as List?) ?? [];
        _isCachedResult = true;
        _fetchedAt =
            data['fetchedAt']?.toString() ?? latest['savedAt']?.toString();
        _searchMeta = data['searchMeta'] is Map
            ? Map<String, dynamic>.from(data['searchMeta'] as Map)
            : null;
      });
    }
  }

  Future<void> _loadIbgeCities() async {
    try {
      final res = await http.get(Uri.parse(
          'https://servicodados.ibge.gov.br/api/v1/localidades/municipios'));
      if (res.statusCode == 200) {
        final List<dynamic> data = json.decode(res.body);
        final List<String> cities = data.map((e) {
          final nome = e['nome'] ?? 'Desconhecida';
          final uf = e['microrregiao']?['mesorregiao']?['UF']?['sigla'] ?? '';
          return uf.isNotEmpty ? '$nome - $uf' : nome.toString();
        }).toList();
        if (mounted) {
          setState(() {
            _ibgeCities = cities;
            _isLoadingCities = false;
          });
        }
      } else if (mounted) {
        setState(() => _isLoadingCities = false);
      }
    } catch (_) {
      if (mounted) {
        setState(() => _isLoadingCities = false);
      }
    }
  }

  Future<void> _performSearch(String cityQuery,
      {bool forceRefresh = false}) async {
    final city = cityQuery.trim();
    if (city.isEmpty) return;

    _searchController.text = city;
    setState(() {
      _isSearching = true;
      _error = null;
      if (forceRefresh) {
        _cityInfo = null;
        _searchResults = [];
      }
    });

    try {
      final api = Provider.of<ApiService>(context, listen: false);
      final data = await api.searchEvents(city, forceRefresh: forceRefresh);

      if (!mounted) return;
      setState(() {
        _cityInfo = data['cityInfo'] is Map
            ? Map<String, dynamic>.from(data['cityInfo'] as Map)
            : null;
        _searchResults = (data['events'] as List?) ?? [];
        _isCachedResult = data['cached'] == true;
        _fetchedAt = data['fetchedAt']?.toString();
        _searchMeta = data['searchMeta'] is Map
            ? Map<String, dynamic>.from(data['searchMeta'] as Map)
            : null;
        _isSearching = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString().replaceFirst('Exception: ', '');
        _isSearching = false;
      });
    }
  }

  String _cleanText(dynamic value, {String fallback = 'Não informado'}) {
    if (value == null) return fallback;
    final s = value.toString().trim();
    if (s.isEmpty) return fallback;
    final lower = s.toLowerCase();
    if (lower == 'n/a' ||
        lower == 'na' ||
        lower == 'null' ||
        lower == 'undefined' ||
        lower == '-') {
      return fallback;
    }
    return s;
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

  String _formatDateRange(Map<dynamic, dynamic> evt) {
    final startRaw = evt['startDate']?.toString().trim() ?? '';
    final endRaw = evt['endDate']?.toString().trim() ?? '';
    if (startRaw.isEmpty) return 'Data em confirmação';

    String fmtIso(String raw) {
      final parts = raw.split('T').first.split('-');
      if (parts.length == 3) {
        return '${parts[2]}/${parts[1]}/${parts[0]}';
      }
      return raw;
    }

    final sFmt = fmtIso(startRaw);
    if (endRaw.isNotEmpty &&
        endRaw.split('T').first != startRaw.split('T').first) {
      return '$sFmt a ${fmtIso(endRaw)}';
    }
    return sFmt;
  }

  String _formatFetchedAt(String? isoStr) {
    if (isoStr == null || isoStr.trim().isEmpty) return '';
    final parsed = DateTime.tryParse(isoStr.trim());
    if (parsed == null) return '';
    final local = parsed.toLocal();
    return DateFormat('dd/MM/yyyy HH:mm').format(local);
  }

  Future<void> _addProspect(Map<String, dynamic> event) async {
    final TextEditingController obsController = TextEditingController();
    final TextEditingController valueController = TextEditingController();

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
                'Adicionar "${event['name']}" aos Meus Prospectos?',
                style: const TextStyle(color: Colors.white70),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: valueController,
                style: const TextStyle(color: Colors.white),
                keyboardType: TextInputType.number,
                decoration: InputDecoration(
                  labelText: 'Receita Prevista (R\$)',
                  labelStyle: const TextStyle(color: Colors.white54),
                  filled: true,
                  fillColor: Colors.white10,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(8),
                    borderSide: BorderSide.none,
                  ),
                ),
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
        final audienceVal = _cleanText(
          event['estimatedAudience'] ?? event['audience'],
          fallback: '',
        );
        final ticketVal = _cleanText(event['ticketPrice'], fallback: '');
        await api.saveProspect({
          'name': event['name'],
          'city': _cleanText(event['city'], fallback: _searchController.text),
          'startDate': event['startDate'],
          'endDate': event['endDate'],
          'durationDays': event['durationDays'],
          'score': event['score']?.toString() ?? 'HIGH',
          'category': event['category'] ?? 'OTHER',
          'ticketPrice': ticketVal.isNotEmpty ? ticketVal : null,
          'notes': _cleanText(
            event['notes'],
            fallback: 'Ingresso: $ticketVal | Público: $audienceVal',
          ),
          'observations': obsController.text,
          'expectedRevenue':
              double.tryParse(valueController.text.replaceAll(',', '.')) ?? 0.0,
          'isProspect': true,
          'audience': audienceVal.isNotEmpty ? audienceVal : null,
          'organizerContact':
              _cleanText(event['organizerContact'], fallback: ''),
          'socialMedia': _cleanText(
            event['socialMedia'],
            fallback: event['sourcePlatform'] != null
                ? 'Fonte: ${event['sourcePlatform']}'
                : '',
          ),
          'cityAge': _cityInfo?['cityAge'],
          'cityIncome': _cityInfo?['rendaDomiciliarPerCapitaMedia'] ??
              _cityInfo?['perCapitaIncome'],
          'cityPerCapita':
              _cityInfo?['perCapitaIncome'] ?? _cityInfo?['rendaPerCapita'],
          'cityEconomy': _cityInfo?['economicActivities'],
        });

        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Prospecto salvo com sucesso!'),
              backgroundColor: Colors.green,
            ),
          );
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

  Widget _buildFreshnessBanner() {
    if (_cityInfo == null && _searchResults.isEmpty) {
      return const SizedBox.shrink();
    }
    final formattedTime = _formatFetchedAt(_fetchedAt);
    final sourcesCount =
        int.tryParse('${_searchMeta?['groundingSourcesCount'] ?? 0}') ?? 0;
    final grounded = _searchMeta?['grounded'] == true;

    final Color badgeColor = _isCachedResult ? _accentSoft : _green;

    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: _cardBg,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: badgeColor.withOpacity(0.35)),
      ),
      child: Row(
        children: [
          Icon(
            _isCachedResult ? Icons.history_rounded : Icons.travel_explore_rounded,
            size: 18,
            color: badgeColor,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _isCachedResult
                      ? 'Origem: Cache validado (eventos ativos)'
                      : (grounded
                          ? 'Origem: Busca ao vivo na Web ($sourcesCount fonte(s) verificada(s))'
                          : 'Origem: Busca ao vivo'),
                  style: TextStyle(
                    color: badgeColor,
                    fontSize: 12,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                if (formattedTime.isNotEmpty)
                  Text(
                    'Coletado em $formattedTime',
                    style: const TextStyle(color: Colors.white54, fontSize: 11),
                  ),
              ],
            ),
          ),
          if (_isCachedResult && !_isSearching)
            TextButton.icon(
              onPressed: () =>
                  _performSearch(_searchController.text, forceRefresh: true),
              icon: const Icon(Icons.refresh_rounded, size: 15, color: _green),
              label: const Text(
                'Atualizar agora',
                style: TextStyle(
                    color: _green, fontSize: 12, fontWeight: FontWeight.bold),
              ),
            ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _bg,
      appBar: AppBar(
        backgroundColor: _cardBg,
        title: const Text(
          'Busca de Eventos e Cidades (IA)',
          style: TextStyle(color: Colors.white),
        ),
        iconTheme: const IconThemeData(color: Colors.white),
        actions: [
          if (_canConfigureSearch)
            IconButton(
              icon: const Icon(Icons.settings_rounded, color: _accentSoft),
              tooltip: 'Configurar Busca IA',
              onPressed: () {
                Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (_) => const TelaConfigBuscaEventosIa(),
                  ),
                );
              },
            ),
        ],
      ),
      body: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(
              color: _bg,
              padding: const EdgeInsets.all(20.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Autocomplete<String>(
                    optionsBuilder: (TextEditingValue textEditingValue) {
                      if (textEditingValue.text.isEmpty || _ibgeCities.isEmpty) {
                        return const Iterable<String>.empty();
                      }
                      final query = textEditingValue.text.toLowerCase();
                      return _ibgeCities
                          .where((city) => city.toLowerCase().contains(query))
                          .take(10);
                    },
                    onSelected: (String selection) {
                      _searchController.text = selection;
                      _performSearch(selection);
                    },
                    fieldViewBuilder: (
                      context,
                      textEditingController,
                      focusNode,
                      onFieldSubmitted,
                    ) {
                      if (textEditingController.text.isEmpty &&
                          _searchController.text.isNotEmpty) {
                        textEditingController.text = _searchController.text;
                      }
                      return TextField(
                        controller: textEditingController,
                        focusNode: focusNode,
                        onChanged: (val) => _searchController.text = val,
                        style: const TextStyle(color: Colors.white),
                        decoration: InputDecoration(
                          hintText: _isLoadingCities
                              ? 'Carregando cidades do IBGE...'
                              : 'Digite cidade e UF (Ex: Rio Verde - GO)',
                          hintStyle: const TextStyle(color: Colors.white54),
                          filled: true,
                          fillColor: _cardBg,
                          prefixIcon:
                              const Icon(Icons.search, color: _accentSoft),
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(12),
                            borderSide:
                                BorderSide(color: _accent.withOpacity(0.35)),
                          ),
                          enabledBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(12),
                            borderSide:
                                BorderSide(color: _accent.withOpacity(0.25)),
                          ),
                          focusedBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(12),
                            borderSide: const BorderSide(color: _accent),
                          ),
                        ),
                        onSubmitted: (value) => _performSearch(value),
                      );
                    },
                    optionsViewBuilder: (context, onSelected, options) {
                      return Align(
                        alignment: Alignment.topLeft,
                        child: Material(
                          elevation: 6.0,
                          color: _cardBg,
                          borderRadius: BorderRadius.circular(10),
                          child: ConstrainedBox(
                            constraints: const BoxConstraints(
                              maxWidth: 420,
                              maxHeight: 260,
                            ),
                            child: ListView.builder(
                              padding: EdgeInsets.zero,
                              shrinkWrap: true,
                              itemCount: options.length,
                              itemBuilder: (BuildContext context, int index) {
                                final String option = options.elementAt(index);
                                return InkWell(
                                  onTap: () => onSelected(option),
                                  child: Padding(
                                    padding: const EdgeInsets.all(14.0),
                                    child: Text(
                                      option,
                                      style:
                                          const TextStyle(color: Colors.white),
                                    ),
                                  ),
                                );
                              },
                            ),
                          ),
                        ),
                      );
                    },
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: LedButton.icon(
                          onPressed: _isSearching
                              ? null
                              : () => _performSearch(
                                    _searchController.text,
                                    forceRefresh: false,
                                  ),
                          icon: const Icon(Icons.search_rounded,
                              size: 18, color: Colors.white),
                          label: const Text(
                            'Buscar Eventos',
                            style: TextStyle(
                              color: Colors.white,
                              fontSize: 14,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          style: LedButton.styleFrom(
                            backgroundColor: _accent,
                            padding: const EdgeInsets.symmetric(vertical: 14),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(12),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: LedButton.icon(
                          onPressed: _isSearching
                              ? null
                              : () => _performSearch(
                                    _searchController.text,
                                    forceRefresh: true,
                                  ),
                          icon: const Icon(Icons.refresh_rounded,
                              size: 18, color: Colors.white),
                          label: const Text(
                            'Atualizar agora',
                            style: TextStyle(
                              color: Colors.white,
                              fontSize: 14,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          style: LedButton.styleFrom(
                            backgroundColor: _green,
                            padding: const EdgeInsets.symmetric(vertical: 14),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(12),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 20),
                  if (_error != null)
                    Container(
                      margin: const EdgeInsets.only(bottom: 16),
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: Colors.redAccent.withOpacity(0.12),
                        borderRadius: BorderRadius.circular(10),
                        border:
                            Border.all(color: Colors.redAccent.withOpacity(0.4)),
                      ),
                      child: Text(
                        _error!,
                        style: const TextStyle(color: Colors.redAccent),
                      ),
                    ),
                  if (_isSearching)
                    Container(
                      padding: const EdgeInsets.symmetric(
                          vertical: 40, horizontal: 20),
                      alignment: Alignment.center,
                      child: const Column(
                        children: [
                          CircularProgressIndicator(
                              color: _accent, strokeWidth: 3),
                          SizedBox(height: 24),
                          Text(
                            'Consultando fontes reais na web e validando datas dos eventos... Aguarde!',
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
                    )
                  else ...[
                    _buildFreshnessBanner(),
                    if (_searchResults.isNotEmpty) ...[
                      SingleChildScrollView(
                        scrollDirection: Axis.horizontal,
                        child: Row(
                          children: [
                            ChoiceChip(
                              label: Text('Todos (${_searchResults.length})'),
                              selected: _selectedDurationFilter == 'ALL',
                              selectedColor: _accent,
                              backgroundColor: _cardBg,
                              labelStyle: TextStyle(
                                color: _selectedDurationFilter == 'ALL'
                                    ? Colors.white
                                    : Colors.white70,
                                fontWeight: FontWeight.w600,
                              ),
                              onSelected: (_) => setState(
                                  () => _selectedDurationFilter = 'ALL'),
                            ),
                            const SizedBox(width: 8),
                            ChoiceChip(
                              label: const Text('🟢 6 a 30 Dias (Ideal)'),
                              selected: _selectedDurationFilter == '6_30',
                              selectedColor: _green,
                              backgroundColor: _cardBg,
                              labelStyle: TextStyle(
                                color: _selectedDurationFilter == '6_30'
                                    ? Colors.white
                                    : Colors.white70,
                              ),
                              onSelected: (_) => setState(
                                  () => _selectedDurationFilter = '6_30'),
                            ),
                            const SizedBox(width: 8),
                            ChoiceChip(
                              label: const Text('🔵 +30 Dias'),
                              selected: _selectedDurationFilter == 'OVER_30',
                              selectedColor: Colors.lightBlueAccent,
                              backgroundColor: _cardBg,
                              labelStyle: TextStyle(
                                color: _selectedDurationFilter == 'OVER_30'
                                    ? Colors.black
                                    : Colors.white70,
                              ),
                              onSelected: (_) => setState(
                                  () => _selectedDurationFilter = 'OVER_30'),
                            ),
                            const SizedBox(width: 8),
                            ChoiceChip(
                              label: const Text('🟡 1 a 5 Dias'),
                              selected: _selectedDurationFilter == 'SHORT',
                              selectedColor: Colors.amberAccent,
                              backgroundColor: _cardBg,
                              labelStyle: TextStyle(
                                color: _selectedDurationFilter == 'SHORT'
                                    ? Colors.black
                                    : Colors.white70,
                              ),
                              onSelected: (_) => setState(
                                  () => _selectedDurationFilter = 'SHORT'),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 16),
                      ListView.builder(
                        shrinkWrap: true,
                        physics: const NeverScrollableScrollPhysics(),
                        itemCount: _filteredEvents.length,
                        itemBuilder: (context, index) {
                          final evt = Map<String, dynamic>.from(
                              _filteredEvents[index] as Map);
                          final int durationDays = _computeEventDuration(evt);
                          final String sourcePlatform =
                              _cleanText(evt['sourcePlatform'], fallback: '');
                          final String resolvedUrl = _resolveEventUrl(evt);
                          final bool isVerified = evt['verificationStatus']
                                  ?.toString()
                                  .toUpperCase() ==
                              'VERIFIED_SOURCE';

                          final String dateRangeDisplay = _formatDateRange(evt);
                          final String audienceText = _cleanText(
                            evt['estimatedAudience'] ?? evt['audience'],
                            fallback: 'Público em confirmação',
                          );
                          final String ticketText = _cleanText(
                            evt['ticketPrice'],
                            fallback: 'Consultar organizador',
                          );
                          final String locationText = _cleanText(
                            evt['location'],
                            fallback: '',
                          );
                          final String organizerText = _cleanText(
                            evt['organizer'],
                            fallback: '',
                          );
                          final String contactRaw = _cleanText(
                            evt['organizerContact'],
                            fallback: '',
                          );
                          final String socialRaw = _cleanText(
                            evt['socialMedia'],
                            fallback: '',
                          );
                          final String combinedContact = [
                            if (contactRaw.isNotEmpty) contactRaw,
                            if (socialRaw.isNotEmpty) socialRaw,
                          ].join(' · ');

                          Widget durationBadge;
                          if (durationDays >= 6 && durationDays <= 30) {
                            durationBadge = Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 8, vertical: 4),
                              decoration: BoxDecoration(
                                color: _green.withOpacity(0.18),
                                borderRadius: BorderRadius.circular(6),
                                border: Border.all(color: _green),
                              ),
                              child: Text(
                                '🟢 $durationDays dias · Ideal',
                                style: const TextStyle(
                                  color: _green,
                                  fontSize: 11,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            );
                          } else if (durationDays > 30) {
                            durationBadge = Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 8, vertical: 4),
                              decoration: BoxDecoration(
                                color: Colors.blue.withOpacity(0.2),
                                borderRadius: BorderRadius.circular(6),
                                border:
                                    Border.all(color: Colors.lightBlueAccent),
                              ),
                              child: Text(
                                '🔵 $durationDays dias · Longa',
                                style: const TextStyle(
                                  color: Colors.lightBlueAccent,
                                  fontSize: 11,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            );
                          } else {
                            durationBadge = Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 8, vertical: 4),
                              decoration: BoxDecoration(
                                color: Colors.amber.withOpacity(0.18),
                                borderRadius: BorderRadius.circular(6),
                                border: Border.all(color: Colors.amberAccent),
                              ),
                              child: Text(
                                durationDays == 1
                                    ? '🟡 1 dia'
                                    : '🟡 $durationDays dias',
                                style: const TextStyle(
                                  color: Colors.amberAccent,
                                  fontSize: 11,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            );
                          }

                          return LedCard(
                            color: _cardBg,
                            margin: const EdgeInsets.only(bottom: 16),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(14),
                              side: BorderSide(
                                  color: _accent.withOpacity(0.22)),
                            ),
                            child: Padding(
                              padding: const EdgeInsets.all(16.0),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Expanded(
                                        child: Text(
                                          _cleanText(evt['name'],
                                              fallback: 'Evento'),
                                          style: const TextStyle(
                                            color: Colors.white,
                                            fontSize: 17,
                                            fontWeight: FontWeight.bold,
                                          ),
                                        ),
                                      ),
                                      const SizedBox(width: 8),
                                      durationBadge,
                                    ],
                                  ),
                                  const SizedBox(height: 8),
                                  Wrap(
                                    spacing: 6,
                                    runSpacing: 6,
                                    crossAxisAlignment:
                                        WrapCrossAlignment.center,
                                    children: [
                                      Container(
                                        padding: const EdgeInsets.symmetric(
                                            horizontal: 8, vertical: 4),
                                        decoration: BoxDecoration(
                                          color: _accent.withOpacity(0.2),
                                          borderRadius:
                                              BorderRadius.circular(6),
                                        ),
                                        child: Text(
                                          _cleanText(evt['category'],
                                              fallback: 'Evento Regional'),
                                          style: const TextStyle(
                                            color: _accentSoft,
                                            fontSize: 11,
                                            fontWeight: FontWeight.bold,
                                          ),
                                        ),
                                      ),
                                      Container(
                                        padding: const EdgeInsets.symmetric(
                                            horizontal: 7, vertical: 3),
                                        decoration: BoxDecoration(
                                          color: isVerified
                                              ? _green.withOpacity(0.18)
                                              : Colors.amber.withOpacity(0.14),
                                          borderRadius:
                                              BorderRadius.circular(6),
                                          border: Border.all(
                                            color: isVerified
                                                ? _green
                                                : Colors.amberAccent
                                                    .withOpacity(0.6),
                                          ),
                                        ),
                                        child: Text(
                                          isVerified
                                              ? '✓ Fonte Verificada'
                                              : 'Estimativa / Calendário',
                                          style: TextStyle(
                                            color: isVerified
                                                ? _green
                                                : Colors.amberAccent,
                                            fontSize: 10,
                                            fontWeight: FontWeight.bold,
                                          ),
                                        ),
                                      ),
                                      if (sourcePlatform.isNotEmpty)
                                        Container(
                                          padding: const EdgeInsets.symmetric(
                                              horizontal: 7, vertical: 3),
                                          decoration: BoxDecoration(
                                            color: Colors.cyanAccent
                                                .withOpacity(0.14),
                                            borderRadius:
                                                BorderRadius.circular(6),
                                            border: Border.all(
                                              color: Colors.cyanAccent
                                                  .withOpacity(0.5),
                                            ),
                                          ),
                                          child: Text(
                                            '📍 $sourcePlatform',
                                            style: const TextStyle(
                                              color: Colors.cyanAccent,
                                              fontSize: 10,
                                              fontWeight: FontWeight.bold,
                                            ),
                                          ),
                                        ),
                                      InkWell(
                                        onTap: () async {
                                          Uri? url;
                                          if (resolvedUrl.isNotEmpty) {
                                            url = Uri.tryParse(resolvedUrl);
                                          }
                                          if (url == null) {
                                            final query = Uri.encodeComponent(
                                                '${evt['name'] ?? ''} ${_searchController.text} programação data oficial');
                                            url = Uri.parse(
                                                'https://www.google.com/search?q=$query');
                                          }
                                          if (await canLaunchUrl(url)) {
                                            await launchUrl(
                                              url,
                                              mode: LaunchMode
                                                  .externalApplication,
                                            );
                                          }
                                        },
                                        child: Container(
                                          padding: const EdgeInsets.symmetric(
                                              horizontal: 8, vertical: 4),
                                          decoration: BoxDecoration(
                                            color: _accent.withOpacity(0.18),
                                            borderRadius:
                                                BorderRadius.circular(6),
                                            border: Border.all(
                                                color:
                                                    _accent.withOpacity(0.5)),
                                          ),
                                          child: Row(
                                            mainAxisSize: MainAxisSize.min,
                                            children: [
                                              Icon(
                                                resolvedUrl.isNotEmpty
                                                    ? Icons.open_in_new_rounded
                                                    : Icons.search_rounded,
                                                size: 12,
                                                color: _accentSoft,
                                              ),
                                              const SizedBox(width: 4),
                                              Text(
                                                resolvedUrl.isNotEmpty
                                                    ? 'Abrir Fonte'
                                                    : 'Buscar no Google',
                                                style: const TextStyle(
                                                  color: _accentSoft,
                                                  fontSize: 11,
                                                  fontWeight: FontWeight.bold,
                                                ),
                                              ),
                                            ],
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 12),
                                  _buildEventDetailRow(Icons.calendar_month,
                                      'Data: $dateRangeDisplay'),
                                  if (locationText.isNotEmpty)
                                    _buildEventDetailRow(
                                        Icons.place_outlined,
                                        'Local: $locationText'),
                                  _buildEventDetailRow(Icons.groups,
                                      'Público Esperado: $audienceText'),
                                  _buildEventDetailRow(Icons.local_activity,
                                      'Entrada / Ingresso: $ticketText'),
                                  if (organizerText.isNotEmpty)
                                    _buildEventDetailRow(Icons.business_rounded,
                                        'Organizador: $organizerText'),
                                  if (combinedContact.isNotEmpty)
                                    _buildEventDetailRow(Icons.contact_phone,
                                        'Contatos / Redes: $combinedContact'),
                                  const SizedBox(height: 10),
                                  Container(
                                    padding: const EdgeInsets.all(12),
                                    decoration: BoxDecoration(
                                      color: _accent.withOpacity(0.1),
                                      borderRadius: BorderRadius.circular(8),
                                    ),
                                    child: Row(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        const Icon(Icons.lightbulb_outline,
                                            color: _accentSoft, size: 19),
                                        const SizedBox(width: 8),
                                        Expanded(
                                          child: Text(
                                            _cleanText(
                                              evt['notes'],
                                              fallback:
                                                  'Oportunidade mapeada dentro da janela configurada.',
                                            ),
                                            style: const TextStyle(
                                              color: Colors.white70,
                                              fontStyle: FontStyle.italic,
                                              fontSize: 13,
                                            ),
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                  const SizedBox(height: 14),
                                  SizedBox(
                                    width: double.infinity,
                                    child: LedButton.icon(
                                      onPressed: () => _addProspect(evt),
                                      icon: const Icon(Icons.bookmark_add,
                                          size: 20, color: Colors.white),
                                      label: const Text('Salvar Prospecto',
                                          style:
                                              TextStyle(color: Colors.white)),
                                      style: LedButton.styleFrom(
                                        backgroundColor: _green,
                                        padding: const EdgeInsets.symmetric(
                                            vertical: 14),
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          );
                        },
                      ),
                    ] else if (_cityInfo != null) ...[
                      Container(
                        padding: const EdgeInsets.all(20),
                        decoration: BoxDecoration(
                          color: _cardBg,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(
                              color: Colors.orangeAccent.withOpacity(0.4)),
                        ),
                        child: const Row(
                          children: [
                            Icon(Icons.event_busy, color: Colors.orangeAccent),
                            SizedBox(width: 12),
                            Expanded(
                              child: Text(
                                'Nenhum evento futuro confirmado dentro dos filtros e janela atuais para esta cidade.',
                                style: TextStyle(
                                    color: Colors.orangeAccent, fontSize: 15),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ],
                ],
              ),
            ),

            // Contexto Demográfico da Cidade
            Container(
              color: _bg,
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 28),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text(
                    'Análise Demográfica e Econômica da Cidade',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 19,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 14),
                  if (_cityInfo == null)
                    const Text(
                      'Faça uma busca para visualizar os indicadores demográficos e econômicos do município.',
                      style: TextStyle(color: Colors.white54, fontSize: 14),
                    )
                  else
                    Container(
                      decoration: BoxDecoration(
                        color: _cardBg,
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: _accent.withOpacity(0.45)),
                      ),
                      padding: const EdgeInsets.all(20),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Row(
                            children: [
                              Icon(Icons.analytics, color: _accentSoft, size: 24),
                              SizedBox(width: 10),
                              Text(
                                'Panorama do Município',
                                style: TextStyle(
                                  color: _accentSoft,
                                  fontSize: 16,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 6),
                          Text(
                            'Motor: ${_cleanText(_cityInfo!['aiSource'], fallback: 'Google Gemini · Busca IA')}',
                            style: const TextStyle(
                              color: Colors.white54,
                              fontSize: 12,
                              fontStyle: FontStyle.italic,
                            ),
                          ),
                          if (_cleanText(_cityInfo!['summary'], fallback: '')
                              .isNotEmpty) ...[
                            const SizedBox(height: 12),
                            Text(
                              _cleanText(_cityInfo!['summary']),
                              style: const TextStyle(
                                  color: Colors.white70, fontSize: 14),
                            ),
                          ],
                          const SizedBox(height: 18),
                          _buildDemographicItem(
                            'População Estimada (IBGE)',
                            _cleanText(_cityInfo!['population']),
                            Icons.people_alt_rounded,
                          ),
                          const Divider(color: Colors.white12, height: 22),
                          _buildDemographicItem(
                            'Renda Domiciliar / Per Capita',
                            _cleanText(
                              _cityInfo!['rendaDomiciliarPerCapitaMedia'] ??
                                  _cityInfo!['perCapitaIncome'] ??
                                  _cityInfo!['rendaPerCapita'],
                            ),
                            Icons.monetization_on_rounded,
                          ),
                          const Divider(color: Colors.white12, height: 22),
                          _buildDemographicItem(
                            'PIB Municipal',
                            _cleanText(_cityInfo!['gdp']),
                            Icons.insights_rounded,
                          ),
                          const Divider(color: Colors.white12, height: 22),
                          _buildDemographicItem(
                            'Idade / Fundação',
                            _cleanText(_cityInfo!['cityAge']),
                            Icons.history_rounded,
                          ),
                          const Divider(color: Colors.white12, height: 22),
                          _buildDemographicItem(
                            'Atividades Econômicas Principais',
                            _cleanText(_cityInfo!['economicActivities']),
                            Icons.factory_rounded,
                          ),
                          const Divider(color: Colors.white12, height: 22),
                          _buildDemographicItem(
                            'Principais Festas Fixas Anuais',
                            _cleanText(_cityInfo!['principaisFestasFixas']),
                            Icons.celebration_rounded,
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDemographicItem(String title, String value, IconData icon) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(icon, color: _accentSoft, size: 16),
            const SizedBox(width: 8),
            Text(title,
                style: const TextStyle(color: Colors.white54, fontSize: 13)),
          ],
        ),
        const SizedBox(height: 4),
        Text(
          value,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 16,
            fontWeight: FontWeight.w500,
          ),
        ),
      ],
    );
  }

  Widget _buildEventDetailRow(IconData icon, String text) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 7.0),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: _accentSoft, size: 17),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              text,
              style: const TextStyle(color: Colors.white70, fontSize: 14),
            ),
          ),
        ],
      ),
    );
  }
}
