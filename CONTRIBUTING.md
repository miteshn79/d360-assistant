# Contributing to D360 Assistant

Welcome! This guide is for **solution engineers** who want to contribute to the app using AI coding tools like **Claude Code**, **Cursor**, or **Gemini CLI**.

## Quick Start

### 1. Clone the Repository
```bash
git clone https://github.com/YOUR_ORG/d360-assistant.git
cd d360-assistant
```

### 2. Set Up Your Environment
```bash
# Backend (Python)
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt

# Frontend (Node.js)
cd ../frontend
npm install
```

### 3. Run Locally
```bash
# Terminal 1: Backend
cd backend
uvicorn api:app --reload --port 8000

# Terminal 2: Frontend
cd frontend
npm run dev
```

Visit http://localhost:3000

---

## How to Contribute

### Using AI Coding Tools

We encourage using AI tools! Here's how to work effectively:

#### Claude Code
```bash
# Start Claude Code in the project directory
claude

# Good prompts:
"Add a new filter option to the Data Explorer for date ranges"
"Fix the bug where the dropdown doesn't load on the Retrieve page"
"Add a loading spinner to the Customer Journey page"
```

#### Cursor
- Open the project in Cursor
- Use Cmd+K (Mac) or Ctrl+K (Windows) to prompt
- Reference specific files: "In retrieve.tsx, add a reset button"

#### Gemini CLI
```bash
gemini "Help me add a new feature to stream.tsx"
```

### The Workflow

```
1. Create a branch     →  git checkout -b feature/my-feature
2. Make changes        →  Use your AI tool
3. Test locally        →  npm run dev / uvicorn api:app --reload
4. Commit              →  git add . && git commit -m "Add feature X"
5. Push                →  git push origin feature/my-feature
6. Create PR           →  Go to GitHub and create a Pull Request
7. Get review          →  Tag a teammate
8. Merge               →  Once approved, merge to main
9. Auto-deploy!        →  GitHub Actions deploys to Heroku
```

### Branch Naming

- `feature/` - New features (e.g., `feature/add-export-button`)
- `fix/` - Bug fixes (e.g., `fix/dropdown-not-loading`)
- `docs/` - Documentation (e.g., `docs/update-readme`)

### Commit Messages

Keep them simple and descriptive:
- ✅ "Add date range filter to Data Explorer"
- ✅ "Fix metadata not loading on connect"
- ❌ "Fixed stuff"
- ❌ "WIP"

---

## Project Structure

```
d360-assistant/
├── backend/                 # Python FastAPI backend
│   ├── api.py              # Main API endpoints
│   ├── data_cloud_client.py # Salesforce Data Cloud client
│   └── requirements.txt
│
├── frontend/               # Next.js frontend
│   ├── src/
│   │   ├── app/           # Pages (routes)
│   │   ├── components/    # React components
│   │   │   ├── views/     # Page-specific views
│   │   │   └── layout/    # Layout components
│   │   └── lib/           # Utilities, API client, store
│   └── package.json
│
├── .github/
│   ├── workflows/         # CI/CD automation
│   └── ISSUE_TEMPLATE/    # Bug/Enhancement templates
│
└── CONTRIBUTING.md        # This file!
```

### Key Files to Know

| File | Purpose |
|------|---------|
| `frontend/src/lib/api.ts` | API client - add new endpoints here |
| `frontend/src/lib/store.ts` | Global state management |
| `frontend/src/components/views/*.tsx` | Page components |
| `frontend/src/components/layout/sidebar.tsx` | Navigation menu |
| `backend/api.py` | All backend endpoints |

---

## Common Tasks

### Adding a New Page

1. Create the page route:
   ```
   frontend/src/app/my-page/page.tsx
   ```

2. Create the view component:
   ```
   frontend/src/components/views/my-page.tsx
   ```

3. Add to sidebar:
   ```
   frontend/src/components/layout/sidebar.tsx
   ```

**Pro tip:** Tell your AI tool: "Add a new page called X, following the pattern of the Data Explorer page"

### Adding a New API Endpoint

1. Add to backend `api.py`
2. Add to frontend `api.ts`
3. Use in your component

### Fixing a Bug

1. Reproduce the bug locally
2. Find the relevant file
3. Ask your AI tool: "In [file], fix the bug where [description]"
4. Test the fix
5. Create a PR

---

## Need Help?

- **Stuck?** Create a GitHub Issue with the "help wanted" label
- **Found a bug?** Use the Bug Report template
- **Have an idea?** Use the Enhancement Request template
- **Questions?** Reach out to the team on Slack

---

## Code Style

Don't worry too much about style - the AI tools generally follow good practices. Just ensure:

- Components are in the right folders
- No console.log statements left in code
- Test your changes locally before pushing

Happy coding! 🚀
