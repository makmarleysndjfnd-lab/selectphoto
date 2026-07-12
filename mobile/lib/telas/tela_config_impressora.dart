import 'package:flutter/material.dart';
import 'package:blue_thermal_printer/blue_thermal_printer.dart';
import 'package:flutter/services.dart';

class PrinterConfigScreen extends StatefulWidget {
  const PrinterConfigScreen({super.key});

  @override
  State<PrinterConfigScreen> createState() => _PrinterConfigScreenState();
}

class _PrinterConfigScreenState extends State<PrinterConfigScreen> {
  BlueThermalPrinter bluetooth = BlueThermalPrinter.instance;
  List<BluetoothDevice> _devices = [];
  BluetoothDevice? _device;
  bool _connected = false;

  @override
  void initState() {
    super.initState();
    initPlatformState();
  }

  Future<void> initPlatformState() async {
    bool? isConnected = await bluetooth.isConnected;
    List<BluetoothDevice> devices = [];
    try {
      devices = await bluetooth.getBondedDevices();
    } on PlatformException {
      // Ignore
    }

    bluetooth.onStateChanged().listen((state) {
      switch (state) {
        case BlueThermalPrinter.CONNECTED:
          setState(() {
            _connected = true;
          });
          break;
        case BlueThermalPrinter.DISCONNECTED:
          setState(() {
            _connected = false;
          });
          break;
        default:
          break;
      }
    });

    if (!mounted) return;
    setState(() {
      _devices = devices;
      if (isConnected == true) {
        _connected = true;
      }
    });
  }

  void _connect() {
    if (_device != null) {
      bluetooth.isConnected.then((isConnected) {
        if (isConnected != true) {
          bluetooth.connect(_device!).catchError((error) {
            setState(() => _connected = false);
            ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Falha ao conectar')));
          });
          setState(() => _connected = true);
          ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('Conectado com sucesso')));
        }
      });
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Selecione uma impressora')));
    }
  }

  void _disconnect() {
    bluetooth.disconnect();
    setState(() => _connected = false);
    ScaffoldMessenger.of(context)
        .showSnackBar(const SnackBar(content: Text('Desconectado')));
  }

  void _testPrint() async {
    bool? isConnected = await bluetooth.isConnected;
    if (isConnected == true) {
      bluetooth.printNewLine();
      bluetooth.printCustom("TESTE DE IMPRESSAO - LUMORA", 2, 1);
      bluetooth.printNewLine();
      bluetooth.printCustom("Parabens, sua impressora", 0, 1);
      bluetooth.printCustom("esta configurada!", 0, 1);
      bluetooth.printNewLine();
      bluetooth.printNewLine();
    } else {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Impressora não conectada')));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0D0D1A),
      appBar: AppBar(
        title: const Text('Configurar Impressora', style: TextStyle(color: Colors.white)),
        backgroundColor: const Color(0xFF1A0030),
        iconTheme: const IconThemeData(color: Colors.white),
      ),
      body: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'Impressoras Pareadas',
              style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 16),
            if (_devices.isEmpty)
              const Text('Nenhuma impressora encontrada. Pareie no Bluetooth do celular.',
                  style: TextStyle(color: Colors.white70)),
            if (_devices.isNotEmpty)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                decoration: BoxDecoration(
                  color: Colors.white10,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: DropdownButton<BluetoothDevice>(
                  items: _devices.map((device) {
                    return DropdownMenuItem(
                      value: device,
                      child: Text(device.name ?? 'Desconhecido',
                          style: const TextStyle(color: Colors.white)),
                    );
                  }).toList(),
                  onChanged: (value) {
                    setState(() {
                      _device = value;
                    });
                  },
                  value: _device,
                  dropdownColor: const Color(0xFF1E1E2C),
                  isExpanded: true,
                  underline: const SizedBox(),
                  hint: const Text('Selecione uma impressora',
                      style: TextStyle(color: Colors.white54)),
                ),
              ),
            const SizedBox(height: 24),
            Row(
              children: [
                Expanded(
                  child: ElevatedButton.icon(
                    onPressed: _connected ? _disconnect : _connect,
                    icon: Icon(_connected ? Icons.bluetooth_disabled : Icons.bluetooth_connected,
                        color: Colors.white),
                    label: Text(_connected ? 'Desconectar' : 'Conectar',
                        style: const TextStyle(color: Colors.white)),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: _connected ? Colors.redAccent : Colors.blueAccent,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            ElevatedButton.icon(
              onPressed: _connected ? _testPrint : null,
              icon: const Icon(Icons.print, color: Colors.white),
              label: const Text('Imprimir Teste', style: TextStyle(color: Colors.white)),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFFCE93D8),
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
