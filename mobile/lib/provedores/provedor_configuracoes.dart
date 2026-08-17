import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

class SettingsProvider with ChangeNotifier {
  bool _isDarkMode = true;
  String _serverUrl = 'https://selectphoto-k1ac.onrender.com/api';

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
    _serverUrl = prefs.getString('serverUrl') ?? 'https://selectphoto-k1ac.onrender.com/api';

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
    _serverUrl = url;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('serverUrl', url);
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

