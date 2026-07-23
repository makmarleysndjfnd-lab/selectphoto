const fs = require('fs');
const path = 'mobile/lib/telas/painel_admin.dart';

let content = fs.readFileSync(path, 'utf8');

const regex = /child: Container\([\s\S]*?width: 44,[\s\S]*?height: 44,[\s\S]*?decoration: BoxDecoration\([\s\S]*?color: _accentPurple,[\s\S]*?borderRadius: BorderRadius\.circular\(14\),[\s\S]*?boxShadow: \[[\s\S]*?BoxShadow\([\s\S]*?color: _accentPurple\.withOpacity\(0\.5\),[\s\S]*?blurRadius: 14,[\s\S]*?offset: const Offset\(0, 4\)\),[\s\S]*?\],[\s\S]*?\),[\s\S]*?child: const Icon\(Icons\.admin_panel_settings_rounded,[\s\S]*?color: Colors\.white, size: 22\),[\s\S]*?\),/;

const replacement = `child: Container(
                        width: 50,
                        height: 50,
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(10),
                          boxShadow: [
                            BoxShadow(
                                color: _accentPurple.withOpacity(0.5),
                                blurRadius: 10,
                                offset: const Offset(0, 4)),
                          ],
                        ),
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(10),
                          child: Padding(
                            padding: const EdgeInsets.all(4.0),
                            child: Image.asset(
                              'assets/images/logo_hiper.png',
                              fit: BoxFit.contain,
                              errorBuilder: (context, error, stackTrace) =>
                                  const Icon(Icons.business, color: _accentPurple),
                            ),
                          ),
                        ),
                      ),`;

content = content.replace(regex, replacement);

fs.writeFileSync(path, content, 'utf8');
console.log('Logo patched');
