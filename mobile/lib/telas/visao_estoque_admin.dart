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
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
             Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Estoque de Capas (Books)', style: TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold)),
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
            _buildListaLotes(),
            const SizedBox(height: 20),
            _buildTransferencia(),
          ],
        ),
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

  Widget _loteCard(String title, String subtitle, Color color) {
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
           Text(title, style: TextStyle(color: color, fontWeight: FontWeight.bold)),
           Text(subtitle, style: const TextStyle(color: Colors.white)),
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
          const Text('Transferência para Vendedores', style: TextStyle(color: Color(0xFFCE93D8), fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          ElevatedButton.icon(
            onPressed: () {},
            icon: const Icon(Icons.send_rounded),
            label: const Text('Transferir Capas'),
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF9C27B0)),
          ),
          const SizedBox(height: 16),
          const Text('Gerenciar transferências permite: Incluir, Editar e Excluir.', style: TextStyle(color: Colors.white70, fontSize: 12)),
        ],
      )
    );
  }
}
