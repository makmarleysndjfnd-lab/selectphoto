import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../servicos/servico_api.dart';
import 'tela_busca_manual.dart';
import 'tela_meus_prospectos.dart';

class StateProspectsView extends StatefulWidget {
  const StateProspectsView({super.key});

  @override
  State<StateProspectsView> createState() => _StateProspectsViewState();
}

class _StateProspectsViewState extends State<StateProspectsView> with SingleTickerProviderStateMixin {
  late TabController _tabController;
  final List<String> _states = ['GO', 'MT', 'MS', 'MG', 'RO'];
  final Map<String, List<dynamic>> _stateData = {};
  final Map<String, bool> _isLoading = {};
  final Map<String, String?> _errors = {};

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: _states.length, vsync: this);
    _tabController.addListener(() {
      if (!_tabController.indexIsChanging) {
        _loadDataForState(_states[_tabController.index]);
      }
    });
    // Load first state
    _loadDataForState(_states[0]);
  }

  Future<void> _loadDataForState(String state, {bool force = false}) async {
    if (!force && _stateData.containsKey(state) && _stateData[state]!.isNotEmpty) return;
    
    setState(() {
      _isLoading[state] = true;
      _errors[state] = null;
    });

    try {
      final api = Provider.of<ApiService>(context, listen: false);
      final data = await api.fetchStateRadar(state, force: force);
      setState(() {
        _stateData[state] = data['events'] ?? [];
        _isLoading[state] = false;
      });
    } catch (e) {
      setState(() {
        _errors[state] = e.toString();
        _isLoading[state] = false;
      });
    }
  }

  Future<void> _addProspect(Map<String, dynamic> event, String state) async {
    final TextEditingController obsController = TextEditingController();

    final result = await showDialog<bool>(
      context: context,
      builder: (context) {
        return AlertDialog(
          backgroundColor: const Color(0xFF1E1E2C),
          title: const Text('Adicionar Prospecto', style: TextStyle(color: Colors.white)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('Deseja adicionar "${event['name']}" aos Meus Prospectos?', style: const TextStyle(color: Colors.white70)),
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
          'audience': event['audience'],
          'organizerContact': event['organizerContact'],
          'socialMedia': event['socialMedia'],
          'notes': event['notes'] ?? 'Pop: ${event['population']} | Renda: ${event['perCapitaIncome'] ?? event['income']} | PIB: ${event['gdp']}',
          'observations': obsController.text,
          'isProspect': true,
          'cityAge': event['cityAge'] ?? 'N/A',
          'cityIncome': event['perCapitaIncome'] ?? event['income'] ?? 'N/A',
          'cityPerCapita': event['perCapitaIncome'] ?? event['income'] ?? 'N/A',
          'cityEconomy': event['gdp'] ?? 'N/A',
        });

        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Prospecto adicionado com sucesso!'), backgroundColor: Colors.green));
          setState(() {
            _stateData[state]?.removeWhere((e) => e['name'] == event['name'] && e['city'] == event['city']);
          });
        }
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro: $e'), backgroundColor: Colors.red));
        }
      }
    }
  }

  void _openManualSearch() {
    Navigator.push(context, MaterialPageRoute(builder: (_) => const ManualSearchScreen()));
  }

  void _openMyProspects() {
    Navigator.push(context, MaterialPageRoute(builder: (_) => const MyProspectsScreen()));
  }



  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Container(
          color: const Color(0xFF1A0030),
          child: Row(
            children: [
              Expanded(
                child: TabBar(
                  controller: _tabController,
                  isScrollable: true,
                  indicatorColor: const Color(0xFFCE93D8),
                  labelColor: const Color(0xFFCE93D8),
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
                    padding: EdgeInsets.symmetric(horizontal: 20, vertical: 40),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
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
                  ),
                );
              }
              if (_errors[state] != null) {
                return Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.error_outline, color: Colors.redAccent, size: 48),
                      const SizedBox(height: 16),
                      Text('Erro ao carregar $state', style: const TextStyle(color: Colors.white, fontSize: 18)),
                      const SizedBox(height: 8),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 32),
                        child: Text(_errors[state]!, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white54)),
                      ),
                      const SizedBox(height: 16),
                      ElevatedButton(
                        onPressed: () => _loadDataForState(state),
                        style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFCE93D8)),
                        child: const Text('Tentar Novamente', style: TextStyle(color: Colors.white)),
                      )
                    ],
                  ),
                );
              }

              final events = _stateData[state] ?? [];
              
              return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text('Resultados para $state', style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
                        ElevatedButton.icon(
                          onPressed: () => _loadDataForState(state, force: true),
                          icon: const Icon(Icons.refresh, color: Colors.white),
                          label: const Text('Atualizar', style: TextStyle(color: Colors.white)),
                          style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF43A047)),
                        ),
                      ],
                    ),
                  ),
                  if (events.isEmpty)
                    const Expanded(
                      child: Center(
                        child: Text('Nenhum evento prospectado no momento.', style: TextStyle(color: Colors.white54)),
                      ),
                    )
                  else
                  Expanded(
                    child: SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: SingleChildScrollView(
                        child: Theme(
                          data: Theme.of(context).copyWith(
                            dividerColor: Colors.white10,
                          ),
                          child: DataTable(
                            headingTextStyle: const TextStyle(color: Color(0xFF90CAF9), fontWeight: FontWeight.bold),
                            dataTextStyle: const TextStyle(color: Colors.white),
                            columnSpacing: 24,
                            columns: const [
                              DataColumn(label: Text('Cidade')),
                              DataColumn(label: Text('Evento')),
                              DataColumn(label: Text('Data')),
                              DataColumn(label: Text('População')),
                              DataColumn(label: Text('Renda Per Capita')),
                              DataColumn(label: Text('PIB')),
                              DataColumn(label: Text('Nota')),
                              DataColumn(label: Text('Ação')),
                            ],
                            rows: events.map<DataRow>((evt) {
                              return DataRow(
                                cells: [
                                  DataCell(Text(evt['city'] ?? '')),
                                  DataCell(Text(evt['name'] ?? '')),
                                  DataCell(Text(evt['startDate'] ?? '')),
                                  DataCell(Text(evt['population']?.toString() ?? '')),
                                  DataCell(Text(evt['perCapitaIncome']?.toString() ?? evt['income']?.toString() ?? '')),
                                  DataCell(Text(evt['gdp']?.toString() ?? '-')),
                                  DataCell(
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                      decoration: BoxDecoration(
                                        color: Colors.green.withOpacity(0.2),
                                        borderRadius: BorderRadius.circular(4),
                                      ),
                                      child: Text(evt['score']?.toString() ?? '', style: const TextStyle(color: Colors.greenAccent, fontWeight: FontWeight.bold)),
                                    )
                                  ),
                                  DataCell(
                                    ElevatedButton.icon(
                                      onPressed: () => _addProspect(evt, state),
                                      icon: const Icon(Icons.add, size: 16, color: Colors.white),
                                      label: const Text('Adicionar aos Prospectos', style: TextStyle(color: Colors.white, fontSize: 12)),
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: const Color(0xFF9C27B0),
                                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                                  minimumSize: Size.zero,
                                ),
                              )
                            ),
                          ],
                        );
                      }).toList(),
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
    );
  }
}
