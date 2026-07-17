# React naming conventions

Adopted from [Sufle: Naming Conventions in React](https://www.sufle.io/blog/naming-conventions-in-react). Applies to `apps/pyama` TypeScript/React code.

## Files

Use **kebab-case** for all file names (case-insensitive FS safe):

```
my-component.tsx
use-workspace-scan-sync.ts
query-keys.ts
```

## Components

**PascalCase** for component identifiers. File stays kebab-case:

```tsx
// host-file-picker-dialog.tsx
export function HostFilePickerDialog() {}
```

Context providers/consumers: PascalCase with `Provider` / `Consumer` suffix (`ThemeProvider`).

HOCs: camelCase with `with` prefix (`withAuth`).

## Functions, variables, hooks, props

**camelCase**. Custom hooks start with `use`.

Booleans: prefer `is` / `has` / `should` (`isModalOpen`, `hasError`).

Event handlers: `handle*` or `on*` (`handleInputChange`, `onButtonClick`).

Utilities: meaningful verb prefixes (`getFormattedDate`, `setLocalStorageItem`, `isUserLoggedIn`).

## Constants and enums

- Constants: `UPPER_SNAKE_CASE` (`API_URL`)
- Enum type names: PascalCase (`Colors`)
- Enum members: `UPPER_SNAKE_CASE` (`DARK_BLUE`)

## Types and interfaces

**PascalCase** (`UserInfo`, `AlignState`). Do not prefix with `I`.

## Do not

- PascalCase or camelCase **file** names (`HostFilePickerDialog.tsx`, `queryKeys.ts`)
- snake_case for types/interfaces in this codebase
