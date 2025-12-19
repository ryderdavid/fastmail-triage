#!/bin/bash

# Create project directory
mkdir -p fastmail-triage/src
cd fastmail-triage

# Create package.json
cat > package.json << 'EOF'
{
  "name": "fastmail-triage",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "lucide-react": "^0.263.1",
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.2.1",
    "autoprefixer": "^10.4.16",
    "postcss": "^8.4.32",
    "tailwindcss": "^3.4.0",
    "vite": "^5.0.8"
  }
}
EOF

# Create vite.config.js
cat > vite.config.js << 'EOF'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react()],
    define: {
      'process.env.FASTMAIL_API_KEY': JSON.stringify(env.FASTMAIL_API_KEY),
      'process.env.ANTHROPIC_API_KEY': JSON.stringify(env.ANTHROPIC_API_KEY),
      'process.env.OPENAI_API_KEY': JSON.stringify(env.OPENAI_API_KEY),
    }
  }
})
EOF

# Create tailwind.config.js
cat > tailwind.config.js << 'EOF'
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
EOF

# Create postcss.config.js
cat > postcss.config.js << 'EOF'
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
EOF

# Create .gitignore
cat > .gitignore << 'EOF'
node_modules
.env
.env.local
dist
build
.vscode
.idea
.DS_Store
Thumbs.db
EOF

# Create .env template
cat > .env << 'EOF'
FASTMAIL_API_KEY=your_fastmail_api_key_here
ANTHROPIC_API_KEY=your_anthropic_api_key_here
OPENAI_API_KEY=your_openai_api_key_here
EOF

# Create README.md
cat > README.md << 'EOF'
# Fastmail Email Triage

AI-powered email triage app for Fastmail that classifies emails by importance and provides actionable summaries.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Edit `.env` file with your API keys

3. Run the development server:
```bash
npm run dev
```

4. Open http://localhost:5173 in your browser

## Features

- AI-powered email classification (Haiku 4.5 or GPT-4o Mini)
- Smart caching for Yesterday and Past Week emails
- Interactive chat assistant
- Direct links to Fastmail
- Press Today tab when active to refresh

## Testing

Use "test" for all three credential fields to see mock data.
EOF

# Create index.html
cat > index.html << 'EOF'
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Fastmail Email Triage</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
EOF

# Create src/index.css
cat > src/index.css << 'EOF'
@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
    'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
    sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
EOF

# Create src/main.jsx
cat > src/main.jsx << 'EOF'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
EOF

echo "✅ Project structure created!"
echo "Now you need to create src/App.jsx with the component code."
echo ""
echo "Next steps:"
echo "1. Copy the App.jsx code from the artifact into src/App.jsx"
echo "2. Run: npm install"
echo "3. Edit .env with your API keys"
echo "4. Run: npm run dev"
