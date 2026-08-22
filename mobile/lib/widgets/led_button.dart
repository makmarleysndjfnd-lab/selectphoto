import 'package:flutter/material.dart';

class LedButton extends StatefulWidget {
  final VoidCallback? onPressed;
  final Widget? child;
  final String? text;
  final Color color;
  final IconData? icon;
  final Widget? iconWidget;
  final bool isDestructive;
  final bool isSuccess;
  final ButtonStyle? style;

  const LedButton({
    Key? key,
    required this.onPressed,
    this.child,
    this.text,
    this.color = const Color(0xFFCE93D8),
    this.icon,
    this.iconWidget,
    this.isDestructive = false,
    this.isSuccess = false,
    this.style,
  }) : super(key: key);

  const LedButton.icon({
    Key? key,
    required this.onPressed,
    required Widget icon,
    required Widget label,
    this.color = const Color(0xFFCE93D8),
    this.isDestructive = false,
    this.isSuccess = false,
    this.style,
  }) : child = label, text = null, iconWidget = icon, this.icon = null, super(key: key);

  static ButtonStyle styleFrom({
    Color? backgroundColor,
    Color? foregroundColor,
    Color? disabledBackgroundColor,
    Color? disabledForegroundColor,
    Color? shadowColor,
    double? elevation,
    TextStyle? textStyle,
    EdgeInsetsGeometry? padding,
    Size? minimumSize,
    Size? fixedSize,
    Size? maximumSize,
    BorderSide? side,
    OutlinedBorder? shape,
    AlignmentGeometry? alignment,
  }) {
    return ElevatedButton.styleFrom(
      backgroundColor: backgroundColor,
      foregroundColor: foregroundColor,
      disabledBackgroundColor: disabledBackgroundColor,
      disabledForegroundColor: disabledForegroundColor,
      shadowColor: shadowColor,
      elevation: elevation,
      textStyle: textStyle,
      padding: padding,
      minimumSize: minimumSize,
      fixedSize: fixedSize,
      maximumSize: maximumSize,
      side: side,
      shape: shape,
      alignment: alignment,
    );
  }

  @override
  _LedButtonState createState() => _LedButtonState();
}

class _LedButtonState extends State<LedButton> {
  bool _isHovering = false;
  bool _isPressed = false;

  Color get _effectiveColor {
    // Attempt to extract color from style if provided
    Color baseColor = widget.color;
    if (widget.style?.backgroundColor?.resolve({}) != null) {
      baseColor = widget.style!.backgroundColor!.resolve({})!;
    }
    
    if (widget.isDestructive || baseColor == Colors.red || baseColor == Colors.redAccent) return Colors.redAccent;
    if (widget.isSuccess || baseColor == Colors.green || baseColor == Colors.greenAccent) return Colors.greenAccent;
    return baseColor;
  }

  @override
  Widget build(BuildContext context) {
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
            color: const Color(0xFF1A1A2E),
            borderRadius: BorderRadius.circular(30),
            border: Border.all(
              color: _effectiveColor.withOpacity(glowOpacity * 1.5 > 1 ? 1 : glowOpacity * 1.5),
              width: 1.5,
            ),
            boxShadow: [
              BoxShadow(
                color: _effectiveColor.withOpacity(glowOpacity),
                blurRadius: blurRadius,
                spreadRadius: 2,
                offset: const Offset(0, 0),
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
                    if (widget.iconWidget != null) ...[
                      widget.iconWidget!,
                      const SizedBox(width: 8),
                    ] else if (widget.icon != null) ...[
                      Icon(widget.icon, color: _effectiveColor, size: 20),
                      const SizedBox(width: 8),
                    ],
                    if (widget.child != null) 
                      Flexible(
                        child: DefaultTextStyle(
                          style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.bold,
                            letterSpacing: 1.1,
                          ),
                          child: widget.child!,
                        ),
                      )
                    else if (widget.text != null)
                      Flexible(
                        child: Text(
                          widget.text!,
                          style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.bold,
                            letterSpacing: 1.1,
                          ),
                          overflow: TextOverflow.ellipsis,
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
