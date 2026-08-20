import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../config/app_config.dart';

class SettingsProvider with ChangeNotifier {
  bool _isDarkMode = true;
  String _serverUrl = AppConfig.serverUrl;

  // ROI Default Parameters
  double _hotelCostPerPersonDay = 70.0;
  double _foodCostPerPersonDay = 50.0;
  double _fuelCostPerKm = 0.60;
  double _productCost = 21.0;
  double _defaultTicket = 150.0;
  int _defaultFichasPerDay = 30;

  bool get isDarkMode => _isDarkMode;
  String get serverUrl => _serverUrl;

  double get hotelCostPerPersonDay => _hotelCostPerPersonDay;
  double get foodCostPerPersonDay => _foodCostPerPersonDay;
  double get fuelCostPerKm => _fuelCostPerKm;
  double get productCost => _productCost;
  double get defaultTicket => _defaultTicket;
  int get defaultFichasPerDay => _defaultFichasPerDay;

  SettingsProvider() {
    _loadSettings();
  }

  Future<void> _loadSettings() async {
    final prefs = await SharedPreferences.getInstance();
    _isDarkMode = prefs.getBool('isDarkMode') ?? true;
    
    // Limpeza mandatória de chave serverUrl legada em SharedPreferences em modo release
    if (kReleaseMode) {
      if (prefs.containsKey('serverUrl')) {
        await prefs.remove('serverUrl');
      }
      _serverUrl = AppConfig.serverUrl;
    } else {
      final savedUrl = prefs.getString('serverUrl');
      if (savedUrl != null && savedUrl.trim().isNotEmpty) {
        try {
          _serverUrl = AppConfig.validateUrl(savedUrl, isRelease: false);
        } catch (_) {
          _serverUrl = AppConfig.serverUrl;
        }
      } else {
        _serverUrl = AppConfig.serverUrl;
      }
    }

    _hotelCostPerPersonDay = prefs.getDouble('hotelCostPerPersonDay') ?? 70.0;
    _foodCostPerPersonDay = prefs.getDouble('foodCostPerPersonDay') ?? 50.0;
    _fuelCostPerKm = prefs.getDouble('fuelCostPerKm') ?? 0.60;
    _productCost = prefs.getDouble('productCost') ?? 21.0;
    _defaultTicket = prefs.getDouble('defaultTicket') ?? 150.0;
    _defaultFichasPerDay = prefs.getInt('defaultFichasPerDay') ?? 30;

    notifyListeners();
  }

  Future<void> setDarkMode(bool value) async {
    _isDarkMode = value;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('isDarkMode', value);
    notifyListeners();
  }

  Future<void> setServerUrl(String url) async {
    // Bloqueia qualquer alteração em release mode
    if (kReleaseMode) {
      return;
    }
    final validated = AppConfig.validateUrl(url, isRelease: false);
    _serverUrl = validated;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('serverUrl', validated);
    notifyListeners();
  }

  Future<void> resetToDefaultServerUrl() async {
    if (kReleaseMode) return;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('serverUrl');
    _serverUrl = AppConfig.serverUrl;
    notifyListeners();
  }

  Future<void> updateRoiSettings({
    required double hotelCost,
    required double foodCost,
    required double fuelKmCost,
    required double prodCost,
    required double ticket,
    required int fichasPerDay,
  }) async {
    _hotelCostPerPersonDay = hotelCost;
    _foodCostPerPersonDay = foodCost;
    _fuelCostPerKm = fuelKmCost;
    _productCost = prodCost;
    _defaultTicket = ticket;
    _defaultFichasPerDay = fichasPerDay;

    final prefs = await SharedPreferences.getInstance();
    await prefs.setDouble('hotelCostPerPersonDay', hotelCost);
    await prefs.setDouble('foodCostPerPersonDay', foodCost);
    await prefs.setDouble('fuelCostPerKm', fuelKmCost);
    await prefs.setDouble('productCost', prodCost);
    await prefs.setDouble('defaultTicket', ticket);
    await prefs.setInt('defaultFichasPerDay', fichasPerDay);

    notifyListeners();
  }
}
