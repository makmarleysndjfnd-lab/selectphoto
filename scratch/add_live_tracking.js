const fs = require('fs');

let content = fs.readFileSync('mobile/lib/telas/painel_admin.dart', 'utf8');

// 1. Create the new widget code
const newWidget = `
  Widget _buildFechamentoFotografosLive() {
    final photographers = _sellers.where((s) => s['role'] == 'PHOTOGRAPHER' || s['role'] == 'ADMIN' || s['role'] == 'SUPER_ADMIN').toList();

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
          const Text('Produção ao Vivo (Fotógrafos)', style: TextStyle(color: Color(0xFFCE93D8), fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          if (photographers.isEmpty)
            const Text('Nenhum fotógrafo cadastrado.', style: TextStyle(color: Colors.white54)),
          ...photographers.map((p) {
            final pid = p['id'];
            final name = p['name'] ?? 'Sem Nome';
            
            // Fichas ativas (CREATED) -> em produção (não fechadas)
            final liveCount = _allClients.where((c) => c['photographerId'] == pid && c['bookStatus'] == 'CREATED').length;
            
            // Fichas fechadas no lote (AWAITING_RELEASE) -> aguardando rota
            final closedCount = _allClients.where((c) => c['photographerId'] == pid && c['bookStatus'] == 'AWAITING_RELEASE').length;
            
            if (liveCount == 0 && closedCount == 0) {
               return const SizedBox.shrink(); // Hide if no activity
            }

            return Card(
              color: Colors.white.withOpacity(0.05),
              margin: const EdgeInsets.only(bottom: 8),
              child: ListTile(
                leading: const CircleAvatar(
                  backgroundColor: Colors.white12,
                  child: Icon(Icons.camera_alt_outlined, color: Colors.white),
                ),
                title: Text(name, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                subtitle: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (liveCount > 0)
                      Text('$liveCount fichas', style: const TextStyle(color: Colors.orangeAccent, fontWeight: FontWeight.bold)),
                    if (closedCount > 0)
                      Text('Total: $closedCount fichas (Finalizado)', style: const TextStyle(color: Colors.greenAccent, fontWeight: FontWeight.bold)),
                  ],
                ),
              ),
            );
          }),
        ],
      ),
    );
  }

  Widget _buildPhotosTab() {`;

// 2. Insert it before _buildPhotosTab()
content = content.replace("Widget _buildPhotosTab() {", newWidget);

// 3. Add it to the children of _buildPhotosTab()
content = content.replace(
    "          children: [\n            _buildResumoGeralProducao(),\n            _buildListaTodosBooks(),\n            if (_pendingReleaseBatches.isNotEmpty)",
    "          children: [\n            _buildResumoGeralProducao(),\n            _buildListaTodosBooks(),\n            _buildFechamentoFotografosLive(),\n            if (_pendingReleaseBatches.isNotEmpty)"
);

fs.writeFileSync('mobile/lib/telas/painel_admin.dart', content, 'utf8');
console.log("painel_admin.dart updated.");
