const fs = require('fs');

let content = fs.readFileSync('mobile/lib/telas/painel_admin.dart', 'utf8');

const newWidget = `
  Widget _buildFechamentoFotografosLive() {
    // Agrupa todos os clientes por fotografo
    final Map<String, String> photographerNames = {};
    final Map<String, int> liveCounts = {};
    final Map<String, int> closedCounts = {};

    for (var c in _allClients) {
      if (c['photographerId'] == null) continue;
      final pid = c['photographerId'];
      final name = c['photographer'] != null ? (c['photographer']['name'] ?? 'Sem Nome') : 'Sem Nome';
      final status = c['bookStatus'];

      photographerNames[pid] = name;
      
      if (status == 'CREATED') {
        liveCounts[pid] = (liveCounts[pid] ?? 0) + 1;
      } else if (status == 'AWAITING_RELEASE') {
        closedCounts[pid] = (closedCounts[pid] ?? 0) + 1;
      }
    }

    final pids = photographerNames.keys.toList();

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
          if (pids.isEmpty)
            const Text('Nenhuma produção recente registrada.', style: TextStyle(color: Colors.white54)),
          ...pids.map((pid) {
            final name = photographerNames[pid]!;
            final live = liveCounts[pid] ?? 0;
            final closed = closedCounts[pid] ?? 0;
            
            if (live == 0 && closed == 0) return const SizedBox.shrink();

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
                    if (live > 0)
                      Text('$live fichas', style: const TextStyle(color: Colors.orangeAccent, fontWeight: FontWeight.bold)),
                    if (closed > 0)
                      Text('Total: $closed fichas (Finalizado)', style: const TextStyle(color: Colors.greenAccent, fontWeight: FontWeight.bold)),
                  ],
                ),
              ),
            );
          }),
        ],
      ),
    );
  }
`;

// Replace the buggy method
content = content.replace(
    /Widget _buildFechamentoFotografosLive\(\) \{[\s\S]*?Widget _buildPhotosTab\(\) \{/m,
    newWidget.trim() + "\n\n  Widget _buildPhotosTab() {"
);

fs.writeFileSync('mobile/lib/telas/painel_admin.dart', content, 'utf8');
console.log('Fixed tracking.');
