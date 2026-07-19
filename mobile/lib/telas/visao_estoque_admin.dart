import 'package:flutter/material.dart';
import '../servicos/servico_api.dart';

class VisaoEstoqueAdmin extends StatefulWidget {
  const VisaoEstoqueAdmin({super.key});

  @override
  State<VisaoEstoqueAdmin> createState() => _VisaoEstoqueAdminState();
}

class _VisaoEstoqueAdminState extends State<VisaoEstoqueAdmin> {
  List<dynamic> _clients = [];
  List<dynamic> _editRequests = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadClients();
  }

  Future<void> _loadClients() async {
    try {
      final api = ApiService();
      final responses = await Future.wait([
        api.getAllClients(),
        api.getPendingEditRequests()
      ]);
      if (mounted) {
        setState(() {
          _clients = responses[0] as List<dynamic>;
          _editRequests = responses[1] as List<dynamic>;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() => _isLoading = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro ao carregar books: $e')));
      }
    }
  }

  int get _totalBooks => _clients.length;
  int get _booksAguardando => _clients.where((c) => c['releasedForRouting'] != true).length;
  int get _booksLiberados => _clients.where((c) => c['releasedForRouting'] == true).length;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0D0D1A),
      appBar: AppBar(
        title: const Text('Books Produzidos', style: TextStyle(color: Colors.white)),
        backgroundColor: const Color(0xFF1A0030),
        iconTheme: const IconThemeData(color: Colors.white),
      ),
      body: _isLoading 
        ? const Center(child: CircularProgressIndicator(color: Color(0xFFCE93D8)))
        : SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                 Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('Visão Geral dos Books', style: TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold)),
                    IconButton(
                      icon: const Icon(Icons.refresh, color: Colors.white),
                      onPressed: () {
                        setState(() => _isLoading = true);
                        _loadClients();
                      },
                    )
                  ]
                ),
                const SizedBox(height: 20),
                _buildResumoGeral(),
                const SizedBox(height: 20),
                if (_editRequests.isNotEmpty) _buildEditRequestsCard(),
                if (_editRequests.isNotEmpty) const SizedBox(height: 20),
                _buildListaBooks(),
                const SizedBox(height: 40),
              ],
            ),
          ),
    );
  }

  Future<void> _aprovarSolicitacao(String id) async {
    try {
      await ApiService().approveEditRequest(id);
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Solicitação aprovada.'), backgroundColor: Colors.green));
      _loadClients();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro: $e'), backgroundColor: Colors.red));
    }
  }

  Future<void> _rejeitarSolicitacao(String id) async {
    try {
      await ApiService().rejectEditRequest(id);
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Solicitação rejeitada.'), backgroundColor: Colors.orange));
      _loadClients();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro: $e'), backgroundColor: Colors.red));
    }
  }

  Widget _buildEditRequestsCard() {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: const Color(0xFF1E1E2C),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.orangeAccent.withOpacity(0.5)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.warning_amber_rounded, color: Colors.orangeAccent),
              const SizedBox(width: 8),
              Text('${_editRequests.length} Solicitações de Edição Pendentes', style: const TextStyle(color: Colors.orangeAccent, fontSize: 18, fontWeight: FontWeight.bold)),
            ],
          ),
          const SizedBox(height: 16),
          ..._editRequests.map((req) {
            final client = req['client'] ?? {};
            final proposedData = req['proposedData'] ?? {};
            final photographer = req['photographer'] ?? {};
            return Card(
              color: const Color(0xFF2A2A3C),
              margin: const EdgeInsets.only(bottom: 12),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Ficha: ${client['sequenceNumber'] ?? 'S/N'} - Fotógrafo: ${photographer['name'] ?? 'Desconhecido'}', style: const TextStyle(color: Color(0xFFCE93D8), fontWeight: FontWeight.bold)),
                    const SizedBox(height: 4),
                    Text('Motivo: ${req['reason'] ?? 'Não informado'}', style: const TextStyle(color: Colors.white, fontStyle: FontStyle.italic)),
                    const SizedBox(height: 8),
                    _buildComparativo('Valor R\$', client['price']?.toString(), proposedData['price']?.toString()),
                    const SizedBox(height: 8),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        TextButton.icon(
                          onPressed: () => _rejeitarSolicitacao(req['id']),
                          icon: const Icon(Icons.close, color: Colors.redAccent, size: 16),
                          label: const Text('Rejeitar', style: TextStyle(color: Colors.redAccent)),
                        ),
                        const SizedBox(width: 8),
                        ElevatedButton.icon(
                          onPressed: () => _aprovarSolicitacao(req['id']),
                          icon: const Icon(Icons.check, color: Colors.black, size: 16),
                          label: const Text('Aprovar', style: TextStyle(color: Colors.black, fontWeight: FontWeight.bold)),
                          style: ElevatedButton.styleFrom(backgroundColor: Colors.greenAccent),
                        ),
                      ],
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

  Widget _buildComparativo(String label, String? atual, String? proposto) {
    if (proposto == null || proposto.isEmpty || atual == proposto) return const SizedBox.shrink();
    return Row(
      children: [
        Text('$label Atual: ', style: const TextStyle(color: Colors.white54, fontSize: 12)),
        Text(atual ?? 'Vazio', style: const TextStyle(color: Colors.white38, decoration: TextDecoration.lineThrough, fontSize: 12)),
        const Padding(padding: EdgeInsets.symmetric(horizontal: 8), child: Icon(Icons.arrow_forward_rounded, color: Colors.white24, size: 14)),
        Text('Novo: ', style: const TextStyle(color: Colors.greenAccent, fontSize: 12)),
        Text(proposto, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 12)),
      ],
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
          const Text('Resumo de Produção', style: TextStyle(color: Color(0xFFCE93D8), fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              _infoBox('Total Produzido', '$_totalBooks', Colors.blueAccent),
              _infoBox('Aguardando Rota', '$_booksAguardando', Colors.orangeAccent),
              _infoBox('Liberado p/ Rota', '$_booksLiberados', Colors.greenAccent),
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

  Widget _buildListaBooks() {
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
          const Text('Todos os Books Produzidos', style: TextStyle(color: Color(0xFFCE93D8), fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          if (_clients.isEmpty)
            const Text('Nenhum book foi produzido ainda.', style: TextStyle(color: Colors.white54)),
          ..._clients.map((c) {
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
                title: Text('$name', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                subtitle: Text('Ficha: $seq | Cidade: $city', style: const TextStyle(color: Colors.white70, fontSize: 12)),
                trailing: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: isReleased ? Colors.green.withOpacity(0.2) : Colors.orange.withOpacity(0.2),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    isReleased ? 'Liberado' : 'Aguardando',
                    style: TextStyle(
                      color: isReleased ? Colors.greenAccent : Colors.orangeAccent,
                      fontSize: 12,
                      fontWeight: FontWeight.bold
                    )
                  ),
                ),
              ),
            );
          }),
        ],
      )
    );
  }
}

