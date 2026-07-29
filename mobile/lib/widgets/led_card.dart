import 'package:flutter/material.dart';

class LedCard extends StatefulWidget {
  final Widget child;
  final Color color;
  final EdgeInsetsGeometry? margin;
  final EdgeInsetsGeometry? padding;
  final double borderRadius;
  final bool isInteractive;
  final VoidCallback? onTap;
  final double? elevation;
  final ShapeBorder? shape;

  const LedCard({
    Key? key,
    required this.child,
    this.color = const Color(0xFFCE93D8), // Default purple
    this.margin,
    this.padding,
    this.borderRadius = 16.0,
    this.isInteractive = false,
    this.onTap,
    this.elevation,
    this.shape,
  }) : super(key: key);

  @override
  _LedCardState createState() => _LedCardState();
}

class _LedCardState extends State<LedCard> {
  bool _isHovering = false;

  @override
  Widget build(BuildContext context) {
    final glowOpacity = widget.isInteractive && _isHovering ? 0.3 : 0.1;
    final blurRadius = widget.isInteractive && _isHovering ? 15.0 : 8.0;

    Widget cardContent = Container(
      margin: widget.margin,
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A2E), // Dark background matching app
        borderRadius: BorderRadius.circular(widget.borderRadius),
        border: Border.all(
          color: widget.color.withOpacity(0.5),
          width: 1.0,
        ),
        boxShadow: [
          BoxShadow(
            color: widget.color.withOpacity(glowOpacity),
            blurRadius: blurRadius,
            spreadRadius: 1,
            offset: const Offset(0, 0),
          ),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(widget.borderRadius),
        child: InkWell(
          borderRadius: BorderRadius.circular(widget.borderRadius),
          onTap: widget.onTap,
          hoverColor: widget.color.withOpacity(0.1),
          child: Padding(
            padding: widget.padding ?? const EdgeInsets.all(0),
            child: widget.child,
          ),
        ),
      ),
    );

    if (widget.isInteractive) {
      return MouseRegion(
        onEnter: (_) => setState(() => _isHovering = true),
        onExit: (_) => setState(() => _isHovering = false),
        child: cardContent,
      );
    }

    return cardContent;
  }
}
