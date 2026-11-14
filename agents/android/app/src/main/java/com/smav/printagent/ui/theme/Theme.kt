package com.smav.printagent.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val Slate900 = Color(0xFF0F172A)
val Slate800 = Color(0xFF1E293B)
val Slate700 = Color(0xFF334155)
val Sky500 = Color(0xFF0284C7)
val Sky400 = Color(0xFF38BDF8)
val Rose600 = Color(0xFFE11D48)
val Amber500 = Color(0xFFF59E0B)
val Emerald500 = Color(0xFF10B981)
val Slate100 = Color(0xFFF1F5F9)

private val DarkColorScheme = darkColorScheme(
    primary = Sky400,
    secondary = Rose600,
    tertiary = Amber500,
    background = Color(0xFF0B0F19),
    surface = Slate900,
    onPrimary = Color.Black,
    onBackground = Slate100,
    onSurface = Slate100
)

@Composable
fun SMAVTheme(
    darkTheme: Boolean = true, // Default to dark for counter screens
    content: @Composable () -> Unit
) {
    MaterialTheme(
        colorScheme = DarkColorScheme,
        content = content
    )
}
