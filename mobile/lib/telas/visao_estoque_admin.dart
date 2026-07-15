import 'package:flutter/material.dart';

class VisaoEstoqueAdmin extends StatefulWidget {
  const VisaoEstoqueAdmin({super.key});

  @override
  State<VisaoEstoqueAdmin> createState() => _VisaoEstoqueAdminState();
}

class _VisaoEstoqueAdminState extends State<VisaoEstoqueAdmin> {
  int _capasSede = 500;
  final List<Map<String, dynamic>> _vendedores = [
    {'id': '1', 'nome': 'João (Vendedor 1)', 'qtd': 45},
    {'id': '2', 'nome': 'Maria (Vendedora 2)', 'qtd': 30},
    {'id': '3', 'nome': 'Carlos (Vendedor 3)', 'qtd': 15},
  ];

  int get _capasComVendedores => _vendedores.fold(0, (sum, v) => sum + (v['qtd'] as int));
  int get _totalGeral => _capasSede + _capasComVendedores;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0D0D1A),
      appBar: AppBar(
        title: const Text('Capas', style: TextStyle(color: Colors.white)),
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
                const Text('Estoque de Capas', style: TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold)),
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
            _buildCapasVendedores(),
            const SizedBox(height: 40),
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
              _infoBox('Capas na Sede', '$_capasSede', Colors.blueAccent),
              _infoBox('Capas com Vendedores', '$_capasComVendedores', Colors.orangeAccent),
              _infoBox('Total Geral', '$_totalGeral', Colors.greenAccent),
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

  Widget _buildCapasVendedores() {
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
              const Text('Capas com Vendedores', style: TextStyle(color: Color(0xFFCE93D8), fontSize: 18, fontWeight: FontWeight.bold)),
              ElevatedButton.icon(
                onPressed: () => _showDistribuirDialog(),
                icon: const Icon(Icons.add),
                label: const Text('Distribuir'),
                style: ElevatedButton.styleFrom(backgroundColor: Colors.blueAccent),
              )
            ],
          ),
          const SizedBox(height: 16),
          if (_vendedores.isEmpty)
            const Text('Nenhuma capa distribuída no momento.', style: TextStyle(color: Colors.white54)),
          ..._vendedores.map((v) {
            return Card(
              color: Colors.white.withOpacity(0.05),
              margin: const EdgeInsets.only(bottom: 8),
              child: ListTile(
                leading: const CircleAvatar(
                  backgroundColor: Colors.white12,
                  child: Icon(Icons.person, color: Colors.white),
                ),
                title: Text(v['nome'] as String, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                subtitle: Text('${v['qtd']} Capas', style: const TextStyle(color: Colors.orangeAccent, fontSize: 14, fontWeight: FontWeight.bold)),
                trailing: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    IconButton(
                      icon: const Icon(Icons.edit, color: Colors.white54, size: 20),
                      onPressed: () => _showDistribuirDialog(vendedorExistente: v),
                      tooltip: 'Editar Quantidade',
                    ),
                    IconButton(
                      icon: const Icon(Icons.delete_outline, color: Colors.redAccent, size: 20),
                      onPressed: () => _removerVendedor(v),
                      tooltip: 'Remover',
                    ),
                  ],
                )
              ),
            );
          }),
        ],
      )
    );
  }

  void _removerVendedor(Map<String, dynamic> v) {
    setState(() {
      _capasSede += v['qtd'] as int;
      _vendedores.removeWhere((item) => item['id'] == v['id']);
    });
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Vendedor removido e capas devolvidas à Sede.')));
  }

  void _showDistribuirDialog({Map<String, dynamic>? vendedorExistente}) {
    final bool isEdit = vendedorExistente != null;
    final TextEditingController nomeCtrl = TextEditingController(text: isEdit ? vendedorExistente['nome'] : '');
    final TextEditingController qtdCtrl = TextEditingController(text: isEdit ? vendedorExistente['qtd'].toString() : '');

    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          backgroundColor: const Color(0xFF1E1E2C),
          title: Text(isEdit ? 'Editar Distribuição' : 'Nova Distribuição', style: const TextStyle(color: Colors.white)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: nomeCtrl,
                style: const TextStyle(color: Colors.white),
                decoration: const InputDecoration(
                  labelText: 'Nome do Vendedor',
                  labelStyle: TextStyle(color: Colors.white54),
                  enabledBorder: UnderlineInputBorder(borderSide: BorderSide(color: Colors.white24)),
                  focusedBorder: UnderlineInputBorder(borderSide: BorderSide(color: Color(0xFFCE93D8))),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: qtdCtrl,
                style: const TextStyle(color: Colors.white),
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(
                  labelText: 'Quantidade de Capas',
                  labelStyle: TextStyle(color: Colors.white54),
                  enabledBorder: UnderlineInputBorder(borderSide: BorderSide(color: Colors.white24)),
                  focusedBorder: UnderlineInputBorder(borderSide: BorderSide(color: Color(0xFFCE93D8))),
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancelar', style: TextStyle(color: Colors.white54)),
            ),
            ElevatedButton(
              onPressed: () {
                final nome = nomeCtrl.text.trim();
                final qtd = int.tryParse(qtdCtrl.text.trim()) ?? 0;
                
                if (nome.isEmpty || qtd <= 0) {
                  ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Preencha os dados corretamente.', style: TextStyle(color: Colors.white)), backgroundColor: Colors.redAccent));
                  return;
                }

                setState(() {
                  if (isEdit) {
                    final int diferenca = qtd - (vendedorExistente['qtd'] as int);
                    if (_capasSede - diferenca < 0) {
                      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Estoque insuficiente na Sede.', style: TextStyle(color: Colors.white)), backgroundColor: Colors.redAccent));
                      return;
                    }
                    _capasSede -= diferenca;
                    final index = _vendedores.indexWhere((v) => v['id'] == vendedorExistente['id']);
                    if (index != -1) {
                      _vendedores[index]['nome'] = nome;
                      _vendedores[index]['qtd'] = qtd;
                    }
                  } else {
                    if (_capasSede - qtd < 0) {
                      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Estoque insuficiente na Sede.', style: TextStyle(color: Colors.white)), backgroundColor: Colors.redAccent));
                      return;
                    }
                    _capasSede -= qtd;
                    _vendedores.add({
                      'id': DateTime.now().millisecondsSinceEpoch.toString(),
                      'nome': nome,
                      'qtd': qtd,
                    });
                  }
                });
                Navigator.pop(context);
              },
              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFCE93D8)),
              child: const Text('Salvar', style: TextStyle(color: Colors.white)),
            ),
          ],
        );
      }
    );
  }
}

