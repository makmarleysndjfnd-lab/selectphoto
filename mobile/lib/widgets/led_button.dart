import 'package:flutter/material.dart';

class LedButton extends StatefulWidget {
  final String text;
  final VoidCallback onPressed;
  final Color color;
  final IconData? icon;
  final bool isDestructive; // will force red/orange
  final bool isSuccess;     // will force green

  const LedButton({
    Key? key,
    required this.text,
    required this.onPressed,
    this.color = const Color(0xFFCE93D8), // Default purple
    this.icon,
    this.isDestructive = false,
    this.isSuccess = false,
  }) : super(key: key);

  @override
  _LedButtonState createState() => _LedButtonState();
}

class _LedButtonState extends State<LedButton> {
  bool _isHovering = false;
  bool _isPressed = false;

  Color get _effectiveColor {
    if (widget.isDestructive) return Colors.redAccent;
    if (widget.isSuccess) return Colors.greenAccent;
    return widget.color;
  }

  @override
  Widget build(BuildContext context) {
    // Increase glow based on hover/press
    final glowOpacity = _isPressed ? 0.8 : (_isHovering ? 0.5 : 0.2);
    final blurRadius = _isPressed ? 15.0 : (_isHovering ? 10.0 : 4.0);
    
    return MouseRegion(
      onEnter: (_) => setState(() => _isHovering = true),
      onExit: (_) => setState(() => _isHovering = false),
      child: GestureDetector(
        onTapDown: (_) => setState(() => _isPressed = true),
        onTapUp: (_) => setState(() => _isPressed = false),
        onTapCancel: () => setState(() => _isPressed = false),
        child: Container(
          decoration: BoxDecoration(
            color: const Color(0xFF1A1A2E), // Dark background matching app
            borderRadius: BorderRadius.circular(30), // Pill shape
            border: Border.all(
              color: _effectiveColor.withOpacity(glowOpacity * 1.5 > 1 ? 1 : glowOpacity * 1.5),
              width: 1.5,
            ),
            boxShadow: [
              BoxShadow(
                color: _effectiveColor.withOpacity(glowOpacity),
                blurRadius: blurRadius,
                spreadRadius: 2,
                offset: const Offset(0, 0), // glow in all directions
              ),
            ],
          ),
          child: Material(
            color: Colors.transparent,
            borderRadius: BorderRadius.circular(30),
            child: InkWell(
              borderRadius: BorderRadius.circular(30),
              splashColor: _effectiveColor.withOpacity(0.3),
              highlightColor: _effectiveColor.withOpacity(0.1),
              onTap: widget.onPressed,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 24.0, vertical: 12.0),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    if (widget.icon != null) ...[
                      Icon(widget.icon, color: _effectiveColor, size: 20),
                      const SizedBox(width: 8),
                    ],
                    Text(
                      widget.text,
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.bold,
                        letterSpacing: 1.1,
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
