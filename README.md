# Data Cloud Assistant - Modern UI

A modern, responsive interface for Salesforce Data Cloud operations built with Next.js and FastAPI.

## Features

- **Modern UI** - Clean, responsive design with Tailwind CSS
- **AI-Powered Setup** - Chat interface for designing data schemas
- **Real-time Streaming** - Send events to Data Cloud Ingestion API
- **Data Retrieval** - Query Data Graphs and profiles
- **SQL Query** - Execute queries against Data Cloud
- **Bulk Upload** - CSV file uploads for batch ingestion
- **Metadata Explorer** - Browse Data Cloud objects and fields

## Tech Stack

- **Frontend:** Next.js 14, React 18, Tailwind CSS, React Query, Zustand
- **Backend:** FastAPI, Python 3.11+
- **APIs:** Salesforce Data Cloud REST APIs

## Quick Start

### 1. Start the Backend

```bash
cd backend

# Create virtual environment (optional but recommended)
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Set environment variables (optional)
export LLM_API_KEY=your_api_key  # For AI chat features

# Run the server
python api.py
# Or with uvicorn:
uvicorn api:app --reload --port 8000
```

The backend will run at `http://localhost:8000`

### 2. Start the Frontend

```bash
cd frontend

# Install dependencies
npm install

# Run development server
npm run dev
```

The frontend will run at `http://localhost:3000`

## Usage

1. **Connect to Salesforce**
   - Enter your Connected App's Consumer Key
   - Click "Connect to Salesforce" to authenticate
   - Exchange for a Data Cloud token

2. **Setup Assistant**
   - Choose a pre-built template or describe your use case
   - Get AI-powered schema design help
   - Download YAML configurations

3. **Stream Data**
   - Paste your YAML schema
   - Generate test payloads
   - Send to Data Cloud Ingestion API

4. **Retrieve Data**
   - Enter your Data Graph name
   - Provide lookup keys
   - View unified profile data

## Configuration

### Connected App Setup

Your Salesforce Connected App needs:
- OAuth scopes: `api`, `cdp_ingest_api`, `cdp_query_api`, `cdp_profile_api`
- Callback URL: `http://localhost:3000/oauth/callback`
- Enable PKCE

### Environment Variables

Backend (optional):
```
LLM_API_KEY=your_perplexity_or_openai_key
PERPLEXITY_API_KEY=your_key
OPENAI_API_KEY=your_key
ANTHROPIC_API_KEY=your_key
```

Frontend:
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## Project Structure

```
streamingapp-modern/
├── backend/
│   ├── api.py              # FastAPI server
│   ├── data_cloud_client.py # Data Cloud API client
│   ├── salesforce_oauth.py  # OAuth helpers
│   ├── llm_client.py       # AI chat integration
│   ├── generators.py       # Payload generators
│   ├── yaml_schema.py      # Schema parsing
│   └── templates/          # Use case templates
├── frontend/
│   ├── src/
│   │   ├── app/            # Next.js pages
│   │   ├── components/     # React components
│   │   └── lib/            # Utilities & API client
│   ├── package.json
│   └── tailwind.config.ts
└── README.md
```

## Comparison with Streamlit Version

| Feature | Streamlit | Modern UI |
|---------|-----------|-----------|
| UI Framework | Streamlit | Next.js + Tailwind |
| Chat Interface | Basic | Modern chat bubbles |
| Navigation | Step-by-step | Sidebar navigation |
| State Management | Session state | Zustand (persisted) |
| API Architecture | Monolithic | Separate frontend/backend |
| Responsiveness | Limited | Fully responsive |

## Development

### Backend

```bash
cd backend
uvicorn api:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm run dev
```

## License

Internal Salesforce use only.
