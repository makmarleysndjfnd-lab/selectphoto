import 'package:flutter/material.dart';

class LedChoiceChip extends StatelessWidget {
  final String label;
  final bool selected;
  final Function(bool) onSelected;
  final Color color;
  final IconData? icon;

  const LedChoiceChip({
    Key? key,
    required this.label,
    required this.selected,
    required this.onSelected,
    this.color = const Color(0xFFCE93D8),
    this.icon,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final glowOpacity = selected ? 0.6 : 0.0;
    final blurRadius = selected ? 10.0 : 0.0;
    
    return GestureDetector(
      onTap: () => onSelected(!selected),
      child: Container(
        decoration: BoxDecoration(
          color: selected ? color.withOpacity(0.1) : const Color(0xFF1A1A2E),
          borderRadius: BorderRadius.circular(30),
          border: Border.all(
            color: selected ? color.withOpacity(0.8) : Colors.white24,
            width: 1.5,
          ),
          boxShadow: selected ? [
            BoxShadow(
              color: color.withOpacity(glowOpacity),
              blurRadius: blurRadius,
              spreadRadius: 1,
              offset: const Offset(0, 0),
            ),
          ] : [],
        ),
        padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (icon != null) ...[
              Icon(icon, color: selected ? color : Colors.white54, size: 18),
              const SizedBox(width: 8),
            ],
            Text(
              label,
              style: TextStyle(
                color: selected ? color : Colors.white54,
                fontWeight: selected ? FontWeight.bold : FontWeight.normal,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
