package com.smav.printagent.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// Shared semantic accents calibrated for crisp contrast on white and #F5F6FA surfaces
val Slate900 = SmavColors.Surface
val Slate800 = SmavColors.SurfaceSubtle
val Slate700 = SmavColors.Border
val Sky500 = Color(0xFF0284C7)
val Sky400 = SmavColors.InfoText
val Rose600 = Color(0xFFE11D48)
val Amber500 = SmavColors.WarningText
val Emerald500 = SmavColors.StepperGreen
val Slate100 = SmavColors.TextPrimary

private val SmavLightColorScheme = lightColorScheme(
    primary = SmavColors.AccentPink,
    onPrimary = Color.White,
    primaryContainer = SmavColors.SurfaceHover,
    onPrimaryContainer = SmavColors.TextPrimary,
    secondary = SmavColors.StepperGreen,
    onSecondary = Color.White,
    secondaryContainer = SmavColors.StepperGreenSoft,
    onSecondaryContainer = SmavColors.StepperGreen,
    tertiary = SmavColors.AccentOrange,
    onTertiary = Color.White,
    background = SmavColors.Background,
    onBackground = SmavColors.TextPrimary,
    surface = SmavColors.Surface,
    onSurface = SmavColors.TextPrimary,
    surfaceVariant = SmavColors.SurfaceSubtle,
    onSurfaceVariant = SmavColors.TextSecondary,
    outline = SmavColors.Border,
    outlineVariant = SmavColors.BorderStrong,
    error = SmavColors.DangerText,
    onError = Color.White
)

@Composable
fun SMAVTheme(
    darkTheme: Boolean = false,
    content: @Composable () -> Unit
) {
    MaterialTheme(
        colorScheme = SmavLightColorScheme,
        typography = SmavTypography,
        content = content
    )
}
