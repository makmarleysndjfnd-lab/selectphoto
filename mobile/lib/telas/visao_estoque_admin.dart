import 'package:flutter/material.dart';

class VisaoEstoqueAdmin extends StatefulWidget {
  const VisaoEstoqueAdmin({super.key});

  @override
  State<VisaoEstoqueAdmin> createState() => _VisaoEstoqueAdminState();
}

class _VisaoEstoqueAdminState extends State<VisaoEstoqueAdmin> {

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

}
