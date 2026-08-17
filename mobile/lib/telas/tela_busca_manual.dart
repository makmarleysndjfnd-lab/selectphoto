import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';
import 'dart:convert';
import '../servicos/servico_api.dart';
import '../widgets/led_button.dart';
import '../widgets/led_card.dart';

class ManualSearchScreen extends StatefulWidget {
  const ManualSearchScreen({super.key});

  @override
  State<ManualSearchScreen> createState() => _ManualSearchScreenState();
}

class _ManualSearchScreenState extends State<ManualSearchScreen> {
  final TextEditingController _searchController = TextEditingController();
  
  bool _isSearching = false;
  Map<String, dynamic>? _cityInfo;
  List<dynamic> _searchResults = [];
  String? _error;

  List<String> _ibgeCities = [];
  bool _isLoadingCities = true;

  String _selectedDurationFilter = 'ALL'; // 'ALL', '6_30', 'OVER_30', 'SHORT'

  List<dynamic> get _filteredEvents {
    if (_selectedDurationFilter == 'ALL') return _searchResults;
    return _searchResults.where((evt) {
      // Recalculate duration from startDate/endDate (inclusive) to avoid AI hallucination
      int days;
      try {
        final sRaw = evt['startDate']?.toString() ?? '';
        final eRaw = evt['endDate']?.toString() ?? '';
        if (sRaw.isNotEmpty && eRaw.isNotEmpty) {
          final s = DateTime.parse(sRaw.split('T')[0]);
          final e = DateTime.parse(eRaw.split('T')[0]);
          final diff = e.difference(s).inDays + 1;
          days = diff >= 1 ? diff : 1;
        } else {
          days = evt['durationDays'] != null ? (int.tryParse(evt['durationDays'].toString()) ?? 1) : 1;
        }
      } catch (_) {
        days = evt['durationDays'] != null ? (int.tryParse(evt['durationDays'].toString()) ?? 1) : 1;
      }
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
  }

  void _checkCache() {
    final api = Provider.of<ApiService>(context, listen: false);
    final cache = api.cachedSearches;
    if (cache.isNotEmpty) {
      final latest = cache.first;
      setState(() {
        _searchController.text = latest['originalCity'] ?? '';
        _cityInfo = latest['data']['cityInfo'];
        _searchResults = latest['data']['events'] ?? [];
      });
    }
  }

  Future<void> _loadIbgeCities() async {
    try {
      final res = await http.get(Uri.parse('https://servicodados.ibge.gov.br/api/v1/localidades/municipios'));
      if (res.statusCode == 200) {
        final List<dynamic> data = json.decode(res.body);
        final List<String> cities = data.map((e) {
          final nome = e['nome'] ?? 'Desconhecida';
          final uf = e['microrregiao']?['mesorregiao']?['UF']?['sigla'] ?? '';
          return uf.isNotEmpty ? '$nome - $uf' : nome.toString();
        }).toList();
        setState(() {
          _ibgeCities = cities;
          _isLoadingCities = false;
        });
      }
    } catch (e) {
      setState(() => _isLoadingCities = false);
      print('Erro ao carregar cidades: $e');
    }
  }

  Future<void> _performSearch(String cityQuery) async {
    final city = cityQuery.trim();
    if (city.isEmpty) return;

    setState(() {
      _isSearching = true;
      _error = null;
      _cityInfo = null;
      _searchResults = [];
    });

    try {
      final api = Provider.of<ApiService>(context, listen: false);
      final data = await api.searchEvents(city);
      
      setState(() {
        _cityInfo = data['cityInfo'];
        _searchResults = data['events'] ?? [];
        _isSearching = false;
      });
      
    } catch (e) {
      setState(() {
        _error = e.toString();
        _isSearching = false;
      });
    }
  }

  Future<void> _addProspect(Map<String, dynamic> event) async {
    final TextEditingController obsController = TextEditingController();
    final TextEditingController valueController = TextEditingController();

    final result = await showDialog<bool>(
      context: context,
      builder: (context) {
        return AlertDialog(
          backgroundColor: const Color(0xFF1E1E2C),
          title: const Text('Adicionar Prospecto', style: TextStyle(color: Colors.white)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('Adicionar "${event['name']}" aos Meus Prospectos?', style: const TextStyle(color: Colors.white70)),
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
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: BorderSide.none),
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
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: BorderSide.none),
                ),
                maxLines: 2,
              )
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancelar', style: TextStyle(color: Colors.white54)),
            ),
            LedButton(
              onPressed: () => Navigator.pop(context, true),
              style: LedButton.styleFrom(backgroundColor: const Color(0xFFCE93D8)),
              child: const Text('Adicionar'),
            ),
          ],
        );
      }
    );

    if (result == true) {
      try {
        final api = Provider.of<ApiService>(context, listen: false);
        await api.saveProspect({
          'name': event['name'],
          'city': event['city'],
          'startDate': event['startDate'],
          'endDate': event['endDate'],
          'durationDays': event['durationDays'],
          'score': event['score']?.toString() ?? 'MEDIUM',
          'category': event['category'] ?? 'OTHER',
          'notes': event['notes'] ?? 'Ingressos: ${event['ticketPrice']} | Público: ${event['audience']}',
          'observations': obsController.text,
          'expectedRevenue': double.tryParse(valueController.text.replaceAll(',', '.')) ?? 0.0,
          'isProspect': true,
          'audience': event['audience'],
          'organizerContact': event['organizerContact'],
          'socialMedia': event['socialMedia'] ?? (event['sourcePlatform'] != null ? 'Fonte: ${event['sourcePlatform']}' : null),
          'cityAge': _cityInfo?['cityAge'],
          'cityIncome': _cityInfo?['rendaDomiciliarPerCapitaMedia'],
          'cityPerCapita': _cityInfo?['rendaPerCapita'],
          'cityEconomy': _cityInfo?['economicActivities'],
        });

        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Prospecto salvo! (Verifique o Fluxo de Caixa)'), backgroundColor: Colors.green));
        }
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro: $e'), backgroundColor: Colors.red));
        }
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0D0D1A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A0030),
        title: const Text('Busca de Eventos e Cidades (IA)', style: TextStyle(color: Colors.white)),
        iconTheme: const IconThemeData(color: Colors.white),
      ),
      body: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Área de Busca e Resultados (Topo no mobile)
            Container(
              color: const Color(0xFF111122),
              padding: const EdgeInsets.all(20.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // Campo de busca e botão em coluna para caber na tela
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Autocomplete<String>(
                          optionsBuilder: (TextEditingValue textEditingValue) {
                            if (textEditingValue.text.isEmpty || _ibgeCities.isEmpty) {
                              return const Iterable<String>.empty();
                            }
                            final query = textEditingValue.text.toLowerCase();
                            return _ibgeCities.where((city) => city.toLowerCase().contains(query)).take(10);
                          },
                          onSelected: (String selection) {
                            _searchController.text = selection;
                            _performSearch(selection);
                          },
                          fieldViewBuilder: (context, textEditingController, focusNode, onFieldSubmitted) {
                            if (_searchController.text.isEmpty && textEditingController.text.isNotEmpty) {
                              _searchController.text = textEditingController.text;
                            }
                            return TextField(
                              controller: textEditingController,
                              focusNode: focusNode,
                              style: const TextStyle(color: Colors.white),
                              decoration: InputDecoration(
                                hintText: _isLoadingCities ? 'Carregando cidades do IBGE...' : 'Digite o nome da cidade e estado (Ex: Vazante - MG)',
                                hintStyle: const TextStyle(color: Colors.white54),
                                filled: true,
                                fillColor: Colors.white10,
                                prefixIcon: const Icon(Icons.search, color: Colors.white54),
                                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                              ),
                              onSubmitted: (value) => _performSearch(value),
                            );
                          },
                          optionsViewBuilder: (context, onSelected, options) {
                            return Align(
                              alignment: Alignment.topLeft,
                              child: Material(
                                elevation: 4.0,
                                color: const Color(0xFF1E1E2C),
                                borderRadius: BorderRadius.circular(8),
                                child: SizedBox(
                                  width: MediaQuery.of(context).size.width * 0.3,
                                  child: ListView.builder(
                                    padding: EdgeInsets.zero,
                                    shrinkWrap: true,
                                    itemCount: options.length,
                                    itemBuilder: (BuildContext context, int index) {
                                      final String option = options.elementAt(index);
                                      return InkWell(
                                        onTap: () => onSelected(option),
                                        child: Padding(
                                          padding: const EdgeInsets.all(16.0),
                                          child: Text(option, style: const TextStyle(color: Colors.white)),
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
                      LedButton(
                        onPressed: _isSearching ? null : () => _performSearch(_searchController.text),
                        style: LedButton.styleFrom(
                          backgroundColor: const Color(0xFF43A047),
                          padding: const EdgeInsets.symmetric(vertical: 16),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                        ),
                        child: _isSearching
                            ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                            : const Text('Atualizar / Buscar', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold)),
                      )
                    ],
                  ),
                  const SizedBox(height: 24),
                  if (_error != null)
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(color: Colors.redAccent.withOpacity(0.1), borderRadius: BorderRadius.circular(8)),
                      child: Text('Erro: $_error', style: const TextStyle(color: Colors.redAccent)),
                    ),
                  
                  if (_isSearching)
                    Container(
                      padding: const EdgeInsets.symmetric(vertical: 40, horizontal: 20),
                      alignment: Alignment.center,
                      child: const Column(
                        children: [
                          CircularProgressIndicator(color: Color(0xFFCE93D8), strokeWidth: 3),
                          SizedBox(height: 24),
                          Text(
                            'Estamos fazendo aquele pente fino para você ter os melhores eventos à disposição... Aguarde!',
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              color: Color(0xFFCE93D8), 
                              fontSize: 16, 
                              fontWeight: FontWeight.w500,
                              fontStyle: FontStyle.italic,
                            ),
                          ),
                        ],
                      ),
                    )
                  else if (_searchResults.isNotEmpty) ...[
                    const SizedBox(height: 16),
                    // Filtro por Duração do Evento
                    SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Row(
                        children: [
                          ChoiceChip(
                            label: const Text('Todos'),
                            selected: _selectedDurationFilter == 'ALL',
                            selectedColor: const Color(0xFFCE93D8),
                            backgroundColor: Colors.white10,
                            labelStyle: TextStyle(color: _selectedDurationFilter == 'ALL' ? Colors.black : Colors.white),
                            onSelected: (val) => setState(() => _selectedDurationFilter = 'ALL'),
                          ),
                          const SizedBox(width: 8),
                          ChoiceChip(
                            label: const Text('🟢 6 a 30 Dias (Ideal)'),
                            selected: _selectedDurationFilter == '6_30',
                            selectedColor: Colors.greenAccent,
                            backgroundColor: Colors.white10,
                            labelStyle: TextStyle(color: _selectedDurationFilter == '6_30' ? Colors.black : Colors.white),
                            onSelected: (val) => setState(() => _selectedDurationFilter = '6_30'),
                          ),
                          const SizedBox(width: 8),
                          ChoiceChip(
                            label: const Text('🔵 +30 Dias'),
                            selected: _selectedDurationFilter == 'OVER_30',
                            selectedColor: Colors.lightBlueAccent,
                            backgroundColor: Colors.white10,
                            labelStyle: TextStyle(color: _selectedDurationFilter == 'OVER_30' ? Colors.black : Colors.white),
                            onSelected: (val) => setState(() => _selectedDurationFilter = 'OVER_30'),
                          ),
                          const SizedBox(width: 8),
                          ChoiceChip(
                            label: const Text('🔴 1 a 5 Dias (Curto)'),
                            selected: _selectedDurationFilter == 'SHORT',
                            selectedColor: Colors.amberAccent,
                            backgroundColor: Colors.white10,
                            labelStyle: TextStyle(color: _selectedDurationFilter == 'SHORT' ? Colors.black : Colors.white),
                            onSelected: (val) => setState(() => _selectedDurationFilter = 'SHORT'),
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
                        final evt = _filteredEvents[index];
                        final int durationDays = (evt['startDate'] != null && evt['endDate'] != null && evt['startDate'].toString().isNotEmpty && evt['endDate'].toString().isNotEmpty)
                            ? () {
                                try {
                                  final s = DateTime.parse(evt['startDate'].toString().split('T')[0]);
                                  final e = DateTime.parse(evt['endDate'].toString().split('T')[0]);
                                  final diff = e.difference(s).inDays + 1;
                                  return diff >= 1 ? diff : 1;
                                } catch (_) {
                                  return evt['durationDays'] != null ? (int.tryParse(evt['durationDays'].toString()) ?? 1) : 1;
                                }
                              }()
                            : (evt['durationDays'] != null ? (int.tryParse(evt['durationDays'].toString()) ?? 1) : 1);
                        final String sourcePlatform = (evt['sourcePlatform']?.toString() ?? '').trim();
                        final String sourceUrl = (evt['sourceUrl']?.toString() ?? '').trim();
                        
                        final String startRaw = evt['startDate']?.toString() ?? '';
                        final String endRaw = evt['endDate']?.toString() ?? '';
                        String dateRangeDisplay = startRaw;
                        if (startRaw.isNotEmpty) {
                          final sParts = startRaw.split('T')[0].split('-');
                          final sFmt = sParts.length == 3 ? '${sParts[2]}/${sParts[1]}' : startRaw;
                          if (endRaw.isNotEmpty && endRaw.split('T')[0] != startRaw.split('T')[0]) {
                            final eParts = endRaw.split('T')[0].split('-');
                            final eFmt = eParts.length == 3 ? '${eParts[2]}/${eParts[1]}' : endRaw;
                            dateRangeDisplay = '$sFmt a $eFmt';
                          } else {
                            dateRangeDisplay = sFmt;
                          }
                        }

                        Widget durationBadge;
                        if (durationDays >= 6 && durationDays <= 30) {
                          durationBadge = Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                            decoration: BoxDecoration(color: Colors.green.withOpacity(0.2), borderRadius: BorderRadius.circular(4), border: Border.all(color: Colors.greenAccent)),
                            child: Text('🟢 $durationDays dias · Janela Ideal', style: const TextStyle(color: Colors.greenAccent, fontSize: 11, fontWeight: FontWeight.bold)),
                          );
                        } else if (durationDays > 30) {
                          durationBadge = Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                            decoration: BoxDecoration(color: Colors.blue.withOpacity(0.2), borderRadius: BorderRadius.circular(4), border: Border.all(color: Colors.lightBlueAccent)),
                            child: Text('🔵 $durationDays dias · Longa Permanência', style: const TextStyle(color: Colors.lightBlueAccent, fontSize: 11, fontWeight: FontWeight.bold)),
                          );
                        } else {
                          durationBadge = Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                            decoration: BoxDecoration(color: Colors.amber.withOpacity(0.2), borderRadius: BorderRadius.circular(4), border: Border.all(color: Colors.amberAccent)),
                            child: Text(durationDays == 1 ? '🟡 1 dia · Curto Prazo' : '🟡 $durationDays dias · Curto Prazo', style: const TextStyle(color: Colors.amberAccent, fontSize: 11, fontWeight: FontWeight.bold)),
                          );
                        }

                        return LedCard(
                          color: const Color(0xFF1A1A2E),
                          margin: const EdgeInsets.only(bottom: 16),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                          child: Padding(
                            padding: const EdgeInsets.all(16.0),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Expanded(child: Text(evt['name'] ?? '', style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold))),
                                    durationBadge,
                                  ],
                                ),
                                const SizedBox(height: 6),
                                Row(
                                  children: [
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                      decoration: BoxDecoration(color: const Color(0xFFCE93D8).withOpacity(0.2), borderRadius: BorderRadius.circular(4)),
                                      child: Text(evt['category'] ?? 'OTHER', style: const TextStyle(color: Color(0xFFCE93D8), fontSize: 12, fontWeight: FontWeight.bold)),
                                    ),
                                    if (sourcePlatform.isNotEmpty && sourcePlatform != 'N/A') ...[
                                      const SizedBox(width: 6),
                                      Container(
                                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
                                        decoration: BoxDecoration(
                                          color: sourcePlatform.toLowerCase().contains('sympla')
                                              ? const Color(0xFF00E676).withOpacity(0.2)
                                              : (sourcePlatform.toLowerCase().contains('insta')
                                                  ? const Color(0xFFE1306C).withOpacity(0.2)
                                                  : Colors.cyanAccent.withOpacity(0.2)),
                                          borderRadius: BorderRadius.circular(4),
                                          border: Border.all(
                                            color: sourcePlatform.toLowerCase().contains('sympla')
                                                ? const Color(0xFF00E676)
                                                : (sourcePlatform.toLowerCase().contains('insta')
                                                    ? const Color(0xFFE1306C)
                                                    : Colors.cyanAccent),
                                          ),
                                        ),
                                        child: Text(
                                          '📍 $sourcePlatform',
                                          style: TextStyle(
                                            color: sourcePlatform.toLowerCase().contains('sympla')
                                                ? const Color(0xFF00E676)
                                                : (sourcePlatform.toLowerCase().contains('insta')
                                                    ? const Color(0xFFFF80AB)
                                                    : Colors.cyanAccent),
                                            fontSize: 10,
                                            fontWeight: FontWeight.bold,
                                          ),
                                        ),
                                      ),
                                    ],
                                    const Spacer(),
                                    InkWell(
                                      onTap: () async {
                                        Uri? url;
                                        if (sourceUrl.isNotEmpty && sourceUrl.startsWith('http')) {
                                          url = Uri.tryParse(sourceUrl);
                                        }
                                        if (url == null) {
                                          final query = Uri.encodeComponent('${evt['name'] ?? ''} ${_searchController.text} contato telefone sympla instagram');
                                          url = Uri.parse('https://www.google.com/search?q=$query');
                                        }
                                        if (await canLaunchUrl(url!)) {
                                          await launchUrl(url, mode: LaunchMode.externalApplication);
                                        }
                                      },
                                      child: Container(
                                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                        decoration: BoxDecoration(
                                          color: Colors.blueAccent.withOpacity(0.15),
                                          borderRadius: BorderRadius.circular(6),
                                          border: Border.all(color: Colors.blueAccent.withOpacity(0.4)),
                                        ),
                                        child: const Row(
                                          mainAxisSize: MainAxisSize.min,
                                          children: [
                                            Icon(Icons.search, size: 12, color: Colors.blueAccent),
                                            SizedBox(width: 4),
                                            Text('Fonte / Buscar', style: TextStyle(color: Colors.blueAccent, fontSize: 11, fontWeight: FontWeight.bold)),
                                          ],
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 12),
                                _buildEventDetailRow(Icons.calendar_month, 'Data: $dateRangeDisplay'),
                                _buildEventDetailRow(Icons.groups, 'Público Esperado: ${evt['audience'] ?? 'N/A'}'),
                                _buildEventDetailRow(Icons.local_activity, 'Entrada/Ingresso: ${evt['ticketPrice'] ?? 'N/A'}'),
                                _buildEventDetailRow(Icons.contact_phone, 'Contatos/Redes: ${evt['organizerContact'] ?? 'N/A'}'),
                                const SizedBox(height: 12),
                                Container(
                                  padding: const EdgeInsets.all(12),
                                  decoration: BoxDecoration(color: Colors.blueAccent.withOpacity(0.1), borderRadius: BorderRadius.circular(8)),
                                  child: Row(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      const Icon(Icons.lightbulb, color: Colors.blueAccent, size: 20),
                                      const SizedBox(width: 8),
                                      Expanded(child: Text('Análise da IA: ${evt['notes'] ?? ''}', style: const TextStyle(color: Colors.blueAccent, fontStyle: FontStyle.italic))),
                                    ],
                                  ),
                                ),
                                const SizedBox(height: 16),
                                SizedBox(
                                  width: double.infinity,
                                  child: LedButton.icon(
                                    onPressed: () => _addProspect(evt),
                                    icon: const Icon(Icons.bookmark_add, size: 20, color: Colors.white),
                                    label: const Text('Salvar Prospecto', style: TextStyle(color: Colors.white)),
                                    style: LedButton.styleFrom(backgroundColor: const Color(0xFF43A047), padding: const EdgeInsets.symmetric(vertical: 14)),
                                  ),
                                )
                              ],
                            ),
                          ),
                        );
                      },
                    ),
                  ] else if (_cityInfo != null) ...[
                    Container(
                      padding: const EdgeInsets.all(20),
                      decoration: BoxDecoration(color: Colors.orangeAccent.withOpacity(0.1), borderRadius: BorderRadius.circular(12)),
                      child: const Row(
                        children: [
                          Icon(Icons.event_busy, color: Colors.orangeAccent),
                          SizedBox(width: 12),
                          Expanded(child: Text('Nenhum grande evento futuro encontrado para esta cidade. Procure em outra região.', style: TextStyle(color: Colors.orangeAccent, fontSize: 16))),
                        ],
                      ),
                    ),
                  ]
                ],
              ),
            ),

            // Contexto Demográfico (Base no mobile)
            Container(
              color: const Color(0xFF0D0D1A),
              padding: const EdgeInsets.all(20.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text('Análise Demográfica da Cidade', style: TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 16),
                  if (_cityInfo == null)
                    const Text('Faça uma busca para ver a análise da IA sobre a cidade.', style: TextStyle(color: Colors.white54, fontSize: 14))
                  else
                    Container(
                      decoration: BoxDecoration(
                        color: const Color(0xFF1A1A2E),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: const Color(0xFFCE93D8).withOpacity(0.5)),
                      ),
                      padding: const EdgeInsets.all(20),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Row(
                            children: [
                              Icon(Icons.analytics, color: Color(0xFFCE93D8), size: 24),
                              SizedBox(width: 12),
                              Text('Resultados da Inteligência', style: TextStyle(color: Color(0xFFCE93D8), fontSize: 16, fontWeight: FontWeight.bold)),
                            ],
                          ),
                          const SizedBox(height: 8),
                          Text('Fonte da IA: ${_cityInfo!['aiSource'] ?? 'Desconhecida'}', style: const TextStyle(color: Colors.white38, fontSize: 12, fontStyle: FontStyle.italic)),
                          const SizedBox(height: 20),
                          _buildDemographicItem('Renda Domiciliar Média', _cityInfo!['rendaDomiciliarPerCapitaMedia'] ?? 'N/A', Icons.monetization_on),
                          const Divider(color: Colors.white12, height: 24),
                          _buildDemographicItem('Renda Per Capita (Geral)', _cityInfo!['rendaPerCapita'] ?? 'N/A', Icons.attach_money),
                          const Divider(color: Colors.white12, height: 24),
                          _buildDemographicItem('Idade / Fundação', _cityInfo!['cityAge'] ?? 'N/A', Icons.history),
                          const Divider(color: Colors.white12, height: 24),
                          _buildDemographicItem('Atividades Econômicas Principais', _cityInfo!['economicActivities'] ?? 'N/A', Icons.factory),
                          const Divider(color: Colors.white12, height: 24),
                          _buildDemographicItem('Principais Festas Fixas Anuais', _cityInfo!['principaisFestasFixas'] ?? 'N/A', Icons.celebration),
                        ],
                      ),
                    )
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
            Icon(icon, color: Colors.white54, size: 16),
            const SizedBox(width: 8),
            Text(title, style: const TextStyle(color: Colors.white54, fontSize: 14)),
          ],
        ),
        const SizedBox(height: 4),
        Text(value, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w500)),
      ],
    );
  }

  Widget _buildEventDetailRow(IconData icon, String text) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8.0),
      child: Row(
        children: [
          Icon(icon, color: Colors.white70, size: 18),
          const SizedBox(width: 8),
          Expanded(child: Text(text, style: const TextStyle(color: Colors.white70, fontSize: 15))),
        ],
      ),
    );
  }
}
