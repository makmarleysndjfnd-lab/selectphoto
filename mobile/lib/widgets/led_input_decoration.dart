import 'package:flutter/material.dart';

class LedInputDecoration {
  static InputDecorationTheme build({
    Color color = const Color(0xFFCE93D8),
    Brightness brightness = Brightness.dark,
  }) {
    final isLight = brightness == Brightness.light;
    return InputDecorationTheme(
      labelStyle: TextStyle(color: isLight ? const Color(0xFF475569) : Colors.white70),
      hintStyle: TextStyle(color: isLight ? const Color(0xFF94A3B8) : Colors.white38),
      filled: true,
      fillColor: isLight ? Colors.white : const Color(0xFF1A1A2E),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(30),
        borderSide: BorderSide(
          color: isLight ? const Color(0xFFCBD5E1) : color.withOpacity(0.3),
          width: 1,
        ),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(30),
        borderSide: BorderSide(color: color, width: 2),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(30),
        borderSide: const BorderSide(color: Colors.redAccent, width: 1),
      ),
      focusedErrorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(30),
        borderSide: const BorderSide(color: Colors.redAccent, width: 2),
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
    );
  }
}
