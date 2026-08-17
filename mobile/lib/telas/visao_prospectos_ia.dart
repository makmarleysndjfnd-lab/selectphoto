import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';
import '../servicos/servico_api.dart';
import '../provedores/provedor_configuracoes.dart';
import 'tela_busca_manual.dart';
import 'tela_meus_prospectos.dart';
import '../widgets/led_button.dart';


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

  String _durationFilter = 'ALL'; // 'ALL', 'IDEAL', 'LONG', 'SHORT'

  Widget _buildFilterChip(String value, String label) {
    final bool isSelected = _durationFilter == value;
    return ChoiceChip(
      label: Text(
        label,
        style: TextStyle(
          color: isSelected ? Colors.black : Colors.white70,
          fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
          fontSize: 12,
        ),
      ),
      selected: isSelected,
      selectedColor: const Color(0xFFCE93D8),
      backgroundColor: const Color(0xFF1E1E2C),
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
          'audience': event['audience'],
          'organizerContact': event['organizerContact'],
          'socialMedia': event['socialMedia'] ?? (event['sourcePlatform'] != null ? 'Fonte: ${event['sourcePlatform']}' : null),
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

  String _formatIncome(String? incomeRaw) {
    if (incomeRaw == null || incomeRaw.isEmpty) return '';
    String text = incomeRaw;
    text = text.replaceAll('(Potencial de Crédito:', 'PotC:');
    text = text.replaceAll('Altíssimo', 'alti');
    text = text.replaceAll('Alto', 'alto');
    text = text.replaceAll('Médio', 'med');
    text = text.replaceAll('Baixo', 'baixo');
    text = text.replaceAll('💳', '');
    text = text.replaceAll(')', '');
    return text.trim();
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
                      LedButton(
                        onPressed: () => _loadDataForState(state),
                        style: LedButton.styleFrom(backgroundColor: const Color(0xFFCE93D8)),
                        child: const Text('Tentar Novamente', style: TextStyle(color: Colors.white)),
                      )
                    ],
                  ),
                );
              }

              final rawEvents = _stateData[state] ?? [];
              final events = rawEvents.where((evt) {
                final int duration = evt['durationDays'] != null ? (int.tryParse(evt['durationDays'].toString()) ?? 10) : 10;
                if (_durationFilter == 'IDEAL') return duration >= 6 && duration <= 30;
                if (_durationFilter == 'LONG') return duration > 30;
                if (_durationFilter == 'SHORT') return duration < 6;
                return true;
              }).toList();

              return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Row(
                          children: [
                            Container(
                              width: 10,
                              height: 10,
                              decoration: const BoxDecoration(
                                color: Color(0xFF7C4DFF),
                                shape: BoxShape.circle,
                              ),
                            ),
                            const SizedBox(width: 8),
                            Text(
                              'Resultados para $state (${events.length})',
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 18,
                                fontWeight: FontWeight.bold,
                                letterSpacing: 0.1,
                              ),
                            ),
                          ],
                        ),
                        LedButton.icon(
                          onPressed: () => _loadDataForState(state, force: true),
                          icon: const Icon(Icons.refresh_rounded, size: 18, color: Colors.white),
                          label: const Text('Atualizar', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
                          style: LedButton.styleFrom(
                            backgroundColor: const Color(0xFF2E7D32),
                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                          ),
                        ),
                      ],
                    ),
                  ),

                  // 🏷️ Item 7: Filter Chip Bar (Duração do Evento)
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                    child: SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Row(
                        children: [
                          const Text('Filtro Duração: ', style: TextStyle(color: Colors.white70, fontSize: 12, fontWeight: FontWeight.bold)),
                          const SizedBox(width: 6),
                          _buildFilterChip('ALL', 'Todos (${rawEvents.length})'),
                          const SizedBox(width: 6),
                          _buildFilterChip('IDEAL', '🟢 6-30 dias (Ideal)'),
                          const SizedBox(width: 6),
                          _buildFilterChip('LONG', '🟡 +30 dias'),
                          const SizedBox(width: 6),
                          _buildFilterChip('SHORT', '🔴 1-5 dias'),
                        ],
                      ),
                    ),
                  ),

                  const SizedBox(height: 6),

                  if (events.isEmpty)
                    const Expanded(
                      child: Center(
                        child: Text('Nenhum evento corresponde ao filtro selecionado.', style: TextStyle(color: Colors.white54, fontSize: 15)),
                      ),
                    )
                  else
                    Expanded(
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                        child: Container(
                          decoration: BoxDecoration(
                            color: const Color(0xFF131522),
                            borderRadius: BorderRadius.circular(16),
                            border: Border.all(color: const Color(0xFF26293A)),
                            boxShadow: [
                              BoxShadow(
                                color: Colors.black.withOpacity(0.3),
                                blurRadius: 12,
                                offset: const Offset(0, 4),
                              ),
                            ],
                          ),
                          child: ClipRRect(
                            borderRadius: BorderRadius.circular(16),
                            child: SingleChildScrollView(
                              scrollDirection: Axis.horizontal,
                              child: SingleChildScrollView(
                                child: Theme(
                                  data: Theme.of(context).copyWith(
                                    dividerColor: const Color(0xFF26293A),
                                  ),
                                  child: DataTable(
                                    headingRowColor: WidgetStateProperty.all(const Color(0xFF1A1C2C)),
                                    headingTextStyle: const TextStyle(
                                      color: Color(0xFF90CAF9),
                                      fontWeight: FontWeight.bold,
                                      fontSize: 13,
                                      letterSpacing: 0.2,
                                    ),
                                    dataTextStyle: const TextStyle(
                                      color: Colors.white,
                                      fontSize: 13,
                                      letterSpacing: 0.0,
                                    ),
                                    columnSpacing: 24,
                                    horizontalMargin: 16,
                                    columns: const [
                                      DataColumn(label: Text('Cidade')),
                                      DataColumn(label: Text('Evento')),
                                      DataColumn(label: Text('Data')),
                                      DataColumn(label: Text('Duração')),
                                      DataColumn(label: Text('ROI Est.')),
                                      DataColumn(label: Text('População')),
                                      DataColumn(label: Text('Infantil IBGE')),
                                      DataColumn(label: Text('Renda Per Capita')),
                                      DataColumn(label: Text('PIB')),
                                      DataColumn(label: Text('Nota')),
                                      DataColumn(label: Text('Ação')),
                                    ],
rows: events.map<DataRow>((evt) {
                                      final rawInc = evt['perCapitaIncome']?.toString() ?? evt['income']?.toString();
                                      final incStr = _formatIncome(rawInc).replaceAll('Renda Per Capita:', '').trim();
                                      final score = evt['score']?.toString().toUpperCase() ?? 'HIGH';
                                      
                                      final settings = Provider.of<SettingsProvider>(context, listen: false);
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
                                      final double estRevenue = durationDays * settings.defaultFichasPerDay * settings.defaultTicket;
                                      final double estCost = (durationDays * settings.defaultFichasPerDay * settings.productCost) +
                                          (durationDays * 2 * settings.hotelCostPerPersonDay) +
                                          (durationDays * 2 * settings.foodCostPerPersonDay) +
                                          (150 * settings.fuelCostPerKm) + 1000.0;
                                      final double estProfit = estRevenue - estCost;
                                      final currencyFmt = NumberFormat.compactSimpleCurrency(locale: 'pt_BR');
                                      final estProfitStr = currencyFmt.format(estProfit);

                                      // 👶 Item 8: IBGE Público Infantil (0-14 anos ~ 22.5%)
                                      final String popRaw = (evt['population']?.toString() ?? '').replaceAll(RegExp(r'[^\d]'), '');
                                      final int popInt = int.tryParse(popRaw) ?? 45000;
                                      final int childPop = (popInt * 0.225).round();
                                      final bool isHighChildDensity = childPop >= 12000;

                                      final String sourcePlatform = (evt['sourcePlatform']?.toString() ?? '').trim();
                                      final String sourceUrl = (evt['sourceUrl']?.toString() ?? '').trim();

                                      Color scoreColor = const Color(0xFF00E676);
                                      Color scoreBg = const Color(0xFF00E676).withOpacity(0.15);
                                      if (score == 'MEDIUM' || score == 'MÉDIO') {
                                        scoreColor = const Color(0xFFFFB74D);
                                        scoreBg = const Color(0xFFFFB74D).withOpacity(0.15);
                                      } else if (score == 'LOW' || score == 'BAIXO') {
                                        scoreColor = const Color(0xFFFF5252);
                                        scoreBg = const Color(0xFFFF5252).withOpacity(0.15);
                                      }

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

                                      return DataRow(
                                        cells: [
                                           DataCell(Text(evt['city']?.toString().replaceAll(RegExp(r'[\u00A0\u202F]'), ' ').trim() ?? '', style: const TextStyle(fontWeight: FontWeight.w600))),
                                           DataCell(
                                             Column(
                                               mainAxisAlignment: MainAxisAlignment.center,
                                               crossAxisAlignment: CrossAxisAlignment.start,
                                               children: [
                                                 Text(
                                                   evt['name']?.toString().replaceAll(RegExp(r'[\u00A0\u202F]'), ' ').trim() ?? '',
                                                   style: const TextStyle(fontWeight: FontWeight.w600, color: Colors.white),
                                                 ),
                                                 const SizedBox(height: 3),
                                                 Row(
                                                   mainAxisSize: MainAxisSize.min,
                                                   children: [
                                                     if (sourcePlatform.isNotEmpty && sourcePlatform != 'N/A') ...[
                                                       Container(
                                                         padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
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
                                                             fontSize: 9,
                                                             fontWeight: FontWeight.bold,
                                                           ),
                                                         ),
                                                       ),
                                                       const SizedBox(width: 4),
                                                     ],
                                                     InkWell(
                                                       onTap: () async {
                                                         Uri? url;
                                                         if (sourceUrl.isNotEmpty && sourceUrl.startsWith('http')) {
                                                           url = Uri.tryParse(sourceUrl);
                                                         }
                                                         if (url == null) {
                                                           final query = Uri.encodeComponent('${evt['name'] ?? ''} ${evt['city'] ?? ''} contato telefone sympla instagram');
                                                           url = Uri.parse('https://www.google.com/search?q=$query');
                                                         }
                                                         if (await canLaunchUrl(url!)) {
                                                           await launchUrl(url, mode: LaunchMode.externalApplication);
                                                         }
                                                       },
                                                       child: Container(
                                                         padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                                         decoration: BoxDecoration(
                                                           color: Colors.blueAccent.withOpacity(0.15),
                                                           borderRadius: BorderRadius.circular(4),
                                                           border: Border.all(color: Colors.blueAccent.withOpacity(0.4)),
                                                         ),
                                                         child: const Row(
                                                           mainAxisSize: MainAxisSize.min,
                                                           children: [
                                                             Icon(Icons.search, size: 11, color: Colors.blueAccent),
                                                             SizedBox(width: 3),
                                                             Text('Fonte / Buscar', style: TextStyle(color: Colors.blueAccent, fontSize: 10, fontWeight: FontWeight.bold)),
                                                           ],
                                                         ),
                                                       ),
                                                     ),
                                                   ],
                                                 ),
                                               ],
                                             ),
                                           ),
                                           DataCell(Text(dateRangeDisplay, style: const TextStyle(color: Colors.white70))),
                                          DataCell(
                                            Text(
                                              durationDays == 1 ? '1 dia' : '$durationDays dias',
                                              style: TextStyle(
                                                color: durationDays == 1
                                                    ? Colors.amberAccent
                                                    : (durationDays >= 6 && durationDays <= 30 ? const Color(0xFF80DEEA) : Colors.white70),
                                                fontWeight: FontWeight.bold,
                                              ),
                                            ),
                                          ),
                                          DataCell(
                                            Container(
                                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                              decoration: BoxDecoration(
                                                color: estProfit >= 0 ? const Color(0xFF00E676).withOpacity(0.15) : Colors.redAccent.withOpacity(0.15),
                                                borderRadius: BorderRadius.circular(8),
                                                border: Border.all(color: estProfit >= 0 ? const Color(0xFF00E676).withOpacity(0.4) : Colors.redAccent.withOpacity(0.4)),
                                              ),
                                              child: Text(
                                                estProfitStr,
                                                style: TextStyle(
                                                  color: estProfit >= 0 ? const Color(0xFF00E676) : Colors.redAccent,
                                                  fontWeight: FontWeight.bold,
                                                  fontSize: 11,
                                                ),
                                              ),
                                            ),
                                          ),
                                          DataCell(Text(evt['population']?.toString().replaceAll(RegExp(r'[\u00A0\u202F]'), '.').trim() ?? '-', style: const TextStyle(color: Colors.white))),
                                          DataCell(
                                            Row(
                                              mainAxisSize: MainAxisSize.min,
                                              children: [
                                                Text('👶 ${NumberFormat.compact().format(childPop)}', style: const TextStyle(color: Colors.white70)),
                                                if (isHighChildDensity) ...[
                                                  const SizedBox(width: 4),
                                                  Container(
                                                    padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
                                                    decoration: BoxDecoration(
                                                      color: Colors.amberAccent.withOpacity(0.15),
                                                      borderRadius: BorderRadius.circular(6),
                                                      border: Border.all(color: Colors.amberAccent.withOpacity(0.5)),
                                                    ),
                                                    child: const Text('✨ Alta Conc.', style: TextStyle(color: Colors.amberAccent, fontSize: 9, fontWeight: FontWeight.bold)),
                                                  ),
                                                ],
                                              ],
                                            ),
                                          ),
                                          DataCell(Text(incStr, style: const TextStyle(color: Colors.white))),
                                          DataCell(Text(evt['gdp']?.toString().replaceAll(RegExp(r'[\u00A0\u202F]'), ' ').trim() ?? '-', style: const TextStyle(color: Colors.white))),
                                          DataCell(
                                            Container(
                                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                              decoration: BoxDecoration(
                                                color: scoreBg,
                                                borderRadius: BorderRadius.circular(12),
                                                border: Border.all(color: scoreColor.withOpacity(0.3)),
                                              ),
                                              child: Text(
                                                score,
                                                style: TextStyle(color: scoreColor, fontWeight: FontWeight.bold, fontSize: 11, letterSpacing: 0.5),
                                              ),
                                            ),
                                          ),
                                          DataCell(
                                            IconButton(
                                              onPressed: () => _addProspect(evt, state),
                                              tooltip: 'Adicionar Prospecto',
                                              icon: Container(
                                                padding: const EdgeInsets.all(6),
                                                decoration: const BoxDecoration(
                                                  color: Color(0xFF7C4DFF),
                                                  shape: BoxShape.circle,
                                                ),
                                                child: const Icon(Icons.add_rounded, size: 16, color: Colors.white),
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
    );
  }
}
