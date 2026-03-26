# AI Coding Agent Guidelines

## Project Standards & Best Practices

This document guides AI agents working on this codebase to maintain code quality, security, and consistency.

---

## 1. HTML Templates - Preferred Pattern

### Guideline: Prefer HTML `<template>` elements for reusable UI components

Templates are the default approach for UI components because they provide:
- **Security**: Natural XSS protection via `textContent` binding
- **Maintainability**: UI structure lives in HTML, not JS strings
- **Performance**: Parsed once, cloned many times
- **Clarity**: Visual structure is inspectable in HTML files

### Template System Usage

```javascript
// CORRECT - Clone from existing template
const card = cloneTemplate('tpl-drug-card');
card.querySelector('[data-field="generic"]').textContent = drugName;
```

### Programmatic DOM - When Templates Don't Fit

For one-off or dynamic structures where no template exists, build programmatically:

```javascript
// ALSO CORRECT - Programmatic creation when no template fits
const statusDiv = document.createElement('div');
statusDiv.className = 'status-message';
statusDiv.textContent = message;  // Safe, automatically escaped
container.appendChild(statusDiv);
```

### What to Avoid

```javascript
// AVOID - Hardcoded HTML in JS (XSS risk, hard to maintain)
element.innerHTML = `
  <div class="drug-card">
    <div class="drug-name">${drugName}</div>
  </div>
`;

// AVOID - String building then innerHTML
let html = '';
items.forEach(item => {
  html += `<div>${item.name}</div>`;  // XSS risk!
});
container.innerHTML = html;
```

---

## 2. SVG Icons - Use the Sprite System

### Guideline: Reference existing SVGs via `<use>`

```html
<svg class="icon"><use href="#icon-name"/></svg>
```

Adding new icons:
1. Add SVG symbol to the sprite in `index.html`
2. Reference via `<use href="#icon-name"/>`

### What to Avoid

```javascript
// AVOID - Inline SVGs in JS
button.innerHTML = `<svg>...</svg> Loading...`;
```

For loading states, use text or CSS classes instead of inline SVGs.

---

## 3. XSS Prevention - Security First

### Guideline: Use `textContent` for dynamic data

```javascript
// CORRECT - Always safe
element.textContent = userInput;

// ALSO CORRECT - If you MUST use innerHTML, escape first
function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
element.innerHTML = `<span>${escapeHTML(userInput)}</span>`;
```

---

## 4. When to Reuse vs. Create New

### Reuse Existing Patterns When:
- The UI element already exists (check `index.html` for templates)
- The functionality has a similar use case
- The pattern fits without forcing it

### Create New Patterns When:
- The existing template requires significant hacks to work
- The use case is genuinely different (don't force a card to be a list)
- You're adding a new concept that will be reused

### Finding Existing Patterns

Search before creating:

```bash
# Find templates
grep -n "id=\"tpl-" index.html

# Find utility functions
grep -n "cloneTemplate\|getTemplate" *.js

# Find SVG icons
grep -n "id=\"icon-" index.html
```

---

## 5. Pattern Evolution

### Don't Force Fit

If an existing pattern feels wrong for your use case, **don't use it**. Instead:

1. Create a new template/function that fits naturally
2. Follow the spirit of existing patterns (security, clarity)
3. Use consistent naming (e.g., `tpl-` prefix, `data-field` attributes)

### Naming Conventions

When creating new templates:
- Prefix with `tpl-`: `tpl-component-name`
- Use kebab-case for IDs
- Use `data-field` attributes for bindable content

```html
<template id="tpl-my-component">
  <div class="my-component">
    <span data-field="title"></span>
  </div>
</template>
```

---

## 6. Common Patterns Reference

### Data Binding Pattern

```html
<template id="tpl-example">
  <div class="card">
    <span data-field="title"></span>
    <span data-field="description"></span>
  </div>
</template>
```

```javascript
const el = cloneTemplate('tpl-example');
el.querySelector('[data-field="title"]').textContent = data.title;
```

### Modal Pattern

```javascript
const modalWrapper = cloneTemplate('tpl-modal');
const modal = modalWrapper.querySelector('.modal');
modal.querySelector('[data-field="title"]').textContent = data.title;
document.body.appendChild(modal);

// Wire up close handlers
modal.querySelector('.close-btn').addEventListener('click', () => {
  modal.remove();
});
```

---

## 7. Quick Reference Checklist

Before submitting changes, verify:

- [ ] No `innerHTML` with unsanitized dynamic content
- [ ] Prefer `textContent` for user data
- [ ] Templates use `data-field` attributes for binding
- [ ] New templates follow naming conventions
- [ ] Didn't force-fit an existing pattern that doesn't fit

---

## Summary

**Core Principles:**
1. Prefer templates for reusable UI
2. Use `textContent` for dynamic text
3. Use the SVG sprite system via `<use>`
4. Search before creating - but don't force reuse
5. Follow conventions when creating new patterns

**Remember: Consistency is valuable, but forcing a square peg into a round hole creates technical debt. When in doubt, create a clean new pattern over hacking an old one.**
