import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

class VisaoEstoqueAdmin extends StatefulWidget {
  const VisaoEstoqueAdmin({super.key});

  @override
  State<VisaoEstoqueAdmin> createState() => _VisaoEstoqueAdminState();
}

class _VisaoEstoqueAdminState extends State<VisaoEstoqueAdmin> {
  // Mock Rotas Inteligentes
  final List<Map<String, dynamic>> _rotas = [
    {'city': 'Campinas', 'count': 42, 'lote': 'CAMPINAS01'},
    {'city': 'São Paulo', 'count': 15, 'lote': 'SP01'},
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0D0D1A),
      appBar: AppBar(
        title: const Text('Books & Rotas', style: TextStyle(color: Colors.white)),
        backgroundColor: const Color(0xFF1A0030),
        iconTheme: const IconThemeData(color: Colors.white),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
             Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Estoque & Books', style: TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold)),
                ElevatedButton.icon(
                  onPressed: () {
                     // refresh action
                  }, 
                  icon: const Icon(Icons.refresh),
                  label: const Text('Atualizar'),
                  style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFCE93D8)),
                )
              ]
            ),
            const SizedBox(height: 20),
            _buildResumoGeral(),
            const SizedBox(height: 20),
            _buildTrocasPendentes(),
            const SizedBox(height: 20),
            _buildListaLotes(),
            const SizedBox(height: 20),
            _buildRotasInteligentes(),
            const SizedBox(height: 20),
            _buildTransferencia(),
            const SizedBox(height: 40),
          ],
        ),
      ),
    );
  }

  Widget _buildTrocasPendentes() {
    // Mock de solicitações pendentes
    final trocas = [
      {'remetente': 'João (Vendedor 1)', 'destinatario': 'Maria (Vendedora 2)', 'qtd': 3, 'id': 'TRC-01'},
    ];

    if (trocas.isEmpty) return const SizedBox.shrink();

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A2E),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.orangeAccent.withOpacity(0.5)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.warning_amber_rounded, color: Colors.orangeAccent),
              SizedBox(width: 8),
              Text('Trocas Pendentes de Fichas', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
            ],
          ),
          const SizedBox(height: 16),
          ...trocas.map((troca) {
            return Card(
              color: Colors.white.withOpacity(0.05),
              margin: const EdgeInsets.only(bottom: 8),
              child: ListTile(
                title: Text('${troca['remetente']} \u2794 ${troca['destinatario']}', style: const TextStyle(color: Colors.white, fontSize: 14)),
                subtitle: Text('${troca['qtd']} Fichas', style: const TextStyle(color: Colors.white70)),
                trailing: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    IconButton(
                      icon: const Icon(Icons.close, color: Colors.redAccent),
                      tooltip: 'Recusar',
                      onPressed: () {
                        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Troca ${troca['id']} recusada.')));
                      },
                    ),
                    IconButton(
                      icon: const Icon(Icons.check, color: Colors.greenAccent),
                      tooltip: 'Aprovar',
                      onPressed: () {
                        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Troca ${troca['id']} aprovada.')));
                      },
                    ),
                  ],
                ),
              ),
            );
          }),
        ],
      ),
    );
  }

  void _scanAndDistributeBooks() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF1A1A2E),
      builder: (context) {
        return SizedBox(
          height: MediaQuery.of(context).size.height * 0.8,
          child: Column(
            children: [
              const Padding(
                padding: EdgeInsets.all(16.0),
                child: Text('Leitura de Saída (QR Code)', style: TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold)),
              ),
              Expanded(
                child: MobileScanner(
                  onDetect: (capture) {
                    final List<Barcode> barcodes = capture.barcodes;
                    if (barcodes.isNotEmpty) {
                      final code = barcodes.first.rawValue;
                      if (code != null) {
                        Navigator.pop(context);
                        _assignBookToSellerDialog(code);
                      }
                    }
                  },
                ),
              ),
              const Padding(
                padding: EdgeInsets.all(16.0),
                child: Text('Aponte a câmera para o QR Code impresso no book', style: TextStyle(color: Colors.white70)),
              )
            ],
          ),
        );
      }
    );
  }

  void _assignBookToSellerDialog(String qrCode) {
    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          backgroundColor: const Color(0xFF1E1E2C),
          title: const Text('Atribuir Book a Vendedor', style: TextStyle(color: Colors.white)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Ficha/Book: $qrCode', style: const TextStyle(color: Color(0xFFCE93D8), fontWeight: FontWeight.bold)),
              const SizedBox(height: 16),
              const Text('Selecione o Vendedor ou Gerente:', style: TextStyle(color: Colors.white70)),
              const SizedBox(height: 8),
              // Mock dropdown
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                decoration: BoxDecoration(color: Colors.white10, borderRadius: BorderRadius.circular(8)),
                child: DropdownButton<String>(
                  items: const [
                    DropdownMenuItem(value: 'v1', child: Text('João (Gerente)', style: TextStyle(color: Colors.white))),
                    DropdownMenuItem(value: 'v2', child: Text('Maria', style: TextStyle(color: Colors.white))),
                  ],
                  onChanged: (v) {},
                  dropdownColor: const Color(0xFF1E1E2C),
                  isExpanded: true,
                  underline: const SizedBox(),
                  hint: const Text('Selecionar', style: TextStyle(color: Colors.white54)),
                ),
              ),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancelar', style: TextStyle(color: Colors.white54))),
            ElevatedButton(
              onPressed: () {
                Navigator.pop(context);
                ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Book distribuído com sucesso!'), backgroundColor: Colors.green));
              },
              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFCE93D8)),
              child: const Text('Confirmar Atribuição'),
            ),
          ],
        );
      }
    );
  }

  Widget _buildResumoGeral() {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A2E),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Visão Geral', style: TextStyle(color: Color(0xFFCE93D8), fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              _infoBox('Capas no Admin', '0', Colors.blueAccent),
              _infoBox('Capas com Vendedores', '0', Colors.orangeAccent),
              _infoBox('Total Geral', '0', Colors.greenAccent),
            ],
          )
        ],
      )
    );
  }

  Widget _infoBox(String label, String value, Color color) {
    return Column(
      children: [
        Text(value, style: TextStyle(color: color, fontSize: 28, fontWeight: FontWeight.bold)),
        const SizedBox(height: 4),
        Text(label, style: const TextStyle(color: Colors.white70, fontSize: 12)),
      ],
    );
  }

  Widget _buildListaLotes() {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A2E),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('Lotes de Entrada', style: TextStyle(color: Color(0xFFCE93D8), fontSize: 18, fontWeight: FontWeight.bold)),
              ElevatedButton.icon(
                onPressed: () {},
                icon: const Icon(Icons.add),
                label: const Text('Novo Lote'),
                style: ElevatedButton.styleFrom(backgroundColor: Colors.green),
              )
            ],
          ),
          const SizedBox(height: 16),
          // Exemplo de Lote colorizado: Verde <30, Amarelo 30-100, Vermelho > 400
          _loteCard('Lote L2024-06 (32 dias)', '50 Capas', Colors.yellow.shade700),
          const SizedBox(height: 8),
          _loteCard('Lote L2024-05 (10 dias)', '100 Capas', Colors.green.shade600),
        ],
      )
    );
  }

  Widget _loteCard(String title, String subtitle, Color color, {Widget? trailing}) {
     return Container(
       padding: const EdgeInsets.all(12),
       decoration: BoxDecoration(
         color: color.withOpacity(0.2),
         borderRadius: BorderRadius.circular(12),
         border: Border.all(color: color.withOpacity(0.5)),
       ),
       child: Row(
         mainAxisAlignment: MainAxisAlignment.spaceBetween,
         children: [
           Column(
             crossAxisAlignment: CrossAxisAlignment.start,
             children: [
               Text(title, style: TextStyle(color: color, fontWeight: FontWeight.bold)),
               Text(subtitle, style: const TextStyle(color: Colors.white)),
             ],
           ),
           if (trailing != null) trailing,
         ],
       ),
     );
  }

  Widget _buildTransferencia() {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A2E),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Distribuição de Books (Saída)', style: TextStyle(color: Color(0xFFCE93D8), fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          ElevatedButton.icon(
            onPressed: _scanAndDistributeBooks,
            icon: const Icon(Icons.qr_code_scanner, color: Colors.white),
            label: const Text('Distribuir Books via QR Code', style: TextStyle(color: Colors.white)),
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF9C27B0), padding: const EdgeInsets.symmetric(vertical: 14)),
          ),
          const SizedBox(height: 16),
          const Text('Aponte a câmera para os QR Codes dos books impressos para registrá-los no estoque do vendedor e na respectiva rota.', style: TextStyle(color: Colors.white70, fontSize: 13)),
        ],
      )
    );
  }

  Widget _buildRotasInteligentes() {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A2E),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Rotas Inteligentes', style: TextStyle(color: Color(0xFFCE93D8), fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          const Text('Os books recém criados pelos fotógrafos são agrupados por cidade para facilitar a impressão e logística.', style: TextStyle(color: Colors.white54, fontSize: 12)),
          const SizedBox(height: 16),
          ..._rotas.map((r) => Padding(
            padding: const EdgeInsets.only(bottom: 8.0),
            child: _loteCard(
              'Rota: ${r['city']} (Lote: ${r['lote']})', 
              '${r['count']} Books Prontos', 
              Colors.blue.shade400,
              trailing: Row(
                children: [
                  IconButton(
                    onPressed: () {
                      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Editando/Transferindo Rota...')));
                    },
                    icon: const Icon(Icons.edit, color: Colors.white70, size: 20),
                    tooltip: 'Editar / Transferir Rota',
                  ),
                ],
              ),
            ),
          )),
        ],
      )
    );
  }
}
