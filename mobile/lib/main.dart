import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'servicos/servico_api.dart';
import 'servicos/servico_sincronizacao.dart';
import 'provedores/provedor_configuracoes.dart';
import 'telas/tela_login.dart';

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
    print("FCM Token: $token");
    // TODO: Send this token to the backend
  } catch (e) {
    print("Firebase init failed (maybe missing google-services.json): $e");
  }

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

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return Consumer<SettingsProvider>(
      builder: (context, settings, child) {
        return MaterialApp(
          title: 'Central Fotográfica',
          debugShowCheckedModeBanner: false,
          theme: ThemeData(
            colorScheme: ColorScheme.fromSeed(
              seedColor: const Color(0xFF0288D1),
              brightness: settings.isDarkMode ? Brightness.dark : Brightness.light,
            ),
            useMaterial3: true,
            fontFamily: 'Roboto',
          ),
          home: const LoginScreen(),
        );
      },
    );
  }
}
