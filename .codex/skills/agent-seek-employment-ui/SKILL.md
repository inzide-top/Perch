---
name: agent-seek-employment-ui
description: Use when modifying Agent Seek Employment UI, forms, layout, visual styling, or interaction components. Enforces Nuxt UI first, consistent form density, labels, borders, states, and project-specific visual coherence.
---

# Agent Seek Employment UI Rules

## Component priority

- Prefer Nuxt UI components for all UI primitives: form fields, inputs, selects, popovers, modals, drawers, calendars, buttons, badges, tabs, cards, and notifications.
- Before replacing a UI control with native HTML or a custom control, check whether Nuxt UI already supports the required behavior.
- Date and time selection must use Nuxt UI date/calendar components by default. If month or range selection is needed, first try `UCalendar` with `type="month"` and/or `range`.
- Use custom components only when they wrap Nuxt UI primitives or when Nuxt UI clearly does not support the interaction.

## Visual consistency

- Adjacent form controls must keep consistent label typography, control height, border color, radius, placeholder color, error text style, and spacing.
- When adding a new form field beside existing fields, copy the local form pattern before inventing new spacing or label treatment.
- Keep form density appropriate for an operations dashboard: compact, scannable, and aligned. Avoid making one optional module visually heavier than the primary resume/JD form.
- Use existing project tokens and utility classes before introducing new raw colors, one-off borders, or arbitrary sizes.

## Interaction consistency

- Popovers, drawers, and modals should avoid scroll bleed and should not obscure fixed action bars.
- When a Popover, Select, Calendar, or confirmation layer is nested inside a drawer or modal, render it through a portal and assign an explicit z-index above its parent overlay. Verify the visible stacking order instead of assuming the default layer is sufficient.
- Validation messages should appear near the relevant field, clear when the value is corrected, and avoid causing large layout jumps.
- Destructive actions should use lightweight confirmation for local list items and stronger confirmation for high-impact deletes.
- Every user-triggered asynchronous action must expose a pending/loading state, prevent duplicate submission while pending, and provide explicit success and failure feedback. Disabled controls must not retain hover, active, or press-scale behavior.

## Implementation discipline

- Keep business data simple and stable; format for display at the edge of the UI.
- Prefer small reusable helpers/components when the same UI behavior appears in resume and opportunity flows.
- When a file grows too large, split by product section and preserve behavior first; do not mix large refactors with unrelated business changes.
- After each code change, report the changed files, the user-visible behavior that changed, and the key control-flow or data-flow logic so the project owner can review and learn from the implementation.
