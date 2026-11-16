package com.smav.printagent.model

/**
 * Existing receipt, billing and API code refers to Branch, while the current
 * shared model is named Outlet. Both represent the same fields.
 * Typealias avoids a duplicate data model or changing receipt calculations.
 */
typealias Branch = Outlet
