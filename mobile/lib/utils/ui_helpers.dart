import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

class UIHelpers {
  static String getGreeting() {
    final hour = DateTime.now().hour;
    if (hour < 12) {
      return 'Bom dia';
    } else if (hour < 18) {
      return 'Boa tarde';
    } else {
      return 'Boa noite';
    }
  }

  static Future<String> getUserName() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString('user_name') ?? 'Usuário';
  }

  static Future<String?> getUserId() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString('user_id');
  }

  static Color getStatusColor(String? status, {bool isAgenda = false}) {
    if (isAgenda) {
      return const Color(0xFF00E5FF); // Cyan for agenda items by default
    }
    
    if (status == null) return const Color(0xFF00E5FF); // Default Cyan

    final upperStatus = status.toUpperCase();
    switch (upperStatus) {
      case 'APPROVED':
      case 'FECHADO':
      case 'FINALIZADO':
      case 'CONCLUÍDO':
      case 'APROVADA':
        return const Color(0xFF00FF00); // Green
      case 'PENDING':
      case 'AGENDADO':
      case 'EM_NEGOCIACAO':
      case 'EM_ANDAMENTO':
      case 'PENDENTE':
        return const Color(0xFFFFD700); // Yellow/Gold
      case 'REJECTED':
      case 'CANCELADO':
      case 'REPROVADA':
        return const Color(0xFFFF0000); // Red
      default:
        return const Color(0xFF00E5FF); // Default Cyan
    }
  }

  static BoxDecoration getLedDecoration(String? status, {bool isAgenda = false}) {
    final color = getStatusColor(status, isAgenda: isAgenda);
    return BoxDecoration(
      color: const Color(0xFF1E1E2C),
      borderRadius: BorderRadius.circular(12),
      border: Border.all(color: color.withOpacity(0.5), width: 1.5),
      boxShadow: [
        BoxShadow(
          color: color.withOpacity(0.3),
          blurRadius: 8,
          spreadRadius: 1,
        ),
      ],
    );
  }

  static String formatChild(dynamic child) {
    if (child == null) return '';
    if (child is! Map) {
      return child.toString().trim();
    }
    final name = (child['name'] ?? '').toString().trim();
    final ageRaw = child['age'];
    if (ageRaw != null) {
      final ageStr = ageRaw.toString().trim();
      if (ageStr.isNotEmpty) {
        final ageNum = int.tryParse(ageStr);
        if (ageNum != null) {
          final unit = ageNum == 1 ? 'ano' : 'anos';
          return name.isNotEmpty ? '$name — $ageNum $unit' : '$ageNum $unit';
        }
      }
    }
    return name;
  }

  static String formatChildren(dynamic children) {
    if (children == null) return '';
    if (children is String) return children;
    if (children is List) {
      final formatted = children
          .map(formatChild)
          .where((s) => s.isNotEmpty)
          .toList();
      return formatted.join(', ');
    }
    return '';
  }
}
