const fs = require('fs');

let content = fs.readFileSync('mobile/lib/telas/painel_admin.dart', 'utf8');

// 1. Add BlueThermalPrinter import
if (!content.includes('blue_thermal_printer')) {
    content = content.replace("import 'package:flutter/material.dart';", 
        "import 'package:flutter/material.dart';\nimport 'package:blue_thermal_printer/blue_thermal_printer.dart';");
}

// 2. Extract AWAITING_RELEASE batches in _loadClients()
if (!content.includes('_pendingReleaseBatches')) {
    content = content.replace("List<Map<String, dynamic>> _rebolosNaoAtribuidos = [];",
        "List<Map<String, dynamic>> _rebolosNaoAtribuidos = [];\n  List<Map<String, dynamic>> _pendingReleaseBatches = [];");
    
    // Actually I need to fetch it in _loadClients
    content = content.replace("final clients = await api.getAllClients();",
        "final clients = await api.getAllClients();\n      final pendingBatches = await api.getPendingBookBatches();\n      if(mounted) setState(() => _pendingReleaseBatches = pendingBatches);");
}

// 3. Add print method and showReceiveReturnDialog method
if (!content.includes('_printUnidadeBluetooth')) {
    const methods = `
  void _printUnidadeBluetooth(Map<String, dynamic> ficha) async {
    final bluetooth = BlueThermalPrinter.instance;
    bool? isConnected = await bluetooth.isConnected;
    if (isConnected != true) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Nenhuma impressora conectada! Vá nas configurações.', style: TextStyle(color: Colors.white)), backgroundColor: Colors.red));
      return;
    }

    final seq = ficha['ficha'] ?? 'S/N';
    final city = ficha['city'] ?? 'Sem Cidade';
    final eventName = ficha['cliente'] ?? 'Evento Desconhecido';
    
    bluetooth.printNewLine();
    bluetooth.printCustom("LUMORA - FICHA UNICA", 2, 1);
    bluetooth.printNewLine();
    bluetooth.printCustom("Ficha: $seq", 2, 1);
    bluetooth.printCustom("Evento: $eventName", 1, 1);
    bluetooth.printCustom("Cidade: $city", 1, 1);
    bluetooth.printNewLine();
    bluetooth.printCustom("_________________________________", 0, 1);
    bluetooth.printCustom("Obrigado!", 1, 1);
    bluetooth.printNewLine();
    bluetooth.printNewLine();
    bluetooth.printNewLine();

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Imprimindo ticket...', style: TextStyle(color: Colors.white)), backgroundColor: Colors.green));
    }
  }

  void _showReceiveReturnDialog() {
    final _codeCtrl = TextEditingController();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1A1A2E),
        title: const Text('Receber Devolução de Book', style: TextStyle(color: Colors.white)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('O book será re-cadastrado no estoque para Rebolo.', style: TextStyle(color: Colors.white70)),
            const SizedBox(height: 16),
            TextField(
              controller: _codeCtrl,
              style: const TextStyle(color: Colors.white),
              textCapitalization: TextCapitalization.characters,
              decoration: const InputDecoration(
                labelText: 'Código da Ficha',
                labelStyle: TextStyle(color: Colors.white54),
                enabledBorder: UnderlineInputBorder(borderSide: BorderSide(color: Colors.white24)),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar', style: TextStyle(color: Colors.white54))),
          ElevatedButton(
            onPressed: () async {
              final code = _codeCtrl.text.trim();
              if (code.isEmpty) return;
              Navigator.pop(ctx);
              try {
                await ApiService().receiveReturnedBook(code);
                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Devolução registrada. Book no estoque!'), backgroundColor: Colors.green));
                  _loadClients();
                }
              } catch(e) {
                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro: ' + e.toString()), backgroundColor: Colors.red));
                }
              }
            },
            child: const Text('Confirmar'),
          )
        ],
      )
    );
  }
`;
    content = content.replace("Widget _sideMenuItem(int index, IconData icon, String label) {", methods + "\n    Widget _sideMenuItem(int index, IconData icon, String label) {");
}

// 4. Modify _buildPhotosTab to include AWAITING_RELEASE section
if (!content.includes('Lotes Aguardando Liberação')) {
    const pending_ui = `
            if (_pendingReleaseBatches.isNotEmpty)
              Container(
                margin: const EdgeInsets.only(bottom: 20),
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: Colors.orange.withOpacity(0.15),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: Colors.orangeAccent),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const Icon(Icons.hourglass_top_rounded, color: Colors.orangeAccent, size: 24),
                        const SizedBox(width: 8),
                        const Text('Lotes Aguardando Liberação', style: TextStyle(color: Colors.orangeAccent, fontWeight: FontWeight.bold, fontSize: 16)),
                      ],
                    ),
                    const SizedBox(height: 12),
                    ..._pendingReleaseBatches.map((batch) {
                      return ListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text('Lote Fotógrafo: ' + (batch['photographer'] ? batch['photographer']['name'] : 'N/A'), style: const TextStyle(color: Colors.white)),
                        subtitle: Text('Status: ' + batch['status'] + ' | Fechado', style: const TextStyle(color: Colors.white70)),
                        trailing: ElevatedButton(
                          style: ElevatedButton.styleFrom(backgroundColor: Colors.green),
                          onPressed: () async {
                            try {
                              await ApiService().releaseBatchToStock(batch['id']);
                              if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Lote liberado para estoque!'), backgroundColor: Colors.green));
                              _loadClients();
                            } catch(e) {
                              if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro: ' + e.toString()), backgroundColor: Colors.red));
                            }
                          },
                          child: const Text('Liberar para Estoque'),
                        ),
                      );
                    }).toList(),
                  ],
                ),
              ),
`;
    content = content.replace("// Resumo geral", pending_ui + "\n            // Resumo geral");
}

// 5. Modify _buildStockTab to include the Devolução Card
if (!content.includes('Receber Devolução de Book')) {
    const return_card_ui = `
            GestureDetector(
              onTap: _showReceiveReturnDialog,
              child: Container(
                margin: const EdgeInsets.only(bottom: 20, top: 20),
                padding: const EdgeInsets.all(18),
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [Color(0xFF00301A), Color(0xFF00683A)],
                  ),
                  borderRadius: BorderRadius.circular(18),
                  border: Border.all(color: Colors.greenAccent.withOpacity(0.3)),
                ),
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: Colors.greenAccent.withOpacity(0.2),
                        borderRadius: BorderRadius.circular(14),
                      ),
                      child: const Icon(Icons.qr_code_scanner_rounded, color: Colors.greenAccent, size: 26),
                    ),
                    const SizedBox(width: 16),
                    const Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Receber Devolução', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
                          Text('Registrar devolução de books para o estoque de Rebolo', style: TextStyle(color: Colors.white70, fontSize: 12)),
                        ],
                      ),
                    ),
                    const Icon(Icons.arrow_forward_ios_rounded, color: Colors.white54, size: 16),
                  ],
                ),
              ),
            ),
`;
    content = content.replace(/const Text\('Toque para\\nver detalhes',[\s\S]*?\),\s*\]\,\s*\)\,\s*\)\,/m, match => match + "\n" + return_card_ui);
}

// 6. Add Print Button to Book Tiles
content = content.replace(/trailing: isRebolo/g, "trailing: Row(mainAxisSize: MainAxisSize.min, children: [IconButton(icon: const Icon(Icons.print, color: Colors.blueAccent), onPressed: () => _printUnidadeBluetooth(book), tooltip: 'Imprimir Ticket'), isRebolo");
content = content.replace(/\? const Icon\(Icons\.autorenew_rounded\, color\: Colors\.orangeAccent\)/g, "? const Icon(Icons.autorenew_rounded, color: Colors.orangeAccent)])");
content = content.replace(/\: const Icon\(Icons\.menu_book_rounded\, color\: Color\(0xFFCE93D8\)\)\,/g, ": const Icon(Icons.menu_book_rounded, color: Color(0xFFCE93D8))]),");

fs.writeFileSync('mobile/lib/telas/painel_admin.dart', content, 'utf8');
