import 'package:flutter/material.dart';

class LedMenuItem extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool selected;
  final VoidCallback onTap;
  final Color color;

  const LedMenuItem({
    Key? key,
    required this.icon,
    required this.label,
    required this.selected,
    required this.onTap,
    this.color = const Color(0xFFCE93D8), // Default purple
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final glowOpacity = selected ? 0.5 : 0.0;
    final blurRadius = selected ? 12.0 : 0.0;
    
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8.0, vertical: 4.0),
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          decoration: BoxDecoration(
            color: selected ? color.withOpacity(0.15) : Colors.transparent,
            borderRadius: BorderRadius.circular(30), // Pill shape
            border: Border.all(
              color: selected ? color.withOpacity(0.8) : Colors.transparent,
              width: 1.5,
            ),
            boxShadow: selected ? [
              BoxShadow(
                color: color.withOpacity(glowOpacity),
                blurRadius: blurRadius,
                spreadRadius: 2,
                offset: const Offset(0, 0),
              ),
            ] : [],
          ),
          child: Material(
            color: Colors.transparent,
            borderRadius: BorderRadius.circular(30),
            child: InkWell(
              borderRadius: BorderRadius.circular(30),
              splashColor: color.withOpacity(0.3),
              highlightColor: color.withOpacity(0.1),
              onTap: onTap,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 12.0),
                child: Row(
                  children: [
                    Icon(
                      icon,
                      color: selected ? color : const Color(0xFF546E7A),
                      size: 24,
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: Text(
                        label,
                        style: TextStyle(
                          color: selected ? Colors.white : const Color(0xFF546E7A),
                          fontWeight: selected ? FontWeight.bold : FontWeight.normal,
                          fontSize: 14,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
