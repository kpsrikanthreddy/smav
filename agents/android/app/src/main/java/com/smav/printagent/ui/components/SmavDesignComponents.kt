package com.smav.printagent.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.smav.printagent.ui.theme.SmavColors
import com.smav.printagent.ui.theme.SmavMetrics
import com.smav.printagent.ui.theme.SmavNumericStyles
import java.util.Locale

@Composable
fun smavOutlinedFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedTextColor = SmavColors.TextPrimary,
    unfocusedTextColor = SmavColors.TextPrimary,
    disabledTextColor = SmavColors.TextSecondary,
    focusedContainerColor = SmavColors.Surface,
    unfocusedContainerColor = SmavColors.Surface,
    disabledContainerColor = SmavColors.SurfaceSubtle,
    focusedBorderColor = SmavColors.AccentPink,
    unfocusedBorderColor = SmavColors.Border,
    focusedLabelColor = SmavColors.AccentPink,
    unfocusedLabelColor = SmavColors.TextSecondary,
    focusedPlaceholderColor = SmavColors.TextMuted,
    unfocusedPlaceholderColor = SmavColors.TextMuted,
    cursorColor = SmavColors.AccentPink
)

@Composable
fun SmavCard(
    modifier: Modifier = Modifier,
    highlighted: Boolean = false,
    highlightColor: Color = SmavColors.StepperGreen,
    onClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit
) {
    val border = BorderStroke(
        width = 1.dp,
        color = if (highlighted) highlightColor.copy(alpha = 0.45f) else SmavColors.Border
    )
    val shape = RoundedCornerShape(SmavMetrics.CardRadius)
    if (onClick != null) {
        Card(
            onClick = onClick,
            modifier = modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = SmavColors.Surface),
            border = border,
            shape = shape,
            elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
        ) {
            Column(
                modifier = Modifier.padding(SmavMetrics.CardPadding),
                verticalArrangement = Arrangement.spacedBy(8.dp),
                content = content
            )
        }
    } else {
        Card(
            modifier = modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = SmavColors.Surface),
            border = border,
            shape = shape,
            elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
        ) {
            Column(
                modifier = Modifier.padding(SmavMetrics.CardPadding),
                verticalArrangement = Arrangement.spacedBy(8.dp),
                content = content
            )
        }
    }
}

@Composable
fun SmavGradientButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    enabled: Boolean = true,
    busy: Boolean = false
) {
    val shape = RoundedCornerShape(SmavMetrics.SmallRadius)
    val isClickable = enabled && !busy
    Box(
        modifier = modifier
            .heightIn(min = SmavMetrics.MinTouchTarget)
            .clip(shape)
            .alpha(if (isClickable) 1f else 0.52f)
            .background(SmavColors.BrandGradientBrush, shape)
            .clickable(enabled = isClickable, onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        contentAlignment = Alignment.Center
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center
        ) {
            if (busy) {
                CircularProgressIndicator(
                    modifier = Modifier.size(18.dp),
                    color = Color.White,
                    strokeWidth = 2.dp
                )
                Spacer(Modifier.width(8.dp))
            } else if (icon != null) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(18.dp)
                )
                Spacer(Modifier.width(8.dp))
            }
            Text(
                text = text,
                color = Color.White,
                fontWeight = FontWeight.Bold,
                fontSize = 14.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

@Composable
fun SmavSecondaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    enabled: Boolean = true,
    textColor: Color = SmavColors.TextPrimary
) {
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.heightIn(min = SmavMetrics.MinTouchTarget),
        shape = RoundedCornerShape(SmavMetrics.SmallRadius),
        border = BorderStroke(1.dp, SmavColors.Border),
        colors = ButtonDefaults.outlinedButtonColors(
            containerColor = SmavColors.Surface,
            contentColor = textColor,
            disabledContainerColor = SmavColors.SurfaceSubtle,
            disabledContentColor = SmavColors.TextMuted
        ),
        contentPadding = PaddingValues(horizontal = 14.dp, vertical = 10.dp)
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, modifier = Modifier.size(17.dp))
            Spacer(Modifier.width(6.dp))
        }
        Text(
            text = text,
            fontWeight = FontWeight.SemiBold,
            fontSize = 13.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}

@Composable
fun SmavLabeledField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String = "",
    helperText: String? = null,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    singleLine: Boolean = true,
    modifier: Modifier = Modifier
) {
    Column(modifier = modifier.fillMaxWidth()) {
        Text(
            text = label,
            color = SmavColors.TextPrimary,
            fontSize = 13.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(bottom = 6.dp)
        )
        OutlinedTextField(
            value = value,
            onValueChange = onValueChange,
            placeholder = {
                if (placeholder.isNotBlank()) {
                    Text(placeholder, color = SmavColors.TextMuted, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            },
            singleLine = singleLine,
            keyboardOptions = keyboardOptions,
            keyboardActions = keyboardActions,
            colors = smavOutlinedFieldColors(),
            shape = RoundedCornerShape(SmavMetrics.SmallRadius),
            modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)
        )
        if (!helperText.isNullOrBlank()) {
            Text(
                text = helperText,
                color = SmavColors.TextSecondary,
                fontSize = 11.sp,
                modifier = Modifier.padding(top = 4.dp)
            )
        }
    }
}

@Composable
fun SmavPasswordField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String = "Enter password",
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    modifier: Modifier = Modifier
) {
    var visible by remember { mutableStateOf(false) }
    Column(modifier = modifier.fillMaxWidth()) {
        Text(
            text = label,
            color = SmavColors.TextPrimary,
            fontSize = 13.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(bottom = 6.dp)
        )
        OutlinedTextField(
            value = value,
            onValueChange = onValueChange,
            placeholder = { Text(placeholder, color = SmavColors.TextMuted, fontSize = 13.sp) },
            singleLine = true,
            visualTransformation = if (visible) VisualTransformation.None else PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            keyboardActions = keyboardActions,
            trailingIcon = {
                IconButton(onClick = { visible = !visible }, modifier = Modifier.size(48.dp)) {
                    Icon(
                        imageVector = if (visible) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                        contentDescription = if (visible) "Hide password" else "Show password",
                        tint = SmavColors.TextSecondary
                    )
                }
            },
            colors = smavOutlinedFieldColors(),
            shape = RoundedCornerShape(SmavMetrics.SmallRadius),
            modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)
        )
    }
}

@Composable
fun SmavQuantityStepper(
    quantity: Int,
    onIncrement: () -> Unit,
    onDecrement: () -> Unit,
    itemName: String = "item",
    addLabel: String = "ADD",
    enabled: Boolean = true
) {
    if (quantity <= 0) {
        OutlinedButton(
            onClick = onIncrement,
            enabled = enabled,
            shape = RoundedCornerShape(SmavMetrics.PillRadius),
            border = BorderStroke(1.2.dp, if (enabled) SmavColors.StepperGreen else SmavColors.BorderStrong),
            colors = ButtonDefaults.outlinedButtonColors(
                containerColor = SmavColors.Surface,
                contentColor = SmavColors.StepperGreen,
                disabledContainerColor = SmavColors.SurfaceSubtle,
                disabledContentColor = SmavColors.TextMuted
            ),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 0.dp),
            modifier = Modifier
                .defaultMinSize(minWidth = 84.dp, minHeight = SmavMetrics.CompactTouchTarget)
                .height(SmavMetrics.CompactTouchTarget)
                .semantics { contentDescription = "Add $itemName" }
        ) {
            Text(
                text = addLabel,
                fontWeight = FontWeight.Bold,
                fontSize = 12.sp,
                letterSpacing = 0.4.sp
            )
        }
    } else {
        Surface(
            color = SmavColors.StepperGreen,
            shape = RoundedCornerShape(SmavMetrics.PillRadius),
            modifier = Modifier
                .defaultMinSize(minWidth = 104.dp, minHeight = SmavMetrics.CompactTouchTarget)
                .height(SmavMetrics.CompactTouchTarget)
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Box(
                    modifier = Modifier
                        .size(width = 36.dp, height = SmavMetrics.CompactTouchTarget)
                        .clickable(enabled = enabled, onClick = onDecrement)
                        .semantics { contentDescription = "Decrease quantity of $itemName" },
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.Remove,
                        contentDescription = null,
                        tint = Color.White,
                        modifier = Modifier.size(16.dp)
                    )
                }
                Text(
                    text = quantity.toString(),
                    style = SmavNumericStyles.Counter,
                    color = Color.White,
                    modifier = Modifier.padding(horizontal = 4.dp)
                )
                Box(
                    modifier = Modifier
                        .size(width = 36.dp, height = SmavMetrics.CompactTouchTarget)
                        .clickable(enabled = enabled, onClick = onIncrement)
                        .semantics { contentDescription = "Increase quantity of $itemName" },
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.Add,
                        contentDescription = null,
                        tint = Color.White,
                        modifier = Modifier.size(16.dp)
                    )
                }
            }
        }
    }
}

@Composable
fun SmavItemCard(
    title: String,
    subtitle: String? = null,
    meta: String? = null,
    price: Double,
    mrp: Double? = null,
    discountLabel: String? = null,
    quantity: Int,
    onIncrement: () -> Unit,
    onDecrement: () -> Unit,
    addLabel: String = "ADD",
    enabled: Boolean = true,
    disabledReason: String? = null,
    badgeText: String? = null,
    badgeColor: Color = SmavColors.StepperGreen,
    footer: (@Composable ColumnScope.() -> Unit)? = null
) {
    SmavCard(
        highlighted = quantity > 0,
        highlightColor = SmavColors.StepperGreen
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.Top
        ) {
            Column(
                modifier = Modifier
                    .weight(1f)
                    .padding(end = 12.dp),
                verticalArrangement = Arrangement.spacedBy(3.dp)
            ) {
                if (!badgeText.isNullOrBlank()) {
                    StatusBadgeChip(text = badgeText, color = badgeColor)
                }
                Text(
                    text = title,
                    color = SmavColors.TextPrimary,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 14.sp,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
                if (!subtitle.isNullOrBlank()) {
                    Text(
                        text = subtitle,
                        color = SmavColors.TextSecondary,
                        fontSize = 12.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
                if (!meta.isNullOrBlank()) {
                    Text(
                        text = meta,
                        color = SmavColors.TextMuted,
                        fontSize = 11.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
                if (!enabled && !disabledReason.isNullOrBlank()) {
                    Text(
                        text = disabledReason,
                        color = SmavColors.WarningText,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Medium
                    )
                }

                Row(
                    modifier = Modifier.padding(top = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text(
                        text = "Rs. ${String.format(Locale.ENGLISH, "%.2f", price)}",
                        style = SmavNumericStyles.Price,
                        color = SmavColors.TextPrimary
                    )
                    if (mrp != null && mrp > price) {
                        Text(
                            text = "Rs. ${String.format(Locale.ENGLISH, "%.2f", mrp)}",
                            style = SmavNumericStyles.Price.copy(
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Normal,
                                textDecoration = TextDecoration.LineThrough
                            ),
                            color = SmavColors.TextMuted
                        )
                    }
                    if (!discountLabel.isNullOrBlank()) {
                        Text(
                            text = discountLabel,
                            color = SmavColors.InfoText,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.SemiBold
                        )
                    }
                }
            }

            SmavQuantityStepper(
                quantity = quantity,
                onIncrement = onIncrement,
                onDecrement = onDecrement,
                itemName = title,
                addLabel = addLabel,
                enabled = enabled
            )
        }

        if (footer != null) {
            HorizontalDivider(color = SmavColors.Border)
            Column(verticalArrangement = Arrangement.spacedBy(6.dp), content = footer)
        }
    }
}

@Composable
fun SmavCheckoutBottomBar(
    countLabel: String,
    totalAmount: Double,
    ctaText: String,
    ctaEnabled: Boolean,
    ctaIcon: ImageVector? = null,
    onCtaClick: () -> Unit
) {
    Surface(
        color = SmavColors.Surface,
        shadowElevation = 6.dp,
        border = BorderStroke(1.dp, SmavColors.Border),
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(
                modifier = Modifier
                    .weight(1f)
                    .padding(end = 12.dp)
            ) {
                Text(
                    text = countLabel,
                    color = SmavColors.TextSecondary,
                    fontSize = 12.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = "Rs. ${String.format(Locale.ENGLISH, "%.0f", totalAmount)}",
                    style = SmavNumericStyles.PriceLarge,
                    color = SmavColors.TextPrimary
                )
            }
            SmavGradientButton(
                text = ctaText,
                icon = ctaIcon,
                enabled = ctaEnabled,
                onClick = onCtaClick
            )
        }
    }
}

@Composable
fun SmavSuccessBannerCard(message: String) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = SmavColors.SuccessBg),
        border = BorderStroke(1.dp, SmavColors.SuccessBorder),
        shape = RoundedCornerShape(SmavMetrics.SmallRadius)
    ) {
        Text(
            text = message,
            color = SmavColors.SuccessText,
            fontSize = 13.sp,
            fontWeight = FontWeight.Medium,
            modifier = Modifier.padding(12.dp)
        )
    }
}

@Composable
fun SmavWarningBannerCard(message: String) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = SmavColors.WarningBg),
        border = BorderStroke(1.dp, SmavColors.WarningBorder),
        shape = RoundedCornerShape(SmavMetrics.SmallRadius)
    ) {
        Text(
            text = message,
            color = SmavColors.WarningText,
            fontSize = 13.sp,
            fontWeight = FontWeight.Medium,
            modifier = Modifier.padding(12.dp)
        )
    }
}
