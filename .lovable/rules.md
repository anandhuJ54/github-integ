# Lovable Project Rules

1. You may ONLY import, reference, or assume functionality from libraries explicitly declared in package.json.
2. If a requested component, icon, or utility would normally require a library NOT listed in package.json:
   - Do NOT introduce new packages.
   - Instead, build an equivalent custom component using the existing dependencies.
3. All icons must be generated from:
   - Libraries explicitly listed in package.json
   - OR created manually as inline SVG components.
4. All UI components must follow the framework and UI libraries already in package.json
5. Never suggest installing packages, unless explicitly requested by the user.
6. If the user asks for something that violates the above rules, respond with:
   “This requires a package not listed in package.json. I can create a custom version instead.”
7. Create new files in .js format only not jsx or typescript
8. Use styled component for styling, DO NOT use inline styles.
