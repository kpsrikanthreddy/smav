package com.smav.printagent.ui.theme

import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

object SmavColors {
    val Background = Color(0xFFF5F6FA)
    val Surface = Color(0xFFFFFFFF)
    val SurfaceSubtle = Color(0xFFF9FAFC)
    val SurfaceHover = Color(0xFFF1F3F9)

    val TextPrimary = Color(0xFF2F3033)
    val TextSecondary = Color(0xFF6F737D)
    val TextMuted = Color(0xFF8B909C)

    val Border = Color(0xFFE5E7EC)
    val BorderStrong = Color(0xFFD3D7E0)

    val StepperGreen = Color(0xFF15803D)
    val StepperGreenPressed = Color(0xFF166534)
    val StepperGreenSoft = Color(0xFFECFDF5)

    val AccentPink = Color(0xFFFF1B7A)
    val AccentOrange = Color(0xFFFF6A00)
    val AccentAmber = Color(0xFFFFA500)

    val InfoBg = Color(0xFFEFF6FF)
    val InfoText = Color(0xFF1D4ED8)
    val InfoBorder = Color(0xFFBFDBFE)

    val SuccessBg = Color(0xFFECFDF5)
    val SuccessText = Color(0xFF15803D)
    val SuccessBorder = Color(0xFFBBF7D0)

    val WarningBg = Color(0xFFFFFBEB)
    val WarningText = Color(0xFFB45309)
    val WarningBorder = Color(0xFFFDE68A)

    val DangerBg = Color(0xFFFEF2F2)
    val DangerText = Color(0xFFB91C1C)
    val DangerBorder = Color(0xFFFECACA)

    val BrandGradientBrush = Brush.horizontalGradient(
        colors = listOf(AccentPink, AccentOrange, AccentAmber)
    )
}

object SmavMetrics {
    val ScreenPadding = 16.dp
    val CardPadding = 14.dp
    val CardRadius = 16.dp
    val SmallRadius = 12.dp
    val PillRadius = 10.dp
    val MinTouchTarget = 48.dp
    val CompactTouchTarget = 44.dp
}
