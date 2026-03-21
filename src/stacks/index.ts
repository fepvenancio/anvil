export interface StackPreset {
  name: string;
  description: string;
  plannerInstructions: string;
}

const typescript: StackPreset = {
  name: 'typescript',
  description: 'TypeScript + Node 22 + Vitest + Zod (default)',
  plannerInstructions: `DEFAULT STACK:
- TypeScript 5.x, strict mode, ESM ("type": "module")
- Node 22+ (use built-in crypto.randomUUID(), no external UUID lib)
- Vitest for testing
- Zod for runtime validation
- tsconfig.json: strict: true, target: "ES2022", module: "node16", moduleResolution: "node16"
- package.json: "type": "module"
- devDependencies MUST include: typescript, vitest, @types/node (CRITICAL — without @types/node, process/Buffer/etc. cause tsc errors)`,
};

const python: StackPreset = {
  name: 'python',
  description: 'Python 3.12+ + FastAPI + pytest + Pydantic',
  plannerInstructions: `DEFAULT STACK:
- Python 3.12+
- FastAPI for HTTP APIs
- pytest for testing
- Pydantic for validation and data models
- pyproject.toml for project config (PEP 621)
- Use type hints throughout
- Use venv for virtual environment

SCAFFOLD TASK must create:
- pyproject.toml with all dependencies
- src/ directory with __init__.py
- tests/ directory with __init__.py
- requirements.txt (pinned versions)`,
};

const go: StackPreset = {
  name: 'go',
  description: 'Go 1.22+ + Chi router + stdlib testing',
  plannerInstructions: `DEFAULT STACK:
- Go 1.22+
- Chi v5 for HTTP routing (if API)
- Standard library testing package (no external test framework)
- go.mod for dependency management
- Use Go conventions: short variable names, error returns, no exceptions

SCAFFOLD TASK must create:
- go.mod with module path
- main.go with package main
- Sensible directory layout (cmd/, internal/, pkg/ as needed)`,
};

const react: StackPreset = {
  name: 'react',
  description: 'React 19 + Vite + TypeScript + Vitest',
  plannerInstructions: `DEFAULT STACK:
- React 19 with TypeScript
- Vite as build tool
- Vitest for testing with @testing-library/react
- ESM ("type": "module")
- tsconfig.json: strict: true, jsx: "react-jsx"
- CSS Modules or Tailwind (choose based on project needs)

SCAFFOLD TASK must create:
- package.json with react, react-dom, vite, vitest, @testing-library/react
- tsconfig.json with React JSX settings
- vite.config.ts
- index.html entry point
- src/main.tsx entry point
- src/App.tsx root component`,
};

const PRESETS: Record<string, StackPreset> = {
  typescript,
  ts: typescript,
  python,
  py: python,
  go,
  golang: go,
  react,
};

export function getStackPreset(name: string): StackPreset {
  const preset = PRESETS[name.toLowerCase()];
  if (!preset) {
    const available = [...new Set(Object.values(PRESETS).map(p => p.name))].join(', ');
    throw new Error(`Unknown stack "${name}". Available: ${available}`);
  }
  return preset;
}

export function getDefaultStack(): StackPreset {
  return typescript;
}

export function listStacks(): StackPreset[] {
  return [...new Set(Object.values(PRESETS))];
}
