const fs = require('fs');

// 1. Patch ApiService
let apiContent = fs.readFileSync('mobile/lib/servicos/servico_api.dart', 'utf8');
if (!apiContent.includes('getCoverStockInfo')) {
    apiContent = apiContent.replace(
        "Future<List<dynamic>> getPendingBookBatches() async {",
        "Future<Map<String, dynamic>> getCoverStockInfo() async {\n    try {\n      final response = await _dio.get('/stock/info');\n      return response.data as Map<String, dynamic>;\n    } on DioException catch (e) {\n      throw Exception(e.response?.data['error'] ?? 'Erro ao buscar informacoes de capas');\n    }\n  }\n\n  Future<void> transferCovers(String sellerId, int quantity) async {\n    try {\n      await _dio.post('/stock/transfer', data: {'recipientId': sellerId, 'quantity': quantity});\n    } on DioException catch (e) {\n      throw Exception(e.response?.data['error'] ?? 'Erro ao transferir capas');\n    }\n  }\n\n  Future<List<dynamic>> getPendingBookBatches() async {"
    );
    fs.writeFileSync('mobile/lib/servicos/servico_api.dart', apiContent, 'utf8');
}

// 2. Patch painel_admin.dart
let painelContent = fs.readFileSync('mobile/lib/telas/painel_admin.dart', 'utf8');
if (!painelContent.includes('_allClients =')) {
    // Add _allClients to state
    painelContent = painelContent.replace(
        "List<dynamic> _upcomingEvents = [];",
        "List<Map<String, dynamic>> _allClients = [];\n  List<dynamic> _upcomingEvents = [];"
    );

    // In _loadClients, populate _allClients
    painelContent = painelContent.replace(
        "final clients = books.map((b) => b['rawClientData'] as Map<String, dynamic>).where((c) => c != null).toList();",
        "final rawClients = await api.getAllClients();\n      if(mounted) setState(() => _allClients = List<Map<String, dynamic>>.from(rawClients));\n\n      final clients = books.map((b) => b['rawClientData'] as Map<String, dynamic>).where((c) => c != null).toList();"
    );

    // Add widgets logic
    const widgetsCode = `
  int get _totalBooksProduced => _allClients.length;
  int get _booksAguardando => _allClients.where((c) => c['releasedForRouting'] != true).length;
  int get _booksLiberados => _allClients.where((c) => c['releasedForRouting'] == true).length;

  Widget _buildResumoGeralProducao() {
    return Container(
      margin: const EdgeInsets.only(bottom: 20),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A2E),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Resumo de Produção (Geral)', style: TextStyle(color: Color(0xFFCE93D8), fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              _infoBoxProducao('Total Produzido', '$_totalBooksProduced', Colors.blueAccent),
              _infoBoxProducao('Aguardando Rota', '$_booksAguardando', Colors.orangeAccent),
              _infoBoxProducao('Liberado p/ Rota', '$_booksLiberados', Colors.greenAccent),
            ],
          )
        ],
      )
    );
  }

  Widget _infoBoxProducao(String label, String value, Color color) {
    return Column(
      children: [
        Text(value, style: TextStyle(color: color, fontSize: 28, fontWeight: FontWeight.bold)),
        const SizedBox(height: 4),
        Text(label, style: const TextStyle(color: Colors.white70, fontSize: 12)),
      ],
    );
  }

  Widget _buildListaTodosBooks() {
    return Container(
      margin: const EdgeInsets.only(bottom: 20),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A2E),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Todos os Books Produzidos', style: TextStyle(color: Color(0xFFCE93D8), fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          if (_allClients.isEmpty)
            const Text('Nenhum book foi produzido ainda.', style: TextStyle(color: Colors.white54)),
          ..._allClients.map((c) {
            final name = c['name'] ?? 'Sem Nome';
            final city = c['city'] ?? 'Sem Cidade';
            final seq = c['sequenceNumber'] ?? 'S/N';
            final isReleased = c['releasedForRouting'] == true;

            return Card(
              color: Colors.white.withOpacity(0.05),
              margin: const EdgeInsets.only(bottom: 8),
              child: ListTile(
                leading: const CircleAvatar(
                  backgroundColor: Colors.white12,
                  child: Icon(Icons.menu_book, color: Colors.white),
                ),
                title: Text(name, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                subtitle: Text('Ficha: $seq | Cidade: $city', style: const TextStyle(color: Colors.white70)),
                trailing: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(
                    color: isReleased ? Colors.green.withOpacity(0.2) : Colors.orange.withOpacity(0.2),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    isReleased ? 'Liberado' : 'Aguardando',
                    style: TextStyle(
                      color: isReleased ? Colors.greenAccent : Colors.orangeAccent,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ),
            );
          }),
        ],
      ),
    );
  }
`;
    // Insert before _buildPhotosTab
    painelContent = painelContent.replace(
        "Widget _buildPhotosTab() {",
        widgetsCode + "\n  Widget _buildPhotosTab() {"
    );

    // Inject the widgets at the top of _buildPhotosTab (inside the Column children)
    painelContent = painelContent.replace(
        "          children: [\n            \n              if (_pendingReleaseBatches.isNotEmpty)",
        "          children: [\n            _buildResumoGeralProducao(),\n            _buildListaTodosBooks(),\n            if (_pendingReleaseBatches.isNotEmpty)"
    );

    fs.writeFileSync('mobile/lib/telas/painel_admin.dart', painelContent, 'utf8');
}
