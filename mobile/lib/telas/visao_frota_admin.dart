import 'package:flutter/material.dart';

class FleetAdminView extends StatefulWidget {
  const FleetAdminView({super.key});

  @override
  State<FleetAdminView> createState() => _FleetAdminViewState();
}

class _FleetAdminViewState extends State<FleetAdminView> {
  // Mock data representing backend response
  final List<Map<String, dynamic>> _cars = [
    {
      'id': '1',
      'plate': 'ABC-1234',
      'model': 'Fiat Uno 2021',
      'status': 'AVAILABLE',
      'currentUserId': null,
      'currentUser': null,
      'nextOilChangeKm': 50000,
      'pendingMaintenance': '',
      'warrantyParts': 'Motor até 2026',
      'lastMileage': 41000, // From latest checklist
    },
    {
      'id': '2',
      'plate': 'XYZ-9876',
      'model': 'Chevrolet Onix 2022',
      'status': 'IN_USE',
      'currentUserId': 'user_1',
      'currentUser': {'name': 'Carlos Lima', 'team': {'prefix': 'EQP1'}},
      'nextOilChangeKm': 35000,
      'pendingMaintenance': '',
      'warrantyParts': '',
      'lastMileage': 34500, // Close to oil change!
    },
    {
      'id': '3',
      'plate': 'DEF-5678',
      'model': 'VW Gol 2020',
      'status': 'MAINTENANCE',
      'currentUserId': null,
      'currentUser': null,
      'nextOilChangeKm': 60000,
      'pendingMaintenance': 'Troca de pastilha de freio pendente',
      'warrantyParts': 'Câmbio',
      'lastMileage': 60500, // Expired oil change!
    },
  ];

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'Gestão da Frota',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 20,
                  fontWeight: FontWeight.bold,
                ),
              ),
              ElevatedButton.icon(
                onPressed: () {},
                icon: const Icon(Icons.add, color: Colors.white),
                label: const Text('Novo Veículo', style: TextStyle(color: Colors.white)),
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF9C27B0),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
              ),
            ],
          ),
          const SizedBox(height: 24),
          Wrap(
            spacing: 16,
            runSpacing: 16,
            children: _cars.map((car) => _buildCarCard(car)).toList(),
          ),
        ],
      ),
    );
  }

  Widget _buildCarCard(Map<String, dynamic> car) {
    // Determine Status Colors
    final isMaintenancePending = car['pendingMaintenance'].toString().isNotEmpty;
    final int nextOil = car['nextOilChangeKm'] as int;
    final int currentKm = car['lastMileage'] as int;
    
    // Logic for color statuses
    // GREEN: OK
    // YELLOW: Close to oil change (less than 1000km)
    // RED: Passed oil change OR has pending maintenance
    Color statusColor = Colors.green;
    String statusText = 'Manutenção em Dia';
    IconData statusIcon = Icons.check_circle_rounded;

    if (isMaintenancePending) {
      statusColor = Colors.red;
      statusText = 'Manutenção Pendente';
      statusIcon = Icons.build_circle_rounded;
    } else if (currentKm >= nextOil) {
      statusColor = Colors.red;
      statusText = 'Óleo Vencido!';
      statusIcon = Icons.warning_rounded;
    } else if ((nextOil - currentKm) <= 1000) {
      statusColor = Colors.amber;
      statusText = 'Próximo à Troca';
      statusIcon = Icons.info_rounded;
    }

    final inUse = car['status'] == 'IN_USE';
    final userName = car['currentUser']?['name'] ?? '';
    final teamPrefix = car['currentUser']?['team']?['prefix'] ?? '';

    return Container(
      width: 320,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A2E),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: statusColor.withOpacity(0.5), width: 2),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                car['plate'],
                style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: statusColor.withOpacity(0.2),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(statusIcon, color: statusColor, size: 14),
                    const SizedBox(width: 4),
                    Text(statusText, style: TextStyle(color: statusColor, fontSize: 11, fontWeight: FontWeight.bold)),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            car['model'],
            style: const TextStyle(color: Color(0xFF90CAF9), fontSize: 13),
          ),
          const SizedBox(height: 16),
          _infoRow(Icons.speed_rounded, 'KM Atual: $currentKm km'),
          const SizedBox(height: 4),
          _infoRow(Icons.oil_barrel_rounded, 'Troca Óleo: $nextOil km'),
          if (car['warrantyParts'].toString().isNotEmpty) ...[
            const SizedBox(height: 4),
            _infoRow(Icons.verified_rounded, 'Garantia: ${car['warrantyParts']}', color: Colors.blueAccent),
          ],
          if (isMaintenancePending) ...[
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(color: Colors.red.withOpacity(0.1), borderRadius: BorderRadius.circular(8)),
              child: Text(
                'Atenção: ${car['pendingMaintenance']}',
                style: const TextStyle(color: Colors.redAccent, fontSize: 12),
              ),
            ),
          ],
          const SizedBox(height: 16),
          const Divider(color: Colors.white12),
          const SizedBox(height: 8),
          Row(
            children: [
              Icon(
                inUse ? Icons.person_rounded : Icons.local_parking_rounded,
                color: inUse ? const Color(0xFFCE93D8) : Colors.green,
                size: 18,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  inUse ? 'Com: $userName ($teamPrefix)' : 'Veículo Livre (Garagem)',
                  style: TextStyle(
                    color: inUse ? const Color(0xFFCE93D8) : Colors.green,
                    fontSize: 13,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _infoRow(IconData icon, String text, {Color color = const Color(0xFF546E7A)}) {
    return Row(
      children: [
        Icon(icon, color: color, size: 16),
        const SizedBox(width: 6),
        Text(text, style: TextStyle(color: color == const Color(0xFF546E7A) ? Colors.white70 : color, fontSize: 13)),
      ],
    );
  }
}
