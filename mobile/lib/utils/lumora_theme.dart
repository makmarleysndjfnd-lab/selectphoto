import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../widgets/led_input_decoration.dart';

class LumoraPalette {
  final bool isLight;
  final Color scaffoldBg;
  final Color surface;
  final Color surfaceAlt;
  final Color accent;
  final Color accentText;
  final Color textPrimary;
  final Color textSecondary;
  final Color border;
  final Color headerStart;
  final Color headerEnd;

  const LumoraPalette({
    required this.isLight,
    required this.scaffoldBg,
    required this.surface,
    required this.surfaceAlt,
    required this.accent,
    required this.accentText,
    required this.textPrimary,
    required this.textSecondary,
    required this.border,
    required this.headerStart,
    required this.headerEnd,
  });
}

class LumoraTheme {
  static bool isLight(BuildContext context) =>
      Theme.of(context).brightness == Brightness.light;

  static LumoraPalette of(BuildContext context, {bool isAdmin = false}) {
    final light = isLight(context);
    if (isAdmin) {
      if (light) {
        return const LumoraPalette(
          isLight: true,
          scaffoldBg: Color(0xFFF5F3FF),
          surface: Color(0xFFFFFFFF),
          surfaceAlt: Color(0xFFEDE9FE),
          accent: Color(0xFF7C3AED),
          accentText: Color(0xFF5B21B6),
          textPrimary: Color(0xFF1E1B4B),
          textSecondary: Color(0xFF475569),
          border: Color(0xFFDDD6FE),
          headerStart: Color(0xFF5B21B6),
          headerEnd: Color(0xFF7C3AED),
        );
      }
      return LumoraPalette(
        isLight: false,
        scaffoldBg: const Color(0xFF0D0714),
        surface: const Color(0xFF160D24),
        surfaceAlt: const Color(0xFF2A1247),
        accent: const Color(0xFFA855F7),
        accentText: const Color(0xFFD8B4FE),
        textPrimary: Colors.white,
        textSecondary: Colors.white70,
        border: const Color(0xFFA855F7).withOpacity(0.32),
        headerStart: const Color(0xFF1A0030),
        headerEnd: const Color(0xFF3A0068),
      );
    }

    if (light) {
      return const LumoraPalette(
        isLight: true,
        scaffoldBg: Color(0xFFF1F5F9),
        surface: Color(0xFFFFFFFF),
        surfaceAlt: Color(0xFFE2E8F0),
        accent: Color(0xFF0284C7),
        accentText: Color(0xFF0369A1),
        textPrimary: Color(0xFF0F172A),
        textSecondary: Color(0xFF475569),
        border: Color(0xFFCBD5E1),
        headerStart: Color(0xFF0369A1),
        headerEnd: Color(0xFF0284C7),
      );
    }

    return LumoraPalette(
      isLight: false,
      scaffoldBg: const Color(0xFF0F1923),
      surface: const Color(0xFF1A2634),
      surfaceAlt: const Color(0xFF13273A),
      accent: const Color(0xFF00E5FF),
      accentText: const Color(0xFF4FC3F7),
      textPrimary: Colors.white,
      textSecondary: Colors.white70,
      border: const Color(0xFF4FC3F7).withOpacity(0.3),
      headerStart: const Color(0xFF0D1B2A),
      headerEnd: const Color(0xFF0D3B6E),
    );
  }
}

ThemeData buildLumoraLightTheme() {
  const scaffoldBg = Color(0xFFF5F3FF);
  const surface = Color(0xFFFFFFFF);
  const primary = Color(0xFF7C3AED);
  const textPrimary = Color(0xFF1E1B4B);

  return ThemeData(
    useMaterial3: true,
    brightness: Brightness.light,
    scaffoldBackgroundColor: scaffoldBg,
    colorScheme: ColorScheme.fromSeed(
      seedColor: primary,
      brightness: Brightness.light,
      surface: surface,
    ),
    cardColor: surface,
    dividerColor: const Color(0xFFE2E8F0),
    appBarTheme: const AppBarTheme(
      backgroundColor: Color(0xFF5B21B6),
      foregroundColor: Colors.white,
      iconTheme: IconThemeData(color: Colors.white),
      elevation: 0,
    ),
    dialogTheme: const DialogTheme(
      backgroundColor: surface,
      titleTextStyle: TextStyle(
        color: textPrimary,
        fontSize: 18,
        fontWeight: FontWeight.bold,
      ),
      contentTextStyle: TextStyle(
        color: Color(0xFF334155),
        fontSize: 14,
      ),
    ),
    textTheme: GoogleFonts.interTextTheme(ThemeData.light().textTheme).apply(
      bodyColor: textPrimary,
      displayColor: textPrimary,
    ),
    inputDecorationTheme: LedInputDecoration.build(
      brightness: Brightness.light,
      color: primary,
    ),
    pageTransitionsTheme: const PageTransitionsTheme(
      builders: {
        TargetPlatform.android: ZoomPageTransitionsBuilder(),
        TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
        TargetPlatform.windows: ZoomPageTransitionsBuilder(),
        TargetPlatform.macOS: ZoomPageTransitionsBuilder(),
        TargetPlatform.linux: ZoomPageTransitionsBuilder(),
      },
    ),
  );
}

ThemeData buildLumoraDarkTheme() {
  const scaffoldBg = Color(0xFF0D0714);
  const primary = Color(0xFFA855F7);

  return ThemeData(
    useMaterial3: true,
    brightness: Brightness.dark,
    scaffoldBackgroundColor: scaffoldBg,
    colorScheme: ColorScheme.fromSeed(
      seedColor: primary,
      brightness: Brightness.dark,
    ),
    cardColor: const Color(0xFF160D24),
    textTheme: GoogleFonts.interTextTheme(ThemeData.dark().textTheme),
    inputDecorationTheme: LedInputDecoration.build(
      brightness: Brightness.dark,
      color: const Color(0xFFCE93D8),
    ),
    pageTransitionsTheme: const PageTransitionsTheme(
      builders: {
        TargetPlatform.android: ZoomPageTransitionsBuilder(),
        TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
        TargetPlatform.windows: ZoomPageTransitionsBuilder(),
        TargetPlatform.macOS: ZoomPageTransitionsBuilder(),
        TargetPlatform.linux: ZoomPageTransitionsBuilder(),
      },
    ),
  );
}
