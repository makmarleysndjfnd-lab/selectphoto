import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../servicos/servico_api.dart';

class VisaoRoteiroInteligente extends StatefulWidget {
  const VisaoRoteiroInteligente({super.key});

  @override
  State<VisaoRoteiroInteligente> createState() => _VisaoRoteiroInteligenteState();
}

class _VisaoRoteiroInteligenteState extends State<VisaoRoteiroInteligente> {
  final ApiService _api = ApiService();
  bool _isLoading = true;
  String? _error;
  List<dynamic> _routes = [];
  String? _message;

  @override
  void initState() {
    super.initState();
    _loadRoutes();
  }

  Future<void> _loadRoutes() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final data = await _api.getSmartRoute();
      setState(() {
        _routes = data['routes'] ?? [];
        _message = data['message'];
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _isLoading = false;
      });
    }
  }

  Color _scoreColor(String? score) {
    switch ((score ?? '').toUpperCase()) {
      case 'HIGH':
        return const Color(0xFF00E676);
      case 'MEDIUM':
        return const Color(0xFFFFB74D);
      case 'LOW':
        return const Color(0xFFFF5252);
      default:
        return const Color(0xFF00E676);
    }
  }

  String _formatDate(dynamic d) {
    if (d == null) return 'N/A';
    try {
      return DateFormat('dd/MM/yy').format(DateTime.parse(d.toString()));
    } catch (_) {
      return d.toString();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0F0F1A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1A2E),
        title: const Text('Mapeamento de Rotas & Logística', style: TextStyle(color: Colors.white)),
        iconTheme: const IconThemeData(color: Colors.white),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: Colors.white70),
            onPressed: _loadRoutes,
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFFCE93D8)))
          : _error != null
              ? _buildError()
              : _routes.isEmpty
                  ? _buildEmpty()
                  : _buildRouteList(),
    );
  }

  Widget _buildError() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline, color: Colors.redAccent, size: 48),
            const SizedBox(height: 16),
            Text(_error!, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white54)),
            const SizedBox(height: 16),
            ElevatedButton.icon(
              onPressed: _loadRoutes,
              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFCE93D8)),
              icon: const Icon(Icons.refresh),
              label: const Text('Tentar Novamente'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildEmpty() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.map_outlined, color: Color(0xFF80DEEA), size: 64),
            const SizedBox(height: 16),
            const Text(
              'Nenhuma rota ativa encontrada',
              style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            Text(
              _message ?? 'Adicione eventos no Radar para o sistema mapear itinerários das equipes.',
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white54, fontSize: 14),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildRouteList() {
    return Column(
      children: [
        Container(
          color: const Color(0xFF1A0030),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          child: const Row(
            children: [
              Icon(Icons.route_rounded, color: Color(0xFF80DEEA), size: 18),
              SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Mapeamento de trajeto para transbordo de fichas entre equipes e vendedores no mesmo itinerário.',
                  style: TextStyle(color: Colors.white70, fontSize: 12),
                ),
              ),
            ],
          ),
        ),
        Expanded(
          child: ListView.builder(
            padding: const EdgeInsets.all(16),
            itemCount: _routes.length,
            itemBuilder: (ctx, i) => _buildRouteCard(_routes[i], i + 1),
          ),
        ),
      ],
    );
  }

  Widget _buildRouteCard(dynamic route, int index) {
    final stops = (route['stops'] as List?) ?? [];
    final summary = route['summary'] as Map? ?? {};

    final int totalDays = summary['totalDays'] ?? 0;
    final int totalKm = summary['totalKm'] ?? 0;
    final int stopCount = summary['stopCount'] ?? 0;

    return Container(
      margin: const EdgeInsets.only(bottom: 20),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A2E),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: const Color(0xFF80DEEA).withOpacity(0.4)),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFF80DEEA).withOpacity(0.06),
            blurRadius: 16,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Header
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: const BoxDecoration(
              color: Color(0xFF161B2E),
              borderRadius: BorderRadius.only(
                topLeft: Radius.circular(18),
                topRight: Radius.circular(18),
              ),
            ),
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: const Color(0xFF80DEEA).withOpacity(0.2),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    'Rota $index',
                    style: const TextStyle(color: Color(0xFF80DEEA), fontWeight: FontWeight.bold, fontSize: 12),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    '$stopCount cidades . $totalDays dias de permanência . $totalKm km totais',
                    style: const TextStyle(color: Colors.white70, fontSize: 13),
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: Colors.blueAccent.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: Colors.blueAccent.withOpacity(0.4)),
                  ),
                  child: const Text(
                    '📍 Itinerário Ativo',
                    style: TextStyle(color: Colors.blueAccent, fontWeight: FontWeight.bold, fontSize: 11),
                  ),
                ),
              ],
            ),
          ),

          // Stops
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
            child: Column(
              children: stops.asMap().entries.map((entry) {
                final idx = entry.key;
                final stop = entry.value as Map;
                final bool isFirst = idx == 0;
                final int distKm = (stop['distanceFromPrevKm'] ?? 0) as int;

                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (!isFirst)
                      Row(
                        children: [
                          const SizedBox(width: 18),
                          Container(width: 2, height: 20, color: Colors.white12),
                          const SizedBox(width: 12),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                            decoration: BoxDecoration(color: Colors.white10, borderRadius: BorderRadius.circular(10)),
                            child: Text('$distKm km', style: const TextStyle(color: Colors.white38, fontSize: 10)),
                          ),
                        ],
                      ),
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: Colors.white.withOpacity(0.04),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(color: Colors.white12),
                      ),
                      child: Row(
                        children: [
                          Container(
                            width: 34,
                            height: 34,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: const Color(0xFF80DEEA).withOpacity(0.15),
                              border: Border.all(color: const Color(0xFF80DEEA).withOpacity(0.5)),
                            ),
                            child: Center(
                              child: Text(
                                '${idx + 1}',
                                style: const TextStyle(color: Color(0xFF80DEEA), fontWeight: FontWeight.bold, fontSize: 13),
                              ),
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  stop['city']?.toString() ?? '',
                                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14),
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  stop['name']?.toString() ?? '',
                                  style: const TextStyle(color: Colors.white60, fontSize: 12),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ],
                            ),
                          ),
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              Text('${stop['durationDays'] ?? 0} dias', style: const TextStyle(color: Color(0xFF80DEEA), fontWeight: FontWeight.bold, fontSize: 12)),
                              const SizedBox(height: 2),
                              const Text('Destino no Trajeto', style: TextStyle(color: Colors.white38, fontSize: 10)),
                            ],
                          ),
                        ],
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
