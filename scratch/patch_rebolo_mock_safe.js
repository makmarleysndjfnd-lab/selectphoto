const fs = require('fs');

let content = fs.readFileSync('mobile/lib/telas/painel_admin.dart', 'utf8');

// 1. Remove mock data `_stockByCity`
content = content.replace(/final _stockByCity = \[\s*\{[\s\S]*?\},\s*\];/m, '');

// 2. We will replace Widget _buildStockTab() completely.
const newBuildStockTab = `Widget _buildStockTab() {
    final totalFichas = _rotasRebolo.fold<int>(0, (s, r) => s + (r['books'] as List).length) +
        _rebolosNaoAtribuidos.length +
        _rebolosDistribuidos.values.fold<int>(0, (s, list) => s + list.length);

    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Resumo total
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [Color(0xFF1A0A00), Color(0xFF3A1000)],
              ),
              borderRadius: BorderRadius.circular(18),
              border: Border.all(
                  color: const Color(0xFFEF5350).withOpacity(0.3)),
            ),
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: const Color(0xFFEF5350).withOpacity(0.2),
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: const Icon(Icons.inventory_2_rounded,
                      color: Color(0xFFEF9A9A), size: 26),
                ),
                const SizedBox(width: 16),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Estoque de Não-Vendas',
                        style: TextStyle(
                            color: Color(0xFF90CAF9), fontSize: 12)),
                    Text('$totalFichas fichas',
                        style: const TextStyle(
                            color: Colors.white,
                            fontSize: 24,
                            fontWeight: FontWeight.bold)),
                    Text('\${_rotasRebolo.length} cidades',
                        style: const TextStyle(
                            color: Color(0xFFEF9A9A), fontSize: 12)),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),
          _buildRotasInteligentes(isRebolo: true),
          const SizedBox(height: 20),
        ],
      ),
    );
  }

  // REPLACED _buildCityStockCard WITH NOOP JUST IN CASE to preserve block boundaries if used
  Widget _buildCityStockCard(Map<String, dynamic> cityData) {
     return const SizedBox.shrink();
  }`;

content = content.replace(/Widget _buildStockTab\(\) \{[\s\S]*?Widget _buildCityStockCard\(Map<String, dynamic> cityData\) \{[\s\S]*?\/\/ ===/m, newBuildStockTab + '\n  // ==='); // Wait, let's use a smarter replace.

fs.writeFileSync('mobile/lib/telas/painel_admin.dart', content, 'utf8');
