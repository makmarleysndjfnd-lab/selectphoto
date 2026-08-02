import 'package:flutter/material.dart';
import '../servicos/servico_api.dart';
import '../widgets/led_card.dart';
import '../widgets/led_button.dart';
import 'dart:math';

class VisaoRotasChegada extends StatefulWidget {
  const VisaoRotasChegada({super.key});

  @override
  State<VisaoRotasChegada> createState() => _VisaoRotasChegadaState();
}

class _VisaoRotasChegadaState extends State<VisaoRotasChegada> {
  final ApiService _api = ApiService();
  bool _isLoading = true;
  
  // city -> teamId -> List of clients
  Map<String, Map<String, List<dynamic>>> _rotasPorCidade = {};
  Map<String, String> _teamNames = {};
  
  final List<Color> _teamColors = [
    Colors.blueAccent,
    Colors.greenAccent,
    Colors.orangeAccent,
    Colors.pinkAccent,
    Colors.cyanAccent,
    Colors.amberAccent,
    Colors.purpleAccent,
    Colors.tealAccent,
    Colors.indigoAccent,
    Colors.limeAccent,
  ];

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    setState(() => _isLoading = true);
    try {
      final teams = await _api.getTeams();
      final Map<String, String> tNames = {};
      for (var t in teams) {
        tNames[t['id'].toString()] = t['name'] ?? 'Equipe Desconhecida';
      }

      final clients = await _api.getClients();
      
      final Map<String, Map<String, List<dynamic>>> agrupado = {};
      
      for (var c in clients) {
        if (c['bookStatus'] == 'AWAITING_RELEASE') {
          final city = (c['city'] ?? 'Sem Cidade').toString().trim().toUpperCase();
          final teamId = (c['teamId'] ?? 'Sem Equipe').toString();
          
          if (!agrupado.containsKey(city)) {
            agrupado[city] = {};
          }
          if (!agrupado[city]!.containsKey(teamId)) {
            agrupado[city]![teamId] = [];
          }
          agrupado[city]![teamId]!.add(c);
        }
      }

      if (mounted) {
        setState(() {
          _teamNames = tNames;
          _rotasPorCidade = agrupado;
          _isLoading = false;
        });
      }
    } catch (e) {
      debugPrint('Erro ao carregar rotas de chegada: $e');
      if (mounted) {
        setState(() => _isLoading = false);
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Erro ao carregar rotas')));
      }
    }
  }
  
  Color _getColorForTeam(String teamId) {
    if (teamId == 'Sem Equipe') return Colors.grey;
    final idHash = teamId.hashCode.abs();
    return _teamColors[idHash % _teamColors.length];
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0F0F1A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1A2E),
        title: const Text('Filtro de Rotas (Gráfica)', style: TextStyle(color: Colors.white)),
        iconTheme: const IconThemeData(color: Colors.white),
      ),
      body: RefreshIndicator(
        onRefresh: _loadData,
        color: const Color(0xFFCE93D8),
        backgroundColor: const Color(0xFF1A1A2E),
        child: _isLoading
            ? const Center(child: CircularProgressIndicator(color: Color(0xFFCE93D8)))
            : _rotasPorCidade.isEmpty
                ? ListView(
                    children: const [
                      SizedBox(height: 100),
                      Center(
                        child: Text(
                          'Nenhuma ficha a caminho da gráfica.\nTudo atualizado!',
                          textAlign: TextAlign.center,
                          style: TextStyle(color: Colors.white54, fontSize: 16),
                        ),
                      ),
                    ],
                  )
                : ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: _rotasPorCidade.length,
                    itemBuilder: (context, index) {
                      final city = _rotasPorCidade.keys.elementAt(index);
                      final teamsMap = _rotasPorCidade[city]!;
                      
                      int totalFichasNaCidade = 0;
                      teamsMap.values.forEach((lista) {
                        totalFichasNaCidade += lista.length;
                      });

                      return _buildCityCard(city, totalFichasNaCidade, teamsMap);
                    },
                  ),
      ),
    );
  }

  Widget _buildCityCard(String city, int totalFichas, Map<String, List<dynamic>> teamsMap) {
    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A2E),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Header
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: const BoxDecoration(
              color: Color(0xFF2A1A4A),
              borderRadius: BorderRadius.only(topLeft: Radius.circular(16), topRight: Radius.circular(16)),
            ),
            child: Row(
              children: [
                const Icon(Icons.location_on, color: Color(0xFFCE93D8)),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    city.isEmpty ? 'CIDADE NÃO INFORMADA' : city,
                    style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold),
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: Colors.white10,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    '$totalFichas fichas',
                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
                  ),
                ),
              ],
            ),
          ),
          
          // Equipes
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: teamsMap.keys.map((teamId) {
                final list = teamsMap[teamId]!;
                final teamName = _teamNames[teamId] ?? 'Equipe $teamId';
                final color = _getColorForTeam(teamId);
                
                return Container(
                  margin: const EdgeInsets.only(bottom: 8),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: color.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: color.withOpacity(0.3)),
                  ),
                  child: Row(
                    children: [
                      Container(
                        width: 12,
                        height: 12,
                        decoration: BoxDecoration(
                          color: color,
                          shape: BoxShape.circle,
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          teamName,
                          style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 16),
                        ),
                      ),
                      Text(
                        '${list.length} fichas',
                        style: const TextStyle(color: Colors.white, fontSize: 14),
                      ),
                    ],
                  ),
                );
              }).toList(),
            ),
          ),
        ],
      ),
    );
  }
}
