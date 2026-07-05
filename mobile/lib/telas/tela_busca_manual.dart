import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import '../servicos/servico_api.dart';

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
            ElevatedButton(
              onPressed: () => Navigator.pop(context, true),
              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFCE93D8)),
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
          'score': event['score']?.toString() ?? 'MEDIUM',
          'category': event['category'] ?? 'OTHER',
          'notes': event['notes'] ?? 'Ingressos: ${event['ticketPrice']} | Público: ${event['audience']}',
          'observations': obsController.text,
          'expectedRevenue': double.tryParse(valueController.text.replaceAll(',', '.')) ?? 0.0,
          'isProspect': true,
          'audience': event['audience'],
          'organizerContact': event['organizerContact'],
          'socialMedia': event['socialMedia'],
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
                      ElevatedButton(
                        onPressed: _isSearching ? null : () => _performSearch(_searchController.text),
                        style: ElevatedButton.styleFrom(
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
                      child: Column(
                        children: [
                          const CircularProgressIndicator(color: Color(0xFFCE93D8), strokeWidth: 3),
                          const SizedBox(height: 24),
                          const Text(
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
                    ListView.builder(
                      shrinkWrap: true,
                      physics: const NeverScrollableScrollPhysics(),
                      itemCount: _searchResults.length,
                      itemBuilder: (context, index) {
                        final evt = _searchResults[index];
                        return Card(
                          color: const Color(0xFF1A1A2E),
                          margin: const EdgeInsets.only(bottom: 16),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                          child: Padding(
                            padding: const EdgeInsets.all(16.0),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(evt['name'] ?? '', style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
                                const SizedBox(height: 4),
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                  decoration: BoxDecoration(color: const Color(0xFFCE93D8).withOpacity(0.2), borderRadius: BorderRadius.circular(4)),
                                  child: Text(evt['category'] ?? 'OTHER', style: const TextStyle(color: Color(0xFFCE93D8), fontSize: 12, fontWeight: FontWeight.bold)),
                                ),
                                const SizedBox(height: 12),
                                _buildEventDetailRow(Icons.calendar_month, 'Data: ${evt['startDate'] ?? 'A definir'}'),
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
                                  child: ElevatedButton.icon(
                                    onPressed: () => _addProspect(evt),
                                    icon: const Icon(Icons.bookmark_add, size: 20, color: Colors.white),
                                    label: const Text('Salvar Prospecto', style: TextStyle(color: Colors.white)),
                                    style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF43A047), padding: const EdgeInsets.symmetric(vertical: 14)),
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
