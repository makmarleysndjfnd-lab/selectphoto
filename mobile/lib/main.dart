import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';

import 'servicos/servico_api.dart';
import 'servicos/servico_sincronizacao.dart';
import 'servicos/servico_notificacoes_agenda.dart';
import 'provedores/provedor_configuracoes.dart';
import 'telas/tela_login.dart';
import 'widgets/led_input_decoration.dart';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';

@pragma('vm:entry-point')
Future<void> _firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp();
  print("Handling a background message: ${message.messageId}");
}

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  try {
    await Firebase.initializeApp();
    FirebaseMessaging.onBackgroundMessage(_firebaseMessagingBackgroundHandler);
    
    // Request permission
    final messaging = FirebaseMessaging.instance;
    await messaging.requestPermission(
      alert: true,
      badge: true,
      sound: true,
    );

    // Get FCM token
    final token = await messaging.getToken();
    if (token != null) {
      // Token will be synced securely via ApiService without logging
    }
  } catch (e) {
    // Silent fail for missing Firebase in local environment
  }

  try {
    await ServicoNotificacoesAgenda().inicializar();
  } catch (_) {}

  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => SettingsProvider()),
        ProxyProvider<SettingsProvider, ApiService>(
          update: (context, settings, previous) {
            final apiService = previous ?? ApiService();
            apiService.updateBaseUrl(settings.serverUrl);
            return apiService;
          },
        ),
        ChangeNotifierProxyProvider<ApiService, SyncService>(
          create: (context) => SyncService(context.read<ApiService>()),
          update: (context, apiService, previous) => previous ?? SyncService(apiService),
        ),
      ],
      child: const MyApp(),
    ),
  );
}

final GlobalKey<NavigatorState> rootNavigatorKey = GlobalKey<NavigatorState>();
final GlobalKey<ScaffoldMessengerState> rootScaffoldMessengerKey = GlobalKey<ScaffoldMessengerState>();

class MyApp extends StatefulWidget {
  const MyApp({super.key});

  @override
  State<MyApp> createState() => _MyAppState();
}

class _MyAppState extends State<MyApp> {
  bool _isRedirectingSession = false;

  @override
  void initState() {
    super.initState();
    ApiService.onSessionReplacedByOtherDevice = (String message) {
      if (_isRedirectingSession) return;
      _isRedirectingSession = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        rootNavigatorKey.currentState?.pushAndRemoveUntil(
          MaterialPageRoute(builder: (_) => const LoginScreen()),
          (route) => false,
        );
        rootScaffoldMessengerKey.currentState?.showSnackBar(
          SnackBar(
            content: Text(
              message,
              style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
            ),
            backgroundColor: const Color(0xFFE53935),
            behavior: SnackBarBehavior.floating,
            duration: const Duration(seconds: 5),
          ),
        );
        Future.delayed(const Duration(seconds: 2), () {
          _isRedirectingSession = false;
        });
      });
    };
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<SettingsProvider>(
      builder: (context, settings, child) {
        return MaterialApp(
          title: 'Lumora',
          navigatorKey: rootNavigatorKey,
          scaffoldMessengerKey: rootScaffoldMessengerKey,
          debugShowCheckedModeBanner: false,
          theme: ThemeData(
            colorScheme: ColorScheme.fromSeed(
              seedColor: const Color(0xFF0288D1),
              brightness: settings.isDarkMode ? Brightness.dark : Brightness.light,
            ),
            useMaterial3: true,
            textTheme: GoogleFonts.interTextTheme(
              settings.isDarkMode ? ThemeData.dark().textTheme : ThemeData.light().textTheme,
            ),
            inputDecorationTheme: LedInputDecoration.build(),
            pageTransitionsTheme: const PageTransitionsTheme(
              builders: {
                TargetPlatform.android: ZoomPageTransitionsBuilder(),
                TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
                TargetPlatform.windows: ZoomPageTransitionsBuilder(),
                TargetPlatform.macOS: ZoomPageTransitionsBuilder(),
                TargetPlatform.linux: ZoomPageTransitionsBuilder(),
              },
            ),
          ),
          home: const LoginScreen(),
        );
      },
    );
  }
}
